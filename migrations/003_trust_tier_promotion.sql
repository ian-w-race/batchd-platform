-- ════════════════════════════════════════════════════════════════════════════
-- Migration 003: Trust tier auto-promotion trigger
-- Phase 1.5 of refactor plan v2 (subsection — auto promotion only;
-- manufacturer claim flow is deferred to a later phase)
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES
--
-- Adds an AFTER INSERT trigger on the scans table that automatically promotes
-- a product's trust tier from `ai_extracted_unverified` or `external_api` to
-- `retailer_validated` once it has been confirmed by enough independent scans.
--
-- Promotion thresholds (per plan v2):
--   - At least 3 scans referencing the same barcode AND same product_name
--   - Across at least 2 distinct organizations
--
-- The trigger ONLY runs the promotion check when:
--   1. The inserted scan has a non-null barcode_number AND organisation_id
--   2. There exists a matching product (by barcode_normalized) currently at
--      'ai_extracted_unverified' or 'external_api' tier
--
-- WHY A DATABASE TRIGGER (vs client-side or scheduled job)
--
-- Atomic: the promotion check runs in the same transaction as the scan insert,
-- so we can't have a state where the threshold is met but the product hasn't
-- been promoted yet. No race conditions.
--
-- Source-agnostic: works regardless of how the scan was inserted (UI save,
-- offline queue replay, future API integrations). All paths get promotion
-- "for free."
--
-- Defensible: the four-tier trust model is structurally enforced in the
-- database, not in client code. Per plan v2 patent strategy, this means
-- attorneys can point to specific RLS policies + this trigger as proof of
-- structural enforcement, not just convention.
--
-- WHY ai_extracted_unverified AND external_api BOTH PROMOTE
--
-- Both represent single-source identifications that haven't been cross-validated.
-- Once N independent retailer scans confirm the same name, both tiers are
-- equally promoted. This honors the plan's intent that retailer-validated is
-- the consensus-derived trust level, regardless of where the unverified
-- identification originally came from.
--
-- WHY manufacturer_registered IS NEVER AUTO-PROMOTED OR DOWNGRADED
--
-- Manufacturer-registered is the highest trust tier and is set only via the
-- (separately-shipped) manufacturer claim flow. The trigger explicitly excludes
-- this tier from auto-promotion logic — it's a defensive guard against any
-- future code path accidentally downgrading or rewriting manufacturer-claimed
-- entries. Per plan v2 "do not collapse trust tiers into a single boolean."
--
-- HOW TO APPLY
--
-- 1. Open Supabase dashboard → SQL Editor
-- 2. Paste the entire file into a new query
-- 3. Click "Run"
-- 4. Verify with the SELECT statements at the bottom (uncomment to run)
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Trigger function. Runs AFTER each scan insert; checks whether the promotion
-- thresholds are now met for the product associated with the scan; promotes if so.
--
-- SECURITY DEFINER: runs with the privileges of the function owner (a privileged
-- role at the postgres level), not the calling user. Required because the calling
-- user is typically a scanner staff with no UPDATE rights on products via RLS.
-- The trigger bypasses RLS to perform the structural promotion the plan requires.
CREATE OR REPLACE FUNCTION promote_product_trust_tier_on_scan() RETURNS TRIGGER AS $$
DECLARE
  v_normalized text;
  v_product_id uuid;
  v_product_name text;
  v_scan_count int;
  v_org_count int;
BEGIN
  -- Cheap exits first: skip if no barcode or no org context.
  IF NEW.barcode_number IS NULL OR NEW.organisation_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_normalized := normalize_barcode(NEW.barcode_number);
  IF v_normalized IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find the matching product. Only candidates for promotion are products
  -- currently at the unverified or external_api tiers — manufacturer_registered
  -- and retailer_validated are skipped.
  SELECT id, name INTO v_product_id, v_product_name
    FROM products
   WHERE barcode_normalized = v_normalized
     AND source IN ('ai_extracted_unverified', 'external_api')
   LIMIT 1;

  IF v_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count scans confirming this product name + barcode pairing across orgs.
  -- Includes the scan being inserted (we're in AFTER INSERT, row is committed
  -- to the trigger's snapshot).
  SELECT COUNT(*), COUNT(DISTINCT organisation_id)
    INTO v_scan_count, v_org_count
    FROM scans
   WHERE normalize_barcode(barcode_number) = v_normalized
     AND product_name = v_product_name
     AND organisation_id IS NOT NULL;

  -- Promote if both thresholds are met.
  -- The WHERE clause defensively re-checks the current source — protects
  -- against a concurrent manufacturer claim flow promoting the row to
  -- manufacturer_registered between our SELECT above and this UPDATE.
  IF v_scan_count >= 3 AND v_org_count >= 2 THEN
    UPDATE products
       SET source = 'retailer_validated'
     WHERE id = v_product_id
       AND source IN ('ai_extracted_unverified', 'external_api');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS scans_promote_product_trust_tier ON scans;
CREATE TRIGGER scans_promote_product_trust_tier
  AFTER INSERT ON scans
  FOR EACH ROW
  EXECUTE FUNCTION promote_product_trust_tier_on_scan();

-- ── Index to speed up the trigger's COUNT query ────────────────────────────
-- The trigger does a COUNT over scans filtered by (normalized barcode, product_name).
-- Since normalize_barcode() is IMMUTABLE we can use it in a functional index.
-- Without this, the trigger would do a sequential scan on every insert — fine
-- at pilot scale, but degrades as the scans table grows.

CREATE INDEX IF NOT EXISTS scans_barcode_normalized_for_promotion
  ON scans (normalize_barcode(barcode_number), product_name)
  WHERE barcode_number IS NOT NULL AND organisation_id IS NOT NULL;

-- ── Verification queries (uncomment to run after migration) ────────────────
--
-- Trigger should exist:
-- SELECT tgname FROM pg_trigger WHERE tgname = 'scans_promote_product_trust_tier';
--
-- Index should exist:
-- SELECT indexname FROM pg_indexes WHERE indexname = 'scans_barcode_normalized_for_promotion';
--
-- After existing scan data is in place, you can manually trigger the trigger
-- on every existing scan to retroactively promote any products that already
-- meet the threshold (run as a one-off):
--
-- UPDATE scans SET barcode_number = barcode_number WHERE id IN (SELECT id FROM scans);
--
-- (The no-op UPDATE fires the AFTER INSERT trigger — wait, it wouldn't, that's
-- only for INSERT. For retroactive promotion, run a one-time SELECT/UPDATE
-- against products manually. See below.)

-- ── ONE-TIME RETROACTIVE PROMOTION (uncomment to run after migration) ─────
-- For products that already meet the threshold from existing scan history,
-- promote them all in one pass. Safe to skip if scans table is small/empty.
--
-- WITH eligible AS (
--   SELECT p.id
--     FROM products p
--     JOIN scans s ON normalize_barcode(s.barcode_number) = p.barcode_normalized
--    WHERE p.source IN ('ai_extracted_unverified', 'external_api')
--      AND s.product_name = p.name
--      AND s.organisation_id IS NOT NULL
--    GROUP BY p.id
--   HAVING COUNT(*) >= 3 AND COUNT(DISTINCT s.organisation_id) >= 2
-- )
-- UPDATE products SET source = 'retailer_validated'
--  WHERE id IN (SELECT id FROM eligible)
--    AND source IN ('ai_extracted_unverified', 'external_api');

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK BLOCK (only run if migration needs to be undone)
-- ════════════════════════════════════════════════════════════════════════════
-- BEGIN;
--   DROP TRIGGER IF EXISTS scans_promote_product_trust_tier ON scans;
--   DROP FUNCTION IF EXISTS promote_product_trust_tier_on_scan();
--   DROP INDEX IF EXISTS scans_barcode_normalized_for_promotion;
-- COMMIT;

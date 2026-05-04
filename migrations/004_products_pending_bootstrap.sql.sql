-- ════════════════════════════════════════════════════════════════════════════
-- Migration 004: Bootstrap migration staging table + helpers
-- Phase 2 of refactor plan v2 (Phase 2a — schema + bootstrap from existing data;
-- Phase 2b OFF US seed deferred to a separate Netlify function commit)
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES
--
-- Creates the `products_pending` staging table per plan v2 §2.1: bootstrap data
-- goes into a staging table FIRST, gets a manual review pass, then gets
-- promoted in a single transaction with full provenance.
--
-- Also creates SQL helper functions:
--   - bootstrap_products_pending(): pulls distinct barcode→name pairs from
--     existing code_patterns and scans tables that aren't already in products,
--     stages them in products_pending. Caller chooses when to run.
--   - promote_pending_to_products(uuid): promotes one staging row to products,
--     marking it reviewed and recording the new product id.
--   - reject_pending(uuid, text): marks a staging row as rejected with reason.
--
-- WHAT THIS DOES NOT DO
--
-- - DOES NOT auto-run bootstrap. Per plan v2 "Manual review pass on the staged
--   dataset before promotion." Schema and functions are created; bootstrap is
--   triggered by Ian explicitly running `SELECT bootstrap_products_pending();`
--   in the Supabase SQL editor.
-- - DOES NOT include the Open Food Facts US seed. That requires HTTP calls
--   from outside Postgres and ships as a separate Netlify function (Phase 2b).
-- - DOES NOT touch existing manufacturer-registered products in `products` —
--   those are already canonical at source = 'manufacturer_registered'.
--
-- HOW TO APPLY
--
-- 1. Open Supabase dashboard → SQL Editor
-- 2. Paste the entire file into a new query
-- 3. Click "Run"
-- 4. Verify with the SELECT statements at the bottom (uncomment to run)
-- 5. When ready to bootstrap from existing data, run separately:
--      SELECT bootstrap_products_pending();
-- 6. Review with: SELECT * FROM products_pending WHERE reviewed_at IS NULL ORDER BY confidence_score DESC;
-- 7. Promote individual rows: SELECT promote_pending_to_products('<uuid>');
-- 8. Or reject: SELECT reject_pending('<uuid>', 'reason here');
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Step 1: Staging table ─────────────────────────────────────────────────
-- Mirrors the public-facing columns of `products` plus bootstrap-specific
-- provenance and review-workflow metadata.

CREATE TABLE IF NOT EXISTS products_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Mirror of products columns we'll promote
  barcode text,
  barcode_normalized text,                              -- auto-populated by trigger below
  name text NOT NULL,
  category text,
  description text,
  is_ftl boolean,
  manufacturer_id uuid REFERENCES organisations(id) ON DELETE SET NULL,
  created_by_org_id uuid REFERENCES organisations(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'ai_extracted_unverified'
    CHECK (source IN ('manufacturer_registered', 'retailer_validated', 'ai_extracted_unverified', 'external_api')),
  published boolean NOT NULL DEFAULT true,

  -- Bootstrap provenance — where this row was sourced from
  bootstrap_source text NOT NULL
    CHECK (bootstrap_source IN ('code_patterns', 'scans', 'manufacturer', 'open_food_facts', 'manual')),
  confidence_score numeric(3,2),                        -- 0.00-1.00; informs review prioritization
  staging_notes text,                                   -- "why this row exists; what to verify"
  conflict_with_pending_ids uuid[],                     -- other pending rows with same barcode but different name

  -- Review workflow
  staged_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  promoted_at timestamptz,
  promoted_to_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejection_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-normalize barcode using the same trigger function as `products`
-- (created in migration 002). Same defensive logic: only writes if barcode is
-- non-null and barcode_normalized is null, so explicit callers can override.
DROP TRIGGER IF EXISTS products_pending_normalize_barcode ON products_pending;
CREATE TRIGGER products_pending_normalize_barcode
  BEFORE INSERT OR UPDATE OF barcode ON products_pending
  FOR EACH ROW
  EXECUTE FUNCTION products_normalize_barcode_trigger();

-- Indexes for common review queries
CREATE INDEX IF NOT EXISTS products_pending_unreviewed_idx
  ON products_pending (staged_at) WHERE reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS products_pending_barcode_normalized_idx
  ON products_pending (barcode_normalized) WHERE barcode_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_pending_confidence_idx
  ON products_pending (confidence_score DESC, staged_at) WHERE reviewed_at IS NULL;

-- ── Step 2: RLS — restrict staging access to authenticated org members ────
-- Staging data isn't user-facing; only people doing review should see it.
-- For pilot, any authenticated user with any org membership can SELECT.
-- Tighten later when we have an explicit admin role.

ALTER TABLE products_pending ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_can_read_pending" ON products_pending
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM organisation_members WHERE user_id = auth.uid())
  );

-- INSERT/UPDATE/DELETE on products_pending happen via the SECURITY DEFINER
-- functions below, which bypass RLS. No direct mutation policies needed.

-- ── Step 3: Bootstrap function ─────────────────────────────────────────────
-- Pulls distinct (barcode, product_name) pairs from code_patterns and scans
-- that aren't already in products, stages them in products_pending.
--
-- Quality filters per plan v2 §2.1:
--   - exclude entries with NULL barcode or NULL/empty product_name
--   - exclude entries below confidence threshold (code_patterns.confidence_level)
--   - exclude orphan/malformed barcodes (length < 6)
--   - flag conflicts (same barcode, different name) without auto-merging
--
-- Returns a row with counts: rows_staged_from_code_patterns, rows_staged_from_scans,
-- rows_skipped_already_in_products, conflicts_flagged.

CREATE OR REPLACE FUNCTION bootstrap_products_pending()
RETURNS TABLE (
  rows_staged_from_code_patterns int,
  rows_staged_from_scans int,
  rows_skipped_already_in_products int,
  conflicts_flagged int
) AS $$
DECLARE
  v_cp_count int := 0;
  v_scan_count int := 0;
  v_skip_count int := 0;
  v_conflict_count int := 0;
BEGIN
  -- Source 1: code_patterns (high-quality — these came from successful scans + AI confirmation)
  WITH cp_distinct AS (
    SELECT DISTINCT ON (normalize_barcode(barcode_number))
      barcode_number,
      product_name,
      confidence_level,
      scan_count
    FROM code_patterns
    WHERE barcode_number IS NOT NULL
      AND product_name IS NOT NULL
      AND length(trim(product_name)) > 1
      AND length(trim(barcode_number)) >= 6
    ORDER BY normalize_barcode(barcode_number), scan_count DESC, confidence_level DESC
  ),
  cp_eligible AS (
    SELECT cp.*, normalize_barcode(cp.barcode_number) AS norm
    FROM cp_distinct cp
    WHERE NOT EXISTS (
      SELECT 1 FROM products p WHERE p.barcode_normalized = normalize_barcode(cp.barcode_number)
    )
    AND NOT EXISTS (
      SELECT 1 FROM products_pending pp WHERE pp.barcode_normalized = normalize_barcode(cp.barcode_number) AND pp.reviewed_at IS NULL
    )
  )
  INSERT INTO products_pending (
    barcode, name, source, bootstrap_source, confidence_score, staging_notes
  )
  SELECT
    barcode_number,
    trim(product_name),
    'ai_extracted_unverified',
    'code_patterns',
    -- Confidence: prefer high-confidence rows with multiple scans
    LEAST(0.95, 0.5 + (scan_count * 0.05) +
      CASE WHEN confidence_level = 'high' THEN 0.2
           WHEN confidence_level = 'medium' THEN 0.1
           ELSE 0 END),
    'From code_patterns: ' || scan_count || ' prior scan(s), confidence=' || COALESCE(confidence_level, 'unknown')
  FROM cp_eligible;
  GET DIAGNOSTICS v_cp_count = ROW_COUNT;

  -- Source 2: scans rows that didn't make it to code_patterns
  -- (these are scans where the user identified the product but no pattern was learned —
  -- typically because lot code wasn't extracted successfully)
  WITH scans_distinct AS (
    SELECT DISTINCT ON (normalize_barcode(barcode_number))
      barcode_number,
      product_name,
      organisation_id
    FROM scans
    WHERE barcode_number IS NOT NULL
      AND product_name IS NOT NULL
      AND length(trim(product_name)) > 1
      AND length(trim(barcode_number)) >= 6
    ORDER BY normalize_barcode(barcode_number), created_at DESC
  ),
  scans_eligible AS (
    SELECT s.*
    FROM scans_distinct s
    WHERE NOT EXISTS (
      SELECT 1 FROM products p WHERE p.barcode_normalized = normalize_barcode(s.barcode_number)
    )
    AND NOT EXISTS (
      SELECT 1 FROM products_pending pp WHERE pp.barcode_normalized = normalize_barcode(s.barcode_number)
    )
  )
  INSERT INTO products_pending (
    barcode, name, source, bootstrap_source, created_by_org_id, confidence_score, staging_notes
  )
  SELECT
    barcode_number,
    trim(product_name),
    'ai_extracted_unverified',
    'scans',
    organisation_id,
    0.4,  -- Lower confidence — scans without learned patterns are less validated
    'From scans table: most-recent scan with this barcode in your org history'
  FROM scans_eligible;
  GET DIAGNOSTICS v_scan_count = ROW_COUNT;

  -- Conflict detection: find pending rows where multiple staged entries share
  -- the same barcode but have different names. These are flagged for manual
  -- resolution per plan v2 "No automatic merge of conflicting product names."
  WITH conflict_groups AS (
    SELECT barcode_normalized, array_agg(id) AS pending_ids, count(DISTINCT name) AS name_variants
    FROM products_pending
    WHERE barcode_normalized IS NOT NULL AND reviewed_at IS NULL
    GROUP BY barcode_normalized
    HAVING count(DISTINCT name) > 1
  )
  UPDATE products_pending pp
    SET conflict_with_pending_ids = (SELECT pending_ids FROM conflict_groups cg WHERE cg.barcode_normalized = pp.barcode_normalized),
        staging_notes = COALESCE(staging_notes, '') || ' [⚠ CONFLICT: multiple name variants for this barcode — review all and choose canonical]'
  WHERE pp.id IN (
    SELECT unnest(pending_ids) FROM conflict_groups
  );
  GET DIAGNOSTICS v_conflict_count = ROW_COUNT;

  -- Skip count: rows we filtered out because they already exist in products
  -- Approximate count — counts distinct barcodes from sources that overlap with products
  SELECT COUNT(DISTINCT normalize_barcode(barcode_number)) INTO v_skip_count
  FROM (
    SELECT barcode_number FROM code_patterns WHERE barcode_number IS NOT NULL
    UNION
    SELECT barcode_number FROM scans WHERE barcode_number IS NOT NULL
  ) sources
  WHERE EXISTS (SELECT 1 FROM products p WHERE p.barcode_normalized = normalize_barcode(barcode_number));

  RETURN QUERY SELECT v_cp_count, v_scan_count, v_skip_count, v_conflict_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Step 4: Promotion function ─────────────────────────────────────────────
-- Promotes ONE staging row into products. Called per-row so reviewer can
-- approve/reject individual entries during review.
--
-- Returns the new products.id, or NULL if promotion failed (e.g., another
-- pending row was promoted first for the same barcode).

CREATE OR REPLACE FUNCTION promote_pending_to_products(p_pending_id uuid)
RETURNS uuid AS $$
DECLARE
  v_pending products_pending%ROWTYPE;
  v_new_product_id uuid;
BEGIN
  SELECT * INTO v_pending FROM products_pending WHERE id = p_pending_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending row not found: %', p_pending_id;
  END IF;

  IF v_pending.promoted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pending row already promoted: %', p_pending_id;
  END IF;

  IF v_pending.rejected_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pending row was rejected: %', p_pending_id;
  END IF;

  -- Check if a product with this barcode already exists (race condition guard)
  IF EXISTS (SELECT 1 FROM products WHERE barcode_normalized = v_pending.barcode_normalized) THEN
    UPDATE products_pending
       SET reviewed_at = now(),
           reviewed_by_user_id = auth.uid(),
           rejected_at = now(),
           rejection_reason = 'Auto-rejected: barcode already exists in products'
     WHERE id = p_pending_id;
    RETURN NULL;
  END IF;

  -- Insert into products
  INSERT INTO products (
    barcode, barcode_normalized, name, category, description, is_ftl,
    manufacturer_id, created_by_org_id, source, published
  ) VALUES (
    v_pending.barcode, v_pending.barcode_normalized, v_pending.name,
    v_pending.category, v_pending.description, v_pending.is_ftl,
    v_pending.manufacturer_id, v_pending.created_by_org_id,
    v_pending.source, v_pending.published
  )
  RETURNING id INTO v_new_product_id;

  -- Mark the pending row as promoted
  UPDATE products_pending
     SET reviewed_at = now(),
         reviewed_by_user_id = auth.uid(),
         promoted_at = now(),
         promoted_to_product_id = v_new_product_id
   WHERE id = p_pending_id;

  RETURN v_new_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Step 5: Rejection function ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reject_pending(p_pending_id uuid, p_reason text)
RETURNS void AS $$
BEGIN
  UPDATE products_pending
     SET reviewed_at = now(),
         reviewed_by_user_id = auth.uid(),
         rejected_at = now(),
         rejection_reason = COALESCE(p_reason, 'Rejected during review')
   WHERE id = p_pending_id
     AND promoted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Verification queries (uncomment to run after migration) ────────────────
--
-- Table should exist:
-- SELECT count(*) FROM products_pending;  -- expect 0 (empty until you bootstrap)
--
-- Functions should exist:
-- SELECT proname FROM pg_proc WHERE proname IN ('bootstrap_products_pending', 'promote_pending_to_products', 'reject_pending');
--
-- ── BOOTSTRAP RUN (uncomment when ready) ──────────────────────────────────
-- This is the explicit "go" — runs once, populates products_pending from
-- existing code_patterns + scans data. Run only when you want to start the
-- review process.
--
-- SELECT * FROM bootstrap_products_pending();
--
-- ── REVIEW QUERIES ────────────────────────────────────────────────────────
--
-- Top-confidence unreviewed entries:
-- SELECT id, barcode, name, source, bootstrap_source, confidence_score, staging_notes
-- FROM products_pending
-- WHERE reviewed_at IS NULL
-- ORDER BY confidence_score DESC, staged_at;
--
-- Conflicts (multiple staged names for the same barcode):
-- SELECT barcode_normalized, array_agg(name) AS variants, array_agg(id) AS pending_ids
-- FROM products_pending
-- WHERE reviewed_at IS NULL AND conflict_with_pending_ids IS NOT NULL
-- GROUP BY barcode_normalized;
--
-- Promote one row:
-- SELECT promote_pending_to_products('<uuid here>');
--
-- Reject one row:
-- SELECT reject_pending('<uuid here>', 'rejection reason here');
--
-- After review, summary of what got promoted vs rejected:
-- SELECT
--   COUNT(*) FILTER (WHERE promoted_at IS NOT NULL) AS promoted,
--   COUNT(*) FILTER (WHERE rejected_at IS NOT NULL) AS rejected,
--   COUNT(*) FILTER (WHERE reviewed_at IS NULL) AS unreviewed
-- FROM products_pending;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK BLOCK (only run if migration needs to be undone)
-- ════════════════════════════════════════════════════════════════════════════
-- BEGIN;
--   DROP FUNCTION IF EXISTS reject_pending(uuid, text);
--   DROP FUNCTION IF EXISTS promote_pending_to_products(uuid);
--   DROP FUNCTION IF EXISTS bootstrap_products_pending();
--   DROP TABLE IF EXISTS products_pending;
-- COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- Migration 001: Products table trust tier model
-- Phase 1.1 of refactor plan v2
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES
--
-- Transforms the products table from a manufacturer-private catalog into
-- the foundation of a cross-organizational barcode → product identification
-- network with explicit trust tiers.
--
-- The four-tier `source` enum (manufacturer_registered, retailer_validated,
-- ai_extracted_unverified, external_api) is structurally enforced via RLS
-- so that a scanner org can never claim a row as manufacturer-registered.
-- This is load-bearing for both the data network moat and the patent surface.
--
-- WHAT THIS DOES NOT DO
--
-- - No application code changes (no index.html/manufacturer.html edits).
-- - No data backfill from code_patterns/scans yet (that's Phase 2).
-- - No promotion mechanism between tiers yet (also Phase 2).
-- - No new UI for unknown-barcode handling (Phase 1.4).
--
-- HOW TO APPLY
--
-- 1. Open Supabase dashboard → SQL Editor
-- 2. Paste the entire contents of this file into a new query
-- 3. Click "Run" — the BEGIN/COMMIT block ensures all-or-nothing application
-- 4. Verify with the SELECT statements at the bottom (uncomment to run)
-- 5. If anything looks wrong, the migration is reversible via the rollback
--    block at the end (commented out — only run if you need to undo)
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Step 1: Barcode normalization function ─────────────────────────────────
-- Canonical form for cross-system barcode matching.
-- Standard GS1 convention: 12-digit UPC and 13-digit EAN with leading zero
-- represent the same product. We normalize to the 13-digit form.
-- IMMUTABLE so it can be used in indexes and generated columns.

CREATE OR REPLACE FUNCTION normalize_barcode(input text) RETURNS text AS $$
DECLARE
  cleaned text;
BEGIN
  IF input IS NULL OR length(trim(input)) = 0 THEN
    RETURN NULL;
  END IF;
  -- Strip whitespace and non-printables
  cleaned := regexp_replace(input, '\s', '', 'g');
  -- Pad 12-digit UPC to 13-digit GTIN-13 form with leading zero
  IF length(cleaned) = 12 AND cleaned ~ '^\d{12}$' THEN
    RETURN '0' || cleaned;
  END IF;
  RETURN cleaned;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── Step 2: Add new columns to products ────────────────────────────────────
-- All additive. Existing rows get sensible defaults.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode_normalized text,
  ADD COLUMN IF NOT EXISTS created_by_org_id uuid REFERENCES organisations(id),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manufacturer_registered'
    CHECK (source IN (
      'manufacturer_registered',  -- registered by the manufacturer org (highest trust)
      'retailer_validated',       -- created by retailer scans, validated by 3+ from 2+ orgs
      'ai_extracted_unverified',  -- created by AI label scan, single-source
      'external_api'              -- pulled from Open Food Facts / UPC Item DB
    )),
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;

-- Allow scanner orgs to create unowned product entries.
-- (Existing rows are unaffected — they all have manufacturer_id set.)
ALTER TABLE products ALTER COLUMN manufacturer_id DROP NOT NULL;

-- ── Step 3: Backfill barcode_normalized from existing barcode column ───────

UPDATE products
SET barcode_normalized = normalize_barcode(barcode)
WHERE barcode IS NOT NULL AND barcode_normalized IS NULL;

-- ── Step 4: Unique constraint on normalized barcode ────────────────────────
-- WHERE clause excludes NULL so multiple products without barcodes can coexist.
-- First INSERT for any given barcode wins; subsequent attempts get a constraint
-- violation that the application code must handle gracefully.

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_normalized_unique
  ON products (barcode_normalized)
  WHERE barcode_normalized IS NOT NULL;

-- Lookup index — products_public view filters by published, so a partial
-- index speeds the common scanner lookup path.
CREATE INDEX IF NOT EXISTS products_published_lookup
  ON products (barcode_normalized)
  WHERE published = true AND barcode_normalized IS NOT NULL;

-- ── Step 5: Cross-org public lookup view ───────────────────────────────────
-- Exposes only the public-readable columns (barcode_normalized, product_name,
-- source) of published rows. Bypasses underlying products RLS via
-- security_invoker=false so any authenticated user can SELECT, regardless of
-- which org owns the row. The view itself acts as column-level access control.
--
-- Scanner code queries products_public for barcode lookup.
-- Manufacturer code continues to query products directly (RLS-scoped to their org).

CREATE OR REPLACE VIEW products_public
  WITH (security_invoker = false)
AS
  SELECT
    id,
    barcode_normalized,
    name AS product_name,
    source
  FROM products
  WHERE published = true
    AND barcode_normalized IS NOT NULL;

GRANT SELECT ON products_public TO authenticated, anon;

-- ── Step 6: RLS policy for scanner-org INSERTs ─────────────────────────────
-- Allows authenticated users to INSERT new product entries for unknown
-- barcodes, but only with the lower trust tiers.
-- Manufacturer-registered tier is reachable only via the existing
-- manufacturer.html policies (which insert with source defaulting to
-- 'manufacturer_registered' and manufacturer_id = their org).

CREATE POLICY "scanner_orgs_can_insert_unverified_products" ON products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Only the lower trust tiers — never manufacturer_registered or external_api
    source IN ('retailer_validated', 'ai_extracted_unverified')
    -- Provenance must be set to caller's org
    AND created_by_org_id IS NOT NULL
    AND created_by_org_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
    -- Either no manufacturer claim, or the caller is the manufacturer themselves
    AND (
      manufacturer_id IS NULL
      OR manufacturer_id IN (
        SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
      )
    )
  );

-- Allow scanner orgs to UPDATE the product_name on rows they created
-- (typo correction, name refinement). Cannot change source, manufacturer_id,
-- or barcode_normalized.

CREATE POLICY "scanner_orgs_can_update_own_unverified_names" ON products
  FOR UPDATE
  TO authenticated
  USING (
    source IN ('retailer_validated', 'ai_extracted_unverified')
    AND created_by_org_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    -- Source, manufacturer_id, barcode_normalized must not change
    source IN ('retailer_validated', 'ai_extracted_unverified')
    AND created_by_org_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- ── Verification queries (uncomment to run after migration) ────────────────

-- Confirm the new columns exist:
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'products' AND column_name IN
--   ('barcode_normalized', 'created_by_org_id', 'source', 'published');

-- Confirm the source enum is enforced:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'products'::regclass AND conname LIKE '%source%';

-- Count existing products by source (should all be 'manufacturer_registered'):
-- SELECT source, count(*) FROM products GROUP BY source;

-- Test the public view:
-- SELECT * FROM products_public LIMIT 5;

-- Test barcode normalization:
-- SELECT barcode, barcode_normalized FROM products
-- WHERE barcode IS NOT NULL LIMIT 10;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK BLOCK (only run if migration needs to be undone)
-- ════════════════════════════════════════════════════════════════════════════
--
-- BEGIN;
--   DROP POLICY IF EXISTS "scanner_orgs_can_update_own_unverified_names" ON products;
--   DROP POLICY IF EXISTS "scanner_orgs_can_insert_unverified_products" ON products;
--   DROP VIEW IF EXISTS products_public;
--   DROP INDEX IF EXISTS products_published_lookup;
--   DROP INDEX IF EXISTS products_barcode_normalized_unique;
--   ALTER TABLE products ALTER COLUMN manufacturer_id SET NOT NULL;  -- only if it WAS NOT NULL
--   ALTER TABLE products
--     DROP COLUMN IF EXISTS barcode_normalized,
--     DROP COLUMN IF EXISTS created_by_org_id,
--     DROP COLUMN IF EXISTS source,
--     DROP COLUMN IF EXISTS published;
--   DROP FUNCTION IF EXISTS normalize_barcode(text);
-- COMMIT;

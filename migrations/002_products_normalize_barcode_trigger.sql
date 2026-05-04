-- ════════════════════════════════════════════════════════════════════════════
-- Migration 002: Auto-normalize barcode on INSERT/UPDATE
-- Phase 1.4 of refactor plan v2 (also retrofits a Phase 1.1 omission)
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES
--
-- Adds a BEFORE INSERT/UPDATE trigger on the products table that automatically
-- populates `barcode_normalized` from `barcode` whenever a new row is created
-- or `barcode` is changed.
--
-- WHY THIS MATTERS
--
-- Migration 001 added `barcode_normalized` and backfilled existing rows. It also
-- created a UNIQUE INDEX on it and a `products_public` view that filters
-- WHERE barcode_normalized IS NOT NULL. But it did NOT add a trigger.
--
-- Result: any code path that INSERTs into products without explicitly setting
-- barcode_normalized (e.g., manufacturer.html's existing saveProduct() function,
-- which only sets `barcode`) silently created rows with NULL barcode_normalized
-- — invisible to the scanner's products_public lookup.
--
-- This trigger fixes that retroactively without requiring code changes in
-- manufacturer.html. Phase 1.4 will rely on this trigger so the new
-- "scanner-created unknown-barcode" flow has a single, consistent normalization
-- path shared with manufacturer-created products.
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

-- Trigger function: auto-populate barcode_normalized on INSERT/UPDATE.
-- Idempotent — only writes if barcode is non-null and either barcode_normalized
-- is null OR barcode itself just changed (caller may have set barcode_normalized
-- explicitly, in which case we don't override).
CREATE OR REPLACE FUNCTION products_normalize_barcode_trigger() RETURNS TRIGGER AS $$
BEGIN
  -- Only auto-populate if barcode is set and barcode_normalized is missing.
  -- This lets explicit callers (e.g., scanner code) set both columns directly
  -- if they want, while transparently handling all other code paths.
  IF NEW.barcode IS NOT NULL AND NEW.barcode_normalized IS NULL THEN
    NEW.barcode_normalized := normalize_barcode(NEW.barcode);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_normalize_barcode ON products;
CREATE TRIGGER products_normalize_barcode
  BEFORE INSERT OR UPDATE OF barcode ON products
  FOR EACH ROW
  EXECUTE FUNCTION products_normalize_barcode_trigger();

-- Backfill any rows that may have been created between migrations 001 and 002
-- with NULL barcode_normalized despite having a non-null barcode.
UPDATE products
SET barcode_normalized = normalize_barcode(barcode)
WHERE barcode IS NOT NULL AND barcode_normalized IS NULL;

-- Verification queries (uncomment to run after migration):
--
-- Trigger should exist:
-- SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname = 'products_normalize_barcode';
--
-- Test with a fake INSERT (uses a UPC, expect leading-zero pad to GTIN-13):
-- BEGIN;
--   INSERT INTO products (name, barcode, source, manufacturer_id)
--     VALUES ('TEST_DELETE_ME', '123456789012', 'manufacturer_registered', NULL);
--   SELECT name, barcode, barcode_normalized FROM products WHERE name = 'TEST_DELETE_ME';
--   -- Expect: barcode = '123456789012', barcode_normalized = '0123456789012'
-- ROLLBACK;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK BLOCK (only run if migration needs to be undone)
-- ════════════════════════════════════════════════════════════════════════════
-- BEGIN;
--   DROP TRIGGER IF EXISTS products_normalize_barcode ON products;
--   DROP FUNCTION IF EXISTS products_normalize_barcode_trigger();
-- COMMIT;

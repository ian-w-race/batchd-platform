-- 030_products_public_ftl_columns.sql
-- Follow-up to Phase 1 (migration 025) and Phase 2 (scanner FTL resolution).
-- One transaction; re-runnable.
--
-- Migration 001 created the products_public view with four columns (id,
-- barcode_normalized, product_name, source). Migration 025 added the FTL
-- columns to products but did not extend the view, so the scanner's third
-- resolution step (products_public.is_ftl by GTIN, after the two org
-- overrides) has always answered 400 and fallen through to the name regex.
-- Confirmed by an anon probe on 2026-10-08: select=is_ftl returns 400 and
-- select=* returns only the four original columns.
--
-- CREATE OR REPLACE VIEW may append columns at the end, so the four
-- existing columns keep their positions and the grants from 001 (SELECT to
-- authenticated and anon) stay in place. security_invoker stays false, as
-- in 001: the view is the cross-organisation product lookup and bypasses
-- products RLS on purpose. The FTL columns carry no organisation data.
--
-- Run in the Supabase SQL editor. Expect "Success. No rows returned".
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE VIEW public.products_public
  WITH (security_invoker = false)
AS
  SELECT
    id,
    barcode_normalized,
    name AS product_name,
    source,
    is_ftl,
    ftl_category,
    ftl_confirmed_source
  FROM public.products
  WHERE published = true
    AND barcode_normalized IS NOT NULL;

COMMENT ON VIEW public.products_public IS
  'Cross-organisation product lookup for the scanner (published rows with a normalized barcode). FTL columns added 2026-10-08, migration 030.';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='products_public'
     AND column_name IN ('is_ftl','ftl_category','ftl_confirmed_source');
  IF n <> 3 THEN RAISE EXCEPTION 'products_public: expected 3 FTL columns, found %', n; END IF;
  RAISE NOTICE 'OK: products_public exposes is_ftl, ftl_category and ftl_confirmed_source';
END $$;

COMMIT;

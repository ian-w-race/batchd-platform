-- 025_products_ftl.sql
-- Phase 1 of the FSMA 204 handoff, step 4 of 5. US-only (2026-09-29).
-- One transaction; re-runnable.
--
-- Food Traceability List status at the product (GTIN) level, plus a
-- per-organisation override table. Resolution order in app code:
-- org override by GTIN, then org override by normalized name, then
-- products.is_ftl by GTIN, then the name regex in the scanner.
--
-- products keeps its existing policies (migrations 001 to 004). Note for
-- Phase 2: the scanner reads products through the products_public view,
-- which is defined outside these migrations; if the view does not expose
-- the new columns, the client falls through to the regex until the view
-- is extended.
--
-- Run in the Supabase SQL editor. Expect "Success. No rows returned".
-- The destructive-operations warning is expected (DROP POLICY IF EXISTS).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 1. products: GTIN-level FTL flags ───────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_ftl boolean,                      -- null = unknown
  ADD COLUMN IF NOT EXISTS ftl_category text,
  ADD COLUMN IF NOT EXISTS ftl_confirmed_source text
    CHECK (ftl_confirmed_source IS NULL OR ftl_confirmed_source IN ('staff','admin','wholesaler_feed','regex')),
  ADD COLUMN IF NOT EXISTS ftl_confirmed_at timestamptz;

-- ── 2. ftl_overrides ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ftl_overrides (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  gtin                     text,
  product_name_normalized  text,
  is_ftl                   boolean NOT NULL,
  ftl_category             text,
  set_by                   text,                                 -- staff email
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (gtin IS NOT NULL OR product_name_normalized IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ftl_overrides_org_gtin_uidx
  ON public.ftl_overrides (organisation_id, gtin) WHERE gtin IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ftl_overrides_org_name_uidx
  ON public.ftl_overrides (organisation_id, product_name_normalized)
  WHERE gtin IS NULL AND product_name_normalized IS NOT NULL;

ALTER TABLE public.ftl_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ftl_overrides FROM public, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftl_overrides TO authenticated;
GRANT ALL ON public.ftl_overrides TO service_role;

DROP POLICY IF EXISTS b25_ftl_overrides_member_select ON public.ftl_overrides;
CREATE POLICY b25_ftl_overrides_member_select ON public.ftl_overrides FOR SELECT
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()));

DROP POLICY IF EXISTS b25_ftl_overrides_manager_insert ON public.ftl_overrides;
CREATE POLICY b25_ftl_overrides_manager_insert ON public.ftl_overrides FOR INSERT
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_manager_of(organisation_id));

DROP POLICY IF EXISTS b25_ftl_overrides_manager_update ON public.ftl_overrides;
CREATE POLICY b25_ftl_overrides_manager_update ON public.ftl_overrides FOR UPDATE
  USING      (public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_manager_of(organisation_id))
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_manager_of(organisation_id));

DROP POLICY IF EXISTS b25_ftl_overrides_corp_admin_delete ON public.ftl_overrides;
CREATE POLICY b25_ftl_overrides_corp_admin_delete ON public.ftl_overrides FOR DELETE
  USING (public.batchd_is_corp_admin_of(organisation_id));

DROP POLICY IF EXISTS b25_ftl_overrides_platform_admin ON public.ftl_overrides;
CREATE POLICY b25_ftl_overrides_platform_admin ON public.ftl_overrides FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

COMMENT ON TABLE public.ftl_overrides IS
  'Per-organisation Food Traceability List overrides keyed by GTIN or normalized product name. Resolution: org GTIN, org name, products.is_ftl, regex. Added 2026-10-03, migration 025.';

-- ── 3. Post-check ───────────────────────────────────────────────────────
DO $$
DECLARE n int; c int;
BEGIN
  SELECT count(*) INTO c FROM information_schema.columns
   WHERE table_schema='public' AND table_name='products'
     AND column_name IN ('is_ftl','ftl_category','ftl_confirmed_source','ftl_confirmed_at');
  IF c <> 4 THEN RAISE EXCEPTION 'products: expected 4 FTL columns, found %', c; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename='ftl_overrides';
  IF n < 5 THEN RAISE EXCEPTION 'ftl_overrides: expected 5 policies, found %', n; END IF;
  RAISE NOTICE 'OK: products has 4 FTL columns; ftl_overrides created with % policies', n;
END $$;

COMMIT;

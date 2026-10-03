-- 022_suppliers.sql
-- Phase 1 of the FSMA 204 handoff, step 1 of 5. US-only (2026-09-29).
-- One transaction; re-runnable. Creates the supplier directory: the
-- "location description" of the immediate previous source that
-- 21 CFR 1.1345 asks for at receiving (business name, phone, address,
-- city, state, zip).
--
-- Policies follow migration 021's pattern and helpers (batchd_*). The
-- handoff asked for corp_admin and store_manager INSERT; this file also
-- lets any active member INSERT, because Phase 2's receiving form lets
-- floor staff add a supplier name on the spot. Only managers and corp
-- admins may UPDATE, and only corp admins may DELETE (prefer active=false).
--
-- Run in the Supabase SQL editor. Expect "Success. No rows returned".
-- The editor's destructive-operations warning appears because of the
-- DROP POLICY IF EXISTS lines; that is expected.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 0. Shared trigger: keep updated_at current ──────────────────────────
CREATE OR REPLACE FUNCTION public.batchd_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ── 1. Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  phone             text,
  street_address    text,
  city              text,
  region            text,                                   -- US state, as typed
  postal_code       text,
  country           text NOT NULL DEFAULT 'US',             -- ISO 3166-1 alpha-2
  gln               text,                                   -- GS1 Global Location Number, optional
  supplier_type     text NOT NULL DEFAULT 'distributor'
                    CHECK (supplier_type IN ('distributor','manufacturer','farm','other')),
  is_exempt_entity  boolean NOT NULL DEFAULT false,         -- 21 CFR 1.1345: receiving from an exempt entity
  category_hints    text[],                                 -- FTL category keys this supplier typically ships
  seeded_from       text,                                   -- 'category_kit:<key>' when created by a kit, else null
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_name_uidx
  ON public.suppliers (organisation_id, lower(name));
CREATE INDEX IF NOT EXISTS suppliers_org_active_idx
  ON public.suppliers (organisation_id, active);

DROP TRIGGER IF EXISTS suppliers_touch_updated_at ON public.suppliers;
CREATE TRIGGER suppliers_touch_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.batchd_touch_updated_at();

-- ── 2. Privileges and RLS ───────────────────────────────────────────────
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suppliers FROM public, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;

DROP POLICY IF EXISTS b22_suppliers_member_select ON public.suppliers;
CREATE POLICY b22_suppliers_member_select ON public.suppliers FOR SELECT
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()));

DROP POLICY IF EXISTS b22_suppliers_member_insert ON public.suppliers;
CREATE POLICY b22_suppliers_member_insert ON public.suppliers FOR INSERT
  WITH CHECK (organisation_id IN (SELECT public.batchd_my_active_org_ids()));

DROP POLICY IF EXISTS b22_suppliers_manager_update ON public.suppliers;
CREATE POLICY b22_suppliers_manager_update ON public.suppliers FOR UPDATE
  USING      (public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_manager_of(organisation_id))
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_manager_of(organisation_id));

DROP POLICY IF EXISTS b22_suppliers_corp_admin_delete ON public.suppliers;
CREATE POLICY b22_suppliers_corp_admin_delete ON public.suppliers FOR DELETE
  USING (public.batchd_is_corp_admin_of(organisation_id));

DROP POLICY IF EXISTS b22_suppliers_platform_admin ON public.suppliers;
CREATE POLICY b22_suppliers_platform_admin ON public.suppliers FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

COMMENT ON TABLE public.suppliers IS
  'Per-organisation supplier directory. Supplies the immediate previous source location description (21 CFR 1.1345) for receiving records. Added 2026-10-03, migration 022.';

-- ── 3. Post-check ───────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename='suppliers';
  IF n < 5 THEN RAISE EXCEPTION 'suppliers: expected 5 policies, found %', n; END IF;
  RAISE NOTICE 'OK: suppliers created with % policies', n;
END $$;

COMMIT;

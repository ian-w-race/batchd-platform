-- 026_records_requests.sql
-- Phase 1 of the FSMA 204 handoff, step 5 of 5. US-only (2026-09-29).
-- One transaction; re-runnable.
--
-- Two tables behind Phase 4: the timed records-request drill ("when the
-- FDA asks, you have 24 hours; see how long it takes you today") and the
-- versioned traceability plan (21 CFR 1.1315). Members read; corp admins
-- write; nobody deletes from the client.
--
-- Run in the Supabase SQL editor. Expect "Success. No rows returned".
-- The destructive-operations warning is expected (DROP POLICY IF EXISTS).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 1. records_requests ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.records_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  is_drill            boolean NOT NULL DEFAULT true,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  requested_by        text,
  scope_lot           text,
  scope_product       text,
  scope_date_from     date,
  scope_date_to       date,
  produced_at         timestamptz,
  produced_by         text,
  row_count           integer,
  minutes_to_produce  numeric GENERATED ALWAYS AS
                        (EXTRACT(EPOCH FROM (produced_at - requested_at)) / 60.0) STORED,
  file_name           text,
  notes               text
);
CREATE INDEX IF NOT EXISTS records_requests_org_requested_idx
  ON public.records_requests (organisation_id, requested_at DESC);

ALTER TABLE public.records_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.records_requests FROM public, anon;
GRANT SELECT, INSERT, UPDATE ON public.records_requests TO authenticated;
GRANT ALL ON public.records_requests TO service_role;

DROP POLICY IF EXISTS b26_records_requests_member_select ON public.records_requests;
CREATE POLICY b26_records_requests_member_select ON public.records_requests FOR SELECT
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()));

DROP POLICY IF EXISTS b26_records_requests_corp_admin_insert ON public.records_requests;
CREATE POLICY b26_records_requests_corp_admin_insert ON public.records_requests FOR INSERT
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id));

DROP POLICY IF EXISTS b26_records_requests_corp_admin_update ON public.records_requests;
CREATE POLICY b26_records_requests_corp_admin_update ON public.records_requests FOR UPDATE
  USING      (public.batchd_is_corp_admin_of(organisation_id))
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id));

DROP POLICY IF EXISTS b26_records_requests_platform_admin ON public.records_requests;
CREATE POLICY b26_records_requests_platform_admin ON public.records_requests FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

COMMENT ON TABLE public.records_requests IS
  'Timed records-request drills (and, later, real FDA requests). minutes_to_produce is computed from requested_at to produced_at. Added 2026-10-03, migration 026.';

-- ── 2. traceability_plans ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.traceability_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  version          integer NOT NULL,
  content_json     jsonb NOT NULL,
  rendered_html    text,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  generated_by     text,
  superseded_at    timestamptz,
  UNIQUE (organisation_id, version)
);
CREATE INDEX IF NOT EXISTS traceability_plans_org_current_idx
  ON public.traceability_plans (organisation_id) WHERE superseded_at IS NULL;

ALTER TABLE public.traceability_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.traceability_plans FROM public, anon;
GRANT SELECT, INSERT, UPDATE ON public.traceability_plans TO authenticated;
GRANT ALL ON public.traceability_plans TO service_role;

DROP POLICY IF EXISTS b26_plans_member_select ON public.traceability_plans;
CREATE POLICY b26_plans_member_select ON public.traceability_plans FOR SELECT
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()));

DROP POLICY IF EXISTS b26_plans_corp_admin_insert ON public.traceability_plans;
CREATE POLICY b26_plans_corp_admin_insert ON public.traceability_plans FOR INSERT
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id));

DROP POLICY IF EXISTS b26_plans_corp_admin_update ON public.traceability_plans;
CREATE POLICY b26_plans_corp_admin_update ON public.traceability_plans FOR UPDATE
  USING      (public.batchd_is_corp_admin_of(organisation_id))
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id));

DROP POLICY IF EXISTS b26_plans_platform_admin ON public.traceability_plans;
CREATE POLICY b26_plans_platform_admin ON public.traceability_plans FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

COMMENT ON TABLE public.traceability_plans IS
  'Versioned traceability plan generations (21 CFR 1.1315). Superseded versions are kept for two years. Added 2026-10-03, migration 026.';

-- ── 3. Post-check ───────────────────────────────────────────────────────
DO $$
DECLARE a int; b int;
BEGIN
  SELECT count(*) INTO a FROM pg_policies WHERE schemaname='public' AND tablename='records_requests';
  SELECT count(*) INTO b FROM pg_policies WHERE schemaname='public' AND tablename='traceability_plans';
  IF a < 4 OR b < 4 THEN RAISE EXCEPTION 'expected 4 policies each, found % and %', a, b; END IF;
  RAISE NOTICE 'OK: records_requests (% policies) and traceability_plans (% policies) created', a, b;
END $$;

COMMIT;

-- 024_org_applicability_and_focus.sql
-- Phase 1 of the FSMA 204 handoff, step 3 of 5. US-only (2026-09-29).
-- One transaction; re-runnable. Columns only, no new policies.
--
-- Adds to organisations: the three applicability answers (sales band,
-- registered facility, own distribution center), the computed
-- applicability bucket, the starter-scope category focus, a pricing
-- tier label, the network benchmarks opt-in flag (nothing reads it
-- yet), and the traceability plan contact.
--
-- Naming note: the handoff called the tier column plan_tier. Migration
-- 020 already owns organisations.plan for the commercial status
-- (trial, pov, active, churned), so the pricing label is pricing_tier
-- here to keep the two apart. It is informational only; no billing
-- logic reads it.
--
-- Migration 021's corp-admin UPDATE policy covers these columns, and
-- 020's batchd_guard_org_commercial_columns trigger does not touch
-- them. Nothing secret goes in these columns.
--
-- Run in the Supabase SQL editor. Expect "Success. No rows returned".
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS annual_food_sales_band text
    CHECK (annual_food_sales_band IS NULL OR annual_food_sales_band IN
           ('under_250k','250k_to_1m','1m_to_10m','over_10m','undisclosed')),
  ADD COLUMN IF NOT EXISTS operates_registered_facility boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS operates_distribution_center boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fsma_applicability text
    CHECK (fsma_applicability IS NULL OR fsma_applicability IN
           ('exempt','covered_no_spreadsheet','covered','unknown')),
  ADD COLUMN IF NOT EXISTS focus_categories text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pricing_tier text
    CHECK (pricing_tier IS NULL OR pricing_tier IN ('pilot','starter','essential','professional','readiness')),
  ADD COLUMN IF NOT EXISTS network_benchmarks_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS traceability_plan_contact_name text,
  ADD COLUMN IF NOT EXISTS traceability_plan_contact_phone text,
  ADD COLUMN IF NOT EXISTS traceability_plan_updated_at timestamptz;

COMMENT ON COLUMN public.organisations.annual_food_sales_band IS
  'Self-reported band for the 21 CFR 1.1305 and 1.1455(c)(3) retail exemptions. Dollar thresholds live in app code and must be verified against eCFR before copy ships.';
COMMENT ON COLUMN public.organisations.operates_registered_facility IS
  'True when the org runs a warehouse, DC or central kitchen registered under FD&C 415. Gates Reportable Food Registry guidance.';
COMMENT ON COLUMN public.organisations.operates_distribution_center IS
  'True when the org ships listed foods from its own DC to its stores (Shipping CTE applies).';
COMMENT ON COLUMN public.organisations.fsma_applicability IS
  'Computed by the app from the sales band: exempt, covered_no_spreadsheet, covered or unknown.';
COMMENT ON COLUMN public.organisations.focus_categories IS
  'FTL category keys in the starter scope, for example {leafy_greens,nut_butters}.';
COMMENT ON COLUMN public.organisations.pricing_tier IS
  'Informational pricing label (pilot, starter, essential, professional, readiness). Not billing. Distinct from organisations.plan (commercial status, migration 020).';
COMMENT ON COLUMN public.organisations.network_benchmarks_opt_in IS
  'Opt-in to anonymized aggregate recall-response benchmarks. Default false. Nothing reads it yet (Phase 8).';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='organisations'
     AND column_name IN ('annual_food_sales_band','operates_registered_facility','operates_distribution_center',
                         'fsma_applicability','focus_categories','pricing_tier','network_benchmarks_opt_in',
                         'traceability_plan_contact_name','traceability_plan_contact_phone','traceability_plan_updated_at');
  IF n <> 10 THEN RAISE EXCEPTION 'organisations: expected 10 new columns, found %', n; END IF;
  RAISE NOTICE 'OK: organisations has the 10 applicability and focus columns';
END $$;

COMMIT;

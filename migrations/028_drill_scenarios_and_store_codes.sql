-- 028_drill_scenarios_and_store_codes.sql
-- Phases 6 and 7 of the FSMA 204 handoff. US-only (2026-09-29). One transaction;
-- re-runnable. Numbered 028 because 027 is John's code_patterns slot.
--
-- 1. mock_recall_drills.scenario_text: the drill script paragraph chosen in the
--    launcher (Phase 6.3), shown on the drill certificate.
-- 2. stores.external_code: the wholesaler's ship-to code for a store, used by the
--    Phase 7 delivery-file import to map rows to stores when the names differ.
-- No policy changes; both tables keep their existing policies.
--
-- Run in the Supabase SQL editor. Expect "Success. No rows returned".
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.mock_recall_drills ADD COLUMN IF NOT EXISTS scenario_text text;
COMMENT ON COLUMN public.mock_recall_drills.scenario_text IS
  'Drill script paragraph from the launcher template (category kits). Shown on the drill certificate. Added 2026-10-07, migration 028.';

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS external_code text;
CREATE INDEX IF NOT EXISTS stores_org_external_code_idx
  ON public.stores (organisation_id, external_code) WHERE external_code IS NOT NULL;
COMMENT ON COLUMN public.stores.external_code IS
  'Ship-to code used by a wholesaler for this store; the delivery-file import matches on it before falling back to the name. Added 2026-10-07, migration 028.';

DO $$
DECLARE a boolean; b boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mock_recall_drills' AND column_name='scenario_text') INTO a;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stores' AND column_name='external_code') INTO b;
  IF NOT a OR NOT b THEN RAISE EXCEPTION 'migration 028: scenario_text % external_code %', a, b; END IF;
  RAISE NOTICE 'OK: mock_recall_drills.scenario_text and stores.external_code present';
END $$;

COMMIT;

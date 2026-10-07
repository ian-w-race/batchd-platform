-- 029_receiving_confirm_policy.sql
-- Phase 7 of the FSMA 204 handoff. US-only (2026-09-29). One transaction;
-- re-runnable. Requires 023 (receiving_events).
--
-- Floor staff confirm expected deliveries in the scanner: the row imported
-- from a wholesaler file (status 'expected') becomes 'received' with the real
-- time, person and quantity. Migration 023 only let corp admins and store
-- managers UPDATE receiving rows, so staff could not confirm. This policy lets
-- any active member of the organisation update a row while it is still
-- 'expected'. Rows already received stay manager-only, as before.
--
-- Run in the Supabase SQL editor. Expect "Success. No rows returned".
-- The destructive-operations warning is expected (DROP POLICY IF EXISTS).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP POLICY IF EXISTS b29_receiving_member_confirm_expected ON public.receiving_events;
CREATE POLICY b29_receiving_member_confirm_expected ON public.receiving_events FOR UPDATE
  USING      (organisation_id IN (SELECT public.batchd_my_active_org_ids()) AND status = 'expected')
  WITH CHECK (organisation_id IN (SELECT public.batchd_my_active_org_ids()));

COMMENT ON POLICY b29_receiving_member_confirm_expected ON public.receiving_events IS
  'Active members may update a receiving row while it is still expected (confirm or correct a wholesaler-file delivery). Added 2026-10-07, migration 029.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='receiving_events' AND policyname='b29_receiving_member_confirm_expected') THEN
    RAISE EXCEPTION 'migration 029: policy missing';
  END IF;
  RAISE NOTICE 'OK: b29_receiving_member_confirm_expected present';
END $$;

COMMIT;

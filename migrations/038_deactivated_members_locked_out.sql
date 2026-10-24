-- 038_deactivated_members_locked_out.sql (2026-10-24)
--
-- FOUND: about 70 older policies (from before John's b20_ helpers) test
-- membership with organisation_members but never look at the active flag.
-- A member the corporate admin had deactivated, holding a session that had
-- not yet expired, could therefore keep reading and writing their old
-- organization's scans, stores, recalls, complaints and acknowledgements,
-- and a deactivated corp_admin could still update the organization row.
-- The apps sign such a user out at load, but RLS is the real boundary.
--
-- Fix: one RESTRICTIVE policy per tenant table, for signed-in users only:
-- the caller must hold at least one active membership. Restrictive policies
-- are ANDed with the permissive ones, so nothing an active member can do
-- today changes, and nothing has to be rewritten policy by policy. The
-- anon role and the service role are untouched.
--
-- Not covered on purpose: organisation_members, user_settings and
-- user_profiles (the sign-in screens read them to show "Account
-- deactivated"; signup and invitation acceptance run before a membership
-- exists), products, products_pending and products_public (shared catalog),
-- and tables whose policies already use the active-only helpers
-- (code_patterns, scan_telemetry, scan_queue, ftl_overrides,
-- receiving_events, records_requests, suppliers, traceability_plans,
-- organisation_api_keys).
--
-- Known limit: a user active in one org and deactivated in another would
-- keep the legacy access in the second. Production has no such user
-- (checked 2026-10-24: 2 deactivated users, 0 mixed).
--
-- Re-runnable. One transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.batchd_has_active_membership()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organisation_members
    WHERE user_id = auth.uid() AND COALESCE(active, true) = true
  );
$$;

REVOKE ALL ON FUNCTION public.batchd_has_active_membership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batchd_has_active_membership() TO authenticated, service_role;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'complaint_audit_log', 'complaint_escalations', 'complaint_messages', 'complaints',
    'ingredient_receipts', 'investigation_requests', 'investigation_responses', 'invitations',
    'mock_recall_drills', 'organisations', 'product_lots',
    'recall_acknowledgements', 'recall_consumer_notifications', 'recall_distributions',
    'recall_effectiveness_checks', 'recall_events', 'recalls',
    'scan_recall_matches', 'scans', 'scans_audit_log', 'shipments',
    'store_group_members', 'store_groups', 'store_manager_stores', 'stores',
    'supplier_connections', 'supplier_ingredients', 'supplier_lot_codes',
    'supplier_manufacturer_links', 'supplier_shipments', 'trading_partners'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skipping missing table %', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS b38_active_members_only ON public.%I', t);
    -- (SELECT ...) lets Postgres evaluate the check once per statement.
    EXECUTE format(
      'CREATE POLICY b38_active_members_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING ((SELECT public.batchd_has_active_membership()))
         WITH CHECK ((SELECT public.batchd_has_active_membership()))', t);
  END LOOP;
END $$;

COMMIT;

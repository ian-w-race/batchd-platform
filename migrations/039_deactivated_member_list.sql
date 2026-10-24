-- 039_deactivated_member_list.sql (2026-10-24)
--
-- Follow-up to 038, found in the live staging test of a deactivated
-- account: it still read every organisation_members row of its old org
-- (colleagues' user ids and roles; no emails, since get_org_member_emails
-- already requires an active corp_admin). 038 left organisation_members out
-- on purpose because the sign-in screens read the caller's own row to show
-- "Account deactivated".
--
-- Fix: a RESTRICTIVE SELECT policy. A signed-in user always reads their own
-- rows; other rows only while they hold an active membership. Writes are
-- unchanged (the guard triggers already refuse self-reactivation and
-- self-promotion, and inserts are corp-admin only). The RLS helpers are
-- SECURITY DEFINER, so policies on other tables that read
-- organisation_members are unaffected.
--
-- Re-runnable. One transaction.

BEGIN;

DROP POLICY IF EXISTS b39_members_own_or_active ON public.organisation_members;
CREATE POLICY b39_members_own_or_active ON public.organisation_members
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (SELECT public.batchd_has_active_membership()));

COMMIT;

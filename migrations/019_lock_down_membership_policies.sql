-- 019_lock_down_membership_policies.sql
--
-- SECURITY FIX (part 2 of 2) — the actual lock-down.
--
-- ⚠ DO NOT RUN THIS UNTIL ALL THREE ARE TRUE:
--   1. Migration 018 has been applied.
--   2. The updated join.html and signup.html (which call the new RPCs)
--      are DEPLOYED and live.
--   3. You have signed up a throwaway org and accepted a test invite on
--      the deployed pages, and both worked.
--
-- Running it before that will break sign-up and invitation acceptance,
-- because today those pages write organisation_members directly from the
-- browser and that is exactly what this migration forbids.
--
-- Rollback: the DROPped policies are recreated verbatim at the bottom of
-- this file, commented out. Paste that block to restore the old
-- behaviour if something goes wrong.

-- ══════════════════════════════════════════════════════════════════════
-- 1. invitations — stop anon from reading the table
-- ══════════════════════════════════════════════════════════════════════
-- The join page now calls get_invitation_by_token() instead, which is
-- SECURITY DEFINER and returns one row of display fields.

DROP POLICY IF EXISTS "Anyone can read invitation by token" ON public.invitations;

-- ══════════════════════════════════════════════════════════════════════
-- 2. organisation_members — remove the blanket client INSERT
-- ══════════════════════════════════════════════════════════════════════
-- accept_invitation() and create_organisation_with_admin() are
-- SECURITY DEFINER and so are unaffected by this.

DROP POLICY IF EXISTS "Insert own membership" ON public.organisation_members;

-- ══════════════════════════════════════════════════════════════════════
-- 3. organisation_members — fix the misnamed update policy
-- ══════════════════════════════════════════════════════════════════════
-- "Admins can update org memberships" checked org membership but never
-- role, so any member could rewrite any row in their org, including
-- their own role. Replaced with a genuine corp_admin check.
-- (organisation_members_corp_admin_update and
-- organisation_members_manager_update already cover the legitimate
-- admin/manager paths, so this policy is redundant as well as unsafe.)

DROP POLICY IF EXISTS "Admins can update org memberships" ON public.organisation_members;

-- ══════════════════════════════════════════════════════════════════════
-- 4. organisation_members — stop self-delete
-- ══════════════════════════════════════════════════════════════════════
-- "Delete own memberships" let a user remove their own row. Combined
-- with the INSERT policy above that was a role-reset primitive; on its
-- own it still lets someone silently drop out of an org and break audit
-- continuity. Deactivation is the supported path and is admin-driven.

DROP POLICY IF EXISTS "Delete own memberships" ON public.organisation_members;

-- ══════════════════════════════════════════════════════════════════════
-- Verify
-- ══════════════════════════════════════════════════════════════════════
-- Re-run the audit query; the four policies above should be gone and
-- only the corp_admin / manager / self_update ones should remain:
--
--   SELECT tablename, policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--   WHERE tablename IN ('organisation_members','invitations')
--   ORDER BY tablename, cmd;

-- ══════════════════════════════════════════════════════════════════════
-- ROLLBACK (paste to restore the previous, insecure behaviour)
-- ══════════════════════════════════════════════════════════════════════
-- CREATE POLICY "Anyone can read invitation by token"
--   ON public.invitations FOR SELECT TO anon, authenticated USING (true);
--
-- CREATE POLICY "Insert own membership"
--   ON public.organisation_members FOR INSERT TO authenticated
--   WITH CHECK (user_id = auth.uid());
--
-- CREATE POLICY "Admins can update org memberships"
--   ON public.organisation_members FOR UPDATE TO authenticated
--   USING (organisation_id IN (SELECT get_my_organisation_ids()))
--   WITH CHECK (organisation_id IN (SELECT get_my_organisation_ids()));
--
-- CREATE POLICY "Delete own memberships"
--   ON public.organisation_members FOR DELETE TO authenticated
--   USING (user_id = auth.uid());

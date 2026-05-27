-- 014_rls_helpers_security_definer.sql
--
-- Fix "infinite recursion detected in policy for relation
-- 'organisation_members'" that fired when a corp_admin tried to
-- deactivate a member via Staff Activity → Deactivate.
--
-- Root cause:
--   The RLS policies on public.organisation_members invoke four
--   helper functions to check the caller's membership/role:
--     - get_my_organisation_ids()
--     - batchd_user_is_corp_admin()
--     - batchd_user_org_id()
--     - batchd_user_is_store_manager()
--   Each of these queries organisation_members internally. They
--   were declared SECURITY INVOKER (the default), so the inner
--   query runs as the caller — subject to the same RLS policies on
--   organisation_members — which re-invokes the helper — which
--   queries organisation_members again. Postgres detects the loop
--   and aborts with 'infinite recursion detected in policy'.
--
-- Fix:
--   Flip the four helpers to SECURITY DEFINER. Their inner queries
--   then run with the function owner's privileges (postgres in
--   Supabase, which bypasses RLS), breaking the recursion. No
--   policy or function body is touched.
--
-- Hardening:
--   Pin search_path = public on each so a malicious session can't
--   redefine `organisation_members` in a temp schema and trick the
--   SECURITY DEFINER context. Standard Supabase practice.
--
-- Safe to re-run (every statement is idempotent).

ALTER FUNCTION public.get_my_organisation_ids()    SECURITY DEFINER;
ALTER FUNCTION public.batchd_user_is_corp_admin()  SECURITY DEFINER;
ALTER FUNCTION public.batchd_user_org_id()         SECURITY DEFINER;
ALTER FUNCTION public.batchd_user_is_store_manager() SECURITY DEFINER;

ALTER FUNCTION public.get_my_organisation_ids()    SET search_path = public;
ALTER FUNCTION public.batchd_user_is_corp_admin()  SET search_path = public;
ALTER FUNCTION public.batchd_user_org_id()         SET search_path = public;
ALTER FUNCTION public.batchd_user_is_store_manager() SET search_path = public;

-- Done.

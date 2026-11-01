-- 042_revoke_anon_definer_execute.sql
-- Found 2026-10-28 by the Supabase security advisor ("Public Can Execute
-- SECURITY DEFINER Function"), then read by hand. One transaction;
-- re-runnable (REVOKE and GRANT are idempotent).
--
-- Three SECURITY DEFINER functions were executable by the anon key although
-- no signed-out page calls them and each refuses or returns nothing without
-- a session anyway (create_organisation_with_admin raises when auth.uid() is
-- null; get_org_member_emails requires an active corp_admin of the org;
-- get_my_organisation_ids reads auth.uid()). Revoking anon EXECUTE is
-- hygiene: it closes the surface before anyone relies on those internal
-- checks staying as they are.
--
-- Left alone on purpose: get_invitation_by_token and
-- get_invitation_store_names (join.html reads the invite before the invitee
-- has an account), accept_invitation (called after sign-in, but kept as is
-- until the join flow is retested live), and the batchd_user_* RLS helpers
-- (policies on tables anon may read call them; revoking would turn those
-- reads into 42501 errors).
--
-- Dry run on staging 2026-11-01 (rolled back): anon false, signed_in true,
-- service true on all three. Apply: staging first, then production.
--
-- Rollback (restores the old open grants; do not run without a reason):
--   grant execute on function public.create_organisation_with_admin(text,text,text,text,text[]) to anon;
--   grant execute on function public.get_org_member_emails(uuid) to anon;
--   grant execute on function public.get_my_organisation_ids() to anon;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

REVOKE EXECUTE ON FUNCTION public.create_organisation_with_admin(text,text,text,text,text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_org_member_emails(uuid)                                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_organisation_ids()                                  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_organisation_with_admin(text,text,text,text,text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_org_member_emails(uuid)                                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_organisation_ids()                                  TO authenticated, service_role;

COMMIT;

-- Acceptance (every row should read false, true, true):
-- select p.oid::regprocedure as fn,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as signed_in,
--        has_function_privilege('service_role', p.oid, 'EXECUTE')  as service
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('create_organisation_with_admin','get_org_member_emails','get_my_organisation_ids');

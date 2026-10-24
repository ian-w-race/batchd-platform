-- 031_revoke_open_rpcs.sql
-- Found 2026-10-24 by the Supabase security advisor, then read by hand.
-- One transaction; re-runnable (REVOKE and GRANT are idempotent).
--
-- Every function in the public schema is callable through PostgREST at
-- /rest/v1/rpc/<name> unless EXECUTE is revoked. Four SECURITY DEFINER
-- functions were callable by any signed-in user, and three of them by
-- the anon key too. They run as their owner, so RLS does not apply.
--
-- push_recall (manufacturer era, no caller in the repo):
--   Any signed-in member of any org could create a recall event and
--   distribute it to EVERY retailer whose scans match the product name
--   with LIKE '%name%' (an empty name matches every scan). It inserts
--   distributions, acknowledgements and active rows in other orgs'
--   recalls tables. Self-serve signup is open, so anyone on the internet
--   could sign up and inject recall alerts into every customer. A read of
--   recall_events on 2026-10-24 showed no sign it was ever abused.
--
-- create_organisation (pre-018 signup, no caller in the repo):
--   Creates an org of any type, including 'manufacturer', which
--   create_organisation_with_admin refuses since migration 020.
--
-- get_retailer_emails (manufacturer era, no caller in the repo):
--   Returns the contact emails of every retailer a recall event was
--   distributed to, with no caller check, to anon as well.
--
-- sweep_recall_matches (called by the scanner, index.html around 9595,
--   and by the trigger_recall_sweep trigger):
--   Takes p_organisation_id from the caller without checking membership.
--   This migration removes anon access only. Signed-in access stays
--   because the scanner needs it; a membership check inside the function
--   is a separate follow-up.
--
-- The service role keeps EXECUTE on all four, and trigger functions run
-- as their owner, so nothing that runs server-side changes.
--
-- Rollback (restores the old open grants; do not run without a reason):
--   grant execute on function public.push_recall(text,text,text,text,text,text,text,boolean) to anon, authenticated;
--   grant execute on function public.create_organisation(text,text,text,text) to anon, authenticated;
--   grant execute on function public.get_retailer_emails(uuid) to anon, authenticated;
--   grant execute on function public.sweep_recall_matches(uuid,uuid,integer) to anon;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

REVOKE EXECUTE ON FUNCTION public.push_recall(text,text,text,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_organisation(text,text,text,text)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_retailer_emails(uuid)                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sweep_recall_matches(uuid,uuid,integer)              FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.push_recall(text,text,text,text,text,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_organisation(text,text,text,text)             TO service_role;
GRANT EXECUTE ON FUNCTION public.get_retailer_emails(uuid)                            TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_recall_matches(uuid,uuid,integer)              TO authenticated, service_role;

COMMIT;

-- Acceptance (every row should read false, false, true, true):
-- select p.oid::regprocedure as fn,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as signed_in,
--        has_function_privilege('service_role', p.oid, 'EXECUTE')  as service
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('push_recall','create_organisation','get_retailer_emails','sweep_recall_matches');
-- Expected: signed_in is false for the first three and TRUE for
-- sweep_recall_matches.

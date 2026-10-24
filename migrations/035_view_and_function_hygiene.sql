-- 035_view_and_function_hygiene.sql
-- Found 2026-10-24 during the advisor follow-up. One transaction;
-- re-runnable (ALTER VIEW SET, ALTER FUNCTION SET and REVOKE are idempotent).
--
-- 1. user_accessible_stores leaked across organizations.
--    The view runs with its owner's rights (security definer), so it skips
--    row security, and anon and authenticated could SELECT it. A logged-out
--    probe with the public key on 2026-10-24 returned 26 rows covering 4
--    organizations and 5 user ids, with store names, codes and addresses.
--    Nothing in the apps or functions reads it (grep, 2026-10-24). Now it
--    runs with the caller's rights and only the service role may read it.
--
-- 2. search_path pinned on the functions that had none (Supabase advisor
--    "Function Search Path Mutable"). Every one of them only touches the
--    public schema or built-ins, which stay reachable.
--
-- 3. Trigger functions are no longer callable through the API by anon or
--    signed-in users. Postgres checks EXECUTE on a trigger function when the
--    trigger is created, not when it fires, so the triggers keep working.
--    The service role keeps EXECUTE.
--
-- Rollback:
--   alter view public.user_accessible_stores set (security_invoker = false);
--   grant select on public.user_accessible_stores to anon, authenticated;
--   (the search_path settings and trigger revokes have no behavior to restore)

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1
ALTER VIEW public.user_accessible_stores SET (security_invoker = true);
REVOKE ALL ON public.user_accessible_stores FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_accessible_stores TO service_role;

-- 2
ALTER FUNCTION public.batchd_bypass_guards_active()                           SET search_path = public;
ALTER FUNCTION public.batchd_receiving_set_retention()                        SET search_path = public;
ALTER FUNCTION public.batchd_touch_updated_at()                               SET search_path = public;
ALTER FUNCTION public.create_organisation(text,text,text,text)                SET search_path = public;
ALTER FUNCTION public.enforce_scan_immutability()                             SET search_path = public;
ALTER FUNCTION public.get_retailer_emails(uuid)                               SET search_path = public;
ALTER FUNCTION public.handle_new_user()                                       SET search_path = public;
ALTER FUNCTION public.normalize_barcode(text)                                 SET search_path = public;
ALTER FUNCTION public.push_recall(text,text,text,text,text,text,text,boolean) SET search_path = public;
ALTER FUNCTION public.sync_recall_match_removal()                             SET search_path = public;
ALTER FUNCTION public.trigger_recall_sweep()                                  SET search_path = public;

-- 3
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

COMMIT;

-- Acceptance (expect false, false, 0, 0):
-- select has_table_privilege('anon','public.user_accessible_stores','SELECT'),
--        has_table_privilege('authenticated','public.user_accessible_stores','SELECT'),
--        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--          where n.nspname='public' and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')),
--        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--          where n.nspname='public' and p.prorettype='trigger'::regtype and has_function_privilege('anon',p.oid,'EXECUTE'));

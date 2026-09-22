-- 021_tenant_tables_lockdown.sql
-- Run ONLY after Phase 2 is deployed and 020 is applied. One transaction; re-runnable.
-- Closes review items C3, C4, H2 (DB side), H3, H17, H18.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 0. Preflight: print what is there (nothing changes here) ───────────────
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies
           WHERE schemaname='public' AND tablename IN ('scans','stores','organisations','recall_distributions',
                 'recall_acknowledgements','recall_events','recalls','user_profiles','store_manager_stores')
           ORDER BY tablename, policyname LOOP
    RAISE NOTICE 'BEFORE % | % | % | % | USING % | CHECK %', p.tablename, p.policyname, p.cmd, p.roles, p.qual, p.with_check;
  END LOOP;
END $$;

-- ── 1. Drop every open policy on the tenant tables ─────────────────────────────
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
           WHERE schemaname='public'
             AND tablename IN ('scans','stores','organisations','recall_distributions','recall_acknowledgements')
             AND (qual = 'true' OR with_check = 'true'
                  OR qual = '(auth.role() = ''authenticated''::text)'
                  OR qual = '(auth.uid() IS NOT NULL)') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
    RAISE NOTICE 'dropped open policy "%" on %', p.policyname, p.tablename;
  END LOOP;
END $$;
DROP POLICY IF EXISTS "Managers can manage stores" ON public.stores;             -- cross-org via user_profiles.is_manager
DROP POLICY IF EXISTS "Service can insert"         ON public.recall_acknowledgements;

-- ── 2. scans (C3). Scanner inserts carry organisation_id; updates are by id within the org.
DROP POLICY IF EXISTS b20_scans_member_select ON public.scans;
CREATE POLICY b20_scans_member_select ON public.scans FOR SELECT
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()));
DROP POLICY IF EXISTS b20_scans_member_insert ON public.scans;
CREATE POLICY b20_scans_member_insert ON public.scans FOR INSERT
  WITH CHECK (organisation_id IN (SELECT public.batchd_my_active_org_ids()));
DROP POLICY IF EXISTS b20_scans_member_update ON public.scans;
CREATE POLICY b20_scans_member_update ON public.scans FOR UPDATE
  USING      (organisation_id IN (SELECT public.batchd_my_active_org_ids()))
  WITH CHECK (organisation_id IN (SELECT public.batchd_my_active_org_ids()));
DROP POLICY IF EXISTS scans_corp_admin_update ON public.scans;
CREATE POLICY scans_corp_admin_update ON public.scans FOR UPDATE
  USING      (public.batchd_is_corp_admin_of(organisation_id))
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id));
DROP POLICY IF EXISTS b20_scans_platform_admin ON public.scans;
CREATE POLICY b20_scans_platform_admin ON public.scans FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

-- ── 3. stores (H18). The existing org-scoped policies from the dump ("Members can view their
--    org stores", "Admins and managers can manage stores") stay. These are a safety net.
DROP POLICY IF EXISTS b20_stores_member_select ON public.stores;
CREATE POLICY b20_stores_member_select ON public.stores FOR SELECT
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()));
DROP POLICY IF EXISTS b20_stores_admin_write ON public.stores;
CREATE POLICY b20_stores_admin_write ON public.stores FOR ALL
  USING      (public.batchd_is_corp_admin_of(organisation_id))
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id));
DROP POLICY IF EXISTS b20_stores_platform_admin ON public.stores;
CREATE POLICY b20_stores_platform_admin ON public.stores FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

-- ── 4. user_profiles (H18): own row only; is_manager set by accept_invitation or support.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='user_profiles' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_profiles', p.policyname);
    RAISE NOTICE 'dropped user_profiles policy "%"', p.policyname;
  END LOOP;
END $$;
CREATE POLICY b20_profiles_own_select ON public.user_profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY b20_profiles_own_insert ON public.user_profiles FOR INSERT
  WITH CHECK (id = auth.uid() AND COALESCE(is_manager, false) = false);
CREATE POLICY b20_profiles_own_update ON public.user_profiles FOR UPDATE
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY b20_profiles_platform_admin ON public.user_profiles FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

CREATE OR REPLACE FUNCTION public.batchd_guard_profile_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.batchd_bypass_guards_active() OR public.batchd_is_platform_admin() THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_manager,false) IS DISTINCT FROM COALESCE(OLD.is_manager,false) THEN
    RAISE EXCEPTION 'Manager status is assigned by your administrator.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS batchd_guard_profile_update ON public.user_profiles;
CREATE TRIGGER batchd_guard_profile_update
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.batchd_guard_profile_update();

-- ── 5. store_manager_stores: retire the any-org helper (H17) ─────────────────────
DROP POLICY IF EXISTS store_manager_stores_corp_admin_all ON public.store_manager_stores;
CREATE POLICY store_manager_stores_corp_admin_all ON public.store_manager_stores FOR ALL
  USING      (public.batchd_is_corp_admin_of(organisation_id))
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id));

-- ── 6. recall_distributions / recall_acknowledgements / recall_events / recalls (C4) ───
DROP POLICY IF EXISTS b20_dist_select ON public.recall_distributions;
CREATE POLICY b20_dist_select ON public.recall_distributions FOR SELECT
  USING (retailer_org_id IN (SELECT public.batchd_my_active_org_ids())
         OR recall_event_id IN (SELECT public.batchd_my_source_event_ids()));
-- Composer and drill launcher distribute the org's OWN event to ITSELF (dashboard.html
-- 4053, 4951). Cross-org fan-out is service-role only (webhook-recall.js).
DROP POLICY IF EXISTS b20_dist_insert ON public.recall_distributions;
CREATE POLICY b20_dist_insert ON public.recall_distributions FOR INSERT
  WITH CHECK (retailer_org_id IN (SELECT public.batchd_my_active_org_ids())
              AND recall_event_id IN (SELECT public.batchd_my_source_event_ids()));
DROP POLICY IF EXISTS b20_dist_platform_admin ON public.recall_distributions;
CREATE POLICY b20_dist_platform_admin ON public.recall_distributions FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

DROP POLICY IF EXISTS b20_acks_member_all ON public.recall_acknowledgements;
CREATE POLICY b20_acks_member_all ON public.recall_acknowledgements FOR ALL
  USING      (organisation_id IN (SELECT public.batchd_my_active_org_ids()))
  WITH CHECK (organisation_id IN (SELECT public.batchd_my_active_org_ids()));
DROP POLICY IF EXISTS b20_acks_platform_admin ON public.recall_acknowledgements;
CREATE POLICY b20_acks_platform_admin ON public.recall_acknowledgements FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

-- Real events: corp_admin of the source org. Drills: any manager of the source org
-- (the drill launcher has no role gate in the UI, and its rollback deletes the event).
DROP POLICY IF EXISTS b20_events_source_admin_write ON public.recall_events;
CREATE POLICY b20_events_source_admin_write ON public.recall_events FOR ALL
  USING      (public.batchd_is_corp_admin_of(source_org_id))
  WITH CHECK (public.batchd_is_corp_admin_of(source_org_id));
DROP POLICY IF EXISTS b20_events_source_manager_drill ON public.recall_events;
CREATE POLICY b20_events_source_manager_drill ON public.recall_events FOR ALL
  USING      (is_drill = true AND public.batchd_is_manager_of(source_org_id))
  WITH CHECK (is_drill = true AND public.batchd_is_manager_of(source_org_id));
DROP POLICY IF EXISTS b20_events_platform_admin ON public.recall_events;
CREATE POLICY b20_events_platform_admin ON public.recall_events FOR SELECT
  USING (public.batchd_is_platform_admin());
DROP POLICY IF EXISTS b20_recalls_platform_admin ON public.recalls;
CREATE POLICY b20_recalls_platform_admin ON public.recalls FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

-- ── 7. organisations (H3): member read, partner read, admin update, platform admin ─────
DROP POLICY IF EXISTS b20_orgs_member_select ON public.organisations;
CREATE POLICY b20_orgs_member_select ON public.organisations FOR SELECT
  USING (id IN (SELECT public.batchd_my_active_org_ids()));
-- Source orgs of recalls pushed to me: dashboard renders their name and coordinator
-- (dashboard.html 2792, 3451, 9978, 13800).
DROP POLICY IF EXISTS b20_orgs_partner_select ON public.organisations;
CREATE POLICY b20_orgs_partner_select ON public.organisations FOR SELECT
  USING (id IN (SELECT public.batchd_my_partner_source_org_ids()));
DROP POLICY IF EXISTS b20_orgs_corp_admin_update ON public.organisations;
CREATE POLICY b20_orgs_corp_admin_update ON public.organisations FOR UPDATE
  USING (public.batchd_is_corp_admin_of(id)) WITH CHECK (public.batchd_is_corp_admin_of(id));
DROP POLICY IF EXISTS b20_orgs_platform_admin ON public.organisations;
CREATE POLICY b20_orgs_platform_admin ON public.organisations FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());
-- No client INSERT policy: signup goes through create_organisation_with_admin (definer);
-- admin.html's create-org insert is covered by the platform-admin policy.

-- ── 8. ERP API keys out of the client-readable table (H2) ──────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS public.organisation_api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  key_hash        text NOT NULL UNIQUE,
  label           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);
ALTER TABLE public.organisation_api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organisation_api_keys FROM public, anon, authenticated;   -- service role only
INSERT INTO public.organisation_api_keys (organisation_id, key_hash, label)
  SELECT id, encode(digest(api_key, 'sha256'), 'hex'), 'migrated ' || now()::date
  FROM public.organisations WHERE api_key IS NOT NULL
  ON CONFLICT (key_hash) DO NOTHING;
UPDATE public.organisations SET api_key = NULL WHERE api_key IS NOT NULL;
-- The column stays (dashboard.html 11788 and admin.html select *), now always NULL.

-- ── 9. complaints: retailer-targeted public complaints move to receiving_org_id (H4) ───
UPDATE public.complaints c
SET receiving_org_id = c.manufacturer_id, manufacturer_id = NULL
FROM public.organisations o
WHERE c.manufacturer_id = o.id AND o.type <> 'manufacturer' AND c.receiving_org_id IS NULL;

-- ── 10. Post-check ────────────────────────────────────────────────────────
DO $$
DECLARE p record; n int := 0;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
           WHERE schemaname='public'
             AND tablename IN ('scans','stores','organisations','recall_distributions','recall_acknowledgements','invitations','user_profiles')
             AND (qual = 'true' OR with_check = 'true') LOOP
    n := n + 1; RAISE WARNING 'STILL OPEN: %.%', p.tablename, p.policyname;
  END LOOP;
  IF n = 0 THEN RAISE NOTICE 'OK: no USING(true)/CHECK(true) policies remain on the tenant tables.'; END IF;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- PREVIEW: exactly what the migrations will drop and change, BEFORE you
-- run them. READ-ONLY. Changes nothing. Run it as many times as you like.
--
-- Anything that comes back is something a migration will touch. An empty
-- result for a section means that migration has nothing to do there.
--
-- Note: most "DROP POLICY" lines in the files are DROP IF EXISTS followed
-- immediately by CREATE of the same name, inside one transaction. Those
-- are replacements, not removals. This preview shows what actually exists
-- right now and would therefore really be dropped.
-- ══════════════════════════════════════════════════════════════════════

-- 1. Policies 019 + 020 drop by name
SELECT '1. DROP POLICY (019/020, by name)' AS what,
       tablename || '  /  ' || policyname AS object
FROM pg_policies WHERE schemaname = 'public' AND policyname IN (
  'Anyone can read invitation by token','Insert own membership',
  'Admins can update org memberships','Delete own memberships',
  'organisation_members_corp_admin_update','organisation_members_manager_update',
  'b20_members_platform_admin','b20_inv_admin_select','b20_inv_admin_insert',
  'b20_inv_admin_update','b20_inv_admin_delete')

UNION ALL
-- 2. Functions/triggers 020 drops and recreates in the same transaction
SELECT '2. DROP+RECREATE FUNCTION (020)', 'send_invitation  (recreated 2 lines later)'
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'send_invitation'

UNION ALL
SELECT '2. DROP+RECREATE TRIGGER (020/021)', tgname || '  (recreated immediately)'
FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
  ('batchd_guard_member_self_update','batchd_guard_member_insert',
   'batchd_guard_org_commercial_columns','batchd_guard_profile_update')

UNION ALL
-- 3. 021's dynamic loop — the SAME condition the loop uses, so this is
--    literally the list it will drop
SELECT '3. DROP POLICY (021, open policies)', tablename || '  /  ' || policyname
FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('scans','stores','organisations','recall_distributions','recall_acknowledgements')
  AND (qual = 'true' OR with_check = 'true'
       OR qual = '(auth.role() = ''authenticated''::text)'
       OR qual = '(auth.uid() IS NOT NULL)')

UNION ALL
-- 4. 021 drops EVERY policy on user_profiles, then creates 4 new ones
SELECT '4. DROP POLICY (021, all on user_profiles)', 'user_profiles  /  ' || policyname
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles'

UNION ALL
-- 5. 021 drops these three by name
SELECT '5. DROP POLICY (021, by name)', tablename || '  /  ' || policyname
FROM pg_policies WHERE schemaname = 'public' AND policyname IN
  ('Managers can manage stores','Service can insert','store_manager_stores_corp_admin_all')

UNION ALL
-- ── DATA CHANGES. These are the only three, and they are all here. ──
SELECT '6. DATA: 020a changes plan', name || ':  ' || coalesce(plan,'(null)') || '  ->  pov'
FROM public.organisations
WHERE plan IS DISTINCT FROM 'active' AND plan IS DISTINCT FROM 'churned'

UNION ALL
SELECT '7. DATA: 021 blanks api_key (sha256 kept in new table)', name
FROM public.organisations WHERE api_key IS NOT NULL

UNION ALL
SELECT '8. DATA: 021 moves complaint to receiving_org_id', c.id::text
FROM public.complaints c
JOIN public.organisations o ON c.manufacturer_id = o.id
WHERE o.type <> 'manufacturer' AND c.receiving_org_id IS NULL

ORDER BY 1, 2;

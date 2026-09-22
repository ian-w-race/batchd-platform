-- Verify migration 020 applied fully. READ-ONLY.
-- The Supabase SQL editor does not display RAISE NOTICE output, so instead of
-- reading the migration's own messages this checks the same things by looking
-- at what now exists. Every row should say PASS.
SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result, detail
FROM (
  SELECT 'helper functions (expect 8)' AS check_name,
         count(*) = 8 AS ok, count(*)::text || ' found' AS detail
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'batchd_bypass_guards_active','batchd_my_active_org_ids','batchd_is_corp_admin_of',
    'batchd_is_manager_of','batchd_is_platform_admin','batchd_my_source_event_ids',
    'batchd_my_partner_source_org_ids','batchd_org_ai_enabled')

  UNION ALL
  SELECT 'guard triggers (expect 3)', count(*) = 3, count(*)::text || ' found'
  FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
    ('batchd_guard_member_self_update','batchd_guard_member_insert','batchd_guard_org_commercial_columns')

  UNION ALL
  SELECT 'invitation policies (expect 4)', count(*) = 4, count(*)::text || ' found'
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invitations'
    AND policyname LIKE 'b20_inv_%'

  UNION ALL
  SELECT 'old 019 policies removed', count(*) = 0, count(*)::text || ' still present'
  FROM pg_policies WHERE schemaname = 'public' AND policyname IN
    ('Anyone can read invitation by token','Insert own membership',
     'Admins can update org memberships','Delete own memberships')

  UNION ALL
  SELECT 'send_invitation hardened (THE IMPORTANT ONE)',
         coalesce(bool_or(position('Not authorised to invite' in prosrc) > 0), false),
         'security_definer=' || coalesce(bool_or(prosecdef)::text,'missing')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'send_invitation'

  UNION ALL
  SELECT 'complaints.ip_hash column', count(*) = 1, count(*)::text || ' found'
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'complaints' AND column_name = 'ip_hash'

  UNION ALL
  SELECT 'CHECK constraints (expect 4; fewer means SKIPPED)', count(*) = 4,
         coalesce(string_agg(conname, ', '), 'none')
  FROM pg_constraint WHERE conname IN
    ('organisation_members_role_check','organisations_plan_check',
     'organisations_type_check','organisations_region_check')

  UNION ALL
  SELECT 'unique indexes (expect 2; fewer means SKIPPED)', count(*) = 2,
         coalesce(string_agg(indexname, ', '), 'none')
  FROM pg_indexes WHERE schemaname = 'public' AND indexname IN
    ('organisation_members_user_org_unique','invitations_token_unique')

  UNION ALL
  SELECT 'onboarding RPCs (expect 4)', count(*) = 4, coalesce(string_agg(p.proname, ', '), 'none')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN
    ('create_organisation_with_admin','accept_invitation',
     'get_invitation_by_token','get_invitation_store_names')
) q
ORDER BY result, check_name;

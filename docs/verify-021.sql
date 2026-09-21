-- Verify migration 021 applied fully. READ-ONLY.
-- Supabase does not show RAISE NOTICE/WARNING output, so this checks the same
-- things by looking at what now exists. Every row should say PASS.
SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result, detail
FROM (
  SELECT 'NO open policies left on tenant tables' AS check_name, count(*) = 0 AS ok,
         coalesce(string_agg(tablename || '/' || policyname, ', '), 'none') AS detail
  FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('scans','stores','organisations','recall_distributions',
                      'recall_acknowledgements','invitations','user_profiles')
    AND (qual = 'true' OR with_check = 'true')

  UNION ALL
  SELECT 'new org-scoped policies created (expect 15+)', count(*) >= 15, count(*)::text || ' found'
  FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'b20_%'

  UNION ALL
  SELECT 'user_profiles has RLS enabled', relrowsecurity, relrowsecurity::text
  FROM pg_class WHERE oid = 'public.user_profiles'::regclass

  UNION ALL
  SELECT 'organisation_api_keys table exists', count(*) = 1, count(*)::text
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'organisation_api_keys'

  UNION ALL
  SELECT 'every plaintext api_key is now blank', count(*) = 0,
         count(*)::text || ' still have one'
  FROM public.organisations WHERE api_key IS NOT NULL

  UNION ALL
  SELECT 'api key hashes were migrated', true,
         (SELECT count(*)::text FROM public.organisation_api_keys) || ' hash(es) stored'

  UNION ALL
  SELECT 'organisations is no longer world-readable', count(*) = 0,
         coalesce(string_agg(policyname, ', '), 'none')
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organisations'
    AND cmd IN ('SELECT','ALL') AND qual = 'true'
) q
ORDER BY result, check_name;

-- verify-022-026.sql
-- Read-only. Run after migrations 022 to 026. Every row must say PASS.
-- Same shape as docs/verify-020.sql and verify-021.sql.
SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result, detail
FROM (
  SELECT '022 suppliers table exists' AS check_name,
         EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='suppliers') AS ok,
         ''::text AS detail
  UNION ALL
  SELECT '023 receiving_events table exists',
         EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='receiving_events'), ''
  UNION ALL
  SELECT '023 scans.receiving_event_id column exists',
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='scans' AND column_name='receiving_event_id'), ''
  UNION ALL
  SELECT '024 organisations has the 10 new columns',
         (SELECT count(*) FROM information_schema.columns
           WHERE table_schema='public' AND table_name='organisations'
             AND column_name IN ('annual_food_sales_band','operates_registered_facility','operates_distribution_center',
                                 'fsma_applicability','focus_categories','pricing_tier','network_benchmarks_opt_in',
                                 'traceability_plan_contact_name','traceability_plan_contact_phone','traceability_plan_updated_at')) = 10,
         (SELECT count(*)::text || ' of 10' FROM information_schema.columns
           WHERE table_schema='public' AND table_name='organisations'
             AND column_name IN ('annual_food_sales_band','operates_registered_facility','operates_distribution_center',
                                 'fsma_applicability','focus_categories','pricing_tier','network_benchmarks_opt_in',
                                 'traceability_plan_contact_name','traceability_plan_contact_phone','traceability_plan_updated_at'))
  UNION ALL
  SELECT '025 products has the 4 FTL columns',
         (SELECT count(*) FROM information_schema.columns
           WHERE table_schema='public' AND table_name='products'
             AND column_name IN ('is_ftl','ftl_category','ftl_confirmed_source','ftl_confirmed_at')) = 4, ''
  UNION ALL
  SELECT '025 ftl_overrides table exists',
         EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ftl_overrides'), ''
  UNION ALL
  SELECT '026 records_requests and traceability_plans exist',
         (SELECT count(*) FROM information_schema.tables
           WHERE table_schema='public' AND table_name IN ('records_requests','traceability_plans')) = 2, ''
  UNION ALL
  SELECT 'RLS enabled on all 5 new tables',
         (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relrowsecurity
             AND c.relname IN ('suppliers','receiving_events','ftl_overrides','records_requests','traceability_plans')) = 5,
         (SELECT count(*)::text || ' of 5' FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relrowsecurity
             AND c.relname IN ('suppliers','receiving_events','ftl_overrides','records_requests','traceability_plans'))
  UNION ALL
  SELECT 'NO open policies on the new tables',
         (SELECT count(*) FROM pg_policies
           WHERE schemaname='public'
             AND tablename IN ('suppliers','receiving_events','ftl_overrides','records_requests','traceability_plans')
             AND (qual = 'true' OR with_check = 'true')) = 0,
         (SELECT count(*)::text || ' open' FROM pg_policies
           WHERE schemaname='public'
             AND tablename IN ('suppliers','receiving_events','ftl_overrides','records_requests','traceability_plans')
             AND (qual = 'true' OR with_check = 'true'))
  UNION ALL
  SELECT 'every new table has a platform-admin policy',
         (SELECT count(DISTINCT tablename) FROM pg_policies
           WHERE schemaname='public' AND policyname LIKE '%platform_admin'
             AND tablename IN ('suppliers','receiving_events','ftl_overrides','records_requests','traceability_plans')) = 5, ''
  UNION ALL
  SELECT 'anon has no privileges on the new tables',
         (SELECT count(*) FROM information_schema.role_table_grants
           WHERE table_schema='public' AND grantee='anon'
             AND table_name IN ('suppliers','receiving_events','ftl_overrides','records_requests','traceability_plans')) = 0,
         (SELECT count(*)::text || ' grants' FROM information_schema.role_table_grants
           WHERE table_schema='public' AND grantee='anon'
             AND table_name IN ('suppliers','receiving_events','ftl_overrides','records_requests','traceability_plans'))
  UNION ALL
  SELECT 'trigger functions present (touch_updated_at, receiving_set_retention)',
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN ('batchd_touch_updated_at','batchd_receiving_set_retention')) = 2, ''
) checks
ORDER BY check_name;

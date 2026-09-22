-- OPTIONAL, for later. READ-ONLY.
-- Only needed if you decide to pursue the code_patterns ownership follow-up
-- (see docs/SECURITY-ROLLOUT-2026-09.md section 5, item 2). It shows whether
-- the table has row-level security at all, and what its policies are.
SELECT 'RLS enabled on code_patterns: '
       || (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.code_patterns'::regclass) AS info
UNION ALL
SELECT 'policy: ' || policyname || '  |  ' || cmd
       || '  |  using=' || coalesce(qual, '(none)')
       || '  |  check=' || coalesce(with_check, '(none)')
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'code_patterns'
ORDER BY 1;

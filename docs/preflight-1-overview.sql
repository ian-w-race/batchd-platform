-- Batch'd pre-flight diagnostic 1 of 2. READ-ONLY: changes nothing.
-- Paste into the Supabase SQL Editor and press Run.
-- One result table comes back. Copy all of it and send it to Claude.
SELECT 'A. ORGANISATION' AS section,
       id::text || '  |  ' || coalesce(name,'(no name)')
         || '  |  type=' || coalesce(type,'?')
         || '  |  plan=' || coalesce(plan,'(NULL)')
         || '  |  region=' || coalesce(region,'(NULL)') AS detail
FROM public.organisations
UNION ALL
SELECT 'B. PLATFORM ADMIN',
       'user=' || user_id::text || '  |  org=' || organisation_id::text
         || '  |  role=' || coalesce(role,'?')
         || '  |  active=' || coalesce(active::text,'(NULL)')
FROM public.organisation_members WHERE is_batched_admin = true
UNION ALL
SELECT 'C. code_patterns column', column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'code_patterns'
UNION ALL
SELECT 'E. scans with no organisation', count(*)::text
FROM public.scans WHERE organisation_id IS NULL
UNION ALL
SELECT 'E. stores with no organisation', count(*)::text
FROM public.stores WHERE organisation_id IS NULL
UNION ALL
SELECT 'F. DUPLICATE membership',
       'user=' || user_id::text || '  |  org=' || organisation_id::text || '  |  copies=' || count(*)::text
FROM public.organisation_members GROUP BY user_id, organisation_id HAVING count(*) > 1
UNION ALL
SELECT 'G. DUPLICATE invite token', token
FROM public.invitations GROUP BY token HAVING count(*) > 1
UNION ALL
SELECT 'H. old policy still present', tablename || '  /  ' || policyname
FROM pg_policies WHERE schemaname = 'public' AND policyname IN
  ('Anyone can read invitation by token','Insert own membership',
   'Admins can update org memberships','Delete own memberships')
ORDER BY 1, 2;

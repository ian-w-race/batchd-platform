-- 032_lock_photo_bucket.sql
-- Found 2026-10-24 while rebuilding production's schema in staging.
-- One transaction; re-runnable (DROP POLICY IF EXISTS before each CREATE).
--
-- Before: six policies on storage.objects for bucket scan-photos.
--   "Public Access h0pwpd_0" to _3 applied to role public, which covers
--   the anon key and every signed-in user: anyone on the internet could
--   list, upload, overwrite and DELETE any photo in the bucket.
--   "Authenticated storage insert" and "... select" let any signed-in
--   user write or list anywhere in the bucket, across organisations.
--
-- After:
--   - No policy for anon. Photos still load from their public URL
--     (/storage/v1/object/public/scan-photos/...) because the bucket stays
--     public, and public URLs do not go through these policies. Listing the
--     bucket and writing to it need a signed-in member.
--   - A signed-in member may read, upload and overwrite (the scanner's
--     offline replay uploads with upsert) only under
--     orgs/<first 8 characters of an organisation id they are an active
--     member of>/ ... which is exactly the path the scanner builds
--     (index.html, orgPrefix and the receiving label paths).
--   - Nobody may delete through the API. Label and shelf photos are
--     evidence. The service role (server functions, dashboard) still can.
--   - The 82 older photos stored at the bucket root (March and April 2026,
--     before org folders) stay readable by their public URL. No signed-in
--     user can overwrite them any more.
--
-- Known limit: the folder key is 8 hex characters of the org id, so two
-- orgs whose ids share those 8 characters would share a folder. With
-- random UUIDs that is about 1 in 4 billion per pair.
--
-- Rollback (restores the old open access; do not run without a reason):
--   drop policy b32_scan_photos_member_select on storage.objects;
--   drop policy b32_scan_photos_member_insert on storage.objects;
--   drop policy b32_scan_photos_member_update on storage.objects;
--   create policy "Authenticated storage insert" on storage.objects for insert to authenticated with check (bucket_id = 'scan-photos');
--   create policy "Authenticated storage select" on storage.objects for select to authenticated using (bucket_id = 'scan-photos');
--   create policy "Public Access h0pwpd_0" on storage.objects for select to public using (bucket_id = 'scan-photos');
--   create policy "Public Access h0pwpd_1" on storage.objects for insert to public with check (bucket_id = 'scan-photos');
--   create policy "Public Access h0pwpd_2" on storage.objects for update to public using (bucket_id = 'scan-photos');
--   create policy "Public Access h0pwpd_3" on storage.objects for delete to public using (bucket_id = 'scan-photos');

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP POLICY IF EXISTS "Public Access h0pwpd_0"        ON storage.objects;
DROP POLICY IF EXISTS "Public Access h0pwpd_1"        ON storage.objects;
DROP POLICY IF EXISTS "Public Access h0pwpd_2"        ON storage.objects;
DROP POLICY IF EXISTS "Public Access h0pwpd_3"        ON storage.objects;
DROP POLICY IF EXISTS "Authenticated storage insert"  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated storage select"  ON storage.objects;

DROP POLICY IF EXISTS b32_scan_photos_member_select ON storage.objects;
DROP POLICY IF EXISTS b32_scan_photos_member_insert ON storage.objects;
DROP POLICY IF EXISTS b32_scan_photos_member_update ON storage.objects;

CREATE POLICY b32_scan_photos_member_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'scan-photos'
    AND (storage.foldername(name))[1] = 'orgs'
    AND (storage.foldername(name))[2] IN
        (SELECT left(o::text, 8) FROM public.batchd_my_active_org_ids() AS o)
  );

CREATE POLICY b32_scan_photos_member_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'scan-photos'
    AND (storage.foldername(name))[1] = 'orgs'
    AND (storage.foldername(name))[2] IN
        (SELECT left(o::text, 8) FROM public.batchd_my_active_org_ids() AS o)
  );

CREATE POLICY b32_scan_photos_member_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'scan-photos'
    AND (storage.foldername(name))[1] = 'orgs'
    AND (storage.foldername(name))[2] IN
        (SELECT left(o::text, 8) FROM public.batchd_my_active_org_ids() AS o)
  )
  WITH CHECK (
    bucket_id = 'scan-photos'
    AND (storage.foldername(name))[1] = 'orgs'
    AND (storage.foldername(name))[2] IN
        (SELECT left(o::text, 8) FROM public.batchd_my_active_org_ids() AS o)
  );

COMMIT;

-- Acceptance: exactly three policies on storage.objects, all b32_, all
-- for role authenticated:
-- select policyname, cmd, roles from pg_policies
-- where schemaname = 'storage' and tablename = 'objects' order by 1;

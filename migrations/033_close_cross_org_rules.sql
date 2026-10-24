-- 033_close_cross_org_rules.sql
-- Found 2026-10-24 while rebuilding production's schema in staging.
-- One transaction; re-runnable (DROP POLICY IF EXISTS before each CREATE,
-- CREATE OR REPLACE FUNCTION, idempotent REVOKE and SET DEFAULT).
--
-- 1. code_patterns (learned label patterns). Before: any signed-in user
--    could read, insert and update every row, and rows carry real lot
--    codes (code_a, code_b). After: a member works only with their own
--    org's rows; corp admins and store managers may delete; platform
--    admins see all. The scanner never sets organisation_id when it saves
--    a pattern, so the column now defaults to the caller's org
--    (batchd_user_org_id()) and saves keep working without a code change.
--    Effect: the 12 legacy rows with no org become visible to platform
--    admins only, and one org's learned patterns no longer help another
--    org's scanner. Learning has been idle since May 2026 (AI label
--    reading retired), so nothing in daily use depends on sharing.
--
-- 2. scan_queue. Unused by any app and empty. Before: any signed-in user
--    could read and delete every row. After: no client access at all.
--
-- 3. scan_telemetry. The scanner inserts; nothing in the apps reads it.
--    Before: every signed-in user could read every org's rows. After: a
--    member reads only their own org's rows; platform admins read all.
--    Inserts are unchanged.
--
-- 4. complaints, complaint_messages, complaint_audit_log. Before: anyone,
--    including the public anon key, could insert rows directly through
--    the API, skipping triage-complaint.js (its rate limits, honeypot and
--    plan gate). The function writes with the service role, which ignores
--    these policies, so it is unaffected. After: no direct inserts into
--    complaints or complaint_messages; complaint_audit_log accepts an
--    insert only from a signed-in member of the complaint's organization
--    (the dashboard's status-change log does exactly that).
--
-- 5. sweep_recall_matches. Before: any signed-in user could pass any
--    p_organisation_id and any recall id. After: when called by a user,
--    the caller must be an active member of p_organisation_id (or a
--    platform admin), and the recall must belong to that org or to no org
--    (8,340 shared feed recalls have no org). Server-side calls with no
--    user (service role, feed import) are unchanged. The trigger path is
--    unchanged in practice: a user can only insert a recall into an org
--    they belong to. search_path is now pinned to public.
--
-- Rollback (restores the old open access; do not run without a reason).
-- Drop the b33_ policies, then:
--   alter table public.code_patterns alter column organisation_id drop default;
--   create policy "Authenticated insert patterns" on public.code_patterns for insert to authenticated with check (true);
--   create policy "Authenticated select patterns" on public.code_patterns for select to authenticated using (true);
--   create policy "Authenticated update patterns" on public.code_patterns for update to authenticated using (true);
--   grant all on public.scan_queue to anon, authenticated;
--   create policy "Users can read their own queued scans" on public.scan_queue for select to authenticated using (auth.uid() is not null);
--   create policy "Users can insert their own queued scans" on public.scan_queue for insert to authenticated with check (auth.uid() is not null);
--   create policy "Users can delete their own queued scans" on public.scan_queue for delete to authenticated using (auth.uid() is not null);
--   create policy authenticated_can_read_telemetry on public.scan_telemetry for select to authenticated using (true);
--   create policy "Orgs insert complaints" on public.complaints for insert to public with check (true);
--   create policy "Insert complaint messages" on public.complaint_messages for insert to public with check (true);
--   create policy "Insert audit log" on public.complaint_audit_log for insert to public with check (true);
-- and re-create sweep_recall_matches without the two "033" checks (the
-- rest of the body is unchanged).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. code_patterns
ALTER TABLE public.code_patterns ALTER COLUMN organisation_id SET DEFAULT public.batchd_user_org_id();
DROP POLICY IF EXISTS "Authenticated insert patterns" ON public.code_patterns;
DROP POLICY IF EXISTS "Authenticated select patterns" ON public.code_patterns;
DROP POLICY IF EXISTS "Authenticated update patterns" ON public.code_patterns;
DROP POLICY IF EXISTS b33_patterns_member_select   ON public.code_patterns;
DROP POLICY IF EXISTS b33_patterns_member_insert   ON public.code_patterns;
DROP POLICY IF EXISTS b33_patterns_member_update   ON public.code_patterns;
DROP POLICY IF EXISTS b33_patterns_manager_delete  ON public.code_patterns;
DROP POLICY IF EXISTS b33_patterns_platform_admin  ON public.code_patterns;
CREATE POLICY b33_patterns_member_select ON public.code_patterns FOR SELECT TO authenticated
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()));
CREATE POLICY b33_patterns_member_insert ON public.code_patterns FOR INSERT TO authenticated
  WITH CHECK (organisation_id IN (SELECT public.batchd_my_active_org_ids()));
CREATE POLICY b33_patterns_member_update ON public.code_patterns FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()))
  WITH CHECK (organisation_id IN (SELECT public.batchd_my_active_org_ids()));
CREATE POLICY b33_patterns_manager_delete ON public.code_patterns FOR DELETE TO authenticated
  USING (public.batchd_is_manager_of(organisation_id));
CREATE POLICY b33_patterns_platform_admin ON public.code_patterns FOR ALL TO authenticated
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

-- 2. scan_queue
DROP POLICY IF EXISTS "Users can delete their own queued scans" ON public.scan_queue;
DROP POLICY IF EXISTS "Users can insert their own queued scans" ON public.scan_queue;
DROP POLICY IF EXISTS "Users can read their own queued scans"   ON public.scan_queue;
REVOKE ALL ON public.scan_queue FROM anon, authenticated;

-- 3. scan_telemetry
DROP POLICY IF EXISTS authenticated_can_read_telemetry ON public.scan_telemetry;
DROP POLICY IF EXISTS b33_telemetry_member_select      ON public.scan_telemetry;
DROP POLICY IF EXISTS b33_telemetry_platform_admin     ON public.scan_telemetry;
CREATE POLICY b33_telemetry_member_select ON public.scan_telemetry FOR SELECT TO authenticated
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()));
CREATE POLICY b33_telemetry_platform_admin ON public.scan_telemetry FOR ALL TO authenticated
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

-- 4. complaints
DROP POLICY IF EXISTS "Orgs insert complaints"    ON public.complaints;
DROP POLICY IF EXISTS "Insert complaint messages" ON public.complaint_messages;
DROP POLICY IF EXISTS "Insert audit log"          ON public.complaint_audit_log;
DROP POLICY IF EXISTS b33_audit_member_insert     ON public.complaint_audit_log;
CREATE POLICY b33_audit_member_insert ON public.complaint_audit_log FOR INSERT TO authenticated
  WITH CHECK (complaint_id IN (
    SELECT c.id FROM public.complaints c
    WHERE c.receiving_org_id IN (SELECT public.batchd_my_active_org_ids())
       OR c.manufacturer_id  IN (SELECT public.batchd_my_active_org_ids())));

-- 5. sweep_recall_matches: same body as before plus the two checks.
CREATE OR REPLACE FUNCTION public.sweep_recall_matches(p_recall_id uuid, p_organisation_id uuid, p_lookback_days integer DEFAULT 180)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recall        recalls%ROWTYPE;
  v_lot           text;
  v_barcode       text;
  v_inserted      int := 0;
  v_cutoff        timestamptz;
BEGIN
  -- 033: a signed-in caller may only sweep into an org they belong to.
  -- Calls with no user (service role, feed import) are not restricted.
  IF auth.uid() IS NOT NULL
     AND NOT public.batchd_is_platform_admin()
     AND p_organisation_id NOT IN (SELECT public.batchd_my_active_org_ids()) THEN
    RAISE EXCEPTION 'Not a member of this organization.' USING ERRCODE = '42501';
  END IF;

  -- Load the recall
  SELECT * INTO v_recall FROM recalls WHERE id = p_recall_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- 033: the recall must belong to this org or be a shared (no-org) recall.
  IF v_recall.organisation_id IS NOT NULL AND v_recall.organisation_id <> p_organisation_id THEN
    RETURN 0;
  END IF;

  v_lot     := lower(trim(v_recall.lot_number));
  v_barcode := lower(trim(v_recall.barcode_number));
  v_cutoff  := now() - (p_lookback_days || ' days')::interval;

  -- Only proceed if there's a specific lot or barcode to match on.
  -- Recalls without a lot/barcode are too broad to match reliably.
  IF (v_lot IS NULL OR v_lot = '') AND (v_barcode IS NULL OR v_barcode = '') THEN
    RETURN 0;
  END IF;

  -- Insert matches for exact lot or exact barcode, never product name
  INSERT INTO scan_recall_matches (
    scan_id, recall_id, recall_source, recall_product, recall_lot,
    match_type, match_confidence, organisation_id,
    store_name, store_id, scanned_by, placed_at, quantity
  )
  SELECT
    s.id,
    p_recall_id,
    COALESCE(v_recall.source, 'manual'),
    v_recall.product_name,
    v_recall.lot_number,
    CASE
      WHEN v_lot     != '' AND lower(trim(s.lot_number))     = v_lot     THEN 'exact_lot'
      WHEN v_barcode != '' AND lower(trim(s.barcode_number)) = v_barcode THEN 'exact_barcode'
    END AS match_type,
    'high',
    p_organisation_id,
    s.store_name,
    s.store_id,
    s.scanned_by,
    s.created_at,
    COALESCE(s.quantity, 1)
  FROM scans s
  WHERE s.organisation_id = p_organisation_id
    AND s.created_at     >= v_cutoff
    AND (
      (v_lot     != '' AND lower(trim(s.lot_number))     = v_lot)
      OR
      (v_barcode != '' AND lower(trim(s.barcode_number)) = v_barcode)
    )
  ON CONFLICT (scan_id, recall_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

COMMIT;

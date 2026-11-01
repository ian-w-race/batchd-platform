-- scripts/cleanup-staging-e2e-data.sql
-- Removes the rows the end-to-end tests (e2e/) leave in the STAGING database
-- (project batchd-staging, tiwrrocdwljazweveeth) for the shared test org
-- "QA 038 Grocer". STAGING ONLY. The guard in step 2 refuses to run on a
-- database that holds Ian's production org, and the rule below never
-- matches production data anyway, but do not point this at
-- lurxucdmrugikdlvvebc.
--
-- When to run it: after a batch of deploy previews (the e2e workflow runs
-- on every one and leaves one chain of rows per run), or whenever the
-- Recalls panel on a preview gets slow or a run times out waiting for a
-- button. Claude runs it through the Supabase connector: step 1 first
-- (read-only preview), then step 2 (one transaction).
--
-- The rule (what counts as a test row), all scoped to the QA org:
--   receiving_events   traceability_lot_code starts with "E2E", or
--                      product_name starts with "E2E " (core-flow step 1)
--   scans              lot_number starts with "E2E", or product_name starts
--                      with "E2E " (core-flow steps 2 and 4)
--   recall_events      product_name starts with "E2E ", lot_number starts
--                      with "E2E", closed_note is "End-to-end test, closed
--                      automatically", or the event was pushed from a
--                      STAGING TEST notice (recall_notices.recall_event_id)
--   recall_notices     raw_text contains "STAGING TEST"
--                      (e2e/recall-notice.spec.mjs)
--   records_requests   scope_lot starts with "E2E" or scope_product starts
--                      with "E2E " (none yet; the drill test is not written)
--   Children follow their parent: recall_distributions,
--   recall_acknowledgements, recall_effectiveness_checks, mock_recall_drills
--   and the linked recalls rows (recalls.recall_event_id) of a deleted
--   event; scan_recall_matches of a deleted scan, event or recalls row;
--   scans_audit_log of a deleted scan. scan_telemetry and complaints only
--   point at scans with ON DELETE SET NULL and are left alone.
--
-- Window: rows younger than keep_hours (default 24) stay, so a run that is
-- still going on a deploy preview is never cut in half. Oldest rows go
-- first: everything older than the window goes in one pass.
--
-- Kept on purpose (not test rows): the QA stores, members, suppliers and
-- the two accounts; the FDA feed rows in recalls; the manual QA recalls
-- ("QA Baby spinach 5 oz" lot QA038LOT, "QA multi-lot test peanut butter");
-- the hand-pasted notice.pdf and the recall pushed from it; the QA smoke
-- scans and deliveries (QA038LOT, QAW, SMOKE1101, QA Creamy Peanut Butter
-- and so on); the QA10LOT drill records requests.
--
-- Backup: every deleted row is copied first into
-- backup.e2e_cleanup_<YYYYMMDD>_<table> (schema backup is created on
-- first use and revoked from public, anon and authenticated). A second run
-- on the same day appends to the same tables. To restore one row:
--   insert into public.scans
--     select * from backup.e2e_cleanup_20261101_scans where id = '<id>';
-- Drop the backup tables once the next cleanup has run without complaint.
--
-- Order of deletes (foreign keys): scan_recall_matches, scans_audit_log,
-- scans, receiving_events, recall_notices, recall_acknowledgements,
-- recall_distributions, recall_effectiveness_checks, mock_recall_drills,
-- recalls (linked rows), recall_events, records_requests.
--
-- First run 2026-11-01 on staging (see docs/CHANGELOG.md).

-- ---------------------------------------------------------------------------
-- Step 1: preview (read-only). Change the interval here and in step 2 together.
-- ---------------------------------------------------------------------------
with params as (
  select (select id from organisations where name = 'QA 038 Grocer') as org_id,
         now() - interval '24 hours' as cutoff),
notices as (
  select n.id, n.recall_event_id, n.created_at < p.cutoff as old
  from recall_notices n, params p
  where n.organisation_id = p.org_id and n.raw_text like '%STAGING TEST%'),
events as (
  select e.id, e.created_at < p.cutoff as old, e.closed_at is null as live
  from recall_events e, params p
  where e.source_org_id = p.org_id
    and (e.product_name like 'E2E %' or e.lot_number like 'E2E%'
         or e.closed_note = 'End-to-end test, closed automatically'
         or e.id in (select recall_event_id from notices where recall_event_id is not null))),
linked as (
  select r.id, r.created_at < p.cutoff as old, r.active
  from recalls r, params p
  where (r.organisation_id = p.org_id or r.source_org_id = p.org_id)
    and (r.recall_event_id in (select id from events)
         or r.product_name like 'E2E %' or r.lot_number like 'E2E%')),
deliveries as (
  select r.id, r.created_at < p.cutoff as old
  from receiving_events r, params p
  where r.organisation_id = p.org_id
    and (r.traceability_lot_code like 'E2E%' or r.product_name like 'E2E %')),
shelf as (
  select s.id, s.created_at < p.cutoff as old
  from scans s, params p
  where s.organisation_id = p.org_id
    and (s.lot_number like 'E2E%' or s.product_name like 'E2E %')),
matches as (
  select m.id,
         (m.scan_id in (select id from shelf where old)
          or m.recall_event_id in (select id from events where old)
          or m.recall_id in (select id from linked where old)) as old
  from scan_recall_matches m
  where m.scan_id in (select id from shelf)
     or m.recall_event_id in (select id from events)
     or m.recall_id in (select id from linked)),
requests as (
  select r.id, r.requested_at < p.cutoff as old
  from records_requests r, params p
  where r.organisation_id = p.org_id
    and (r.scope_lot like 'E2E%' or r.scope_product like 'E2E %'))
select 'recall_events' as "table", count(*) as test_rows, count(*) filter (where old) as to_delete,
       count(*) filter (where live) as still_live from events
union all select 'recalls (linked)', count(*), count(*) filter (where old), count(*) filter (where active) from linked
union all select 'recall_distributions', count(*), count(*) filter (where recall_event_id in (select id from events where old)), null
  from recall_distributions where recall_event_id in (select id from events)
union all select 'recall_acknowledgements', count(*), count(*) filter (where recall_event_id in (select id from events where old)), null
  from recall_acknowledgements where recall_event_id in (select id from events)
union all select 'recall_effectiveness_checks', count(*), count(*) filter (where recall_event_id in (select id from events where old)), null
  from recall_effectiveness_checks where recall_event_id in (select id from events)
union all select 'mock_recall_drills', count(*), count(*) filter (where recall_event_id in (select id from events where old)), null
  from mock_recall_drills where recall_event_id in (select id from events)
union all select 'recall_notices', count(*), count(*) filter (where old), null from notices
union all select 'receiving_events', count(*), count(*) filter (where old), null from deliveries
union all select 'scans', count(*), count(*) filter (where old), null from shelf
union all select 'scans_audit_log', count(*), count(*) filter (where scan_id in (select id from shelf where old)), null
  from scans_audit_log where scan_id in (select id from shelf)
union all select 'scan_recall_matches', count(*), count(*) filter (where old), null from matches
union all select 'records_requests', count(*), count(*) filter (where old), null from requests;

-- ---------------------------------------------------------------------------
-- Step 2: back up and delete (one transaction; the DO block is atomic).
-- ---------------------------------------------------------------------------
do $$
declare
  keep_hours constant int := 24;
  org uuid;
  cutoff timestamptz;
  stamp text := to_char(now() at time zone 'UTC', 'YYYYMMDD');
  t text;
  n bigint;
  total bigint := 0;
  -- table name, id-list temp table, in delete order
  plan text[][] := array[
    ['scan_recall_matches', '_e2e_matches'],
    ['scans_audit_log', '_e2e_audit'],
    ['scans', '_e2e_scans'],
    ['receiving_events', '_e2e_deliveries'],
    ['recall_notices', '_e2e_notices'],
    ['recall_acknowledgements', '_e2e_acks'],
    ['recall_distributions', '_e2e_dists'],
    ['recall_effectiveness_checks', '_e2e_checks'],
    ['mock_recall_drills', '_e2e_drills'],
    ['recalls', '_e2e_linked'],
    ['recall_events', '_e2e_events'],
    ['records_requests', '_e2e_requests']];
begin
  -- Guards: staging only, and the QA org must exist.
  if exists (select 1 from organisations where id = '925923b5-22c6-433c-8812-7e32918dab66') then
    raise exception 'This database holds the production org. Refusing to run.';
  end if;
  select id into org from organisations where name = 'QA 038 Grocer';
  if org is null then
    raise exception 'Org "QA 038 Grocer" not found. Refusing to run.';
  end if;
  cutoff := now() - make_interval(hours => keep_hours);

  -- The rule, as id lists. Parents first, children derived from them.
  create temp table _e2e_notices on commit drop as
    select id, recall_event_id from recall_notices
    where organisation_id = org and raw_text like '%STAGING TEST%' and created_at < cutoff;
  create temp table _e2e_events on commit drop as
    select id from recall_events
    where source_org_id = org and created_at < cutoff
      and (product_name like 'E2E %' or lot_number like 'E2E%'
           or closed_note = 'End-to-end test, closed automatically'
           or id in (select recall_event_id from recall_notices
                     where organisation_id = org and raw_text like '%STAGING TEST%'
                       and recall_event_id is not null));
  create temp table _e2e_linked on commit drop as
    select id from recalls
    where (organisation_id = org or source_org_id = org)
      and (recall_event_id in (select id from _e2e_events)
           or ((product_name like 'E2E %' or lot_number like 'E2E%') and created_at < cutoff));
  create temp table _e2e_deliveries on commit drop as
    select id from receiving_events
    where organisation_id = org and created_at < cutoff
      and (traceability_lot_code like 'E2E%' or product_name like 'E2E %');
  create temp table _e2e_scans on commit drop as
    select id from scans
    where organisation_id = org and created_at < cutoff
      and (lot_number like 'E2E%' or product_name like 'E2E %');
  create temp table _e2e_matches on commit drop as
    select id from scan_recall_matches
    where scan_id in (select id from _e2e_scans)
       or recall_event_id in (select id from _e2e_events)
       or recall_id in (select id from _e2e_linked);
  create temp table _e2e_audit on commit drop as
    select id from scans_audit_log where scan_id in (select id from _e2e_scans);
  create temp table _e2e_acks on commit drop as
    select id from recall_acknowledgements where recall_event_id in (select id from _e2e_events);
  create temp table _e2e_dists on commit drop as
    select id from recall_distributions where recall_event_id in (select id from _e2e_events);
  create temp table _e2e_checks on commit drop as
    select id from recall_effectiveness_checks where recall_event_id in (select id from _e2e_events);
  create temp table _e2e_drills on commit drop as
    select id from mock_recall_drills where recall_event_id in (select id from _e2e_events);
  create temp table _e2e_requests on commit drop as
    select id from records_requests
    where organisation_id = org and requested_at < cutoff
      and (scope_lot like 'E2E%' or scope_product like 'E2E %');

  -- Backup schema, closed to clients.
  create schema if not exists backup;
  revoke all on schema backup from public, anon, authenticated;

  -- Copy, then delete, in foreign-key order.
  for i in 1 .. array_length(plan, 1) loop
    t := plan[i][1];
    execute format('create table if not exists backup.%I (like public.%I)',
                   'e2e_cleanup_' || stamp || '_' || t, t);
    execute format('insert into backup.%I select s.* from public.%I s where s.id in (select id from %I)',
                   'e2e_cleanup_' || stamp || '_' || t, t, plan[i][2]);
    execute format('delete from public.%I s where s.id in (select id from %I)', t, plan[i][2]);
    get diagnostics n = row_count;
    total := total + n;
    raise notice '% : % rows deleted (backup.%)', t, n, 'e2e_cleanup_' || stamp || '_' || t;
  end loop;
  raise notice 'Done: % rows older than % hours removed from the QA org.', total, keep_hours;
end $$;

-- Step 3: run step 1 again. test_rows should now equal the rows younger
-- than the window, and to_delete should be 0 on every line.

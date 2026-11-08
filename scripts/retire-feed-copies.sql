-- scripts/retire-feed-copies.sql
-- B4 stage 6 (docs/B4-RECALL-CATALOG-PLAN.md): the per-organization copies
-- of public feed recalls leave `recalls`. Since stage 3 (migration 044) every
-- copy has its entry in recall_catalog with a recall_catalog_org row per
-- organization, and since stages 4 and 5 no screen reads the copies; since
-- this stage the importer no longer writes them.
--
-- The rule: source fda, mattilsynet or rasff, with an organisation_id, not a
-- linked row of a pushed recall (recall_event_id null, is_pushed not true).
-- Run on STAGING first, then PRODUCTION, each time with EXPECTED set to the
-- preview count:
--   select count(*) from recalls where source in ('fda','mattilsynet','rasff')
--     and organisation_id is not null and recall_event_id is null
--     and coalesce(is_pushed, false) = false;
-- Ran on staging 2026-11-08 (56 rows) and on production the same day with
-- Ian's approval (982 rows: 934 fda, 48 mattilsynet, across 3 organizations;
-- 0 scan_recall_matches rows pointed at a copy; 12 recalls rows left).
--
-- The block refuses to run when a copy has no catalog entry under the shared
-- key, when a match row points at a copy without carrying catalog_id (its
-- recall_id would be left dangling), or when the backup count differs from
-- EXPECTED. Matches that point at a copy and carry catalog_id are backed up
-- and keep only the catalog_id (recall_id set to null), then the copies go.
-- Nothing else is touched: manual recalls and the linked rows of pushed
-- recalls stay.

do $$
declare
  expected int := 982;   -- set per project before running
  v_backup int; v_deleted int; v_missing int; v_dangling int; v_matches int;
begin
  -- 1. Every copy has its catalog entry (the CHECK_MIGRATIONS 044 rule).
  select count(*) into v_missing
    from public.recalls r
   where r.source in ('fda','mattilsynet','rasff') and r.organisation_id is not null
     and r.recall_event_id is null and coalesce(r.is_pushed, false) = false
     and r.product_name is not null
     and not exists (
       select 1 from public.recall_catalog c
        where c.source = r.source
          and c.external_key = case when substring(r.description from '\[([A-Z]-\d{4}-\d{4})\]$') is not null
                then substring(r.description from '\[([A-Z]-\d{4}-\d{4})\]$') || '|' || left(md5(r.product_name), 12)
                else 'pd|' || r.product_name || '|' || to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD') end);
  if v_missing > 0 then
    raise exception '% copies have no catalog entry; run migration 044 first, nothing deleted', v_missing;
  end if;

  -- 2. No match row may be left pointing at nothing.
  select count(*) into v_dangling
    from public.scan_recall_matches m
    join public.recalls r on r.id = m.recall_id
   where r.source in ('fda','mattilsynet','rasff') and r.organisation_id is not null
     and r.recall_event_id is null and coalesce(r.is_pushed, false) = false
     and m.catalog_id is null;
  if v_dangling > 0 then
    raise exception '% match rows point at a copy without catalog_id; nothing deleted', v_dangling;
  end if;

  -- 3. Backups in the private schema.
  create table backup.recalls_feed_copies_20261108 as
    select * from public.recalls r
     where r.source in ('fda','mattilsynet','rasff') and r.organisation_id is not null
       and r.recall_event_id is null and coalesce(r.is_pushed, false) = false;
  select count(*) into v_backup from backup.recalls_feed_copies_20261108;
  if v_backup <> expected then
    raise exception 'backup holds % rows, expected %; nothing deleted', v_backup, expected;
  end if;
  create table backup.scan_recall_matches_feed_copies_20261108 as
    select m.* from public.scan_recall_matches m
     where m.recall_id in (select id from backup.recalls_feed_copies_20261108);
  select count(*) into v_matches from backup.scan_recall_matches_feed_copies_20261108;

  -- 4. Matches keep the catalog entry only.
  update public.scan_recall_matches m
     set recall_id = null
   where m.recall_id in (select id from backup.recalls_feed_copies_20261108)
     and m.catalog_id is not null;

  -- 5. The copies go.
  delete from public.recalls r
   where r.id in (select id from backup.recalls_feed_copies_20261108);
  get diagnostics v_deleted = row_count;
  if v_deleted <> expected then
    raise exception 'deleted % rows, expected %; rolled back', v_deleted, expected;
  end if;
  raise notice 'deleted % feed copies (backup.recalls_feed_copies_20261108); % match rows repointed (backup.scan_recall_matches_feed_copies_20261108)', v_deleted, v_matches;
end $$;

-- Verification (read-only, run after):
-- select
--   (select count(*) from recalls where source in ('fda','mattilsynet','rasff')) as feed_rows_left,
--   (select count(*) from recalls) as recalls_total,
--   (select count(*) from backup.recalls_feed_copies_20261108) as backed_up,
--   (select count(*) from scan_recall_matches where recall_id is null and recall_event_id is null and catalog_id is null) as orphan_matches;

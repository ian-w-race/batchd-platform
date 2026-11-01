-- scripts/cleanup-orphan-feed-recalls.sql
-- B4 stage 0 (docs/B4-RECALL-CATALOG-PLAN.md). Ran on PRODUCTION
-- (lurxucdmrugikdlvvebc) on 2026-11-01 with Ian's approval; staging had no
-- such rows, so the same block was rehearsed there inside a rolled-back
-- transaction first, then dry-run on production the same way.
--
-- The rule: public feed rows (source fda, mattilsynet or rasff) with no
-- organisation_id. An importer defect wrote 8,340 of them between
-- 2026-04-15 and 2026-04-21 (72 distinct entries repeated about 115 times
-- each). No row-level policy lets a member read a row with a null
-- organisation_id, so no screen ever showed them; only sweep_recall_matches
-- could touch them. No scan_recall_matches row referenced any of them.
--
-- Result on production: backup.recalls_orphan_feed_20261101 holds 8,340
-- rows; recalls went from 9,184 rows to 844 (784 fda, 48 mattilsynet, 12
-- manual or pushed); scan_recall_matches unchanged at 2 rows.
--
-- Re-runnable: the block refuses to delete when the backup count does not
-- match the expected count, so adjust EXPECTED before a second run.

do $$
declare
  expected int := 8340;
  v_backup int; v_deleted int;
begin
  create table backup.recalls_orphan_feed_20261101 as
    select * from public.recalls
     where organisation_id is null and source in ('fda','mattilsynet','rasff');
  select count(*) into v_backup from backup.recalls_orphan_feed_20261101;
  if v_backup <> expected then
    raise exception 'backup holds % rows, expected %; nothing deleted', v_backup, expected;
  end if;
  delete from public.recalls
   where organisation_id is null and source in ('fda','mattilsynet','rasff');
  get diagnostics v_deleted = row_count;
  if v_deleted <> expected then
    raise exception 'deleted % rows, expected %; rolled back', v_deleted, expected;
  end if;
end $$;

-- Verification (read-only)
select
  (select count(*) from backup.recalls_orphan_feed_20261101) as backup_rows,
  (select count(*) from recalls where organisation_id is null) as orphan_rows_left,
  (select count(*) from recalls) as rows_remaining;

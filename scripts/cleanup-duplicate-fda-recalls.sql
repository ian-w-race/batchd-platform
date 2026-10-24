-- scripts/cleanup-duplicate-fda-recalls.sql
-- RAN ON PRODUCTION 2026-10-24 (Claude, on Ian's standing instruction to run
-- SQL). Kept as the record of what ran. Re-running it is safe: it finds 0.
--
-- The old FDA import (before 2026-10-24) inserted the same recall more than
-- once for the same organization. A row counts as a duplicate only when every
-- content column matches another row of the same org (product, lot, batch,
-- barcode, description, created_at, active, resolved_at, source org, pushed
-- flags). The first draft of this script keyed on the FDA recall number "or
-- product name and day"; old rows carry no recall number, so that key would
-- have deleted 7,827 distinct recalls. Do not use that key.
--
-- Result on 2026-10-24: 953 rows deleted, 7,707 FDA rows kept, every kept row
-- distinct, none referenced by scan_recall_matches. The deleted rows are in
-- backup.recalls_fda_duplicates_20261024 (schema not reachable by anon or
-- signed-in users). To restore one:
--   insert into recalls select id, created_at, product_name, lot_number,
--     batch_number, barcode_number, description, active, organisation_id,
--     source_org_id, is_pushed, recall_event_id, source, potential_duplicate,
--     duplicate_source, duplicate_ref, resolved_at
--   from backup.recalls_fda_duplicates_20261024 where id = '<id>';

-- Preview (read-only)
with ranked as (
  select id, row_number() over (partition by organisation_id, product_name, lot_number, batch_number,
    barcode_number, description, created_at, active, resolved_at, source_org_id, is_pushed, recall_event_id
    order by id) n
  from recalls where source = 'fda')
select count(*) filter (where n > 1) as duplicates,
       count(*) filter (where n > 1 and exists (select 1 from scan_recall_matches m where m.recall_id = ranked.id)) as referenced
from ranked;

-- What ran (one transaction)
-- begin;
-- create schema if not exists backup;
-- revoke all on schema backup from public, anon, authenticated;
-- create table backup.recalls_fda_duplicates_20261024 as
-- with ranked as (select r.*, row_number() over (partition by organisation_id, product_name, lot_number, batch_number, barcode_number, description, created_at, active, resolved_at, source_org_id, is_pushed, recall_event_id order by id) n from recalls r where source = 'fda')
-- select * from ranked where n > 1 and not exists (select 1 from scan_recall_matches m where m.recall_id = ranked.id);
-- delete from recalls r using backup.recalls_fda_duplicates_20261024 b where r.id = b.id;
-- commit;

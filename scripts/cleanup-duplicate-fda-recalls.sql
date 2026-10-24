-- scripts/cleanup-duplicate-fda-recalls.sql
-- FOR IAN TO REVIEW AND RUN. NOT RUN BY CLAUDE (it deletes production rows).
--
-- The old FDA import (before 2026-10-24) inserted the same FDA recall more
-- than once for the same organization: 955 of 8,660 FDA rows were repeats
-- on 2026-10-24, and one product appeared 73 times for one org. This keeps
-- the oldest row of each (organization, recall) and deletes the rest.
-- A recall is identified by its FDA recall number at the end of the
-- description, or, when the number was cut off, by product name and day.
-- Rows that any scan_recall_matches row points at are never deleted.
--
-- Step 1, preview (read-only). Run this first and check the counts.
with f as (
  select id, organisation_id, created_at,
         coalesce(substring(description from '\[([A-Z]-\d{4}-\d{4})\]$'),
                  product_name || '|' || created_at::date) as recall_key
  from recalls where source = 'fda'
), ranked as (
  select id, row_number() over (partition by organisation_id, recall_key order by created_at, id) as n
  from f
)
select count(*) filter (where n > 1) as rows_to_delete,
       count(*) filter (where n > 1 and exists (select 1 from scan_recall_matches m where m.recall_id = ranked.id)) as kept_because_matched,
       count(*) as fda_rows_now
from ranked;

-- Step 2, delete. Remove the leading "-- " from the six lines below and run
-- them together. It runs in one transaction; check the reported count
-- matches rows_to_delete minus kept_because_matched from step 1.
-- begin;
-- with f as (select id, organisation_id, created_at, coalesce(substring(description from '\[([A-Z]-\d{4}-\d{4})\]$'), product_name || '|' || created_at::date) as recall_key from recalls where source = 'fda'),
--      ranked as (select id, row_number() over (partition by organisation_id, recall_key order by created_at, id) as n from f)
-- delete from recalls r using ranked where r.id = ranked.id and ranked.n > 1
--   and not exists (select 1 from scan_recall_matches m where m.recall_id = r.id);
-- commit;

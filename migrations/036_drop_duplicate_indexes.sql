-- 036_drop_duplicate_indexes.sql
-- Supabase performance advisor, 2026-10-24: two pairs of identical indexes.
-- Each duplicate costs write time and space and adds nothing. One
-- transaction; re-runnable (DROP INDEX IF EXISTS).
--
--   invitations: invitations_token_key (backs the UNIQUE constraint, kept)
--                and invitations_token_unique (same column, same uniqueness, dropped)
--   scan_recall_matches: idx_srm_org (kept) and idx_srm_organisation (dropped),
--                both btree (organisation_id)
--
-- The advisor's other findings were reviewed and left on purpose at the
-- current data size (about 24 MB, around 100 scans): 58 foreign keys without
-- a covering index, 84 policies that call auth.uid() per row, 281 overlapping
-- permissive policies and 40 unused indexes. Revisit when scans reach the
-- tens of thousands; the hot tables would be scans, scan_recall_matches,
-- recalls and receiving_events.
--
-- Rollback:
--   create unique index invitations_token_unique on public.invitations (token);
--   create index idx_srm_organisation on public.scan_recall_matches (organisation_id);

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP INDEX IF EXISTS public.invitations_token_unique;
DROP INDEX IF EXISTS public.idx_srm_organisation;
COMMIT;

-- Acceptance (expect false, false, true, true):
-- select exists (select 1 from pg_indexes where indexname='invitations_token_unique'),
--        exists (select 1 from pg_indexes where indexname='idx_srm_organisation'),
--        exists (select 1 from pg_indexes where indexname='invitations_token_key'),
--        exists (select 1 from pg_indexes where indexname='idx_srm_org');

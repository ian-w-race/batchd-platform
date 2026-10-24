-- 034_store_names_and_anon_writes.sql
-- Two items from the 2026-10-24 staging rebuild. One transaction;
-- re-runnable (DROP ... IF EXISTS, CREATE ... IF NOT EXISTS, REVOKE and
-- ALTER DEFAULT PRIVILEGES are idempotent).
--
-- 1. Store names unique per organization, not across the platform.
--    Before: constraint stores_name_key made every store name unique
--    across ALL organizations, so a second retailer could not create a
--    store called "Store 1" once anyone had one. After: a name is unique
--    within its organization, ignoring case and surrounding spaces
--    ("Store 1" and " store 1 " clash inside one org; two orgs may both
--    have "Store 1"). Production had 19 stores, all with an org, and no
--    duplicates under the new rule when this was written. No code looks
--    a store up by name across organizations.
--
-- 2. No table-level write access for the anon (logged-out) role.
--    Before: every public table granted anon INSERT, UPDATE, DELETE,
--    TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, so row security was the
--    only barrier on writes. Nothing writes as anon: signup and join act
--    after sign-in, complaints go through triage-complaint.js with the
--    service role. After: anon keeps SELECT only (reads still return
--    empty results under RLS, so pages that read before sign-in behave
--    as before), and tables created later by migrations get no anon write
--    access either (ALTER DEFAULT PRIVILEGES for role postgres, the role
--    migrations run as). authenticated and service_role are unchanged.
--
-- Rollback:
--   drop index if exists public.stores_org_name_uidx;
--   alter table public.stores add constraint stores_name_key unique (name);
--   grant insert, update, delete, truncate, references, trigger, maintain
--     on all tables in schema public to anon;
--   alter default privileges for role postgres in schema public
--     grant insert, update, delete, truncate, references, trigger, maintain on tables to anon;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Store names
CREATE UNIQUE INDEX IF NOT EXISTS stores_org_name_uidx
  ON public.stores (organisation_id, lower(btrim(name)));
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_name_key;

-- 2. Anon writes
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon;

COMMIT;

-- Acceptance (expect 0 and true and false):
-- select count(*) from information_schema.role_table_grants
--  where table_schema='public' and grantee='anon' and privilege_type <> 'SELECT';
-- select exists (select 1 from pg_indexes where indexname='stores_org_name_uidx');
-- select exists (select 1 from pg_constraint where conname='stores_name_key');

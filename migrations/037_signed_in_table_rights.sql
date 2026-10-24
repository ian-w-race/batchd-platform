-- 037_signed_in_table_rights.sql
-- Found 2026-10-24 while generating docs/SCHEMA-REFERENCE.md. One
-- transaction; re-runnable (REVOKE and ALTER DEFAULT PRIVILEGES are
-- idempotent).
--
-- Supabase's defaults gave the authenticated role TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN on every public table. TRUNCATE skips row security.
-- PostgREST never issues it and every RPC runs as its owner, so it was not
-- reachable through the API, but nothing in the apps needs any of the four.
-- Signed-in users keep SELECT, INSERT, UPDATE and DELETE (row security
-- still decides which rows). Tables created later by role postgres follow
-- the same rule. The same was done for anon in migration 034.
--
-- Rollback:
--   grant truncate, references, trigger, maintain on all tables in schema public to authenticated;
--   alter default privileges for role postgres in schema public
--     grant truncate, references, trigger, maintain on tables to authenticated;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM authenticated;
COMMIT;

-- Acceptance (expect 0):
-- select count(*) from information_schema.role_table_grants
--  where table_schema='public' and grantee='authenticated'
--    and privilege_type not in ('SELECT','INSERT','UPDATE','DELETE');

-- CHECK_MIGRATIONS.sql: which migrations are actually applied?
--
-- There is no migration-tracking table in this project, so this checks
-- for the real artifact each migration creates (a column, table,
-- function, trigger or policy) and reports APPLIED / MISSING.
--
-- Read-only. Safe to run any time. Paste the whole file into the
-- Supabase SQL editor and run it.
--
-- Note on 019 and 021: they DROP policies, so APPLIED means the lock-down
-- is done. 020a reports MISSING again if a newly created organisation is
-- ever left on the trial plan; that is a data state, not a schema one.
-- Rows 020 to 021 added 2026-09-29 after John's security-hardening merge.

WITH checks AS (
  SELECT '001 products trust tier' AS migration,
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='products'
                   AND column_name='barcode_normalized') AS applied
  UNION ALL SELECT '002 barcode normalize trigger',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='products_normalize_barcode')
  UNION ALL SELECT '003 trust tier promotion',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='scans_promote_product_trust_tier')
  UNION ALL SELECT '004 products_pending bootstrap',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='products_pending')
  UNION ALL SELECT '005 scan telemetry',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='scan_telemetry')
  UNION ALL SELECT '006 stores location columns',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='stores' AND column_name='latitude')
  UNION ALL SELECT '007 scan corrections',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='scan_corrections')
  UNION ALL SELECT '008 recall_events closure',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='recall_events' AND column_name='closed_at')
  UNION ALL SELECT '009 three-tier roles + staff invites',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='store_manager_stores')
  UNION ALL SELECT '010 invitations HR fields',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='invitations' AND column_name='manager_store_ids')
  UNION ALL SELECT '011 user_settings language',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='user_settings' AND column_name='language')
  UNION ALL SELECT '012 org recall_source + invite region',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='organisations' AND column_name='recall_source')
  UNION ALL SELECT '013 user notification prefs',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='user_settings' AND column_name='notification_prefs')
  UNION ALL SELECT '014 RLS helpers SECURITY DEFINER',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='batchd_user_org_id' AND p.prosecdef)
  UNION ALL SELECT '015 get_org_member_emails RPC',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='get_org_member_emails')
  UNION ALL SELECT '016 fix self-update recursion',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename='organisation_members'
                   AND policyname='organisation_members_self_update'
                   AND with_check LIKE '%batchd_user_role%')
  UNION ALL SELECT '017 lock member self-update (trigger)',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='batchd_guard_member_self_update')
  UNION ALL SELECT '018 secure onboarding RPCs',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='accept_invitation')
  UNION ALL SELECT '019 lock down membership policies',
         NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE tablename='organisation_members' AND policyname='Insert own membership')
  UNION ALL SELECT '020 helpers, membership guards, AI plan flag',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='batchd_is_platform_admin')
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='organisations' AND column_name='plan')
  UNION ALL SELECT '020a existing orgs set to pov (no org left on trial)',
         NOT EXISTS (SELECT 1 FROM public.organisations WHERE plan = 'trial')
  UNION ALL SELECT '021 tenant tables lockdown',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='organisation_api_keys')
         AND NOT EXISTS (SELECT 1 FROM pg_policies
                         WHERE tablename='scans' AND policyname='Authenticated select scans')
  UNION ALL SELECT '022 suppliers',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='suppliers')
  UNION ALL SELECT '023 receiving events + scans.receiving_event_id',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='receiving_events')
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='scans' AND column_name='receiving_event_id')
  UNION ALL SELECT '024 org applicability + focus columns',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='organisations' AND column_name='fsma_applicability')
  UNION ALL SELECT '025 products FTL flags + ftl_overrides',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='ftl_overrides')
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='products' AND column_name='is_ftl')
  UNION ALL SELECT '026 records requests + traceability plans',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='traceability_plans')
  UNION ALL SELECT '028 drill scenario text + store external codes',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='mock_recall_drills' AND column_name='scenario_text')
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='stores' AND column_name='external_code')
)
SELECT
  migration,
  CASE WHEN applied THEN 'APPLIED' ELSE 'MISSING' END AS status
FROM checks
ORDER BY migration;


-- ══════════════════════════════════════════════════════════════════════
-- NOTE: invitations vs staff_invitations, NOT a drift, already handled
-- ══════════════════════════════════════════════════════════════════════
-- Migration 009 created a `staff_invitations` table, and migration 010
-- §1 deliberately DROPs it again ("orphaned ... nothing in production
-- wrote to or read from this table"). The application has always used
-- the `invitations` table, which is the one migrations 018 and 019
-- secure. So there is no second, competing invitations table to worry
-- about, 010 already cleaned that up.
--
-- One consequence for re-runs: running 009 again recreates the empty
-- staff_invitations table. Running 010 after it removes it again.


-- ══════════════════════════════════════════════════════════════════════
-- RE-RUN SAFETY (verified 2026-09-11, ignoring commented-out rollback
-- blocks, an earlier pass miscounted those and got this wrong)
-- ══════════════════════════════════════════════════════════════════════
-- SAFE to re-run: 002, 003, 006, 007, 008, 009, 010, 011, 012, 013,
--                 014, 015, 016, 017, 018, 019, 020, 020a, 021,
--                 022, 023, 024, 025, 026 (Phase 1 of the FSMA 204 handoff),
--                 028 (Phases 6 and 7: two columns)
--   (idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
--    DROP ... IF EXISTS before each CREATE POLICY / CREATE TRIGGER;
--    020, 020a and 021 each run inside one BEGIN/COMMIT)
--
-- WILL ERROR on re-run: 001, 004, 005
--   These CREATE POLICY (and 004 also CREATE TABLE) without dropping
--   first, so Postgres raises 42710 "policy already exists". The
--   statement aborts and changes nothing, none of the three contains a
--   live DROP/DELETE/TRUNCATE, so a failed re-run is noise, not damage.
--   The error itself is proof the migration is already applied.
--
-- ROLLOUT STATE 2026-09-29: 019, 020, 020a and 021 are APPLIED in
--   production (John Ponchak's security-hardening merge of 2026-09-22).
--   017 and 007 were still MISSING on 2026-09-13; re-run this file to see
--   whether they have since been applied.
--
-- Prefer the status query at the top of this file over re-running
-- anything: it answers "what is missing" without touching the database.

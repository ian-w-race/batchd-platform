# Batch'd changelog

Newest first. One entry per change Ian ships: the date, what changed,
how it was verified and what is still unverified. Everything before
2026-10-24 is in docs/HISTORY.md.

## 2026-10-24
- FOUND: the daily FDA import mostly failed. Netlify's scheduler cut runs
  off at 15 s (status 499) on both app sites; between 2026-10-18 and
  2026-10-24 only the runs on 10-22 and 10-24 completed. It also created
  duplicates (955 of 8,660 FDA rows) and never gave a recall to an org
  created after another org had it. fetch-recall-feeds.js now makes three
  database calls with stable ids and a per-org check, honors
  SCHEDULED_FUNCTIONS_DISABLED, and keeps the recall number whole.
  Verified: tests/fetch-recall-feeds.test.mjs (8 tests, including two
  simultaneous runs and the feed's "N/A" recall numbers); a read-only dry
  run against production with the live FDA feed would add 1 recall per US
  org. Not verified: the next scheduled run (06:00 UTC). The duplicates
  are untouched; scripts/cleanup-duplicate-fda-recalls.sql is for Ian.
- Migration 037: signed-in users keep only select, insert, update and
  delete on public tables (TRUNCATE, REFERENCES, TRIGGER and MAINTAIN
  removed, also for future tables). Applied to staging, then production;
  rolled-back checks as a test user on staging and as Ian on production:
  reads, insert, update, delete and the recall sweep work, TRUNCATE is
  refused, 0 non-CRUD grants left. docs/SCHEMA-REFERENCE.md regenerated.
- docs/SCHEMA-REFERENCE.md generated from production by the new
  scripts/schema-reference.sql (45 tables, 2 views, 42 functions, 148
  policies). CLAUDE.md now points to it as the schema authority.
- Tests for the scanner's GS1 parser and listed-food detector
  (tests/scanner-parsers.test.mjs, 14 tests: human-readable, raw with and
  without FNC1, the RM240928 lot, plain GTINs, net weight 310n/320n,
  dates, Digital Link, pepper and egg misfires, no literal backspace in
  any pattern), and two more checks in scripts/check.mjs (supplier
  completeness fields, FSMA dollar thresholds). Verified: 9 of 9 checks,
  24 of 24 tests; removing the pepper exclusions, dropping phone from the
  dashboard's completeness rule and changing one dollar figure in signup
  each made a check or test fail.
- Migration 036 dropped two duplicate indexes (invitations_token_unique,
  idx_srm_organisation). Applied to staging, checked (duplicate invitation
  tokens still refused), then production; both projects have the same 137
  index definitions. The rest of the performance advisor's 465 notes were
  reviewed and left on purpose at the current data size; see the header
  of migrations/036_drop_duplicate_indexes.sql.
- recall-escalation.js claims each escalation (2h, 24h) in the database
  before sending and releases the claim when the send fails, so two
  sites' crons cannot double-email a store. push-recall-email.js counts
  "confirmed pulled" from scans.removed_from_shelf_at and defaults a
  missing region to us. Verified: tests/recall-escalation.test.mjs (4
  tests: simultaneous runs send once, failed send retries, no repeat for
  stamped rows, disabled flag still skips); the same race test fails on
  the old code (duplicate 2h emails); the new embedded query shape passes
  PostgREST's relationship check on staging. Not verified: a live
  escalation (production has no open unacknowledged recalls).
- Automatic checks on every pull request (GitHub Actions): scripts/check.mjs
  (7 checks) and tests/env-block.test.mjs (6 tests). netlify.toml now
  forces 404 for /scripts/*, /tests/* and /.github/*. Verified locally:
  7 of 7 checks and 6 of 6 tests pass; three planted mistakes (a changed
  export column, a wrong retention citation, a changed database block in
  join.html) each made check.mjs fail.
- FOUND: production view user_accessible_stores (security definer, unused
  by any code) returned 26 rows covering 4 organizations and 5 user ids,
  with store names, codes and addresses, to a logged-out request with the
  public key. Migration 035 closes it (security_invoker, service role
  only), pins search_path on 11 functions and stops API calls to trigger
  functions. Applied to STAGING only. Verified there in a rolled-back
  transaction: 12 checks (sign-up profile trigger, scan insert with the
  barcode index, pull audit trigger, scan immutability guard, recall
  sweep trigger, retention trigger, supplier updated_at trigger, plan
  guard, self-role guard, trigger function not callable, view denied to
  signed-in and logged-out users); the Supabase security advisor on
  staging no longer lists the view, any mutable search_path or any
  trigger function. Applied to PRODUCTION the same day: acceptance passed
  (view closed to anon and signed-in users, 0 functions without a
  search_path, 0 trigger functions callable by anon), fingerprints of
  functions, function grants, views, table grants and policies match
  staging, the same logged-out request that returned 26 rows now gets
  42501, the join page's invitation lookup and products_public still
  answer 200. Rolled-back checks as Ian and a store manager: reads,
  saving and pulling a scan (audit trigger wrote 2 rows; the manager's
  RLS hides them for a scan outside their stores, as designed), the
  immutability guard, supplier, delivery with retention date, manual
  recall with sweep match. Not verified: a live app session.
- Preview links use the staging database. The five pages choose staging
  on any "name--site.netlify.app" host and on localhost, production
  elsewhere; staging shows a badge, keeps cross-app links and the
  signup and join redirects on the preview. Verified: node --check on
  every inline block (index 4, dashboard 6, signup 2, join 2, admin 1);
  a Node test of the selection block over ten hosts (four real domains
  and the bare netlify.app name stay production; previews, branch
  deploys and localhost go to staging; a look-alike foreign host stays
  production) and of the link rewriting.
- Migration 034 applied to STAGING only. Store names are unique per
  organization (ignoring case and surrounding spaces) instead of across
  the platform, and the anon role keeps SELECT only on public tables
  (no table-level writes), including tables created later. Verified on
  staging in a rolled-back transaction: two orgs can both have "Store 1",
  one org cannot have "Store 1" and " store 1 ", the real signup function
  creates a retailer whose store names another org already uses,
  signed-in writes work, logged-out inserts and updates are refused, the
  join page's invitation lookup and products_public still work, a new
  table gives anon SELECT only. Found on the way: logged-out reads of
  scans, organisations, stores and recalls already error in production
  (42501 on the RLS helper functions, since migration 020), not the
  empty list older notes describe. 034 does not change reads.
  Applied to PRODUCTION the same day: no store-name clashes beforehand
  (19 stores), acceptance passed (0 anon write grants, per-org index
  present, global constraint gone), and the fingerprint including
  default privileges matches staging. Rolled-back checks as Ian and as a
  store manager: both read scans, stores, recalls, deliveries and
  suppliers, save and pull a scan, add a supplier, a delivery, a manual
  recall (the sweep trigger matched) and a store; a duplicate store name
  in the same org is refused. Not verified: a live app session.
- Migration 033 (cross-org rules) applied to STAGING only. code_patterns
  scoped to the member's org (organisation_id now defaults to the
  caller's org, so the scanner's saves keep working), scan_queue closed
  to clients, scan_telemetry readable only for the member's own org,
  no direct inserts into complaints or complaint_messages, complaint
  audit-log inserts only for the member's own complaints, and
  sweep_recall_matches checks membership and recall ownership (shared
  no-org feed recalls still sweep). Verified on staging in rolled-back
  transactions: 21 checks as staff, store manager, logged-out visitor
  and server all behaved as intended. Control: with production's old
  rules restored, staff in one org read another org's lot-code patterns
  and a logged-out visitor inserted a complaint. Applied to PRODUCTION
  the same day: the full schema fingerprint (12 categories) matches
  staging exactly. Read-only checks in rolled-back transactions as real
  accounts: Ian (platform admin) sees the same counts as before in every
  dashboard and scanner read, the sweep runs, pattern saves land in his
  org, telemetry writes succeed; an ordinary store manager in his org now
  sees 27 patterns instead of 39 and 26 telemetry rows instead of 27,
  keeps all 51 scans, cannot read the scan queue, and is refused a sweep
  into another org. Not verified: a live scanner session after the
  change.
- Migration 032 (photo bucket) applied to STAGING only. Removes the six
  scan-photos storage policies (four of them let anyone list, upload,
  overwrite and delete) and adds three: a signed-in member may read,
  upload and overwrite only under orgs/<own org id prefix>/, nobody may
  delete through the API, photos keep loading by public URL. Verified on
  staging in rolled-back transactions: member uploads to own folder
  allowed, to another org or the bucket root denied, sees only own org's
  photos, overwrites own but not others or legacy photos, deletes 0;
  logged-out lists 0, uploads denied, overwrites 0, deletes 0. Control:
  with production's old rules restored, a logged-out visitor deleted 2 of
  2 test photos. Applied to PRODUCTION the same day: production's
  storage policies now match staging's exactly (same three rules, same
  fingerprints), all 108 photos remain, three sample photos (two in the
  org folder, one old root file) still load by public link with the same
  byte sizes, and logged-out listing dropped from 83 entries to 0. Not
  verified: a real signed-in scanner upload after the change.
- Staging Supabase project batchd-staging (tiwrrocdwljazweveeth) created
  at $0 a month and its schema rebuilt from production's catalog.
  Verified: a fingerprint per category (columns, constraints, indexes,
  functions, views, triggers, RLS, policies, table and function grants,
  bucket, extensions) is identical on both projects, and logged-out
  probes return the same errors on both. Not done: email confirmation
  is still on in staging, and no app or preview points at it yet.
- The rebuild surfaced security gaps in production (storage bucket
  writable and deletable by anyone, fixed by migration 032 above;
  several cross-org table policies; direct anon complaint inserts) and a
  global unique constraint on store names. The open ones are listed
  under Open items in CLAUDE.md.
- Migration 031 applied to production through the Supabase connector.
  It revokes public access to push_recall, create_organisation and
  get_retailer_emails, and anon access to sweep_recall_matches.
  push_recall had let any signed-in user push recalls into every
  retailer's dashboard; recall_events showed no sign of abuse. Verified:
  privilege check (anon and signed-in false on the first three, signed-in
  true on the sweep), anon REST probes answer 42501, and
  get_invitation_by_token still answers 200 for the join page. Not
  verified: a signed-in scanner session calling the sweep.
- Moved to a git workflow. The repo is cloned at ~/Desktop/batchd-platform,
  changes go through a branch, a pull request and a Netlify deploy
  preview, and Ian merges.
- CLAUDE.md cut from 2,175 lines to rules, current state and gotchas.
  The old file is kept word for word in docs/HISTORY.md.
- Shipped to main earlier the same day (commit a22ad17): the scanner
  design pass, the dashboard's styled confirm dialogs, CTA icons and
  keyboard support, and SMOKE.md checks 46 and 47. Verified live:
  dashboard byte for byte, scanner apart from Netlify's link rewrite.
  Smoke checks 46 and 47 not yet run.

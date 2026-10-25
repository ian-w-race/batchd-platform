# Batch'd changelog

Newest first. One entry per change Ian ships: the date, what changed,
how it was verified and what is still unverified. Everything before
2026-10-24 is in docs/HISTORY.md.

## 2026-10-25 (smoke checks)
- Ran SMOKE.md 10 to 13, 17 to 20, 46 and 47 on staging from the local copy
  as the QA corp admin (camera steps typed, function steps skipped). Passed:
  10, 12, 13, 17, 18, 19, 46, 47; 11 partly (the "Linked to delivery" chip
  shows; saving the shelf scan needs the camera). 20 found a bug, fixed here.
- FIXED: a delivery file built from the app's own template lost its store,
  reference and supplier columns at import (the matcher knew only short
  aliases, not the template's labels), so every row was dropped while the
  button still said "Import 2 rows". The shared import engine now maps any
  still-unmapped field whose header equals its label, and the delivery
  matcher includes the labels. Verified: the template maps 9 of 9 columns
  (6 before) on staging.
- FIXED, smaller: the scanner's "Linked to delivery" chip printed "PO
  PO-1042"; "1 rows" on the records request card, compliance detail and
  drill certificate; "12 case" in the expected-delivery banner (now "12
  cases"); the drill launcher's default reason carried an em dash; six "↓"
  text arrows became the download icon. The scanner's receiving CSV and
  both FSMA exports share one formula guard: a leading =, @ or + is quoted
  (phone numbers like +1 512 no longer open as a broken formula in Excel),
  negative numbers stay plain. US orgs no longer see the Mattilsynet and
  "Both" feed buttons or the Norsk language button in Settings (legacy NO
  orgs still do). SMOKE.md check 18 no longer points at the retired
  "Deliveries recorded" ring.

## 2026-10-24
- Live test of migration 038 on staging with two throwaway accounts
  (qa-active-038 and qa-deactivated-038 @batchd-staging.test, in org "QA 038
  Grocer"; the password is in .claude/staging-test-accounts.txt, local
  only). Through the real sign-in service the deactivated account reads
  empty scans, stores and organizations, cannot insert a scan, and cannot
  reactivate itself, promote itself, add itself back or create a new
  organization; the dashboard and the scanner both show "Account
  deactivated" with no console errors. The active account's dashboard loads
  its org and every data read succeeds; its scan insert returns 201.
- FOUND in that test: the deactivated account still listed its old org's
  members (user ids and roles; no emails). Migration 039 adds a restrictive
  SELECT policy on organisation_members: own rows always, other rows only
  with an active membership. Applied to STAGING and re-tested: the
  deactivated account sees only its own row and both apps still show the
  deactivated screen; the active admin still sees the whole team. Applied
  to PRODUCTION the same day on Ian's approval: policy present; rolled-back
  checks show Ian and an active store manager each see the org's 6 members
  (the member email lookup returns 6, and Ian's platform-admin view still
  spans every org), and both deactivated accounts see only their own row.
- Data fixes run on production by Claude (Ian's instruction: "You run the
  sqls always from now on"): two accounts in a US org moved from region
  "no" to "us" and two US test orgs to the FDA feed; 953 exact-copy FDA
  recall rows deleted, 7,707 kept, every kept row distinct, none referenced
  by a scan match, deleted rows kept in backup.recalls_fda_duplicates_20261024
  (a schema the public keys cannot reach). FOUND before deleting: the first
  draft of scripts/cleanup-duplicate-fda-recalls.sql would have deleted 7,827
  rows, most of them distinct recalls, because old rows carry no recall
  number and it fell back to "same product, same day". The script now
  records the exact-copy rule that ran.
- FOUND: about 70 older RLS policies check membership but not the active
  flag, so a deactivated member with a live session kept access. On
  production both deactivated accounts could read 51 scans, 7 stores, 442
  recalls and a complaint, and a deactivated corp_admin could update the
  organization. Migration 038 adds one restrictive policy per tenant table
  (31 tables) requiring an active membership. Applied to STAGING: a
  rolled-back test shows the active admin unchanged (reads, scan insert, org
  update), the deactivated admin seeing 0 rows and refused writes while
  still reading their own membership row for the "Account deactivated"
  screen, and a brand-new user able to sign up through
  create_organisation_with_admin; with 038 removed the same deactivated
  admin read every table and updated the org. Applied to PRODUCTION the
  same day on Ian's approval: 31 policies, the policy fingerprint matches
  staging (179 policies), both deactivated accounts now read 0 scans,
  stores, recalls, complaints and organizations (51, 7, 442, 1 and 1
  before) but still read their own membership row; rolled-back checks as
  Ian (same counts as before; scan insert, pull, recall insert, org update)
  and as an active store manager (reads, scan insert) all pass; the join
  page's invitation lookup still answers 200.
- notify-consumers.js: a call takes at most 500 customers in batches of
  100, paced under Resend's 2 requests a second, each batch with an
  idempotency key so a retry does not email anyone twice; no single-send
  fallback flood; a 429 is retried once. The dashboard splits longer lists
  into calls of 500 and adds up the results. The notice subject lost its em
  dash. Consumer Notify's manual-recall query now selects is_pushed and
  recall_event_id, which its dedup filter reads. Verified:
  tests/notify-consumers.test.mjs (6 tests).
- Audit of the server functions and the dashboard's complaint code. Fixed:
  - Complaint intake (triage-complaint.js) saved only part of the form:
    people affected, medical attention, best-before date, store, city,
    state, country, storage and language never reached their columns, so
    the dashboard showed them blank. All are saved now, plus the smart
    match results. Dates must be real YYYY-MM-DD dates or are dropped.
  - The AI triage answer was written as returned. A level outside critical,
    serious, monitor or pending broke the database CHECK after the complaint
    was saved, so the reporter saw an error and often resubmitted. The
    answer is now checked field by field, an Anthropic error status uses the
    manual-review fallback, and prose around the JSON is tolerated.
  - Emails were never checked: a refused send was still logged as "follow-up
    sent". Sends now time out after 4 s and only a confirmed send is logged.
    The critical alert goes out before the other emails so the 10 s function
    limit cannot cut it off.
  - Dashboard complaint pattern detection queried complaints.store_id, a
    column that does not exist, so it never found a pattern. It reads
    store_name or purchase_store now. The FDA notification draft's
    recall_events select asked for missing columns; trimmed.
  - Escalation and reminder emails still went out for recalls that were
    administratively closed. Both now skip closed recalls.
  - push-recall-email.js matched pushed recalls on recall_id, which points
    at the recalls table, so the email's exposure block was always empty.
    It uses recall_event_id for pushed recalls.
  - webhook-recall.js sent null severity and reason into NOT NULL columns
    and accepted "market_withdrawal", which the CHECK refuses. "unknown" or
    no severity now takes the Class II default, market withdrawals get a
    clear 422, and a missing reason falls back to the description.
    docs.html matches.
  - notify-event.js compares the internal secret in constant time through
    the shared helper and returns a clean 502 when the recipient lookup
    fails. It, ocr.js and ai-analyze.js refuse a body that is not a JSON
    object. ocr.js waited 25 s for Anthropic in a function Netlify ends at
    10 s; both AI proxies now give up at 9 s.
  - The invite email said invitations expire in 7 days; they last 30.
    Consumer recall emails print US dates.
  Verified: 9 of 9 repository checks, 46 of 46 tests, including the new
  tests/triage-complaint.test.mjs (7 tests, all fail on the old code) and a
  closed-recall test in tests/recall-escalation.test.mjs (fails on the old
  query). Not verified: a live complaint, escalation or webhook call.
  Left for later: notify-consumers.js sends serially and a retry repeats
  emails; recall-feeds.js is frozen Norwegian code.
- Scanner: fetchUserProfile calls applyManagerUI, which is declared in a
  later script block, through _applyManagerUISafe; if the later block has
  not parsed yet it waits for DOMContentLoaded instead of throwing.
  Verified: node --check and the repository checks; a test drives the
  helper with the function missing and then defined.
- Removed landing.html and recall-roi-calculator.html (no visits in the
  week before, per Netlify observability; the landing page's demo form
  posted to a send-invite branch removed in September). netlify.toml
  301s both paths to https://batchd.no/.
- FOUND in Netlify logs: every ocr.js call this week failed with 400. The
  scanner's sign-in warm-up sent a 1x1 image as identify_product before
  the org had loaded, so the auth gate answered "org_id required"; when
  the org had loaded, the same warm-up would have cost an Anthropic call.
  ocr.js now has a "warmup" task that answers 204 before auth and never
  calls Anthropic, and the scanner uses it. Verified: tests/ocr-warmup.test.mjs
  (warmup 204 with no auth and no Anthropic call; other tasks still gated;
  GET refused) and a live call to the pull request's preview.
- robots.txt at the repo root asks crawlers not to index the app domains
  (Netlify logs showed about 150 robots.txt requests a week, all 404).
  The brand site batchd.no is a separate site and unaffected.
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

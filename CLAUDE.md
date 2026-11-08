# Batch'd Platform

Rules, current state and gotchas for working in this repo. Rewritten
2026-10-24 from a 2,175-line file. The full build log (FSMA 204 phases
0 to 8, every follow-up pass, the 2026-09-13 verification notes, the old
RLS dump) is in `docs/HISTORY.md`, frozen. New history goes in
`docs/CHANGELOG.md`. Where the history and this file disagree, this file
wins. A fact that could not be confirmed is marked "needs verification".

## Who I am building with
Ian Race, not a developer. Do the edits yourself and hand over finished
work. Never give Ian partial diffs or snippets to paste in by hand.

## How we work (since 2026-10-24)
- This folder (`~/Desktop/batchd-platform`) is a git clone of
  github.com/ian-w-race/batchd-platform. The repo is PUBLIC, so never
  commit anything private (keys, customer data, pitch notes). The old
  `~/Desktop/batchd-platform-main` folder is a plain download, not git;
  do not edit it.
- Work on a branch, open a pull request, let Netlify build its deploy
  preview, and have Ian click through the preview. Merge only when Ian
  says so. Never push straight to main or merge without his word.
- Netlify deploys main to production on all three sites within a minute.
- Commit messages and PR text: a plain subject line, no attribution or
  Co-Authored-By trailer (Ian's rule; it overrides any harness default).
- Claude runs SQL itself (Ian, 2026-10-24: "You run the sqls always from
  now on"): staging first, rolled-back checks, then production, a preview
  count before any delete and a backup table in the private `backup`
  schema. Never hand Ian a script to run.
- End-to-end tests: `npx playwright test` (local, staging) or the e2e
  workflow on every deploy preview. Add a test in e2e/ for each new core
  flow; they may only target localhost or a deploy preview. The workflow
  signs in to the shared staging test account on every push.
  e2e/feed-alerts.spec.mjs (B4 stage 5) dismisses and restores one catalog
  entry in Retail's Feed alerts and leaves the staging organization as found.
  e2e/core-flow.spec.mjs is the plan A3 chain (receive, shelf-scan, push a
  recall, see it in the store, produce records, scan the lot again and
  check its match row) on one fresh lot per run; it closes its recall at
  the end. e2e/env.mjs blocks Netlify's deploy-preview drawer script
  (/.netlify/scripts/cdp) because the drawer covers buttons at the bottom
  of the viewport on previews only. Every sign-out in the apps and the
  tests is `sb.auth.signOut({ scope: 'local' })` (since 2026-11-01): it
  ends the session on that device only, so a shared store phone stays
  signed in when someone signs out elsewhere.
- After a change Ian should test, add a numbered check to SMOKE.md and a
  dated entry to docs/CHANGELOG.md. Keep this file to rules and current
  state; do not grow it back into a log.
- Build step (improvement plan A2, since 2026-11-01): `npm run build`
  (scripts/build.mjs) copies the public pages and static files into
  `dist/` and bundles `src/shared/` with esbuild into
  `dist/assets/batchd-shared.js`, a classic script every app page loads
  before it creates its Supabase client. Netlify runs the build and
  publishes `dist/` (netlify.toml [build]), so a failed build stops the
  deploy and private files are never published. Shared rules live once
  in `src/shared/` and are exposed on `window.Batchd` plus the globals
  the pages already read; never copy a rule back into a page. The local
  test server and `.claude/serve.js` serve `dist/`, so build first.
- Since 2026-10-24 every page picks its database from the host
  (BATCHD_ENV): any "name--site.netlify.app" host (deploy previews,
  branch deploys) and localhost or 127.0.0.1 use STAGING
  (tiwrrocdwljazweveeth); everything else uses production. Staging pages
  show a "Staging database" badge, rewrite links and window.open calls
  aimed at the production apps to the preview's own origin
  (batchdPreviewUrl), and use batchdLink(productionUrl, stagingPath) for
  redirects. Since 2026-11-01 this is one module, `src/shared/env.js`
  (tests/env-block.test.mjs); the six inline copies are gone.
- Netlify FUNCTIONS on previews still run with the production
  environment variables, so anything that calls /.netlify/functions/
  from a preview (invite emails, AI, reminders, complaint intake) talks
  to production and rejects the staging sign-in. Fix by giving the
  Deploy Previews context its own SUPABASE_URL and SUPABASE_SERVICE_KEY
  (staging values) in Netlify; until then, do not test those features on
  a preview, and never submit the public complaint form there.
- Local previews (local only, excluded from git through .git/info/exclude):
  `.claude/launch.json` and `.claude/serve.js` serve the folder on
  127.0.0.1:8787. `.claude/build-app-preview.py` and
  `.claude/build-scanner-preview.py` write `.claude/app-preview.html` and
  `.claude/scanner-preview.html`: the real page with Sentry removed and
  Supabase swapped for `.claude/app-stub.js`, a stub over sample rows.
  Rebuild after editing the page. The stub must answer queries on a later
  task, not a microtask, or the scanner's script-order assumption breaks.
- Automatic checks (2026-10-24): GitHub Actions runs `node
  scripts/check.mjs` and `node --test tests/*.test.mjs` on every pull
  request and push to main (.github/workflows/checks.yml). check.mjs
  covers syntax of every inline script and function, that every app page
  loads the shared bundle before its Supabase client and keeps no local
  database block, that the site builds into dist/ with no private file,
  that the design tokens exist only in src/shared/design-tokens.css and
  the three pages link it before their own styles,
  anon-only keys in pages and src/shared, that the FSMA rules (export
  headers, citations, applicability, thresholds, supplier completeness,
  CSV guard) exist only in src/shared/fsma.js and the pages read them
  through Batchd.fsma, that the GS1 parser, the listed-food table and
  detector and the recall matcher exist only in src/shared with one
  sentence-case label list, and forced 404s for private paths. The tests
  cover the database switch, the FSMA module (tests/shared-fsma.test.mjs),
  the escalation job's duplicate protection, parseGS1, extractBestBefore,
  detectFtlCategory and the labels (tests/scanner-parsers.test.mjs, now
  importing src/shared) and the recall matcher
  (tests/shared-recall-match.test.mjs). When the FDA
  publishes inflation-adjusted thresholds, change THRESHOLDS and the band
  labels in src/shared/fsma.js only. When CLAUDE.md says "keep X in
  step", put X in src/shared and add a check. Run both locally before
  opening a pull request (`npm run check`).
- Verification standard beyond that: Node tests with stubbed clients,
  local previews in both themes, rolled-back SQL checks as real roles.
  None of that proves behavior in a live session; say so when reporting.

## Decision 2026-09-29: United States only
Norway is abandoned for the foreseeable future. Every new feature,
string, export, drill script and doc is for US grocery retail under
FSMA 204. The US/NO region layer is FROZEN, not removed:
- Never add a Norwegian branch, string, regulator, statute, currency,
  phone prefix or date format. Where an existing helper forces two
  branches, pass the US string to both and comment
  `// US-only (2026-09-29): NO branch intentionally identical`.
- New orgs get region 'us' and recall_source 'fda'. signup.html hardcodes
  both; the region pickers are gone from signup, Settings and the invite
  form. To move an existing org: `update organisations set region = 'us'
  where id = '<org id>';` and the same on its user_settings rows.
- Existing NO rows keep working through the old branches. Do not rip the
  region layer out. Do not fix Norwegian copy. The Mattilsynet feed code
  stays, unused by new orgs.
- Market entry is the two-category wedge: bagged leafy greens and nut
  butters, both on the FDA Food Traceability List. Build spec:
  `Claude outputs/batchd-fsma204-niche-implementation-handoff.md` (in
  Ian's local folder, not in the repo).

## Golden rules
- American English in UI copy, emails, docs and replies. Never rename
  identifiers, tables or columns that use British spelling
  (organisations, organisation_id, normaliseProductKey); that breaks
  the database.
- No em dashes in product copy or docs. Short sentences.
- Think before building. Work surgically. Do not break what works.
- Never expose secrets client-side. The only keys allowed in HTML: the
  Supabase anon keys of production and staging (public by design,
  RLS-protected), the MapTiler
  publishable key in dashboard.html (origin-locked) and the Sentry
  browser-loader public key. Rotation runbook: SECRETS.md.
- batchd.no is the brand site: its own repo and Netlify site. Never edit
  it from here or mix its files with this repo.
- Routing authority is netlify.toml (there is no _redirects file). See
  "Domains and routing".
- Never write "FSMA 204 compliant". Batch'd supports record keeping; the
  responsibility stays with the business.

## Retailer-only platform
The manufacturer side is retired. manufacturer.html, supplier.html and
manufacturer-signup.html are static "retired" stubs. Signup cannot create
a manufacturer org (create_organisation_with_admin rejects
p_type 'manufacturer', migration 020); signup still routes an existing
mfr_admin to the stub. trading_partners and shipments stay in the DB and
are read by the lot tracer, intelligence panel and overview for legacy
data, but nothing creates rows. webhook-recall.js and docs.html only work
for manufacturer orgs; nothing links to docs.html. The Investigations
panel stays (decision 2026-10-18); it only returns rows for orgs with
manufacturer partners.

## The files
Live surfaces:
- index.html (about 23,000 lines): staff scanner PWA. Since 2026-11-01
  (Phase 2a step 2) its address is https://app.batchdapp.com/scan
  (manifest start_url /scan). Only Batch'd's test phones had it installed
  (Ian, 2026-11-01). On the old address, batchd-app.netlify.app, it still
  runs until the offline queue is empty, then shows "Batch'd has moved"
  (tests/scanner-move.test.mjs). The install and offline queue belong to
  the address, so do not move it again once stores install it.
- dashboard.html (about 17,900 lines): the Retail app (renamed from
  "corporate dashboard" 2026-11-01), served at app.batchdapp.com/retail.
  Role names such as corp_admin and "Corporate admin" are unchanged.
- signup.html (self-serve, retailer only), join.html (invitation
  acceptance), admin.html (internal, gated on
  organisation_members.is_batched_admin, linked from nowhere).
- login.html (2026-11-01): central sign-in and app router at /login and
  at the root of app.batchdapp.com. Routing rules live in batchdRoute and
  batchdPick (tests/login-router.test.mjs): one app goes straight there,
  ?app= picks one, otherwise the app last used on the device, and
  ?choose=1 (the "Switch app" links) shows the chooser. ?next= keeps only
  its query string. Retail and the scanner send signed-out visitors to
  /login; their own sign-in forms and the ?legacy=1 fallback were removed
  on 2026-11-01 (Phase 2 cleanup), so login.html is the only sign-in
  form. Sign-out in either app returns to /login.
- lot-code-guide.html, privacy.html, terms.html.
- complaint.html and complaint-widget.js: public complaint intake to
  triage-complaint.js. The widget hardcodes www.batchdapp.com.
- trace.html: retired notice; the trace function answers 410.
Dormant: the three retired stubs (kept: login.html, signup.html and the
Retail app still send legacy mfr_admin and mfr_qa members to
manufacturer.html until the portals replace it). docs.html is unlinked
but still had 11 requests in the week to 2026-11-01, so it stays for now.
landing.html and recall-roi-calculator.html were removed 2026-10-24 (no
visits in the week before, per Netlify observability); netlify.toml 301s
both to batchd.no. Check observability traffic before removing any other
page.
Shared code (A2, since 2026-11-01): `src/shared/env.js` (database
selection, links, staging badge), `src/shared/fsma.js` (the FSMA 204
rules: export headers, citations, applicability bands and copy,
thresholds, supplier completeness, CSV cell guard, local date and time),
`src/shared/gs1.js` (parseGS1, parseGS1DigitalLink, gs1ParseDate,
extractBestBefore), `src/shared/ftl.js` (FTL_CATEGORIES,
detectFtlCategory, normaliseProductKey, ftlLabels), `src/shared/recall-match.js`
(recallMatchLevel, checkRecordAgainstRecalls, fuzzyProductMatch,
levenshtein; since B4 stage 4 the matcher reads every lot in `lots` and
every GTIN in `gtins`), `src/shared/active-recalls.js`
(normalizeActiveRecalls, exactIdentifierHit, matchIdColumns, recallLots,
recallBarcodes: the rows of batchd_active_recalls become the scanner's
cache shape; B4 stage 4), `src/shared/lot-codes.cjs` (parseRecallCodes,
lotInRange, findRangeHit, parseDateToken, PARSER_VERSION: the recall code
parser, CommonJS so the importer can require it; B5 stage 1) and
`src/shared/index.js` (the bundle entry, exposes `window.Batchd.env`,
`.fsma`, `.gs1`, `.ftl`, `.recall`, `.activeRecalls` and `.lotCodes`),
built by
`scripts/build.mjs` into `dist/assets/batchd-shared.js`. The scanner
keeps its old function names as aliases of these; `recallMatchLevel` in
the scanner passes `_logRecallMatch` as the module's log callback.
`dist/` is build output, ignored by git.
Per-surface wording (the "not yet answered" sentence, the store-staff
version of the registered-facility sentence) is passed in by the page
through `applicabilityTable()` and `citationTable()`.
Not app files: README.md, SCHEMA.md, SECRETS.md, SMOKE.md, docs/,
migrations/, fonts/, netlify/, netlify.toml, package.json (pins
@supabase/supabase-js 2.112.1 for the functions, esbuild 0.28.2 for the
build and @playwright/test for the end-to-end tests).
Both big apps are still single files; apart from the shared bundle and
the shared stylesheet only esc, showToast and signOut share names between
them. Design tokens live once in `src/shared/design-tokens.css`, served
as /assets/design-tokens.css and linked by index.html, dashboard.html and
login.html (since 2026-11-01, A2 part 4); the old inline copies and the
never-committed assets/ folder are gone. signup.html, join.html and
admin.html keep their own small, older color sets.

## Domains and routing
- Two Netlify sites deploy this repo: gentle-belekoy-be3cb7
  (www.batchdapp.com and the corporate alias) and batchd-app
  (batchd-app.netlify.app). The third team site, batchdsite, is batchd.no
  from the batchd-website repository, with one function and no schedules
  (checked through the Netlify connector 2026-10-28; the 2026-09-21 note
  that said three was wrong). Every environment variable the functions
  read must exist with the same value on both, INTERNAL_NOTIFY_SECRET
  above all (push-recall-email fails closed without it).
- Since 2026-10-24 recall-escalation.js claims each escalation tier with
  a conditional UPDATE (only while the column is NULL) before sending and
  releases it if the send fails, so two sites running the cron at the
  same minute cannot double-send. Observed 2026-10-24 via Netlify
  observability: batchd-app and gentle-belekoy-be3cb7 (www) both invoke
  recall-escalation 48 times a day; only www ran fetch-recall-feeds that
  day. Site-level environment variables are not readable through the
  Netlify connector. CONFIRMED 2026-10-28 from job_runs instead: over two
  days only gentle-belekoy-be3cb7 recorded runs of fetch-recall-feeds,
  health-check and recall-escalation, and the job logger skips a site
  whose run returns "skipped", so batchd-app has
  SCHEDULED_FUNCTIONS_DISABLED=true and www is the one site that runs
  the jobs. Nothing to change.
- fetch-recall-feeds.js (B4 stages 2 and 6, 2026-11-08): one FDA request,
  one write. One recall_catalog row per report entry, keyed (source,
  external_key) where the key is the recall number plus the first 12 hex
  characters of md5(product name) (one FDA number covers several product
  lines) or product and report day when the feed sends "N/A" or nothing;
  the upsert merges, so status and raw text refresh on every run; new
  entries get a sweep_catalog_matches call, ten at a time. It writes
  nothing to `recalls` and reads no organizations any more (check.mjs
  refuses both); the per-organization copies were removed by
  scripts/retire-feed-copies.sql on staging and production on 2026-11-08
  with Ian's go-ahead (982 rows on production, kept in
  backup.recalls_feed_copies_20261108; `recalls` now holds 12 rows: manual
  recalls and the linked rows of pushed recalls). Since B5 stage 1 the
  shared parser (src/shared/lot-codes.cjs, PARSER_VERSION 2) reads lots,
  printed lot ranges, GTINs and UPCs (also from the product text), the
  best-by window and the "all lots" flag; each run also re-parses up to
  100 older entries (parser_version below the current) and sweeps the
  ones that gained a key. Bump PARSER_VERSION when a rule changes and the
  nightly runs refresh every entry within days. batchd_parse_lots (SQL,
  migration 044) was the migration's one-off twin and is not kept in step
  with the JavaScript parser. The
  Mattilsynet leg is gone (decision 3 of the B4 plan; the feed answered
  404 for weeks) and so are the scanner's own FDA, RASFF and Mattilsynet
  importers, its "Fetch latest recalls now" button and recall-feeds.js,
  the proxy they used (deleted in stage 6). History: the 2026-10-24
  rewrite and scripts/cleanup-duplicate-fda-recalls.sql (953 duplicates
  removed, kept in backup.recalls_fda_duplicates_20261024).
- netlify.toml arms recall-escalation (every 30 min), fetch-recall-feeds
  (daily 06:00 UTC) and health-check (daily 07:00 UTC) on every site that
  deploys it, so SCHEDULED_FUNCTIONS_DISABLED=true must be set on exactly
  one of the two. Missing on both would run every job twice (the
  escalation tiers are claimed with a conditional UPDATE, so emails would
  still not double); true on both runs nothing. Confirmed 2026-10-28:
  batchd-app skips, www runs.
- Path aliases on every domain: /join, /manufacturer, /signup, /terms,
  /privacy, /login (login.html), /retail (dashboard.html) and /scan
  (index.html). app.batchdapp.com/ serves login.html (forced 200).
- One address (2026-11-01): everything lives on app.batchdapp.com.
  corporate.batchdapp.com/ and /dashboard(.html) 301 to
  app.batchdapp.com/retail and any other corporate path to the same path
  on app.; /dashboard(.html) on app., www. and batchd-app.netlify.app 301
  to /retail; www.batchdapp.com/ 301s to app.batchdapp.com/ (other www
  paths stay, because complaint-widget.js posts to www's triage
  function). These rules sit at the top of netlify.toml because Netlify
  uses the first match and the path aliases must not answer on old hosts.
  Supabase Auth must list https://app.batchdapp.com/login as a redirect
  URL for password reset (Ian's to add; needs verification).
- Host rules are host-exact, so deploy-preview-- and other netlify.app
  names serve index.html at / and use /login, /retail and /scan with no
  canonical redirects.
- Forced 404s keep CLAUDE.md, SECRETS.md, SCHEMA.md, SMOKE.md, README.md,
  the roadmap and design docs, CHECK_MIGRATIONS.sql, netlify.toml,
  package files, /migrations/*, /docs/* and /netlify/* off the public
  site. Since 2026-11-01 Netlify publishes `dist/`, which the build fills
  from an allowlist (pages, images, robots.txt, complaint-widget.js,
  fonts/), so those files are not deployed at all; the rules stay as a
  second line of defense. Function calls use /.netlify/functions/, a
  different prefix.
- Netlify's Pretty URLs rewrites `dashboard.html?panel=` links to
  `dashboard?panel=` in the served scanner, so the live index.html
  differs from the file by a few lines. Expected.
- index.html's top script redirects the retired manufacturer., admin.
  and supplier. hostnames client-side. Links between the apps are
  same-origin paths (/retail, /scan, /login), never absolute URLs, so
  they also stay on a deploy preview.

## Supabase
- Project: lurxucdmrugikdlvvebc.supabase.co. Ian's org
  925923b5-22c6-433c-8812-7e32918dab66, user
  97da19d3-3daa-4f7a-bd9c-53e7ac8f8a5c (from Ian).
- Client pinned to @supabase/supabase-js 2.112.1 with SRI in index,
  dashboard, join, signup and admin.
- Email confirmation is OFF (mailer_autoconfirm true), which join.html's
  sign-in-after-signup relies on. Turning it on breaks invite acceptance.
- Migration 007 (scan_corrections) is NOT applied: the table does not
  exist in production (checked 2026-10-24; CHECK_MIGRATIONS reports it
  MISSING). The only writer is the retired OCR path in saveRecord, so the
  insert never runs today. Apply 007 before reviving OCR capture.
- Migrations: 001 to 045 with 020a, no 027 (John's code_patterns slot,
  applied outside the folder). 043 (the recall catalog, B4 stage 1) was
  applied to staging and then production on 2026-11-01 with Ian's
  go-ahead; both functions are byte-identical on the two projects. 044
  (the catalog backfill, B4 stage 3) was applied to staging and then
  production on 2026-11-08 with Ian's go-ahead; it is re-runnable and
  deletes nothing. 045 (the catalog's code columns and the function's new
  fields, B5 stage 1) is on staging since 2026-11-08 and waits for Ian's
  go-ahead on production; it changes the function's return type, so it
  drops and recreates batchd_active_recalls with the same grants.
  CHECK_MIGRATIONS.sql reports APPLIED or
  MISSING per migration; Ian ran it 2026-10-11 and every row was APPLIED.
  031 to 044 were applied through the Supabase connector (031 to 039 on
  2026-10-24, 040 and 041 on 2026-10-25, 042 and 043 on 2026-11-01, 044
  on 2026-11-08), which records them in
  supabase_migrations; confirmed there 2026-10-28, with job_runs and
  recall_notices present and match_recall_notice identical on staging and
  production (staging's 040b best-by fix is folded into production's
  040). 001 to 030 were run by hand in the SQL editor and are not
  recorded there.
- Claude has the Supabase connector (since 2026-10-24) on org Batch'd,
  free plan, one project. Read-only SQL and advisors are fine to run;
  any write, migration or new project waits for Ian's yes on the exact
  change.
- Staging: project batchd-staging, tiwrrocdwljazweveeth, eu-west-1, free
  plan, created 2026-10-24. Its schema was rebuilt from production's
  catalog in ten steps (recorded in its supabase_migrations as clone_01
  to clone_10) and matched production exactly on every category: 631
  columns, 202 constraints, 139 indexes, 42 functions, 2 views, 15
  triggers (auth.users included), RLS flags, 156 policies (storage
  included), 938 table grants, 125 function grants, the scan-photos
  bucket, extensions. No data was copied. Known difference: email
  confirmation is ON in staging and OFF in production (Ian toggles it in
  the dashboard; no connector tool for auth settings). Nothing points at
  staging yet. Any schema change must go to staging first, then
  production, and the fingerprint comparison rerun.
- Security advisor, run 2026-10-28 on production: one ERROR, the
  products_public view is SECURITY DEFINER (deliberate since migration
  001 and kept by 030; anon reads published product names by GTIN
  through it); WARN on SECURITY DEFINER functions callable by anon and by
  signed-in users (all checked: create_organisation_with_admin requires a
  signed-in caller, get_org_member_emails requires an active corp_admin
  of the org, get_my_organisation_ids and the batchd_user_* helpers
  return nothing without a session, the invitation readers are token
  gated for the join page); WARN that leaked-password protection is off
  in Auth (a Pro plan feature; the project is on the free plan, so the
  warning is accepted until the plan changes, Ian 2026-11-01); INFO that
  organisation_api_keys and scan_queue have RLS and no policies (closed
  to clients on purpose). Migration 042 (applied to staging and production
  2026-11-01) revoked anon EXECUTE on the three that never need it; the
  advisor's anon list is now the invitation readers and the batchd_user_*
  RLS helpers, both kept on purpose.
- Before running SQL, confirm the editor is on lurxucdmrugikdlvvebc.
  Migrations 022 to 026 once reported PASS against a different project.
- Schema reference: docs/SCHEMA-REFERENCE.md, generated from production
  by scripts/schema-reference.sql (every table's columns, constraints,
  indexes, triggers, policies and grants, plus views, functions with who
  may call them, and storage). Regenerate it after every migration (run
  the query through the Supabase connector and save the single cell).
  SCHEMA.md is the older hand-written guide to the recall flow; where the
  two disagree, the generated file wins.
- Probing: a made-up table answers 404 PGRST205; a locked real table
  answers 42501 to anon. PostgREST returns PGRST202 for a wrong parameter
  list as well as a missing function, so probe RPCs with real names.

## Security state
- John's rollout (migrations 019, 020, 020a, 021, merged 2026-09-22) is
  applied. Tenant tables (scans, stores, organisations,
  recall_distributions, recall_acknowledgements) are org-scoped,
  membership self-insert is closed, invitations are corp-admin only,
  user_profiles is owner-only, ERP API keys live in
  organisation_api_keys as sha256 hashes (organisations.api_key nulled,
  column kept). Details: docs/SECURITY-ROLLOUT-2026-09.md.
- recall_events: the open read policy was dropped 2026-09-13. Some reads
  (renderCommandCenter, traceLot, renderIntelligencePanel, the scanner's
  _loadClosedEventIds) have no org filter and rely on RLS.
- The recall composer's non-drill recall_events insert is allowed for a
  corp_admin by policy b20_events_source_admin_write (confirmed from
  pg_policies 2026-10-24).
- Netlify functions run with the service-role key, which bypasses RLS.
  `netlify/lib/auth.js` (verifyUser, activeMembership, isPlatformAdmin,
  requireMember, requireAi, internalSecretOk) is the tenant boundary for
  every function. `node_bundler = "esbuild"` bundles it.
- The old demo account password is in git history and the repo is
  public. It must be rotated (open, see "Open items").
- Migration 034 (2026-10-24): store names are unique per organization,
  ignoring case and surrounding spaces (index stores_org_name_uidx; the
  global stores_name_key is gone), and anon has SELECT only on public
  tables, also for tables created later by role postgres (default
  privileges). Logged-out reads of most tenant tables return 42501 from
  the RLS helper functions (true since 020), not an empty list. Any new
  page that reads before sign-in must expect that error.
- Migration 033 (2026-10-24) scoped code_patterns to the member's org
  (organisation_id defaults to batchd_user_org_id(), because the scanner
  never sets it), closed scan_queue to clients, scoped scan_telemetry
  reads to the member's org, removed direct inserts into complaints and
  complaint_messages (only triage-complaint.js, with the service role,
  writes them), limited complaint_audit_log inserts to the member's own
  complaints, and made sweep_recall_matches refuse a signed-in caller
  outside p_organisation_id and skip recalls owned by another org
  (no-org shared feed recalls still sweep).
- Migration 032 (2026-10-24) locked the scan-photos bucket: no anon
  policy at all (photos still load by public URL because the bucket is
  public), signed-in members may read, upload and overwrite only under
  orgs/<first 8 characters of an active org id>/, nobody deletes through
  the API. Uploads to any other path fail; the scanner logs a warning and
  saves the scan without the photo.
- Migration 031 (2026-10-24) revoked EXECUTE on push_recall,
  create_organisation and get_retailer_emails from anon and signed-in
  users (no callers; push_recall let any signed-in user push recalls to
  every retailer) and on sweep_recall_matches from anon. Signed-in users
  can still call sweep_recall_matches with any p_organisation_id; a
  membership check inside it is open. Run the Supabase security advisor
  after any DDL change.

## Commercial plan flag (organisations.plan)
Values trial (signup default), pov, active (paying), churned. Only a
platform admin can change it (migration 020 guard trigger; admin.html
dropdown). It gates every Anthropic-backed feature (ocr.js and
ai-analyze.js require pov or active; the apps read it into
`window._orgAiEnabled` and skip the call with one toast) and public
complaint intake while `PUBLIC_COMPLAINTS_REQUIRE_PLAN = true` in
triage-complaint.js. A new org has no AI until someone sets its plan;
Anthropic spend is billed to Batch'd. 020a moved all pre-existing orgs to
pov once and refuses to run again.

## Database rules (never violate)
- scans.recall_resolved defaults false on every insert. Never use it to
  count active recalls.
- Pull tracking lives on scans.removed_from_shelf_at. App code never
  writes scan_recall_matches.removed_at, but the database does: trigger
  on_scan_pulled (sync_recall_match_removal) copies removed_from_shelf_at
  and removed_from_shelf_by onto existing matches whenever a scan is
  pulled (found 2026-10-24; older notes said the column was never
  written). A match created after the pull does not get it, so
  push-recall-email.js now reads scans.removed_from_shelf_at through an
  embed and falls back to removed_at (2026-10-24). Count on-shelf with
  scans.removed_from_shelf_at.
- A recall requires action only when ALL THREE hold: the recall is
  active, an org scan matches by exact lot or barcode, and that scan is
  still on shelf. Mock drills never count.
- Feed recalls (the FDA entries of recall_catalog) count as active only if
  confirmed in scan_recall_matches (catalog_id) and not dismissed by the
  organization (recall_catalog_org.dismissed_at). Manual and pushed
  recalls count on an exact lot or barcode match to an on-shelf scan.
- Every recall check calls `batchd_active_recalls(p_org)` (migration 043;
  SECURITY INVOKER). It returns manual recalls (`recalls`), pushed events
  (recall_events through recall_distributions) and public feed entries
  (recall_catalog with the organization's recall_catalog_org state) in one
  shape, with drills, closed events and dismissed feed entries left out.
  Never build that list from the tables in a page again: the old rule
  ("read BOTH sources") regressed four times before B4 replaced it. In the
  SCANNER (since B4 stage 4, 2026-11-08) every reader goes through
  `_fetchActiveRecalls()`, which calls the function and normalizes the
  rows with `Batchd.activeRecalls.normalizeActiveRecalls`
  (src/shared/active-recalls.js) into the cache shape; scripts/check.mjs
  refuses a new page query of recall_distributions or recall_events in
  index.html. In RETAIL (since B4 stage 5, 2026-11-08) the same:
  `_fetchActiveRecalls(opts)` in dashboard.html calls the function and
  normalizes; the Dashboard overview, the Recalls panel's Active and Feed
  tabs, Lot Lookup, the lot tracer, the Intelligence panel, the Store
  Network command center and the exposure report read it, and the check
  refuses the old query pairs and unfiltered recall_events lists in
  dashboard.html. Since B4 stage 6 `recalls` holds only manual recalls and
  the linked rows of pushed recalls (the feed copies are gone; the
  importer writes the catalog only). Reads that stay on the tables on
  purpose: the Recalls
  panel's History tab and the recall history report (inactive recalls and
  closed events, by event id through recall_distributions), Live Recall
  and the drill pages (one event by id), the Consumer Notify picker
  (events closed within the last 30 days are still offered), the
  scanner's loadRecallsList, loadMgrRecalls and loadMgrData
  (manual-recall management; loadMgrData also loads scan_recall_matches)
  and the duplicate checks before a manual recall is filed. The Feed
  alerts tab is the catalog with per-organization state
  (recall_catalog_org: dismiss, restore, mark reviewed) and reads the
  per-organization copies no more.
- A received lot with no shelf scan is "held at receiving": warn to hold
  it, but it does not count toward active-recall badges.

### Column names that bite
- recall_distributions.retailer_org_id (NOT initiating_org_id).
- mock_recall_drills.initiated_by_org (NOT retailer_org_id); started_at
  is canonical over created_at.
- recalls has description, NOT reason and NOT severity. Alias with
  `reason:description`; fold severity into the description.
- recall_events.barcode (NOT barcode_number); has both reason and
  description. recall_events.is_recalled does NOT exist.
- recalls.is_pushed and recalls.recall_event_id exist. To iterate manual
  recalls only: `if (r.is_pushed || r.recall_event_id) return false;`
- recall_acknowledgements has acknowledged_at, pulled_at, disposed_at,
  confirmed_at (the last three NULL before 2026-05-07). The UI calls the
  'confirmed' step "Resolved"; the DB value stays 'confirmed'.
- recall_events.closed_at IS NOT NULL means administratively closed.
- A SELECT on a missing column fails silently in the UI (a 400 visible
  only in devtools).

### scan_recall_matches has three paths
The id columns a row carries come from `Batchd.activeRecalls.matchIdColumns`
(the scanner wraps it as `_matchIdColumns`) and every scanner write goes
through `_writeMatchRows` (since B4 stage 4, 2026-11-08).
- Path A (manual): recall_id = recalls.id, recall_event_id and catalog_id
  NULL. Written by matchScanAgainstRecalls, the sign-in sweep and the
  sweep_recall_matches RPC. Query with `.eq('recall_id', recalls.id)`.
- Path C (feed, since migration 043): catalog_id = recall_catalog.id,
  recall_id and recall_event_id NULL. Written by the importer's
  sweep_catalog_matches RPC and by the scanner (save path and sign-in
  sweep). The (scan_id, catalog_id) unique index is partial, so PostgREST
  upsert cannot target it: `_writeMatchRows` selects, then inserts the
  missing rows. Query with `.eq('catalog_id', id)`. Since stage 6 the
  per-organization feed copies are gone from `recalls`, so no match row
  points at a feed copy any more.
- Path B (pushed): recall_event_id = recall_events.id, recall_id = the
  linked recalls row for that lot (is_pushed, recall_event_id set; one
  per lot since 2026-10-25). recall_id has a foreign key to recalls(id),
  so it can NEVER hold a recall_events id; the old "both columns = event
  id" rule was impossible and every such write failed with 23503 (found
  by e2e/core-flow.spec.mjs 2026-11-01; production had 0 match rows with
  an event). Writers: the dashboard's _composerPushRecall stamps
  recall_event_id on the rows the sweep RPC wrote; the scanner's
  matchScanAgainstRecalls (save path) and the login push sweep in
  checkRecallsOnLogin pick the linked row with _pushedMatchRecallId. The
  linked rows ride on each pushed recall object as _linkedRecalls,
  attached by _attachLinkedRecalls where the cache is built
  (checkRecallsOnLogin, loadHistory); a pushed event with no linked row
  gets no match row (the write would be refused). Query with
  `.eq('recall_event_id', id)` (real FK, cascade delete). A reader that
  takes any kind of id (the Recalls drawer's exposure query) filters on
  all three columns; checkPriorComplaintsForRecall takes a manual id.
- recall_source ('manual', 'fda', 'rasff', 'mattilsynet',
  'manufacturer_push') is for reporting, not disambiguation.

## FSMA 204 build: where things live
Phases 0 to 8 of the handoff are built, deployed and backed by applied
migrations (022 to 026, 028 to 030). Full detail per phase:
docs/HISTORY.md.
- Citations: `Batchd.fsma.CITATIONS_US` (src/shared/fsma.js), read by
  the dashboard as `_CITATIONS.us` and by the scanner as
  `window._CITATIONS.us` (with `RFR_FACILITY_STORE` as its
  registered-facility wording). Every surface reads through it. Retention is
  21 CFR 1.1455(d), availability 1.1455(c), receiving KDEs 1.1345, plan
  1.1315, exemptions 1.1305, recall 7.46, 7.49, 7.55. A registered
  facility gets the Reportable Food Registry sentence (`rfrCopy()`,
  gated on operates_registered_facility); a retail store gets "the
  recalling firm notifies the FDA; the store pulls, holds and documents".
- Applicability bands and copy: `Batchd.fsma.applicabilityTable(unknown)`
  in src/shared/fsma.js (bands, labels, copy, closing, threshold note),
  read as `_FSMA_APPLICABILITY` (dashboard), `_FSMA_TABLE`, `_FSMA_BANDS`
  and `_FSMA_COPY` (signup, which also renders its sales band options
  from `APPLICABILITY_BANDS`) and `window._FSMA_APPLICABILITY_COPY`
  (scanner). Only the "not yet answered" sentence differs per page.
  $250,000 (1.1305(i)) and $1 million (1.1455(c)(3)(iii)) are 2020
  dollars (`THRESHOLDS`); the FDA has not published adjusted figures for
  this rule yet. When it does, change them in the module only.
- Receiving: receiving_events (migration 023) is the Receiving CTE.
  Scanner Receiving mode (`rcv*` functions), dashboard Receiving panel
  (wholesaler file import, status 'expected', confirmed in the scanner).
  scans.receiving_event_id links a shelf scan to its delivery. Statuses:
  expected, received, rejected. No client DELETE on this table.
- Completeness rule: supplier name, phone, street, city, state, ZIP, in
  `Batchd.fsma.supplierIsComplete`; `supplierIsComplete` (dashboard) and
  `_rcvSupplierComplete` (scanner) are aliases of it. The four record checks (supplier location, lot or exempt
  source, quantity and unit, reference document) are shared by
  loadComplianceData and the scanner's renderFsmaReadiness.
- Export: `buildFsma204Records(scope)` and `downloadFsma204Export`
  (dashboard), `fsmaExport` (scanner). The 27 `FSMA204_EXPORT_HEADERS`,
  the disclaimer and the formula-safe `csvCell` come from
  src/shared/fsma.js. Used by the records request drill, Live Recall, the
  Reports panel and the scanner.
- FTL detection: `FTL_CATEGORIES` in src/shared/ftl.js (`Batchd.ftl`)
  with optional `exclude` regexes; the dashboard's `_SUPPLIER_CATEGORIES`
  and signup's `_FOCUS_LABELS` are `Batchd.ftl.ftlLabels()`, so the 17
  category labels (sentence case, American English) exist once.
  Resolution order: ftl_overrides by GTIN, by normalized name,
  products_public.is_ftl, then the name regex. If you see `^H` (0x08) in
  a regex, that is the old broken-`\b` defect.
- ftl_overrides unique indexes are partial, so PostgREST upsert cannot
  target them. Use select then insert or update.
- Category kits: `CATEGORY_KITS` (dashboard), full kits for leafy_greens
  and nut_butters; `kitFor(key)` returns a minimal kit for other keys.
- Network benchmarks: only the opt-in toggle exists. Nothing reads it.
  Aggregation must run server-side and expose only pre-aggregated rows
  with at least 10 contributing orgs.
- `_missingColumnFrom(error)` reads the column from PGRST204 or 42703 and
  lets saves retry without it, so new columns degrade gracefully on an
  older database.

## Netlify functions (14)
| Function | Purpose | Auth |
|---|---|---|
| ai-analyze.js | Anthropic proxy for investigations and NL queries | requireAi (member of org, plan pov/active) |
| fetch-recall-feeds.js | Daily FDA import: each entry once into recall_catalog plus a sweep_catalog_matches call per new entry; writes nothing else | Scheduled only, no URL |
| notify-consumers.js | Consumer recall emails | corp_admin of the recall's org |
| notify-event.js | recall_pushed, complaint_filed, drill_scheduled emails | INTERNAL_NOTIFY_SECRET or member JWT |
| ocr.js | Anthropic vision; owns its prompt templates | requireAi |
| health-check.js | Daily 07:00 UTC: reads job_runs (and recall_catalog for the stale-feed rule) and emails platform admins when a job has not run or failed, plus one "all clear" on Mondays (HEALTH_HEARTBEAT=off disables) | Scheduled only |
| parse-recall-notice-background.js | Background function: Claude reads a supplier recall notice into recall_notices.extracted (prompt and schema in netlify/lib/recall-notice.js) | corp_admin of the notice's org, plan pov/active |
| push-recall-email.js | Recall alert emails | INTERNAL_NOTIFY_SECRET, fails closed |
| recall-escalation.js | 2h and 24h unacknowledged escalations | Scheduled only |
| recall-reminder.js | Reminder emails from dashboard buttons | corp_admin of orgId |
| send-invite.js | Staff invitation emails | corp_admin of the invitation's org, or platform admin |
| trace.js | Retired, answers 410 | None |
| triage-complaint.js | Complaint intake, AI triage, follow-ups | Public form with honeypot and rate limits; staff by JWT |
| webhook-recall.js | ERP webhook for manufacturer orgs | X-Batchd-Api-Key, hashed |
The on-demand email functions (push-recall-email, notify-event,
recall-reminder, send-invite, notify-consumers) record a failed send as an
ok=false row in job_runs through `logFailure` in netlify/lib/job-log.js, so
the health check reports it the next morning; successes are not recorded.
Secrets come from environment variables only. fetch-recall-feeds.js has
a stray control character near line 143; use `grep -a` on it. Model ids
pinned: claude-sonnet-4-20250514 and claude-haiku-4-5-20251001 (older
functions, raw fetch); the notice reader uses claude-opus-5-5 through the
@anthropic-ai/sdk package (pinned in package.json).

## Jurisdiction layer (frozen)
Region resolves per user: `_orgRegion` (dashboard) and `_userRegion`
(scanner) are user_settings.region falling back to organisations.region,
then 'us'. `_orgDefaultRegion` is read only by the Settings
Organization card. Every piece of regulatory copy, date format, phone
prefix, currency, retention rule and regulator name gates on
`_orgRegion` or `_userRegion` at the leaf, never on a panel-level flag
or a hardcoded literal. Never mix fields from two regions in one card.
Date format follows region; user_settings.date_format is never written.
Users cannot change their own region.

## Design system
Source of truth: `src/shared/design-tokens.css` (built to
/assets/design-tokens.css and linked by the scanner, Retail and the
sign-in page; tests/design-tokens.test.mjs holds the rules below and
scripts/check.mjs refuses an inline copy). Retail keeps 30 aliases of its
own (sidebar, topbar, tints, blur) in its first `<style>`. Change the one
file; the build ships it.
- Theme is `<html data-theme="dark|light">`, saved in localStorage.
  Never switch on prefers-color-scheme; theme is an operator choice.
- Dark never uses #000000 (use `--background-base` #080F12) and dark
  text never uses #FFFFFF (use `--text-primary` #EAF6F0). Light is not
  an inversion.
- One saturated color: mint #34D399 dark, emerald #077A55 light. Red,
  orange and blue are state signals only. No purple or blue gradients,
  no left-border accent cards.
- Every style reads the ladders: type `--fs-label 10 / eyebrow 11 /
  meta 12 / body 13 / body-lg 15 / h4 17 / h3 22 / h2 28 / h1 46`,
  radius `--r-xs 6 / sm 8 / md 10 / lg 12 / xl 16 / 2xl 20 / pill`,
  motion `--dur-fast/-normal/-slow` with `--ease-out`. Spacing `--s-*`
  is not swept yet; use it in new code. Exceptions: scanner inputs keep
  16px (iOS zoom), and standalone print or stored documents keep literal
  values because their window has no tokens.
- A print window that copies panel HTML must declare the ladder on its
  own `:root` via `_printLadderCss()`, as printReport does.
- Translucent tints: `rgba(var(--accent-rgb), 0.1)` and the other
  `--*-rgb` triples. Recall stages pulled and disposed use
  `--stage-pulled-rgb` and `--stage-disposed-rgb`. Colors handed to
  Leaflet go through `_resolveCssColor`.
- No emoji except the US, EU and Norway flags. Dashboard icons come from
  `_ico(name, size)` (paths in `_ICON_PATHS`). The text marks ✓ ✗ ⚠ ● ★
  are typography, not emoji.
- Use `_confirmDialog(message, opts)` in the dashboard, never confirm().
- Fonts: Figtree (body and display; ExtraBold self-hosted in /fonts/),
  DM Mono uppercase with 0.06 to 0.12em tracking for eyebrows, labels
  and badges.
- WCAG 2.1 AA is required: 4.5:1 body text, 3:1 large text and UI.
  Focus rings use `var(--ring-focus)`.
- Voice: statements over slogans, numbers up front, procedural verbs
  (push, match, acknowledge, pull, dispose, audit), sentence case,
  "you" for the reader, "Batch'd" in the third person, never "we".

## UI conventions
- One page title per panel: the topbar text from the `panels` map in
  showPanel(). Bodies do not add a duplicate h1. Topbar labels match the
  sidebar text exactly: Dashboard, Getting started, Recalls, Store
  Network, Scan History, Receiving, Staff Activity, Compliance, Reports
  and Exports, Settings, Complaint Triage, Consumer Notify,
  Investigations, Terminology & Help, Lot Lookup, Live Recall, Compose
  recall.
- Store-manager views match on store_id with a store_name fallback for
  legacy scans.

## Open items
- Netlify secret hygiene: keep every secret's Local development value empty
  (Netlify shows those in plain text). INTERNAL_NOTIFY_SECRET was rotated and
  recreated under the right name on both sites on 2026-10-25; the code's
  misspelled-key fallback was removed on 2026-11-01.
Owed by Ian:
- Three photographed case labels (romaine, nut butter, one non-GS1) to
  test the GS1 parser.
- One real wholesaler delivery file, with permission, for the import.
- Brand ownership of the suggested supplier seeds, and lot code formats
  for those brands before any lot hints are added.
- Smoke checks 10 to 13, 17 to 20, 46 and 47 were run by Claude on
  2026-11-01 on the local static server against the staging database and
  passed; 48 and 51 were run on the production apps the same day and
  passed, with Ian confirming the drill, complaint and recall emails
  arrived (docs/CHANGELOG.md has the detail).
  10 to 13, 17 to 20, 46 and 47 have not been run on production. The
  three defects from that run (prompt() in Mark complete, closed recalls
  in the Active tab, the slow Recalls deep link) were fixed the same day
  and the deep link now loads in about 3 s on the live site.
- Rotate the demo account password (in public git history). Claude's
  attempt on 2026-11-01 was blocked by the app's permission layer, so it
  stays Ian's: Supabase, Authentication, Users, demo@batchdapp.com.
- Confirm the shared secrets match on both Netlify sites (the connector
  cannot read site-level variables). SCHEDULED_FUNCTIONS_DISABLED is
  settled: batchd-app skips, www runs (2026-10-28).
- Leaked-password protection in Supabase Auth needs the Pro plan; turn it
  on if the project is ever upgraded.
Security, found 2026-10-24 while cloning to staging: all fixed (032
storage bucket, 033 cross-org rules, 034 anon table writes and store
names, 035 view user_accessible_stores, search paths and trigger
functions). Nothing from that pass is still open.
Code, known and not fixed:
- Fixed 2026-11-08 (B4 stage 4): a recall pushed with several lots now
  matches a scan of any of them, because batchd_active_recalls returns
  every lot in `lots` and the shared matcher reads that list (and the
  GTINs of a feed entry). Retail's lotsMatch readers go through
  `_recallLotsMatch(recall, lot)` and its strict readers through
  `Batchd.activeRecalls.recallLots` and `recallBarcodes` (stage 5).
- Design review leftovers: spacing onto `--s-*`; the photo lightbox and
  camera overlays keep literal colors on purpose.
Not built (by decision): EDI 856, a Shipping sheet for distribution
centers, tier gating, NO variants of anything, Supabase Pro (Ian,
2026-11-01: off until further notice), text-message alerts (push only).
Ian's answers to the two plans' decision lists are in
docs/PLATFORM-IMPROVEMENT-PLAN.md and docs/PORTALS-PLAN.md section 6
(2026-11-01 and 2026-11-08). Order of work: the recall engine first.
Only portals plan Q7 (who pays) is still open.

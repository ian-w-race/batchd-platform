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
- After a change Ian should test, add a numbered check to SMOKE.md and a
  dated entry to docs/CHANGELOG.md. Keep this file to rules and current
  state; do not grow it back into a log.
- Since 2026-10-24 every page picks its database from the host
  (BATCHD_ENV, set next to SUPABASE_URL in index, dashboard, signup, join
  and admin): any "name--site.netlify.app" host (deploy previews, branch
  deploys) and localhost or 127.0.0.1 use STAGING (tiwrrocdwljazweveeth);
  everything else uses production. Staging pages show a "Staging
  database" badge, rewrite links and window.open calls aimed at the
  production apps to the preview's own origin (batchdPreviewUrl), and
  use batchdLink(productionUrl, stagingPath) for redirects. Keep the
  block identical in all five files.
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
- Verification standard so far: `node --check` on every inline script
  block (scanner 4, dashboard 6, signup 2, join 2, admin 1), Node tests
  with stubbed clients, local previews in both themes. None of that proves
  behavior against the live database; say so when reporting.

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
manufacturer partners. landing.html still pitches the manufacturer
network and its demo form posts to a send-invite branch that no longer
exists.

## The files
Live surfaces:
- index.html (about 23,000 lines): staff scanner PWA. Canonical URL
  https://batchd-app.netlify.app/ (Ian, 2026-09-13). app. and
  www.batchdapp.com serve the same file but nothing links there. Moving
  stores to another origin orphans the per-origin PWA install and offline
  queue, so settle that before the first design partner installs.
- dashboard.html (about 17,900 lines): corporate retailer dashboard,
  served at the root of corporate.batchdapp.com.
- signup.html (self-serve, retailer only), join.html (invitation
  acceptance), admin.html (internal, gated on
  organisation_members.is_batched_admin, linked from nowhere).
- lot-code-guide.html, privacy.html, terms.html.
- complaint.html and complaint-widget.js: public complaint intake to
  triage-complaint.js. The widget hardcodes www.batchdapp.com.
- trace.html: retired notice; the trace function answers 410.
Dormant: landing.html, recall-roi-calculator.html, the three retired
stubs. Before deleting any, check Netlify analytics or search console for
external links (needs verification).
Not app files: README.md, SCHEMA.md, SECRETS.md, SMOKE.md, docs/,
migrations/, fonts/, netlify/, netlify.toml, package.json (pins
@supabase/supabase-js 2.112.1 for the functions).
Both big apps are single files with no shared JS module. Only esc,
showToast and signOut share names between them. Design tokens are
duplicated by design in index.html, dashboard.html and
assets/design-tokens.css. Note: assets/ exists in Ian's local folder but
is not on GitHub; nothing live loads it.

## Domains and routing
- Three Netlify sites deploy this repo (verified 2026-09-21). Every
  environment variable the functions read must exist with the same value
  on all three, INTERNAL_NOTIFY_SECRET above all (push-recall-email fails
  closed without it).
- netlify.toml arms recall-escalation (every 30 min) and
  fetch-recall-feeds (daily 06:00 UTC) on every site, so
  SCHEDULED_FUNCTIONS_DISABLED=true must be set on exactly two of the
  three. Missing on more than one sends duplicate escalation emails;
  true on all three runs nothing. Needs verification in the Netlify UI.
- Path aliases on every domain: /join, /manufacturer, /signup, /terms,
  /privacy.
- corporate.batchdapp.com/ serves dashboard.html (forced 200);
  /dashboard.html and /dashboard on corporate, app., www. and
  batchd-app.netlify.app 301 to the corporate root.
- Host rules are host-exact, so deploy-preview-- and other netlify.app
  names serve index.html at / and dashboard.html at /dashboard.html with
  no canonical redirects.
- Forced 404s keep CLAUDE.md, SECRETS.md, SCHEMA.md, SMOKE.md, README.md,
  the roadmap and design docs, CHECK_MIGRATIONS.sql, netlify.toml,
  package files, /migrations/*, /docs/* and /netlify/* off the public
  site. Any new private doc at the root needs its own rule (or goes in
  docs/). Function calls use /.netlify/functions/, a different prefix.
- Netlify's Pretty URLs rewrites `dashboard.html?panel=` links to
  `dashboard?panel=` in the served scanner, so the live index.html
  differs from the file by a few lines. Expected.
- index.html's top script redirects the retired manufacturer., admin.
  and supplier. hostnames client-side. The scanner's own "Open dashboard"
  buttons point at app.batchdapp.com/dashboard.html, which 301s.

## Supabase
- Project: lurxucdmrugikdlvvebc.supabase.co. Ian's org
  925923b5-22c6-433c-8812-7e32918dab66, user
  97da19d3-3daa-4f7a-bd9c-53e7ac8f8a5c (from Ian).
- Client pinned to @supabase/supabase-js 2.112.1 with SRI in index,
  dashboard, join, signup and admin.
- Email confirmation is OFF (mailer_autoconfirm true), which join.html's
  sign-in-after-signup relies on. Turning it on breaks invite acceptance.
- Migrations: 001 to 034 with 020a, no 027 (John's code_patterns slot,
  applied outside the folder). CHECK_MIGRATIONS.sql reports APPLIED or
  MISSING per migration; Ian ran it 2026-10-11 and every row was APPLIED.
  031 to 034 were applied 2026-10-24 through the Supabase connector,
  which also records them in supabase_migrations. 001 to 030 were run by hand in the
  SQL editor and are not recorded there.
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
- Before running SQL, confirm the editor is on lurxucdmrugikdlvvebc.
  Migrations 022 to 026 once reported PASS against a different project.
- Schema reference: SCHEMA.md (recall-flow tables, Phase 1 tables, views,
  policies). Older parts predate May 2026; verify against
  information_schema before trusting a column.
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
  push-recall-email.js's "confirmed pulled" undercounts in that case.
  Count on-shelf with scans.removed_from_shelf_at.
- A recall requires action only when ALL THREE hold: the recall is
  active, an org scan matches by exact lot or barcode, and that scan is
  still on shelf. Mock drills never count.
- Feed recalls (FDA, Mattilsynet) count as active only if confirmed in
  scan_recall_matches. Manual and pushed recalls count on an exact lot or
  barcode match to an on-shelf scan.
- Every recall check reads BOTH sources: the recalls table (manual and
  feed) AND recall_events joined through recall_distributions on
  retailer_org_id (pushed). This has regressed before. Lists that still
  read the recalls table only, on purpose or not: the scanner's
  loadRecallsList and loadMgrRecalls (manual-recall management),
  loadMgrData (it also loads scan_recall_matches), and
  checkActiveRecalls when called without `_cachedActiveRecalls`.
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

### scan_recall_matches has two paths
- Path A (manual and feed): recall_id = recalls.id, recall_event_id
  NULL. Written by matchScanAgainstRecalls and the sweep_recall_matches
  RPC. Query with `.eq('recall_id', recalls.id)`.
- Path B (pushed): recall_id = recall_event_id = recall_events.id.
  Written by the scanner's login push sweep and converted by the
  dashboard's _composerPushRecall. Query with
  `.eq('recall_event_id', id)` (real FK, cascade delete).
- recall_source ('manual', 'fda', 'rasff', 'mattilsynet',
  'manufacturer_push') is for reporting, not disambiguation.

## FSMA 204 build: where things live
Phases 0 to 8 of the handoff are built, deployed and backed by applied
migrations (022 to 026, 028 to 030). Full detail per phase:
docs/HISTORY.md.
- Citations: `_CITATIONS.us` (dashboard const; `window._CITATIONS` in
  the scanner). Every surface reads through it. Retention is
  21 CFR 1.1455(d), availability 1.1455(c), receiving KDEs 1.1345, plan
  1.1315, exemptions 1.1305, recall 7.46, 7.49, 7.55. A registered
  facility gets the Reportable Food Registry sentence (`rfrCopy()`,
  gated on operates_registered_facility); a retail store gets "the
  recalling firm notifies the FDA; the store pulls, holds and documents".
- Applicability bands and copy: `_FSMA_APPLICABILITY` (dashboard),
  `_FSMA_BANDS` and `_FSMA_COPY` (signup), `window._FSMA_APPLICABILITY_COPY`
  (scanner). Keep the three in step. $250,000 (1.1305(i)) and $1 million
  (1.1455(c)(3)(iii)) are 2020 dollars; the FDA has not published adjusted
  figures for this rule yet. When it does, change all three together.
- Receiving: receiving_events (migration 023) is the Receiving CTE.
  Scanner Receiving mode (`rcv*` functions), dashboard Receiving panel
  (wholesaler file import, status 'expected', confirmed in the scanner).
  scans.receiving_event_id links a shelf scan to its delivery. Statuses:
  expected, received, rejected. No client DELETE on this table.
- Completeness rule: supplier name, phone, street, city, state, ZIP.
  `supplierIsComplete` (dashboard) and `_rcvSupplierComplete` (scanner)
  must match. The four record checks (supplier location, lot or exempt
  source, quantity and unit, reference document) are shared by
  loadComplianceData and the scanner's renderFsmaReadiness.
- Export: `buildFsma204Records(scope)` and `downloadFsma204Export`
  (dashboard), `fsmaExport` (scanner). `FSMA204_EXPORT_HEADERS` must be
  identical in both files. Cells are formula-safe. Used by the records
  request drill, Live Recall, the Reports panel and the scanner.
- FTL detection: `FTL_CATEGORIES` in the scanner with optional `exclude`
  regexes. Resolution order: ftl_overrides by GTIN, by normalized name,
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

## Netlify functions (13)
| Function | Purpose | Auth |
|---|---|---|
| ai-analyze.js | Anthropic proxy for investigations and NL queries | requireAi (member of org, plan pov/active) |
| fetch-recall-feeds.js | Daily FDA and Mattilsynet import | Scheduled only, no URL |
| notify-consumers.js | Consumer recall emails | corp_admin of the recall's org |
| notify-event.js | recall_pushed, complaint_filed, drill_scheduled emails | INTERNAL_NOTIFY_SECRET or member JWT |
| ocr.js | Anthropic vision; owns its prompt templates | requireAi |
| push-recall-email.js | Recall alert emails | INTERNAL_NOTIFY_SECRET, fails closed |
| recall-escalation.js | 2h and 24h unacknowledged escalations | Scheduled only |
| recall-feeds.js | Proxies rasff and Mattilsynet feeds | Any active session |
| recall-reminder.js | Reminder emails from dashboard buttons | corp_admin of orgId |
| send-invite.js | Staff invitation emails | corp_admin of the invitation's org, or platform admin |
| trace.js | Retired, answers 410 | None |
| triage-complaint.js | Complaint intake, AI triage, follow-ups | Public form with honeypot and rate limits; staff by JWT |
| webhook-recall.js | ERP webhook for manufacturer orgs | X-Batchd-Api-Key, hashed |
Secrets come from environment variables only. fetch-recall-feeds.js has
a stray control character near line 143; use `grep -a` on it. Model ids
pinned: claude-sonnet-4-20250514 and claude-haiku-4-5-20251001.

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
Source of truth: assets/design-tokens.css, mirrored inline in
dashboard.html and index.html. Change the canonical file first, then
both copies.
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
Owed by Ian:
- Three photographed case labels (romaine, nut butter, one non-GS1) to
  test the GS1 parser.
- One real wholesaler delivery file, with permission, for the import.
- Brand ownership of the suggested supplier seeds, and lot code formats
  for those brands before any lot hints are added.
- Live smoke checks never run on the deployed apps: SMOKE.md 10 to 13,
  17 to 20, 46 and 47.
- Rotate the demo account password (in public git history).
- Check SCHEDULED_FUNCTIONS_DISABLED and the shared secrets on all three
  Netlify sites.
Security, found 2026-10-24 while cloning to staging: all fixed (032
storage bucket, 033 cross-org rules, 034 anon table writes and store
names). Nothing from that pass is still open.
Code, known and not fixed:
- push-recall-email.js reads scan_recall_matches.removed_at (see the
  database rules).
- landing.html's demo form posts to a removed send-invite branch.
- Scanner: fetchUserProfile (second script block) calls applyManagerUI
  (third block). Safe in production because the network round-trip lands
  after parsing.
- Design review leftovers: spacing onto `--s-*`; the photo lightbox and
  camera overlays keep literal colors on purpose.
Not built (by decision): EDI 856, a Shipping sheet for distribution
centers, tier gating, NO variants of anything.

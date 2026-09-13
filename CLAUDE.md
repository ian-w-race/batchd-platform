# Batch'd Platform

Verified against the repo on 2026-09-13. Where a fact could not be
confirmed from the code it is marked "needs verification" with a note
on what would settle it.

## Who I am building with
Ian Race, not a developer. Always provide complete, ready-to-use
files. Never partial diffs or code snippets to manually insert.

## The golden rules
- Think carefully before building anything
- Work surgically. Do not break what works
- Never expose API keys in client-side code. The only keys allowed in
  the HTML are the Supabase anon key (public by design, RLS-protected),
  the MapTiler publishable key in dashboard.html (origin-locked in
  MapTiler's console) and the Sentry browser-loader public key. See
  "Security posture" below.
- batchd.no is the brand website. It lives in its own repo and its own
  Netlify site and is not part of this repo. Never edit it from here
  and never mix its files with this platform's.
- Routing: host-scoped rules in netlify.toml are the authority for the
  domain split. There is no _redirects file. The JS hostname snippet at
  the top of index.html is a fallback that only redirects the retired
  manufacturer, admin and supplier subdomains. See "Domains and
  routing" below.

## Retailer-only platform (post-chunk-6 pivot)
Batch'd has been streamlined to a retailer-only platform. The
manufacturer side has been retired:
- manufacturer.html, supplier.html and manufacturer-signup.html are
  static "retired" landing pages (80 lines each, noindex, one link out
  to batchd.no)
- The Manufacturers panel and Shipments panel were removed from
  dashboard.html in chunks 6B and 6C-a
- The manufacturer-escalation flow was removed from the Complaint
  Triage panel in chunk 6C-a
- The trading_partners and shipments tables stay in the DB. They are
  read by the lot-lookup page, the drill launcher, the recall
  distribution joins and webhook-recall.js, but no UI in the platform
  creates new rows in them
- partnerScore was dropped from the dashboard's readiness average in
  chunk 6C-b. Readiness is now 3-way: ackScore + shipScore + scanScore
  (dashboard.html around line 2932). Because nothing writes shipments
  any more, shipScore is 0 for every retailer and caps readiness at
  67 percent. ROADMAP-2026-08.md lists retiring that axis as open work.

Leftovers from the manufacturer era that still exist in the code:
- signup.html still offers a "Manufacturer" card at step 0. Choosing it
  creates an organisations row with type manufacturer and a mfr_admin
  membership, then redirects to the retired manufacturer.html stub.
- landing.html (last touched 2026-04-30) still pitches the
  manufacturer-retailer network and links to manufacturer.html.
- webhook-recall.js, docs.html and the "ERP Webhook API" card in
  Settings (dashboard.html around line 12078) only work for orgs with
  type manufacturer and an api_key. No live flow can create such an
  org except the signup leftover above.
- manufacturer-welcome.js and supplier-invite.js have no callers.

## The files
Line counts and last-modified dates are from the local working folder
on 2026-09-13. This folder is not a git checkout, so "last touched" is
the file's modification time, not a commit date. Files dated
2026-04-30 22:48 have not changed since the repo was downloaded.

Live application surfaces:
- index.html (21,976 lines, 2026-09-09): staff scanning app (PWA).
  Canonical URL is https://batchd-app.netlify.app/ (confirmed by Ian
  2026-09-13): every scanner link in dashboard.html points there, the
  installed PWAs were added from there, and the manifest start_url is
  relative, so an installed scanner lives on the origin it was
  installed from. app.batchdapp.com and www.batchdapp.com serve the
  same file byte for byte but nothing links to them; treat them as
  aliases. Moving stores to app.batchdapp.com later would orphan the
  per-origin PWA install and offline queue, so settle the URL before
  the first design partner installs. The scanner's own dashboard
  buttons (4798, 4904, 5485) point at app.batchdapp.com/dashboard.html,
  which 301s to corporate.
- dashboard.html (15,698 lines, 2026-09-11): corporate retailer
  dashboard. Served at the root of corporate.batchdapp.com; requests
  for /dashboard.html on the scanner domains 301 to corporate.
- join.html (626 lines, 2026-09-13): invitation acceptance. Reads the
  invite token via the get_invitation_by_token RPC, creates or signs in
  the user, calls accept_invitation (with a legacy client-side
  fallback), then routes staff to the scanner and admins and store
  managers to the dashboard. Reachable at /join. Fixed 2026-09-13 (found
  in Ian's live gate test): the RPC returned no HR prefill columns, so
  the form rendered empty and accept_invitation, which wrote only the
  browser's values, dropped the inviter's details. Migration 018 now
  returns the five HR fields plus region and COALESCEs client values with
  the invitation row; join.html maps them. Both must ship together: the
  edited 018 needs a re-run (it DROPs the old function signature, which
  triggers the editor's destructive-operations warning) and join.html
  needs uploading. Known polish items on this page: the prefilled block
  should render read-only when the inviter supplied the details, and the
  phone placeholder is a hardcoded +47 (jurisdiction rule).
- signup.html (1,018 lines, 2026-09-09): self-serve signup. See
  "Self-serve signup" below. Reachable at /signup.
- admin.html (942 lines, 2026-09-09): internal Batch'd platform admin.
  Gated on organisation_members.is_batched_admin. Lists organisations,
  platform health counts, creates orgs and sends invites, seeds and
  resets a demo org. Not linked from any page except the retired
  admin.batchdapp.com hostname redirect in index.html.
- lot-code-guide.html (388 lines, 2026-05-10): printable staff
  reference, linked from the Reports panel. Region via ?region=us|no.
- docs.html (453 lines, 2026-09-06): ERP webhook API docs for
  webhook-recall.js. Linked from Settings. Manufacturer-facing, see
  leftovers above.
- privacy.html (108 lines) and terms.html (94 lines), both 2026-08-06:
  legal pages, reachable at /privacy and /terms.

Public intake surfaces (no login):
- complaint.html (505 lines, 2026-05-02): consumer complaint form that
  POSTs to triage-complaint.js.
- complaint-widget.js (519 lines, 2026-05-02): embeddable version of
  the same form. Hardcodes the triage URL on www.batchdapp.com. Nothing
  in this repo references it.
- trace.html (171 lines, 2026-04-30): consumer traceability lookup
  that calls trace.js. trace.js reads product_lots and shipments,
  which nothing in the retailer-only platform writes. Effectively
  dormant.

Marketing pages, not linked from any live surface:
- landing.html (1,026 lines, 2026-04-30): old landing page with a demo
  request form that POSTs to send-invite.js. Not the site root and not
  in netlify.toml. Still serves HTTP 200 on app.batchdapp.com as of
  2026-09-13, as do recall-roi-calculator.html and trace.html.
  Whether anything external links to any of them needs verification
  (check Netlify analytics or search console) before deleting.
- recall-roi-calculator.html (1,290 lines, 2026-04-30): standalone
  recall cost calculator. No Supabase calls. Not linked anywhere.

Retired stubs (80 lines each, 2026-05-05):
- manufacturer.html, supplier.html, manufacturer-signup.html.

Not application files: README.md (2 lines), SCHEMA.md, SECRETS.md,
ROADMAP-2026-08.md, CLAUDE_DESIGN_BRIEF.md, .ui-polish-checklist.md,
docs/ARCHITECTURE.md, migrations/ (19 SQL files plus
CHECK_MIGRATIONS.sql), assets/, fonts/, netlify/functions/ (18
functions), netlify.toml, package.json (pins @supabase/supabase-js
2.112.1 for the functions).

## Domains and routing
Authority: netlify.toml. Verified rules:
- Path aliases (200 rewrites on every domain): /join, /manufacturer,
  /signup, /terms, /privacy.
- https://corporate.batchdapp.com/ serves /dashboard.html (200, forced).
- https://corporate.batchdapp.com/dashboard.html 301s to the corporate
  root.
- https://app.batchdapp.com/dashboard.html and
  https://batchd-app.netlify.app/dashboard.html 301 to
  https://corporate.batchdapp.com/.
- Scheduled functions: recall-escalation every 30 minutes,
  fetch-recall-feeds daily at 06:00 UTC.

JS hostname checks in client code (index.html lines 4 to 10, the only
routing-related ones in the repo): corporate.batchdapp.com replaces to
/dashboard.html (redundant with the toml rule, which fires first),
manufacturer.batchdapp.com to app.batchdapp.com/manufacturer.html,
admin.batchdapp.com to /admin.html, supplier.batchdapp.com to
/supplier.html. index.html line 17764 also checks for localhost to
enable the dev manager toggle. dashboard.html has no routing hostname
check.

Verified 2026-09-13 from outside the dashboard (DNS, TLS certificate
and HTTP probes, no Netlify login):
- batchdapp.com, www., app., corporate., manufacturer., admin. and
  supplier. all resolve to the same two Netlify edge IPs and all
  present the same TLS certificate (SHA256 fingerprint match,
  wildcard *.batchdapp.com plus apex). Netlify issues one certificate
  per site, so every batchdapp.com hostname is attached to ONE site.
- Made-up subdomains do not resolve, so the wildcard is only the
  certificate, not a catch-all DNS record.
- batchdapp.com 301s to www.batchdapp.com. www, app and
  batchd-app.netlify.app serve byte-identical index.html.
  corporate serves dashboard.html.
- manufacturer., admin. and supplier. still resolve and serve
  index.html at their root (HTTP 200); the JS hostname snippet in
  index.html then redirects client-side to the stub pages. The three
  stubs and admin.html all answer 200 on app.batchdapp.com.
Still needs the Netlify dashboard: SECRETS.md says two Netlify sites
deploy this repo and that the www.batchdapp.com site runs the cron
schedules (SCHEDULED_FUNCTIONS_DISABLED=true everywhere else). Since
all custom domains sit on one site, the second site must be the one
with no custom domain. Confirm which netlify.app name belongs to
which site, and that the env var is set the right way round.
The code references www.batchdapp.com only in complaint-widget.js and
in the origin allowlists of send-invite.js and supplier-invite.js.

## Self-serve signup
Self-serve signup is fully wired in signup.html, contrary to the
earlier "enterprise only" decision:
1. Step 0 picks retailer or manufacturer.
2. Step 1 calls sb.auth.signUp with full_name, user_type and region in
   user metadata. emailRedirectTo is null. Verified 2026-09-13 via
   the public /auth/v1/settings endpoint: mailer_autoconfirm is true
   and disable_signup is false, so email confirmation is OFF and new
   users are usable immediately. join.html's immediate
   signInWithPassword after signUp therefore works. If confirmation
   is ever switched on in Supabase Auth settings, invite acceptance
   in join.html fails with an explicit error message.
3. Step 2 calls the create_organisation_with_admin RPC (migration 018,
   SECURITY DEFINER) to create the organisation, the founding
   corp_admin membership and the initial stores in one call. If the
   RPC is unavailable it falls back to client-side inserts into
   organisations, organisation_members and stores. Then it upserts
   user_settings with region, recall_source both, lookback 180 days
   and onboarding_done true.
4. Step 3 optionally writes recall coordinator fields to organisations
   and can downgrade the role to store_manager.
5. Launch sends retailers to app.batchdapp.com/dashboard.html (which
   301s to corporate) and manufacturers to the retired stub.

manufacturer-signup.html is a static retired page with no form.

## Supabase
- Project: lurxucdmrugikdlvvebc.supabase.co (verified in code)
- Ian's org ID: 925923b5-22c6-433c-8812-7e32918dab66 (from Ian, not
  verifiable from code)
- Ian's user ID: 97da19d3-3daa-4f7a-bd9c-53e7ac8f8a5c (from Ian, not
  verifiable from code)
- Client library pinned to @supabase/supabase-js 2.112.1 with SRI in
  index.html, dashboard.html, join.html, signup.html and admin.html.

### Tables and RPCs referenced by code
Static scan of .from('...') and REST calls across the HTML files and
netlify/functions on 2026-09-13. Column lists per table were derived
the same way and are approximate; verify against information_schema
before relying on them.

Tables (29): code_patterns, complaint_audit_log, complaint_messages,
complaints, investigation_requests, investigation_responses,
invitations, mock_recall_drills, organisation_members, organisations,
product_lots, products, products_pending, products_public (view),
recall_acknowledgements, recall_distributions, recall_events, recalls,
scan_corrections, scan_recall_matches, scan_telemetry, scans,
shipments, store_manager_stores, stores, supplier_connections,
trading_partners, user_profiles, user_settings.

RPCs (6): accept_invitation, create_organisation_with_admin,
get_invitation_by_token, get_org_member_emails, send_invitation,
sweep_recall_matches.

Flags from the scan:
- product_lots is referenced only by trace.js. It is not in SCHEMA.md
  or any migration, but it DOES exist: verified 2026-09-13 by a
  PostgREST probe (a made-up table name returns 404 PGRST205;
  product_lots returns 200 with an empty array under the anon role).
  Same result for supplier_connections and scan_queue. Column lists
  still unverified.
- supplier_connections is referenced only by supplier-invite.js, which
  has no callers.
- shipments and trading_partners are read-only legacy (see above).
- SCHEMA.md covers only the 7 recall-flow tables. The other 22 have no
  column reference in the repo.

## Critical database rules, never violate these
- recall_resolved on the scans table defaults to false on every
  insert. Never use it to count active recalls
- scan_recall_matches.removed_at IS a real column but is NEVER WRITTEN
  by app code. Pull tracking lives on scans.removed_from_shelf_at.
  Don't rely on removed_at for "is this scan still on shelf" checks.
  Known violation: push-recall-email.js lines 192 and 207 read
  removed_at to split "units on shelf" from "confirmed pulled" in the
  alert email, so "confirmed pulled" is always 0 there.
- Feed recalls (FDA/Mattilsynet) only count as "active" if confirmed
  via the scan_recall_matches table
- Manual/push recalls count if exact lot or barcode matches an
  on-shelf scan (removed_from_shelf_at IS NULL)

## Schema reference
See SCHEMA.md (repo root) for the canonical column-by-column reference
for the 7 recall-flow tables, FK relationships, trigger/RPC inventory
and migration log. SCHEMA.md was last updated 2026-05-08 and its
migration log stops at 2026-05-07; migrations 008 to 019 in
migrations/ are newer than it. Verify against information_schema
before trusting it for columns added after May 2026.

## Schema gotchas: column names that bit us
Quick reference for the highest-impact rules. Full details in
SCHEMA.md.

- recall_distributions: retailer_org_id (NOT initiating_org_id)
- mock_recall_drills: initiated_by_org (NOT retailer_org_id). Both
  started_at and created_at exist; started_at is canonical.
- recalls: description (NOT reason). Alias via PostgREST:
  `reason:description`. The recalls table has NO severity column;
  fold severity into the description text.
- recall_events: barcode (NOT barcode_number). Has BOTH reason AND
  description; code reads them interchangeably.
- recalls.is_pushed and recalls.recall_event_id DO exist. The
  dashboard composer (_composerPushRecall) writes both on every
  pushed recall so the linked recalls row can be filtered out. Filter
  with `if (r.is_pushed || r.recall_event_id) return false;` when
  iterating "manual recalls only".
- recall_acknowledgements per-step timestamps added 2026-05-07:
  pulled_at, disposed_at, confirmed_at (alongside acknowledged_at).
  Earlier rows have NULL for the new three.
- recall_events.closed_at, closed_by, closed_note added by migration
  008. closed_at IS NOT NULL means administratively closed.

Genuine silent 400s. These COLUMNS DO NOT EXIST and a SELECT will fail
without client-visible feedback unless devtools is open:
- recall_events.is_recalled does NOT exist
- recalls.severity does NOT exist
- recalls.reason does NOT exist (use description with PostgREST alias)

## scan_recall_matches: two ID columns, two paths
The recall_id column is polymorphic for legacy reasons:
- Path A (manual / feed recalls): recall_id = recalls.id,
  recall_event_id IS NULL. Inserted by matchScanAgainstRecalls
  (index.html) and the sweep_recall_matches RPC (DB-side).
- Path B (manufacturer-pushed and composer-pushed recalls):
  recall_id = recall_events.id AND recall_event_id = recall_events.id
  (both populated for backward compat). Inserted by the login-time
  push sweep in checkRecallsOnLogin (index.html around line 10233) and
  converted from Path A by _composerPushRecall (dashboard.html around
  line 5000).

Convention added 2026-05-07 (audit fix #6):
- Querying by manual/feed recall: use .eq('recall_id', recalls.id).
  recall_event_id will be NULL on these rows.
- Querying by pushed recall: use .eq('recall_event_id',
  recall_events.id). Has a real FK to recall_events with CASCADE on
  delete.
- recall_source is the legacy discriminator ('manual', 'fda', 'rasff',
  'mattilsynet', 'manufacturer_push'). Still useful for reporting but
  no longer needed for disambiguation since recall_event_id is
  unambiguous.

## RLS policy state (pg_policies dump run by Ian, 2026-09-13)
Tenant isolation is weak everywhere except recalls, scan_recall_matches
and mock_recall_drills, which are correctly scoped to the user's orgs.
Live today, in severity order:
- invitations: "Anyone can read invitation by token" is SELECT to anon
  and authenticated with USING true. Confirmed live: a GET with the
  public anon key returns rows. Whole table dumpable, tokens included.
- organisation_members: "Insert own membership" WITH CHECK only
  user_id = auth.uid(). organisation_id and role unconstrained, so any
  signed-up user can insert themselves as corp_admin of any org. Org
  ids are enumerable because organisations is readable by all.
  "Admins can update org memberships" has no role check. "Delete own
  memberships" exists. Migration 017's trigger guards UPDATE only.
- scans: "Authenticated select scans" USING true, "Allow authenticated
  users to update any scan" USING true, two open INSERT policies with
  CHECK true. Org-scoped equivalents exist beside them (Members can
  view their org scans, Staff can update their org scans, Staff update
  org scans which is an INSERT requiring active membership). The
  master-context claim that open UPDATE is needed for pull-from-shelf
  is covered by the org-scoped update policy.
- stores: open SELECT (two policies), open UPDATE, open INSERT, plus
  "Managers can manage stores" (ALL for any user_profiles.is_manager,
  cross-org). Org-scoped "Admins and managers can manage stores" and
  "Members can view their org stores" exist beside them.
- recall_distributions: SELECT and INSERT both open. Open INSERT lets
  any user distribute any recall event to any org, which would make it
  readable there and inject an alert.
- recall_acknowledgements: "Service can insert" WITH CHECK true. The
  org-scoped ALL policy already covers member inserts.
- organisations: "read all" and "search" SELECT USING true (exposes
  api_key and coordinator contacts of every org), INSERT CHECK true.
- recall_events: open read policy dropped 2026-09-13 (see above). No
  INSERT policy admits a corp_admin inserting is_drill = false, yet one
  such composer row exists in Ian's org; whether the composer works
  today needs a live test.
Fix already staged in the repo for the first two items: migration 018
(SECURITY DEFINER onboarding RPCs, additive) and 019 (drops the four
membership and invitation policies; run only after 018 is applied and
the deployed join.html and signup.html have been tested). As of
2026-09-13, 019 has NOT run (its target policies are still present).
018 IS applied: get_invitation_by_token answers 200 with the anon key
(PostgREST returns PGRST202 for a wrong parameter list as well as for a
missing function, so probe RPCs with their real parameter names).
Whether the 2026-09-11 accept_invitation fix was re-run is unknown;
re-running 018 is safe (CREATE OR REPLACE). CHECK_MIGRATIONS.sql
reports APPLIED or MISSING for every migration.
The remaining tables need a further migration (020, not yet written).
Code preconditions verified for it: every scanner scan insert spreads a
payload that sets organisation_id (index.html 9344); the dashboard store
insert carries organisation_id; the scanner's manager store-admin tab
does NOT (list at index.html 18980 is unscoped, insert at 19055 has no
organisation_id) and must be fixed before stores are locked down;
join.html gets the org name from the RPC; dashboard source-org name
lookups (2792, 3451, 9978, 13800) read other orgs' rows and need a
narrow policy or a fallback; admin.html relies on open reads for its
platform-wide views and needs platform-admin policies keyed on
organisation_members.is_batched_admin.

## Recall counting rules (platform-wide)
A recall requires action only when ALL THREE are true:
1. The recall is active (active = true)
2. At least one org scan matches by exact lot or barcode
3. That matched scan is still on shelf
Mock drills never count toward active recall numbers.

## Recall checks must read both sources
Every recall check must read the recalls table (manual and feed) AND
recall_events joined through recall_distributions on retailer_org_id
(pushed). This has regressed before. Status on 2026-09-13:

Reads both sources:
- index.html: loadMultiStoreOverview (7710), checkPrePlacementRecall
  (8095), checkRecallsOnLogin (10084), loadHistory (10906),
  runQuickCheck (11850), loadRecallsView (21678), and
  checkActiveRecalls when it is passed _cachedActiveRecalls (10947).
- dashboard.html: traceLot (2212), _renderOverviewLegacy (2722),
  renderRecalls (3429), renderCommandCenter (6113), renderReports and
  fetchReportData (10389, 10683), runLotCheck (11448),
  renderConsumerNotification (15068).
- netlify/functions: push-recall-email.js, trace.js.

Reads the recalls table only:
- index.html: loadRecallsList (10520) and loadMgrRecalls (19152), both
  manual-recall management lists; buildShiftSummary (12231);
  generateAuditReport (12409); loadMgrData (17873, but it also loads
  scan_recall_matches, which holds Path B rows); checkActiveRecalls
  when called without a cache (callers at 9781, 10466, 11802, 19233).
- dashboard.html: renderIntelligencePanel (1374) reads recall_events
  only, not recalls.

Also note: renderCommandCenter's recall_events query (dashboard.html
6114) filters on is_drill and closed_at but has no organisation
filter. It relies on RLS or on the acknowledgements join to scope
results. Verified 2026-09-13 from pg_policies: RLS is enabled on
recall_events, but a policy named "Authenticated users can read all
recall events" (SELECT, USING true) lets any signed-in user of any
org read every recall event on the platform. Permissive policies OR
together, so the org-scoped SELECT policies (distributed to the org
via recall_distributions.retailer_org_id, or source_org_id in the
user's orgs) do nothing until that policy is dropped. Reads that
currently return other orgs' events: renderIntelligencePanel (1374,
product and lot rows rendered), traceLot (2212, rendered; its comment
calls recall_events "global by design", a manufacturer-era
assumption), renderCommandCenter (6114, ids only) and
_loadClosedEventIds in index.html (5588, ids only). Feed recalls
land in the recalls table per org, not in recall_events, so nothing
in the retailer flow needs a cross-org read. FIXED 2026-09-13: Ian
dropped that policy in the Supabase SQL editor (first attempt hit a
40P01 deadlock against a concurrent dashboard read; the retry with
set local lock_timeout succeeded). Five policies remain on
recall_events: "Manufacturers can manage their recall events" (ALL),
"Orgs can insert drill recall events" (INSERT, is_drill = true),
"Retailers can view recall events distributed to them" and
"Retailers can view recall events targeting them" (SELECT, identical
USING clauses, one is a harmless duplicate), and "Source org can read
their own recall events" (SELECT). These cover composer pushes and
drills (both insert source_org_id = _orgId) and distributed events.
Side effect: admin.html's "Total recall events" count is now the
admin's visible events, not the platform total. The unscoped reads
listed above still exist in code and now rely on RLS; explicit org
scoping is optional hygiene.
Open question from the same dump: the only INSERT paths on
recall_events for non-manufacturer roles are "Orgs can insert drill
recall events" (WITH CHECK is_drill = true) and the manufacturer ALL
policy, yet _composerPushRecall inserts is_drill = false as a
corp_admin. Whether that insert succeeds in production needs
verification.
Anon (signed-out) reads return an empty array from recall_events,
recalls, recall_distributions, scans and organisations.
products_public returns rows to anon, presumably intentional.

## Known bugs, status verified 2026-09-13
- Duplicate recall alerts on login (five copies): fixed in code.
  checkRecallsOnLogin (index.html 10074 to 10332) filters scans by
  organisation_id (10153) and recalls by organisation_id (10084),
  collapses recall_distributions to one row per recall_event_id
  (10093 to 10102), then dedupes by product+lot (10137) and by recall
  id (10215). A production login test would confirm the symptom is
  gone.
- Reports panel is six placeholder cards: no longer true.
  renderReports (dashboard.html 10375) renders six cards with live
  stats, and runReport (10751) and downloadReport (11151) implement
  all six keys (audit, staff, stores, recalls, exposure, fsma) with
  print and CSV output.
- push-recall-email.js may not handle recall_events: it does. Lines 94
  to 142 load the recall_events row, its distributions and the
  affected orgs. The real defect is the exposure block (lines 184 to
  211), which reads scan_recall_matches.removed_at, a column never
  written by app code, so the email always reports 0 pulled. The
  function is only called by webhook-recall.js; the dashboard composer
  sends its alert through notify-event.js instead.
- Compliance panel scores hardcoded: not true. loadComplianceData
  (dashboard.html around 9300 to 9413) computes docScore from lot
  capture rate, traceScore from region-specific KDE fields,
  recallScore from a 20-point base plus 15 for real acknowledgements,
  20 for progressed acks, 35 for a drill in the last 12 months and 10
  for a named coordinator (capped at 100), coverageScore from stores
  active recently, and overallScore as the mean of the four. The
  weights are constants; the inputs are live data.
- Store manager views match on store_name: mostly moved to store_id
  with a deliberate store_name fallback for legacy scans that have no
  store_id. dashboard.html 8146 to 8152 and 12512 prefer store_id and
  fall back to store_name; 2890 and 10721 match either. index.html
  17862 to 17870 uses a server-side OR on store_id or store_name for
  the manager view; 9597, 12404 and 12776 prefer store_id. The Scan
  History store dropdown filter (dashboard.html 8361) still compares
  store_name because it is a name-keyed UI filter.

## Netlify functions (netlify/functions)
All functions read secrets from environment variables. SUPABASE_URL is
optional everywhere (falls back to the hardcoded project URL). URL is
set by Netlify automatically.

| Function | Purpose | Auth | Env vars | Called by |
|---|---|---|---|---|
| ai-analyze.js | Anthropic proxy: synthesize_investigation, nl_query | Bearer JWT, must be an org member | ANTHROPIC_API_KEY, SUPABASE_SERVICE_KEY | dashboard.html |
| bootstrap-off-seed.js | One-off Open Food Facts seed into products_pending | BOOTSTRAP_ADMIN_TOKEN | BOOTSTRAP_ADMIN_TOKEN, SUPABASE_SERVICE_KEY | Nothing in the app (docs/ARCHITECTURE.md only) |
| fetch-recall-feeds.js | Daily FDA + Mattilsynet import into recalls per org | Scheduled, not URL-callable | SUPABASE_SERVICE_KEY, SUPABASE_URL, SCHEDULED_FUNCTIONS_DISABLED, URL | netlify.toml schedule; calls recall-feeds |
| investigation-notify.js | Investigation request emails plus AI photo analysis | Bearer JWT corp_admin | ANTHROPIC_API_KEY, RESEND_API_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL | No caller found in repo |
| manufacturer-welcome.js | Welcome email for manufacturer signups | None | RESEND_API_KEY | No caller (retired flow) |
| notify-consumers.js | Consumer recall notification emails | Bearer JWT corp_admin of org_id | RESEND_API_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL | dashboard.html |
| notify-event.js | Per-event emails: recall_pushed, complaint_filed, drill_scheduled | INTERNAL_NOTIFY_SECRET or Bearer JWT | APP_BASE_URL, INTERNAL_NOTIFY_SECRET, RESEND_API_KEY, SUPABASE_SERVICE_KEY | dashboard.html, triage-complaint.js |
| ocr.js | Anthropic vision proxy: identify_product, read_barcode, localise_lot, extract_codes, extract_raw_cluster | Bearer JWT, org member | ANTHROPIC_API_KEY, SUPABASE_SERVICE_KEY | index.html (callOcrFunction, 5536) |
| push-recall-email.js | Recall alert emails to org contacts, both recall sources | INTERNAL_NOTIFY_SECRET or Bearer JWT corp_admin | INTERNAL_NOTIFY_SECRET, RESEND_API_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL | webhook-recall.js only |
| recall-escalation.js | 2h and 24h escalation emails for unacknowledged recalls | Scheduled, not URL-callable | RESEND_API_KEY, SCHEDULED_FUNCTIONS_DISABLED, SUPABASE_SERVICE_KEY, SUPABASE_URL | netlify.toml schedule |
| recall-feeds.js | Proxies rasff, mattilsynet_rss, mattilsynet_page feeds to XML | None | None | index.html, fetch-recall-feeds.js |
| recall-reminder.js | On-demand reminder emails for the dashboard buttons | Bearer JWT, active corp_admin of orgId | RESEND_API_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL | dashboard.html |
| send-invite.js | Staff invitation emails and demo request notifications | Origin or Referer allowlist | RESEND_API_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL | dashboard.html, admin.html, landing.html |
| supplier-invite.js | Creates supplier_connections rows and emails invites | Origin allowlist | RESEND_API_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY | No caller (retired flow) |
| trace.js | Public traceability lookup for trace.html | None (public) | SUPABASE_SERVICE_KEY, SUPABASE_URL | trace.html |
| triage-complaint.js | Complaint intake, AI triage, follow-up emails | None (public form) | ANTHROPIC_API_KEY, INTERNAL_NOTIFY_SECRET, RESEND_API_KEY, SUPABASE_SERVICE_KEY, URL | complaint.html, complaint-widget.js, dashboard.html, index.html |
| webhook-recall.js | ERP webhook: creates recall_events and distributions for manufacturer orgs | X-Batchd-Api-Key matching organisations.api_key, type manufacturer | ANTHROPIC_API_KEY, INTERNAL_NOTIFY_SECRET, SUPABASE_SERVICE_KEY | External ERP systems (documented in docs.html) |

Notes:
- fetch-recall-feeds.js line 143 contains a stray control character.
  Node parses the file fine, but grep treats it as binary; use
  `grep -a` when searching it.
- The header comment in fetch-recall-feeds.js says it is also callable
  from the dashboard. No client code calls it, and scheduled functions
  cannot be invoked by URL.
- Model IDs in ai-analyze.js and ocr.js pin claude-sonnet-4-20250514;
  ocr.js, triage-complaint.js and investigation-notify.js also use
  claude-haiku-4-5-20251001.

## Security posture (client-side scan 2026-09-13)
Scanned every .html and .js file in the repo root for JWTs, API keys,
service-role keys, webhook URLs and password literals.
- One Supabase JWT appears in admin.html (262), dashboard.html (1191),
  index.html (5514), join.html (151) and signup.html (605). It is the
  same token in all five and its payload says role anon. Expected.
- _MAPTILER_KEY in dashboard.html (5918) is a publishable map-tile
  key, origin-locked per SECRETS.md. Expected.
- The Sentry browser-loader URL in index.html, dashboard.html,
  join.html and signup.html carries Sentry's public loader key.
  Expected.
- No Anthropic, Resend, service-role, Slack or Discord secrets found
  in client code. ANTHROPIC_API_KEY is read only inside
  netlify/functions (ai-analyze, ocr, triage-complaint,
  investigation-notify, webhook-recall).
- The only non-secret fallbacks in functions are the Supabase project
  URL, the corporate dashboard URL and the scanner site URL.
- Rotation runbook: SECRETS.md.

## Market & jurisdiction
- Primary market: United States (FSMA 204 compliance)
- Testing ground: Norway (EU 178/2002)
- Ian is a US citizen living in Norway temporarily

## Jurisdiction precedence (critical: never mix jurisdictions)

Batch'd is a regulatory-assistance platform. The product must never
display regulatory copy, regulator names, phone prefixes, currency,
retention rules or compliance frameworks from one jurisdiction while
the user is assigned to another. A US user must never see Mattilsynet
phrases, Norwegian phone prefixes, EU 178/2002 references or kr
currency, and vice versa. Cross-user consistency matters for
investigation timelines: every seat in an org must render the same
audit timestamps, regulator citations and date formats so a recall
post-mortem isn't ambiguous about who saw what.

### Source of truth (admin-controlled, two writers only)

Updated 2026-05-26. Region is set ONLY by the corp admin, never by the
user themselves. There are exactly two places region can be written:

1. Organisation default: organisations.region. Editable in
   Settings, Organisation, Region (corp_admin only). Applied to every
   new invitee unless the admin overrides it at invite time.
2. Per-invitee override: invitations.region. Picked in the Staff
   invite form's "Default region" field. Written to
   user_settings.region when the invitee accepts. Useful for a
   multi-region operator inviting, for example, a Norwegian staff
   member into a US-default org.

Once a user accepts an invite, their user_settings.region is locked.
The per-user region pickers in Settings, Your preferences (dashboard)
and in the scanner's Settings overlay were both removed 2026-05-26
along with the saveRegion() and _setPrefRegion() handlers (verified
absent on 2026-09-13). The user_settings.region column is still read
at sign-in but is no longer writable from any user-facing control.
signup.html still writes user_settings.region once, at org creation,
for the founding admin.

### How the variables resolve

| Variable | Source | Meaning | Used by |
|---|---|---|---|
| `_orgDefaultRegion` | `organisations.region` | The org's stated default | Only the Settings, Organisation card dropdown (so the org admin can see and edit it) |
| `_orgRegion` | `user_settings.region` ?? `organisations.region` | Effective region for the signed-in user. Admin-assigned (org default at signup, or invitations.region override at accept time), not user-changeable | Everything else in the dashboard: all regulatory copy, FSMA/EU references, regulator contacts, retention rules, recall coordinator notes, terminology entries, currency, date format, phone prefix examples |
| `_userRegion` (scanner) | mirrors `user_settings.region` | Same value as `_orgRegion` on the dashboard side, used by the scanner | All region-dependent surfaces in the scanner (FSMA tab visibility, region badge, dateSep and formatDate, and so on) |

### The rules

1. Every line of regulatory copy gates on `_orgRegion` (dashboard) or
   `_userRegion` (scanner), never on `organisations.region`,
   `_orgDefaultRegion` or a hardcoded region literal. Inline ternaries
   like `_orgRegion === 'us' ? 'FDA 21 CFR 7.49' : 'Mattilsynet §16'`
   are the canonical pattern.
2. Date format is locked to region. No separate user setting.
   `_dashLocale()` (dashboard) and `dateSep` / `formatDate` (scanner)
   derive the format from the region variable. The
   `user_settings.date_format` column added by migration 012 is
   preserved for backward compat but is never written from app code.
3. The org-level dropdown in Settings, Organisation is the ONLY surface
   that reads `_orgDefaultRegion`. Everywhere else: `_orgRegion`.
4. When an admin changes the org region, `saveOrgSettings()` also syncs
   the admin's own `user_settings.region` to the new value (and clears
   `user_settings.date_format`) so their own view follows the change
   immediately, and re-renders the active panel so on-screen regulator
   copy updates without navigation. Other users in the org keep
   whatever region they were assigned at invite time; bulk
   re-assignment would be a separate explicit action.
5. Never construct regulatory copy by string-mixing fields from
   different regions. If you find a card pulling, for example,
   coordinator contact from one region and the regulator name from
   another, that's a bug. Both come from the same `_orgRegion` switch.

### Things that get region-switched (non-exhaustive)

- Regulator name (FDA / Mattilsynet)
- Statute citations (21 CFR 7.49 / Mattilsynet §16, FSMA 204 /
  EU 178/2002)
- Phone prefix examples (`+1` / `+47`)
- Retention windows (24 months FSMA / shelf-life plus 6 months Matloven)
- Compliance score thresholds and category labels
- Severity labels (Class I/II/III vs Klasse I/II/III)
- Regulator portal URLs (access.fda.gov / mattilsynet.no)
- Date format (`MM/DD/YYYY` US vs `DD.MM.YYYY` NO)
- Terminology page entries
- Recall feed sources (FDA enforcement reports / Mattilsynet RSS)

If you add a feature that touches any of these, the region gate must
live at the leaf, not at a panel level, so changing region re-renders
the leaf correctly.

## Design system v2 (Claude Design handoff, 2026-05)

Source of truth: `/assets/design-tokens.css` (the canonical file from
the Claude Design bundle). Both `dashboard.html` and `index.html`
embed the same tokens inline. Keep them in sync.

### Token architecture, two layers
- Layer 1 (semantic): `--accent-primary`, `--text-primary`,
  `--background-base/-surface/-elevated/-input`,
  `--border-default/-strong/-focus`, `--semantic-danger/-warn/-info`,
  `--shadow-xs/-sm/-md/-lg/-xl/-accent`, `--ring-focus`. Use these in
  new code.
- Layer 2 (legacy aliases): `--bg`, `--surface`, `--text`, `--muted`,
  `--accent`, `--danger`, `--warn`, `--info`, and so on resolve to
  Layer 1 via aliases at the bottom of each file's `:root` block.
  Existing markup keeps working unchanged.

### Color palette
| Token | Dark (canonical) | Light (opt-in) |
|---|---|---|
| `--background-base` | `#080F12` deep green-black | `#F5F7F6` warm off-white |
| `--background-surface` | `#0D1E1C` (+1 elevation) | `#FFFFFF` |
| `--background-elevated` | `#13302B` (+2 elevation) | `#FFFFFF` plus `--shadow-md` |
| `--text-primary` | `#EAF6F0` off-white (NEVER `#FFFFFF`) | `#0E1F1A` deep green-black |
| `--accent-primary` | `#34D399` mint | `#077A55` emerald |
| `--semantic-danger` | `#FF6B6B` | `#DC2626` |
| `--semantic-warn` | `#F5A623` | `#BE5A0E` |
| `--semantic-info` | `#5BC9F8` | `#057AAB` |

### Hard rules (non-negotiable)
- Dark never uses `#000000` (eye strain on emissive screens). Use
  `var(--background-base)` (`#080F12`).
- Dark text never uses `#FFFFFF` (optical vibration). Use
  `var(--text-primary)` (`#EAF6F0`).
- Light is NOT an inversion. Hues are darkened and desaturated so
  contrast holds against white.
- Theme is `<html data-theme="dark|light">`, persisted in
  `localStorage`. NEVER switch via `prefers-color-scheme`. This is a
  compliance product; theme is an explicit operator decision.
- No emoji, except the US, EU and Norway flag glyphs used as
  regulatory region markers. The codebase does not comply everywhere
  yet (the Reports cards, for example, still use emoji icons);
  .ui-polish-checklist.md tracks the sweep.
- No purple or blue gradients. No left-border accent cards.
- One saturated color: mint or emerald. Red, orange and blue are state
  signals, never decoration.

### Translucent tints: `--*-rgb` triples
For inline `rgba(...)` translucent backgrounds, chips and banners, use
`rgba(var(--accent-rgb), 0.1)` and so on. Both themes override the RGB
triples so the same alpha gradient recolors correctly per theme.
Tokens: `--accent-rgb`, `--accent-deep-rgb`, `--danger-rgb`,
`--warn-rgb`, `--info-rgb`, `--info-light-rgb` (and dashboard adds
`--accent-alt-rgb`, `--accent-muted-rgb`, `--info-soft-rgb`,
`--surface-tint-rgb`).

### Typography
- Display and body: Figtree (Google Fonts: 400, 500, 600, 700, 800,
  900). `Figtree-ExtraBold.ttf` (weight 800) is self-hosted from
  `/fonts/` as the brand weight; other weights load from Google Fonts
  CDN.
- Mono: DM Mono (300, 400, 500). Used for eyebrows, form labels,
  micro-meta, badges. UPPERCASE plus letter-spacing for these.
- Type ladder: `--fs-eyebrow 11 / --fs-label 10 / --fs-meta 12 /
  --fs-body 13 / --fs-body-lg 15 / --fs-h4 17 / --fs-h3 22 /
  --fs-h2 28 / --fs-h1 46 / --fs-hero clamp(40px, 7vw, 80px)`.
- Line-height: `--lh-tight 1.05` (H1/hero) / `--lh-snug 1.20`
  (H2/H3) / `--lh-body 1.65` (body) / `--lh-loose 1.75` (long-form).
- Weights as variables: `--fw-regular/-medium/-semibold/-bold/
  -extrabold/-black`. Don't pass raw numbers.

### Spacing, radii, motion
- Spacing (4px base): `--s-1` (4px) through `--s-32` (128px).
- Radii: `--r-xs 6 / -sm 8 / -md 10 (button/input) / -lg 12 (card) /
  -xl 16 / -2xl 20 / -pill 999`.
- Motion: `--dur-fast 0.15s / -normal 0.20s / -slow 0.40s`. Easings:
  `--ease-out` default, `--ease-snap` for state transitions. No
  bounces, no springs, no parallax.

### Iconography
Hand-rolled inline SVG, stroke-only, `stroke-width: 2` to `2.5`,
`currentColor`, 24x24 viewBox at 14 to 22px. Visual family: Lucide or
Feather. Triangle-with-exclamation is the canonical recall-alert glyph
(left nav, Push-a-Recall button, all recall surfaces).

### WCAG 2.1 AA, required, not aspirational
- Body text at least 4.5:1. Large text at least 3.0:1. Non-text UI at
  least 3.0:1.
- Focus rings use `var(--ring-focus)`: 2px base offset plus 2px accent.
- Audit grid: `preview/theme-contrast-pairs.html` in the design bundle
  (not in this repo).

### Voice and copy
- Statements over slogans. Brand line: "When a recall fires, every
  second counts."
- Numbers are load-bearing. Use them in headlines (24h, 4.5:1, and so
  on).
- Procedural verbs: push, match, acknowledge, confirm, pull, dispose,
  audit. Never marketing-ese ("revolutionary", "synergy").
- Sentence case for body, buttons, links.
- UPPERCASE plus DM Mono plus 0.06 to 0.12em tracking for eyebrows,
  form labels, badges.
- Person: "you" for the reader; "Batch'd" as third-person actor; never
  "we" in product copy.
- No em dashes in product copy or docs.

### Files and assets
- `/assets/design-tokens.css`: canonical token source. Don't edit the
  HTML inline copies first; update this, then mirror.
- `/assets/batchd-logo-mark.svg` (dark bg) and
  `/assets/batchd-logo-mark-dark.svg` (light bg): 2x2 grid mark.
- `/assets/batchd-wordmark.svg`: Figtree-900 wordmark.
- `/assets/batchd-square-logo.png`: social square logo.
- `/assets/favicon.png`, `/assets/icon-192.png`, `/assets/icon-512.png`,
  `/assets/apple-touch-icon.png`: PWA and favicons. Copies of the
  favicon and icons also sit in the repo root because index.html
  references `/favicon.png` and `/apple-touch-icon.png` directly.
- `/fonts/Figtree-ExtraBold.ttf`: self-hosted brand weight (loaded via
  `@font-face` in both HTML files).

### Out of scope (kept as Phase 2)
The inline `style="..."` attributes scattered across both files still
reference legacy token names. They keep rendering correctly via the
alias bridge but should be migrated to semantic tokens incrementally
for new components. Don't try to do a sweep; the migration is
incremental per feature.

## UI conventions
- Every panel has exactly ONE page title: the topbar text set by the
  `panels` mapping in showPanel() (dashboard.html around line 2122).
  Inner page bodies should NOT add a duplicate h1 row. Subtitles
  (instructional text, regulatory context, dynamic stats) are fine and
  encouraged.
- Topbar labels in `panels` should match the sidebar nav text exactly,
  for example sidebar "Store Network" gives topbar "Store Network",
  not "Stores". Current mapping: overview "Dashboard", onboarding
  "Getting started", recalls "Recalls", stores "Store Network",
  traceability "Scan History", staff "Staff Activity", compliance
  "Compliance", reports "Reports and Exports", settings "Settings",
  triage "Complaint Triage", consumer-notify "Consumer Notify",
  investigations "Investigations", terminology "Terminology & Help",
  lotcheck "Lot Lookup", recall-detail "Live Recall", recall-composer
  "Compose recall".

## Scale notes
- index.html and dashboard.html are single-file apps. index.html has
  a 3,316-line inline style block (lines 59 to 3375) and 416 top-level
  functions; dashboard.html has a 1,003-line style block (26 to 1029)
  plus ten smaller ones and 196 top-level functions.
- Design tokens are duplicated by design in index.html, dashboard.html
  and assets/design-tokens.css.
- Only three top-level function names are shared between index.html
  and dashboard.html (esc, showToast, signOut); admin.html shares
  doAuth, showAuthMsg, showPanel, signOut and updateClock with the
  dashboard. There is no shared JS module; each file is standalone.
- index.html still loads html5-qrcode from unpkg although nothing
  calls it (the comment at line 41 says so). tesseract.js was removed
  2026-08-05; its tag remains only inside an HTML comment. The retired
  Phase 2 OCR helpers stay in the file for revert; ocr.js is still
  called live for identify_product.
- Dead or dormant files: landing.html, recall-roi-calculator.html,
  trace.html, complaint-widget.js, manufacturer-welcome.js,
  supplier-invite.js, bootstrap-off-seed.js and the three retired
  stubs. Nothing in the repo references the first four.

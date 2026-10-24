# Batch'd build history (frozen 2026-10-24)

This is the full CLAUDE.md as it stood on 2026-10-24, kept word for word
when CLAUDE.md was cut down to rules, current state and gotchas. It holds
the phase-by-phase build log of the FSMA 204 handoff, every follow-up pass,
the 2026-09-13 verification notes and the old RLS policy dump.

It is not maintained. Where it disagrees with CLAUDE.md, CLAUDE.md wins.
Line numbers in it refer to the files as they were when each note was
written. New history goes in docs/CHANGELOG.md, not here.

---

# Batch'd Platform

Verified against the repo on 2026-09-13. Where a fact could not be
confirmed from the code it is marked "needs verification" with a note
on what would settle it.

## Decision 2026-09-29: United States only
Batch'd has abandoned the Norwegian market entirely for the foreseeable
future. Every new feature, string, export, drill script and doc is for
US grocery retail under FSMA 204. The US/NO region system described in
"Jurisdiction precedence" below is FROZEN, not removed:
- Never add a Norwegian branch, string, regulator, statute, currency,
  phone prefix or date format to new code. Where an existing helper
  forces two branches, pass the US string to both and comment
  `// US-only (2026-09-29): NO branch intentionally identical`.
- New organisations always get region 'us' and recall_source 'fda'.
  DONE 2026-09-29 (Phase 0): signup.html hardcodes region 'us', sets
  organisations.recall_source to 'fda' right after the RPC creates the
  row, and writes user_settings.recall_source 'fda'; the region picker
  is gone from signup, from the Settings Organization card
  (saveOrgSettings writes the stored value back unchanged) and from the
  staff invite form (invitations.region stays NULL, so invitees inherit
  the org default). Columns stay. To move an existing org to US, run
  `update organisations set region = 'us' where id = '<org id>';` and
  the same on that org's user_settings rows.
- Existing NO rows keep working through the old branches. Do not rip
  the region layer out; it is a large risky edit with no customer
  payoff. Do not fix Norwegian copy defects.
- The Mattilsynet feed code stays but is unused by new orgs.
- Market entry is the two-category wedge (bagged leafy greens and nut
  butters, both on the FDA Food Traceability List). The build spec is
  the project doc claude/batchd-fsma204-niche-implementation-handoff.md.

## Who I am building with
Ian Race, not a developer. Always provide complete, ready-to-use
files. Never partial diffs or code snippets to manually insert.

## The golden rules
- Write in American English, never British English. This applies to
  UI copy, emails, docs and every reply to Ian (color, organization,
  license, center). Do not rename existing code identifiers, table or
  column names that use British spelling (for example the
  organisations table), since that would break the database and code.
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
  domain split. There is no _redirects file. netlify.toml also carries
  the security headers, the forced 404s that keep CLAUDE.md, SECRETS.md,
  SCHEMA.md, migrations/ and docs/ off the public site (2026-09-20) and,
  since 2026-10-08, netlify/ as well (function source was being served as
  static files), and `node_bundler = "esbuild"` for netlify/lib/auth.js. The JS hostname snippet at
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
- signup.html's "Manufacturer" card was REMOVED 2026-09-20 and
  create_organisation_with_admin now rejects p_type 'manufacturer'
  (migration 020). No live flow can create a manufacturer org any more.
  signup.html's checkExistingSession still routes an EXISTING mfr_admin
  to the stub, because such rows exist in the database.
- landing.html (last touched 2026-04-30) still pitches the
  manufacturer-retailer network and links to manufacturer.html.
- webhook-recall.js and docs.html only work for orgs with type
  manufacturer. The "ERP Webhook API" card in Settings was replaced on
  2026-10-09 by a retailer "Data in and out" panel (delivery file import,
  FSMA 204 export); docs.html is still served but nothing links to it.
  Since 2026-09-20 the key is matched by sha256 hash against
  organisation_api_keys (migration 021); organisations.api_key is nulled
  but the column stays, so admin.html's `select *` still works. No live
  flow can create a manufacturer org any more.
- manufacturer-welcome.js and supplier-invite.js were deleted
  2026-09-20 (no callers).

## The files
Line counts and last-modified dates are from the local working folder
on 2026-09-13. This folder is not a git checkout, so "last touched" is
the file's modification time, not a commit date. Files dated
2026-04-30 22:48 have not changed since the repo was downloaded.

Live application surfaces:
- index.html (about 22,900 lines after the 2026-10-07 follow-ups): staff scanning app (PWA).
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
- dashboard.html (about 17,500 lines after Phase 7, 2026-10-07): corporate retailer
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
  needs uploading. Both polish items on this page are done: the phone
  placeholder became +1 in Phase 0, and since 2026-10-07 the profile
  fields the inviter supplied render read-only (see "Follow-ups shipped
  2026-10-07").
- signup.html (about 1,080 lines after Phase 5, 2026-10-07): self-serve signup. See
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
  legal pages, reachable at /privacy and /terms. Found 2026-09-29:
  terms.html existed only in Ian's local folder, so /terms returned 404
  while signup.html and privacy.html linked to it. RESOLVED: it went up
  with the 2026-10-07 American English sweep; on 2026-10-11 the blob
  matches GitHub main and /terms answers HTTP 200.

Public intake surfaces (no login):
- complaint.html (505 lines, 2026-05-02): consumer complaint form that
  POSTs to triage-complaint.js.
- complaint-widget.js (519 lines, 2026-05-02): embeddable version of
  the same form. Hardcodes the triage URL on www.batchdapp.com. Nothing
  in this repo references it.
- trace.html: RETIRED 2026-09-20. Renders a static notice and makes no
  network call; /.netlify/functions/trace answers 410. It was an
  unauthenticated service-role read over legacy tables.

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
docs/ARCHITECTURE.md, migrations/ (30 SQL files, 001 to 030 with 020a and
without 027, plus CHECK_MIGRATIONS.sql), assets/, fonts/, netlify/functions/ (18
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
CORRECTED 2026-09-21: **THREE** Netlify sites deploy this repo, not two.
All three show github.com/ian-w-race/batchd-platform as their
repository (verified in the Netlify UI). Earlier notes here and in
SECRETS.md said two; that was wrong.

Consequences:
- Every environment variable this repo's functions read must exist, with
  the same value, on ALL THREE sites. INTERNAL_NOTIFY_SECRET especially:
  push-recall-email fails closed without it.
- netlify.toml arms the recall-escalation (every 30 min) and
  fetch-recall-feeds (daily) schedules on EVERY site that deploys it, so
  SCHEDULED_FUNCTIONS_DISABLED=true must be set on two of the three.
  If it is missing on more than one, stores receive duplicate escalation
  emails; if it is true on all three, neither job runs at all. Needs
  verifying in the Netlify UI.
- The host-scoped redirects in netlify.toml are host-exact, so any
  netlify.app name not named there serves dashboard.html and admin.html
  without the canonicalizing 301s. Not an auth hole (the same sign-in
  applies) but it is an extra unlinked surface.
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

Tables (34 after migrations 022 to 026 are applied; 29 referenced by
code on 2026-09-13 plus ftl_overrides, receiving_events,
records_requests, suppliers, traceability_plans): code_patterns,
complaint_audit_log, complaint_messages,
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

## Migrations 020 and 021 (security hardening, 2026-09-20)
Written but NOT applied by the code change. Order matters:
- `019_lock_down_membership_policies.sql` (pre-existing, still unapplied
  as of 2026-09-13) runs first.
- `020_helpers_membership_ai_flag.sql` runs next and before the deploy.
  Org-parameterised SECURITY DEFINER helpers (batchd_my_active_org_ids,
  batchd_is_corp_admin_of, batchd_is_manager_of, batchd_is_platform_admin,
  batchd_org_ai_enabled and friends), insert/update guard triggers on
  organisation_members, corp-admin-only policies on invitations, the
  organisations.plan CHECK plus its guard trigger, hardened
  create_organisation_with_admin / accept_invitation /
  get_invitation_by_token (same signatures as 018), the new
  get_invitation_store_names RPC, and complaints.ip_hash.
- `021_tenant_tables_lockdown.sql` runs only AFTER the deploy is live on
  both Netlify sites. It drops every open policy on scans, stores,
  organisations, recall_distributions and recall_acknowledgements,
  replaces them with org-scoped ones, locks user_profiles to its owner,
  moves ERP API keys into the service-role-only organisation_api_keys
  table as sha256 hashes (organisations.api_key is nulled but kept), and
  moves retailer-targeted complaints onto receiving_org_id.

Both run in one transaction and are re-runnable. Full sequence, manual
steps and acceptance checks: `docs/SECURITY-ROLLOUT-2026-09.md`.

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
reports APPLIED or MISSING for every migration. Ian ran it on
2026-10-11: every row APPLIED, including 007 and 017 (MISSING on
2026-09-13), 020a (no org on the trial plan) and 029 and 030.
The remaining tables need a further migration (020, not yet written).
Code preconditions verified for it: every scanner scan insert spreads a
payload that sets organisation_id (index.html 9344); the dashboard store
insert carries organisation_id; the scanner's manager store-admin tab
does NOT (list at index.html 18980 is unscoped, insert at 19055 has no
organisation_id) and must be fixed before stores are locked down (fixed
since: on 2026-10-11 the scanner's store list, insert and updates all
carry organisation_id, index.html around 20240 to 20331);
join.html gets the org name from the RPC; dashboard source-org name
lookups (2792, 3451, 9978, 13800) read other orgs' rows and need a
narrow policy or a fallback; admin.html relies on open reads for its
platform-wide views and needs platform-admin policies keyed on
organisation_members.is_batched_admin.

## Phase 0 of the FSMA 204 handoff (shipped locally 2026-09-29)
Spec: Claude outputs/batchd-fsma204-niche-implementation-handoff.md,
Phase 0, adjusted for the US-only decision (the Norwegian half, the
4-hour EU tooltip and the Matloven citations, was dropped). What changed:
- Reportable Food Registry copy. Every surface that told a retail store
  to file with the RFR within 24 hours now says the recalling firm
  notifies the FDA district recall coordinator (21 CFR 7.46) and the
  store pulls, holds and documents. Dashboard: compliance category tag,
  authority contact card (now "FDA", linking to the FDA recall listing
  instead of the RFR portal), recall readiness pillar, coordination
  sheet, recalls report card, Class I terminology. Scanner: Take Action
  sheet US block (button now opens the FDA recall listing), FSIS note,
  regulatory quick reference rows. The sentence itself lives once in
  `_CITATIONS.us.rfrRetail` in each file.
- Citation table. `_CITATIONS.us` (const in dashboard.html after the
  state declaration; `window._CITATIONS` in index.html after the
  Supabase client) holds rule, subpart, plan 1.1315, receivingKde
  1.1345, availability 1.1455(c), retention 1.1455(d), exemptions 1.1305,
  recallNotify 7.46, recallComms 7.49, recallEnd 7.55, complianceDate.
  Two wrong citations were corrected on the way: receiving KDEs were
  cited as §1.1330 (that section is initial packing) and retention was
  cited as §1.1345 in one place and "21 CFR 1.337" in another. Both now
  read through the table. Phase 0 set retention to 1.1455(a), which is
  the general records paragraph; the 2-year retention is 1.1455(d) and
  the table was corrected on 2026-10-07 (see "Follow-ups shipped"). Remaining hand-typed US literals in code
  comments and in static HTML were left; migrate them when the line is
  next touched.
- Region pickers removed and US defaults set (see the decision section
  at the top).
- join.html: phone placeholder +1, name placeholder Americanized, the
  location-pin emoji in store chips replaced with an inline SVG, "as a
  Store Staff" grammar fixed.
- signup.html: Norwegian example placeholders replaced, manufacturer-
  era "trading partners" sentence replaced, the store emoji on the type
  card replaced with an inline SVG, em dashes removed from copy.
- SMOKE.md created at the repo root with the Phase 0 checks and the
  handoff's later-phase checks.
Not done in Phase 0: a British-to-American sweep of existing UI copy, the
read-only render of prefilled join details, and the invite email's "as a
staff" wording (send-invite.js). The sweep and the invite wording shipped
on 2026-10-07 (see "Follow-ups shipped 2026-10-07"); the read-only render
of prefilled join details is still open.

## Phase 1 of the FSMA 204 handoff (migrations written 2026-10-03)
Five migrations, numbered 022 to 026 because John's 020, 020a and 021
already exist (the handoff said 021 to 025). Each runs in one
transaction, is re-runnable, enables RLS, revokes anon, and uses John's
helpers in his b2N_ policy pattern. Applied status: run
migrations/CHECK_MIGRATIONS.sql; acceptance: docs/verify-022-026.sql
(every row PASS). Column-level detail is in SCHEMA.md, "Phase 1 tables".
- 022 suppliers: supplier directory with the 21 CFR 1.1345 location
  fields, country default 'US', active flag, updated_at trigger
  (batchd_touch_updated_at, new, reusable). Deviation from the handoff:
  any active member may INSERT (the receiving form lets staff add a
  supplier name); UPDATE is corp_admin or manager; DELETE corp_admin.
- 023 receiving_events: the Receiving CTE, plus scans.receiving_event_id
  (FK, set null on delete, indexed). CHECKs on tlc_source_type,
  reference_document_type, source, status, quantity >= 0. Trigger
  batchd_receiving_set_retention fills retain_until with received_at
  plus two years when the client sends null. No client DELETE.
- 024 organisations columns: annual_food_sales_band,
  operates_registered_facility, operates_distribution_center,
  fsma_applicability, focus_categories, pricing_tier,
  network_benchmarks_opt_in, traceability_plan_contact_name and
  _phone, traceability_plan_updated_at. Deviation: the handoff's
  plan_tier is named pricing_tier so it cannot be confused with
  organisations.plan (commercial status, migration 020). The
  Reportable Food Registry guidance from Phase 0 is to be gated on
  operates_registered_facility in Phase 5.
- 025 products FTL flags (is_ftl, ftl_category, ftl_confirmed_source,
  ftl_confirmed_at) and ftl_overrides (per-org, by GTIN or normalized
  name, unique per org on each). products keeps its existing policies.
  Phase 2 note: the scanner reads products through the products_public
  view (migration 001). Until migration 030 runs the view does not
  expose the new columns and the client falls through to the name regex;
  confirmed by probe on 2026-10-08 and fixed by 030 (see "Follow-ups").
- 026 records_requests (minutes_to_produce is a stored generated
  column) and traceability_plans (unique per org on version). corp_admin
  writes, members read.
Not in Phase 1: mock_recall_drills.scenario_text and
stores.external_code (Phase 6 and 7; a small later migration, 028 or
after, since 027 is John's code_patterns slot).
LIVE DATABASE CHECK 2026-10-07 (PostgREST probes with the anon key, no
login): every Phase 1 table answers PGRST205 "could not find the table
in the schema cache" (suppliers, receiving_events, ftl_overrides,
records_requests, traceability_plans), and Postgres itself answers 42703
"column does not exist" for organisations.traceability_plan_contact_name,
pricing_tier and focus_categories, for scans.receiving_event_id and for
products.ftl_confirmed_source. John's artifacts from 020, 021 and 027
(organisations.plan, organisation_api_keys, complaints.ip_hash,
code_patterns) all exist. So migrations 022 to 026 are NOT applied on
project lurxucdmrugikdlvvebc, even though the verify script reported
12/12 PASS on 2026-10-03; the likeliest explanation is that the SQL ran
against a different project or a preview branch. Until they are
applied, the deployed Phase 2 receiving mode, the Phase 3 Suppliers card
and the Phase 4 drill and plan cards show "table not in the database"
messages (the Phase 4 code names the migration to run). Fix: in the
Supabase SQL editor for lurxucdmrugikdlvvebc run CHECK_MIGRATIONS.sql,
then 022, 023, 024, 025, 026 in order, then docs/verify-022-026.sql.
products.is_ftl and ftl_category exist regardless: migration 004 added
them, so a 200 on those two does not prove 025 ran.
RESOLVED 2026-10-07: Ian ran 022 to 026 on lurxucdmrugikdlvvebc and
docs/verify-022-026.sql returned PASS on every row. An outside probe the
same day confirms it: all five tables now answer 42501 "permission denied
for table" to the anon key (exists, locked), the 023, 024 and 025 columns
resolve, and the receiving_events to suppliers embed parses. Phases 2 to
4 are therefore live against a database that has their tables; the
smoke checks (SMOKE.md 10 to 13 and 17) are still owed.
netlify.toml also gained forced 404s for /SMOKE.md and
/CHECK_MIGRATIONS.sql on 2026-10-03; SMOKE.md was being served publicly.

## Phase 2 of the FSMA 204 handoff: scanner receiving mode (built 2026-10-03)
index.html only. English only. Verified: every inline script block passes
node --check, the page loads with no console errors, the parser passes
seven synthetic case-label cases, and the form renders at phone width.
Not yet verified against real case labels (Ian owes three photos) or
against the live database (needs a signed-in session).
- Mode switch at the top of the Scan view: Shelf (the existing three
  phases) and Receiving. Persisted per device in localStorage
  `batched_scan_mode`; `applyScanMode()` hides the stepper and phases and
  shows `#receiving-panel`. Available to every role.
- Receiving form (`rcv*` functions, module sits just before
  blobToBase64): live camera via a separate ZXing reader on the shared
  stream (`rcvStartScanner`, CODE_128, DataMatrix, QR, EAN, ITF, RSS),
  "Photograph label" through a file input decoded with ZXing (and, when
  the org has AI, `identify_product` for the name), a typed GS1 string
  field, product and GTIN (GTIN looks up products_public by
  barcode_normalized), lot, best-by, quantity, unit segmented control
  (case, each, bag, lb, pallet; last unit remembered), supplier picker
  with inline "Add supplier" (any active member may add; policies from
  migration 022), reference document type and number (remembered per
  store for 30 minutes), date received (defaults to now), notes.
- FTL resolution order: ftl_overrides by GTIN, ftl_overrides by
  normalized name, products_public.is_ftl (400 tolerated until the view
  exposes migration 025's columns), then detectFtlCategory. Confirm chip
  writes an override for corp_admin and store_manager via select then
  insert or update (not upsert: the unique indexes are partial, so
  PostgREST's on_conflict cannot target them).
- Save writes one receiving_events row (migration 023) with
  client_uuid; offline it queues `{kind:'receiving', payload, labelB64}`
  in `batched_offline_queue`, and `_syncOfflineQueueImpl` replays it
  through `_replayReceivingItem` (23505 counts as synced). Label photos
  go to the scan-photos bucket under orgs/<org>/receiving/.
- After a save, a back-door recall check reads BOTH sources (recalls
  table and recall_distributions joined to recall_events) and warns to
  hold the lot. Advisory only; it does not change active-recall counts.
- Shelf-scan link: `rcvComputeLinkForPhase3` runs when phase 3 opens
  (alongside checkPrePlacementRecall), finds the newest received row in
  the org within 45 days whose normalized lot equals or is contained in
  the scan's raw capture (store match when both known), shows a chip in
  `#p3-receiving-link`, and saveRecord writes `receiving_event_id`.
  resetForm clears it. History cards show a "Delivery" chip from
  `window._rcvLinkMap`.
- Recalls view: a recall whose lot matches a received row with no
  linked shelf scan renders with a "HELD AT RECEIVING" pill and a
  "Received, not yet on shelf" line; held-only items are excluded from
  the drawer badge count (three-condition rule).
- Manager tab "Receiving" (`loadMgrReceiving`): org rows with store and
  date-range filters, and a simple CSV (`rcvExportCsv`, formula-safe)
  that Phase 4's shared builder will replace.
- parseGS1: 4-char weight AIs 3100 to 3106 and 3200 to 3206 added (the
  old 3-char entries misread them), `netWeightKg` and `netWeightLb`
  derived, and the raw-format boundary rule changed: when any FNC1 is
  present a variable field reads to the next FNC1; only FNC1-less
  strings guess a boundary, and then only on the food-label AI set.
  Before this, lot RM240928 parsed as "RM" because "240" is an AI.
- Default region fallbacks flipped to 'us' in both apps (`_userRegion`,
  `_obRegion` fallbacks, `_orgRegion`, `_orgDefaultRegion`,
  `org?.region` fallback). Stored values still win; the header badge no
  longer flashes NOR before settings load.
- Pre-existing, noticed, not fixed: the deactivated-member and
  no-membership branches at sign-in write to `auth-view` and `main-app`,
  ids that do not exist in the page (the login overlay is
  `login-screen`), so those branches would throw. FIXED 2026-10-07: both
  branches render into `login-screen` (see "Follow-ups shipped
  2026-10-07").
- Local preview for the scanner: `.claude/launch.json` runs
  `.claude/serve.js` (Node static server on 127.0.0.1:8787). Neither
  file is uploaded. For the dashboard, `.claude/build-app-preview.py` and
  `.claude/app-stub.js` (2026-10-18) produce a stubbed whole-app preview;
  see the ladder sweep note in "Follow-ups shipped".

## Phase 3 of the FSMA 204 handoff: supplier directory (built 2026-10-03)
dashboard.html (a Settings card) plus a small index.html change. Verified:
every inline script block passes node --check (dashboard 6, scanner 4),
the module's pure functions pass a Node test file, and the card and its
form render in a local preview with sample rows. Not yet verified against
the live database (needs a signed-in session).
- Settings card "Suppliers", visible to corp_admin and store_manager,
  between the Organization/Account row and "Your preferences". It loads
  asynchronously: `renderSuppliersCard()` fills `#suppliers-body` after
  the Settings shell renders, so a slow query never blocks Settings.
  Table columns: completeness dot, name with type, GLN and tags (Exempt
  source, Suggested, Inactive), phone, address, "Typically ships"
  category hints, last used (newest receiving_events.received_at per
  supplier_id, computed client-side from up to 2,000 rows), and Edit /
  Deactivate or Activate / Delete. Delete is corp_admin only (migration
  022 policy) and its confirm text points at Deactivate when the
  supplier has receiving history, since receiving_events.supplier_id is
  ON DELETE SET NULL and supplier_name_snapshot keeps the name. Inactive
  rows hide behind a "Show inactive" checkbox. The topbar label stays
  "Settings"; there is no new panel.
- Completeness rule (`supplierIsComplete`): name, phone, street, city,
  state and ZIP all present. Green dot, otherwise amber; the tooltip
  text lives in `_SUPPLIER_COMPLETE_TIP` and a summary line says how
  many "still need a full address". The scanner's `_rcvSupplierComplete`
  checks the same six fields; keep the two in step.
- Add/edit modal (`supplierOpenForm`, `supplierSave`): name, type
  (distributor, manufacturer, farm, other), phone, GLN (13 digits or
  blank), street, city, state (datalist of two-letter codes; full names
  are normalized to codes by `supplierNormalizeState`), ZIP, country
  (`supplierNormalizeCountry` maps US spellings to 'US', otherwise the
  first two letters uppercased), "Typically ships" chips keyed like
  FTL_CATEGORIES in index.html (`_SUPPLIER_CATEGORIES`, informational
  until a later phase reads them), an exempt-source checkbox citing
  `_CITATIONS.us.exemptions`, and on edit an Active checkbox. Error
  mapping: 23505 "already exists"; 42501 and PGRST116 (an update that
  matched no row under RLS) become a role message.
- CSV import (`supplierOpenImport`) reuses the shared openCSVImport
  engine with the handoff's columns name, phone, street, city, region
  (labeled State), postal (labeled ZIP), country, gln, type, an
  `autoMapFn` with header aliases, and a fictional two-row template.
  `_supplierImportRow` inserts new names and, for a name that already
  exists (case-insensitive), fills only the blank fields; a malformed
  GLN is dropped instead of failing the row. `onComplete` re-renders the
  card.
- Scanner (index.html): the manager Receiving query embeds
  `suppliers(name,phone,street_address,city,region,postal_code)` and
  the CSV carries supplier_phone, supplier_street, supplier_city,
  supplier_state and supplier_zip after the supplier name, so an
  exported receiving record has all six location fields (handoff 3.1
  acceptance). On entering Receiving mode the picker reloads the
  supplier cache when it is older than five minutes
  (`_suppliersLoadedAt`), so a supplier added in the dashboard appears
  without signing out. Phase 2 already appended "(address incomplete)"
  to picker entries; `<option>` elements cannot carry the amber dot the
  handoff describes, so the text suffix stands in for it.
- Not in Phase 3: category-kit seeds (`seeded_from`, Phase 6). The
  "Suggested" tag already renders for inactive seeded rows, so Phase 6
  needs no table change.

## Phase 4 of the FSMA 204 handoff: export, records request drill, plan (built 2026-10-07)
dashboard.html and index.html. Verified: every inline script block passes
node --check (dashboard 6, scanner 4); a Node test file drives the
dashboard builder through a stubbed client (lot scope, date scope,
missing-table and missing-column degradation, the recall path with no
lot, plan generation) and checks the two header lists are identical; the
two Compliance cards and the plan document render in a local preview.
Not verified against the live database (see the Phase 1 live check:
the tables are not there yet).
- Shared export builder (dashboard `buildFsma204Records(scope)` and
  `downloadFsma204Export`; scanner `fsmaExport` is the twin). Column list
  `FSMA204_EXPORT_HEADERS` is identical in both files and follows the
  handoff's Receiving sheet: TLC, product, GTIN, quantity, unit, six
  immediate-previous-source columns plus country, six receiving-location
  columns (business name is "org, store"), date and local time received,
  TLC source type and reference, reference document type and number, FTL
  category, record id, notes. Rows are receiving_events with status
  received, plus receiving rows referenced by in-scope scans, plus gap
  rows for shelf scans with no linked receiving record (Notes starts with
  "Shelf placement only, no receiving record"). Date-range scopes with no
  lot or product keep only FTL-flagged gap scans (`ftlOnlyGaps`); recall
  and lot scopes keep every match. Cover block: drill banner, regulation
  line, organization, contact (coordinator, else contact email), scope,
  date range, generated at and by, counts, any degradation notes, and
  `FSMA204_EXPORT_DISCLAIMER` ("Prepared with Batch'd. Batch'd supports
  FSMA 204 record keeping; the responsibility for the records remains
  with the business."). Never write "FSMA 204 compliant". CSV cells are
  formula-safe (`_fsmaCsvCell` quotes a leading = or @, or a + or - that
  starts a formula, and leaves plain numbers alone). Degrades on purpose:
  PGRST205 on receiving_events or 42703 on scans.receiving_event_id
  produce scan-only rows and a cover note naming migration 023.
- `produceFsma204Records(recallEventId)` (Live Recall button) now calls
  the builder with the recall's lot codes; an event with no lot falls
  back to its product name instead of refusing. File names:
  `FSMA-204-records_<DRILL-><8-char event id>_<date>.csv`,
  `FSMA-204-records_drill_<date>.csv` for the drill, and in the scanner
  `FSMA-204-records_<from>-<to>.csv`.
- Records request drill (Compliance panel card, US orgs; module before
  renderComplianceCategory). `renderRecordsRequestCard` fills
  `#rr-card-body` after the panel renders. Start (`rrStart`, corp_admin;
  any of lot, product, date range) inserts a records_requests row
  (requested_at is the server default). The card then shows a live
  mm:ss timer (`_rrTimer`, cleared when the element disappears) with
  Produce records and Cancel drill. `rrProduce` runs the builder with the
  saved scope, downloads, and updates produced_at, produced_by,
  row_count and file_name; minutes_to_produce comes back from the stored
  generated column and is shown as "Records produced in X minutes".
  `rrCancel` closes the row with notes "Cancelled before records were
  produced" and row_count 0; cancelled rows are excluded from Last,
  Best and the history table. An open request survives navigation: the
  card resumes the timer from requested_at. A zero-row production is a
  valid result and is recorded as such.
- Drill certificate (`generateDrillCertificate`) adds a "Records
  produced in" detail row from the newest completed, non-cancelled
  records request drill, or "No records request drill on file". The
  query is a fourth member of the existing Promise.all and its errors
  are ignored.
- Traceability plan (Compliance panel card, US orgs).
  `renderTraceabilityPlanCard` shows "Plan last generated {date}
  (version N)" or the empty state, Generate or Regenerate (corp_admin),
  View current plan (members), and the plan contact (name and phone).
  Contact fields are organisations.traceability_plan_contact_name and
  _phone from migration 024; when those columns are missing (42703) the
  card falls back to the recall coordinator, makes the inputs read-only
  and says migration 024 is needed (`_planHas024`). `planGenerate`
  loads org, active stores with addresses, active suppliers (and how
  many have a complete location), ftl_overrides count and receiving
  rows in the last 90 days (each tolerant of a missing table), builds
  `content_json` and `rendered_html` (`_planRenderHtml`: header with
  version and citation, five numbered sections per 21 CFR 1.1315,
  signature boxes, footer with the disclaimer and the compliance date),
  inserts traceability_plans with version = max + 1, then sets
  superseded_at on the previous current rows. Superseded rows are never
  deleted. The document opens through `injectPrintButton` like the
  certificate; `planView(id)` reopens the stored HTML.
- Scanner (index.html): `fsmaExport` rebuilt on the same columns and
  cover block; filters unchanged (date range required, store and FTL
  category optional). Receiving rows come first, then gap rows for FTL
  shelf scans (by flag or detectFtlCategory) with no linked receiving
  record. The panel copy under the button now says so.
- Not in Phase 4: the Shipping sheet for distribution centers (the
  builder is a single sheet; `operates_distribution_center` is only read
  by the plan), the readiness-score axis for records-request time (Phase
  5), and any NO branch (US-only decision). The Reports panel's older
  `fsma` report key stayed scan-based until 2026-10-07, when the US
  branch moved to receiving records and the shared builder (see
  "Follow-ups shipped 2026-10-07").

## Phase 5 of the FSMA 204 handoff: applicability, exemption copy, readiness (built 2026-10-07)
dashboard.html, index.html and signup.html. Verified: every inline script
block passes node --check (dashboard 6, scanner 4, signup 2); a Node test
file drives loadComplianceData through a stubbed client (receiving-based
trace score, the five-axis mean, the records-request scaling at 30 min,
12 h, 24 h and never, cancelled drills ignored, missing table, NO
fallback) and checks the applicability helpers and the missing-column
parser; the Compliance panel and the Settings card render in a local
preview. Not verified against the live database.
- Applicability constant `_FSMA_APPLICABILITY` (dashboard, right after
  `_CITATIONS`): five sales bands (under_250k exempt; 250k_to_1m
  covered_no_spreadsheet; 1m_to_10m and over_10m covered; undisclosed
  unknown), labels, the four copy variants from the handoff, the closing
  sentence "Batch'd supports FSMA 204 record keeping. It does not by
  itself constitute compliance.", and `thresholdNote`. The dollar figures
  are the handoff's and must be checked against eCFR (21 CFR 1.1305 and
  1.1455(c)(3) are inflation-adjusted) before a paying customer sees
  them; they live in this one constant. signup.html carries `_FSMA_BANDS`
  and `_FSMA_COPY` with the same values; index.html carries
  `window._FSMA_APPLICABILITY_COPY`. Keep the three in step.
- Sign-in loads annual_food_sales_band, operates_registered_facility,
  operates_distribution_center and fsma_applicability into
  `_orgSalesBand`, `_orgRegisteredFacility`, `_orgDistributionCenter`
  and `_orgApplicability` (dashboard) and `window._orgApplicability`,
  `window._orgRegisteredFacility` (scanner), with a fallback select when
  the 024 columns are missing. `_missingColumnFrom(error)` reads the
  column name out of a PostgREST PGRST204 (write payload) or a Postgres
  42703 (select) message; saveOrgSettings uses it to drop missing columns
  and retry, which also replaced the old recall_source-only retry.
- Settings, Organization card (US orgs): "FSMA 204 applicability" field
  with the sales-band select, two checkboxes (registered facility,
  distribution center), a live copy preview (`_orgApplicabilityPreview`)
  and the threshold note. saveOrgSettings writes the three answers plus
  the computed fsma_applicability and updates the globals.
- signup.html step 3 (retailers): the same three questions in
  `#applicability-section`; submitFinal writes them best-effort after the
  coordinator update.
- Reportable Food Registry gate: `rfrCopy()` returns
  `_CITATIONS.us.rfrFacility` (a registered facility reports within 24
  hours of determining a food is reportable, FD&C Act section 417) when
  the org operates a registered facility, else the Phase 0 retail
  sentence. Used by the Compliance authority card and the compliance
  report's "Notification obligation" row. The scanner swaps the Take
  Action sheet text (`#recall-fda-text`) at sign-in for the same reason.
  The other "recalling firm notifies the FDA" sentences stay as they are;
  they are true either way.
- Overview readiness (`_renderOverviewLegacy`): `shipScore` retired.
  `receivingScore` = share of on-shelf FTL scans in the last 90 days that
  link to a receiving record; with no FTL shelf scans in the window,
  deliveries recorded in the window count as 100, otherwise 0. Readiness
  = mean(ackScore, receivingScore, scanScore); the ring row reads
  "Deliveries recorded". The 67 percent cap is gone. The shipments and
  trading_partners queries in that function remain for the exposure
  tiles; nothing else changed there.
- Getting started: six steps (stores, first supplier, first delivery,
  first scan, first drill, coordinator) in both renderOnboarding and
  checkOnboardingStatus. The two new steps query suppliers and
  receiving_events.
- Compliance panel (`loadComplianceData`): US traceScore is the share of
  receiving records in the last 365 days that are complete (supplier
  location description complete, lot code or exempt source, quantity
  and unit, reference document); the per-field counts `rcvSupplierOk`,
  `rcvTlcOk`, `rcvQtyOk`, `rcvRefOk` and `receiving` are exposed on
  `_complianceData`. NO orgs keep the frozen scan formula. Fifth axis
  `requestScore` from the newest completed, non-cancelled records request
  drill: 100 at or under 60 minutes, linear to 0 at 24 hours, null when
  never run (then the overall mean uses four axes). The dashboard shows
  an applicability banner ("What applies to you"), receiving-based gaps
  that point at Receiving mode and Settings, Suppliers, a fifth
  "Records request time" card (scrolls to the drill card; "Not run"
  until a drill exists), and receiving-based live checks. The detail
  step 2, the results page and the printable compliance report read the
  same fields. The old scan-column KDE checks (tlc_source,
  reference_document on scans) are gone from US views.
- Scanner FSMA tab: `_fsmaApplicabilityBanner()` prepends the
  applicability sentence when the org has answered; the tab's own score
  (`renderFsmaReadiness`) read legacy scan fields until 2026-10-07, when
  it was rewritten on receiving data (see "Follow-ups shipped
  2026-10-07").
- Not in Phase 5: a Shipping sheet or CTE for distribution centers (the
  answer is stored and read only by the plan generator). The scanner's
  readiness score moved to receiving data on 2026-10-07.

## Phase 6 of the FSMA 204 handoff: the category wedge (built 2026-10-07)
dashboard.html, index.html, signup.html, migration 028. Verified: every
inline script block passes node --check (dashboard 6, scanner 4, signup
2); a Node test file checks the kits, focus matching, drill templates,
checklist tests and supplier seeding with stubs; another drives the
repaired FTL detector through 29 product names including the known
misfires; the Compliance panel, the Settings card and the drill launcher
render in a local preview. Not verified against the live database.
- FOUND AND FIXED on the way: every pattern in the scanner's
  FTL_CATEGORIES table contained literal backspace characters (0x08)
  where `\b` word boundaries were meant (55 of them across all 17
  categories), so alternatives that started with one could never match;
  peppers and shell eggs matched nothing at all. The block is repaired
  to real `\b` escapes. If you ever see `^H` in a regex in this repo,
  that is the same defect.
- Regex misfires (handoff 6.4): FTL_CATEGORIES entries may carry an
  `exclude` regex that detectFtlCategory tests before the pattern.
  peppers excludes dr pepper, pepperoni, peppermint, peppercorn, pepper
  jack, peppered, pepper spray, pepper steak, pepper sauce and salt and
  pepper, and its pattern now lists jalapeno, habanero, poblano and
  serrano; shell_eggs uses word boundaries and excludes eggplant,
  eggnog, liquid egg, egg beaters, egg salad, egg roll and egg white
  (egg salad then falls through to deli_salads).
- Category kits: `CATEGORY_KITS` in dashboard.html (after the
  applicability constants) with full kits for leafy_greens and
  nut_butters: label, description, suggested_suppliers (the handoff's
  name-only seeds; Ian confirms brand ownership before a paying
  customer sees them), one drill_template each (romaine E. coli O157:H7
  Class I; peanut butter Salmonella Class I) with product, lot pattern
  with `<date>`, severity, reason and scenario paragraph,
  readiness_checklist items with `test(d)` returning true, false or
  null (no data), `detail(d)` and `action`, and feed_filter keywords.
  `kitFor(key)` returns a minimal kit (label, a generic Class II
  template, the label as feed keyword) for every other FTL key. Lot
  code hints were not added: the handoff says to wait for photographed
  labels.
- Focus categories: `_orgFocusCategories` loads at sign-in
  (organisations.focus_categories, migration 024). Pickers:
  `_focusPickerHtml(selected, editable, prefix)` renders chips (the two
  wedge categories first, marked recommended) and `_focusPickerValues`
  reads them. Settings, Organization card "Where you start" saves
  through saveOrgSettings; Getting started has a "Where do you want to
  start?" card saved by `saveFocusCategories('ob')`; signup step 3 has
  the same two preselected chips plus an "Add another category" select
  and writes focus_categories with the applicability answers. Settings
  also shows the informational pricing tier read-only
  (`_PRICING_TIER_LABELS`; nothing is gated by it).
- Seeds: `ensureCategoryKitSeeds(keys)` inserts each focus kit's
  suggested suppliers that the org lacks (case-insensitive name match),
  inactive, with seeded_from 'category_kit:<key>' and the key as the
  category hint. It runs after a focus save and once per session from
  renderSuppliersCard when a focus kit has no seeded rows yet
  (`_kitSeedsChecked`). The Suppliers card shows inactive rows by
  default while suggested seeds exist (until the user toggles,
  `_supplierToggleTouched`) and counts them in the summary.
- Drill scripts: showDrillLauncher gains a "Drill script" select
  (`_drillTemplateOptions`, focus categories first) that fills the form
  (`_applyDrillTemplate`) and a Scenario textarea; launchDrill writes
  scenario_text to mock_recall_drills and retries without it when
  migration 028 is missing. The launcher's manufacturer-partner sentence
  is gone. generateDrillCertificate reads scenario_text (fifth query,
  errors ignored) and prints a "Drill scenario" paragraph.
- Compliance panel: a "Focus categories" card under the applicability
  banner renders each focus kit's checklist through complianceCheck
  (null results render as guidance), with a "Run a category drill"
  button. loadComplianceData now selects gtin, best_by and ftl_category
  on receiving rows, ftl_category on scans, and active suppliers
  (`d.suppliers`) for the checklist tests.
- Recalls panel, Feed tab: `_recallInFocus(r)` matches the kits'
  feed_filter words against product name and description; in-focus
  alerts sort first, carry an "In your focus categories" badge, and the
  header counts them. Nothing is hidden.
- Shelf flow FTL chip (index.html): updateFtlBadge now keeps `_p3Ftl`
  (regex first, then `_resolveP3FtlOverride` checks ftl_overrides by
  GTIN from field-barcode, by normalized name, then products_public),
  renders the badge plus a chip in `#p3-ftl-chip` ("Not a listed food"
  on a detected item, "Listed food? Yes" on an undetected one, or the
  confirmed state). `p3ConfirmFtl(yes)` writes an org override for
  corp_admin and store_manager through the new shared
  `writeFtlOverride(norm, key, yes, category)` (rcvConfirmFtl uses it
  too); staff decisions apply to this scan only. saveRecord takes
  is_ftl and ftl_category from `_p3Ftl`; resetForm clears it. The badge
  text lost its em dash.
- Settings "Listed foods" card (`renderFtlOverridesCard`,
  `ftlOverrideDelete`): the org's ftl_overrides rows with product (GTIN
  or normalized name), listed yes/no, category, who, when; corp_admin
  can delete, which returns the product to automatic detection.
- Migration 028 (`028_drill_scenarios_and_store_codes.sql`, not yet
  applied): mock_recall_drills.scenario_text and stores.external_code
  (Phase 7 store mapping) with a partial index; CHECK_MIGRATIONS has a
  028 row; SCHEMA.md documents both columns. Everything in Phase 6
  works without it except storing the scenario.
- Not in Phase 6: NO variants (US-only decision); lot-code hints for
  the brands (need photographed labels); any tier gating.

## Phase 7 of the FSMA 204 handoff: wholesaler delivery files (built 2026-10-07)
dashboard.html, index.html, migration 029. Verified: every inline script
block passes node --check (dashboard 6, scanner 4); Node tests drive the
import helpers (GTIN normalizing, document-type guess, store matching by
wholesaler code then store code then name, supplier match by GLN then name
with creation, duplicate detection against existing expected rows and
within one file, remembered column mappings, header aliases) and the
scanner's expected-delivery matching and prefill; the Receiving panel
renders in a local preview. Not verified against the live database.
EDI 856 (handoff 7.3) is out of scope, as the handoff says.
- New dashboard panel "Receiving" (`renderReceiving`; `receiving` in
  `panels` and `fns`; sidebar item after Scan History; store managers
  allowed). Two tables: expected deliveries (status 'expected', all time)
  and received rows for the last 7, 30 or 90 days with a Source tag (File,
  Scan, Manual). Actions: "Import a delivery file" (corp_admin and
  store_manager), "Export last N days" through the Phase 4 builder, and a
  per-row Cancel on expected lines that sets status 'rejected' with a
  note (managers; no client DELETE exists on this table).
- Import (`rcvImportOpen`) reuses openCSVImport with the handoff's
  columns: ship date, ship-to store (code or name), GTIN, product
  description, lot, quantity, unit, reference document, supplier (GLN or
  name); store, product, lot and quantity are required. `autoMapFn`
  first tries the mappings remembered in localStorage
  (`batchd_rcv_import_maps_<org>`, newest first, used when every
  remembered column is present in the file), then header aliases. The
  engine now stores the file name on the modal (`modal._csvFileName`).
  `_rcvImportRow` builds its context on the first row (stores,
  suppliers, the org's existing expected rows, one `import_batch_id` per
  file): store by stores.external_code, then store_code, then name
  (exact, then contains); supplier by 13-digit GLN, then name, else a
  minimal active supplier is created and counted in the completion
  toast; GTIN digits-only with the scanner's 12-to-13 rule; quantity
  parsed; unit lowercased with default 'case'; ship date becomes
  received_at (the confirm sets the real time); reference document type
  guessed from the value (PO, invoice, BOL, ASN, other). Rows insert
  with status 'expected', source 'wholesaler_import', tlc_source_type
  'shipping_document', tlc_source_reference = the file name, is_ftl
  false (the scanner's confirm sets it). A row that matches an existing
  expected line (store, lot, GTIN) is reported as a duplicate, so
  importing the same file twice adds nothing. `_rcvImportDone` saves
  the mapping and re-renders.
- Store Network form: "Wholesaler ship-to code" (`sf-external-code`,
  stores.external_code from migration 028) with a retry that drops the
  column on an older database.
- Scanner (index.html): `rcvLoadExpected` loads the org's expected rows
  for the session store (or with no store) when Receiving mode opens,
  cached two minutes; a chip above the form says "N expected deliveries"
  and expands to a list with a Use button that fills lot and GTIN.
  `rcvCheckExpected` runs after a label parse, when the lot field
  changes, and on Use: a match is lot-equal (case-insensitive) and
  GTIN-compatible (equal ignoring leading zeros, or either side blank).
  It prefills product, GTIN, quantity (when still default), unit,
  supplier and document, and shows a banner "Expected from {supplier}:
  {qty} {unit} of {product}" with Confirm delivery and Not this one.
  `rcvConfirmExpected` updates the row to status 'received' with
  received_at now, received_by, the quantity and unit on the form
  (recording "Expected X; received Y" in notes when they differ),
  retain_until null so the trigger recomputes it, the FTL decision, a
  typed best-by or GTIN, the label photo and raw capture, then runs the
  usual post-save reset and the back-door recall check. Record receipt
  with a matching expected lot routes to the confirm instead of
  inserting a second row. Confirming needs a connection (no offline
  queue for updates).
- Migration 029 (`029_receiving_confirm_policy.sql`, applied; confirmed
  by CHECK_MIGRATIONS on 2026-10-11):
  policy b29_receiving_member_confirm_expected lets any active member
  UPDATE a receiving row while status = 'expected'; without it floor
  staff get "could not be updated" on confirm (managers still can).
  CHECK_MIGRATIONS has a 029 row; SCHEMA.md documents the policy and the
  import conventions.
- Export builders (both files) select `source` and add the note "From
  wholesaler delivery file" on imported rows, which is how the handoff's
  acceptance check reads the source in the export.
- Not in Phase 7: EDI 856 and the org_integrations token table (7.3);
  per-supplier column mappings beyond the remembered-mappings list;
  an offline queue for confirmations.

## Phase 8 of the FSMA 204 handoff: network foundations (built 2026-10-07)
dashboard.html only. The handoff's Phase 8 deliverable is one Settings
toggle for organisations.network_benchmarks_opt_in (migration 024), default
off, with its exact copy, and an explicit instruction not to build reads,
aggregation or the network_benchmarks table yet. That is what shipped:
- `_NETWORK_OPTIN_COPY` holds the handoff's sentence verbatim.
  `_NETWORK_OPTIN_REVIEWED` gated the toggle until Elliott had reviewed
  the copy, which the handoff's section 10 requires; Elliott approved it
  on 2026-10-07 and the constant is true, so the toggle renders in the
  Organization card below "Where you start" and saveOrgSettings writes
  the flag (corp_admin only, with the usual missing-column retry).
- Nothing reads the flag. When aggregation comes it must run in a
  scheduled Netlify function with the service key, write only
  pre-aggregated rows (metric, period, n_orgs, p25, p50, p75) to a
  network_benchmarks table, suppress cells with fewer than 10
  contributing organizations, and the client may read only that table.
  The precondition the handoff set (open policies closed on scans,
  stores, organisations, recall_distributions, recall_acknowledgements)
  was met by John's migration 021 on 2026-09-22.

## FSMA 204 handoff: state at the end of the build (2026-10-07)
Phases 0 to 8 are built, on GitHub main (blob hashes verified 2026-10-07)
and deployed; migrations 022 to 030 are applied on production (022 to
028 and 030 verified by probe; CHECK_MIGRATIONS run by Ian on 2026-10-11
reports every row APPLIED, 029 included). Still owed by Ian, from the
handoff's section 10 and from the phase notes above:
- Three photographed case labels (romaine case, nut butter case, one
  non-GS1 label) to test the GS1 parser against reality (Phase 2).
- Nothing on the dollar thresholds for now: the eCFR text was verified
  on 2026-10-07 ($250,000 in 1.1305(i), $1 million in 1.1455(c)(3)(iii),
  2020 dollars, rolling 3-year average) and the FDA has not yet published
  inflation-adjusted figures for this rule. When it does (its "FSMA
  Inflation Adjusted Cut Offs" page), `_FSMA_APPLICABILITY` and the copies
  in signup.html and index.html change together (Phase 5).
- Brand ownership of the suggested supplier seeds, and photographed lot
  code formats for the five brands before any lot hints are added
  (Phase 6).
- One sample delivery file from a real wholesaler, with permission, to
  exercise the import against real headers (Phase 7).
- The live smoke checks: SMOKE.md 10 to 13 and 17 to 20 have not been
  run on the deployed apps by anyone. Everything in Phases 2 to 7 was
  verified only by syntax checks, Node tests with stubbed clients and
  local previews.
The follow-ups outside the handoff that the phase sections noted (the
scanner's FSMA readiness score, the sign-in error branches, the
British-to-American sweep, the invite email wording) shipped on
2026-10-07; see the next section, which also covers the join page's
read-only prefill, the Reports panel's FSMA report and the retirement of
the scanner's local plan wizard. Nothing the phase notes parked is still
open.

## Follow-ups shipped 2026-10-07 (outside the handoff)
Seven items the phase notes had parked, plus a citation correction, a
threshold verification and a dashboard sign-in fix found on the way. Verified: every inline script block
passes node --check (scanner 4, dashboard 6, admin 1, join 2); the six
edited Netlify functions pass node --check; Node tests drive the new
scanner score through three stubbed scenarios (full data, receiving table
missing, empty org scoped to a store) and the Reports panel body through
mixed and empty data; the FSMA tab, the Reports body and the join form
(all fields supplied, two supplied, none) render in local previews with
no console errors. Not verified against the live database.
- Scanner FSMA tab score (`renderFsmaReadiness`, now async). It reads
  receiving_events with status received in the last 365 days (store
  managers: their store only, like loadMgrData), on-shelf scans in the
  last 90 days with `receiving_event_id`, the current traceability_plans
  row (superseded_at null) and, when `_recallCoordinator` is empty,
  loadCoordinator(). Seven weighted components: lot code or exempt source
  on every delivery (25), supplier location complete (20), reference
  document (15), listed-food shelf scans linked to a delivery (10), recall
  coordinator (10), traceability plan (10; stored plan first, the local
  wizard date `batchd_tracplan_date` as fallback), deliveries in the last
  30 days (10). The field checks are the same four as loadComplianceData
  in dashboard.html; keep them in step. Components whose data is missing
  (PGRST205 or 42703) show "n/a" and drop out of the weighted mean, and an
  action item names migration 023. The category block is now "Delivery
  records by listed-food category" (share complete). The plan card shows
  "Version N, generated {date} in the corporate dashboard" and hides the
  local print-wizard button when a stored plan exists. The function adds
  `_fsmaApplicabilityBanner()` itself after rendering, so the tab switch
  no longer calls the banner separately.
- Scanner sign-in error branches (deactivated member, no membership row)
  render into `login-screen` with the same full-height wrapper as the
  onAuthStateChange branch, and clear `currentUser` before signing out so
  the SIGNED_OUT handler calls showLogin() instead of raising the
  session-expired overlay.
- Invite email (send-invite.js): the role is phrased with its article ("a
  staff member", "a store manager", "a corporate admin") and the sentence
  reads "on Batch'd as {role}". Needs the netlify/functions upload to take
  effect.
- American English sweep of user-facing strings: dashboard.html,
  index.html, admin.html, privacy.html, terms.html, docs.html and the
  email or prompt text in send-invite, notify-consumers, notify-event,
  recall-reminder, triage-complaint and ai-analyze. 140 replacements:
  organisation to organization in copy (the Settings card title is now
  "Organization"), centre, authorisation, cancelled, categorise,
  labelled, standardised, enrolment, analyse, apologise, recognised,
  anonymised, colour, odour, mould, aluminium. Deliberately left: every
  identifier, table and column name (organisations, organisation_id,
  normaliseProductKey, authoriseStaffInvite, the ocr.js op localise_lot),
  element ids such as mfa-enrol-modal, i18n keys such as
  action.snapAnalyse (its English value changed), code comments, frozen
  NO strings, the severity `<option value>` attributes, and
  "acknowledgement" (both spellings are standard in US usage and the
  word is all over the compliance copy). The records_requests cancel
  note now reads "Canceled before records were produced"; the card
  detects cancelled rows with /cancel/i, so older rows still match.
  admin.html's org-name placeholder lost its Norwegian example. Em dashes
  were removed from the touched lines; the severity option texts keep
  theirs because the sibling options do.
- join.html read-only prefill. Profile fields the inviter supplied
  (phone, store role, badge ID, hire date) render `readonly` with a
  dashed border; blank ones stay editable; the section label becomes
  "Profile details · entered by your administrator" and a note under the
  block says to ask the administrator for corrections. The full name
  stays editable (it is the invitee's account name). acceptInvitation is
  unchanged: it reads the same inputs, so locked values reach
  accept_invitation as before.
- Reports panel, FSMA 204 report (US orgs; the NO branch is frozen and
  untouched). fetchReportData returns receiving_events rows (status
  received, `received_at` in the chosen range, with stores(name) and the
  supplier location embedded; an error such as a missing table returns an
  empty list). The on-screen report (`_reportFsmaUsHtml`, before
  runReport) shows delivery records, complete-KDE share, supplier-location
  share and listed-food count, a warning when any record misses a KDE, and
  a table of the rows. Download CSV no longer builds its own 15-column
  scan CSV: it calls `buildFsma204Records({ dateFrom, dateTo, ftlOnlyGaps:
  true })` and `downloadFsma204Export`, so the file is the 27-column
  export with the cover block, identical to the records request drill and
  Live Recall. The report card on the Reports grid counts delivery records
  (a head count on receiving_events, tolerant of a missing table) and
  shelf scans, and is titled "FSMA 204 receiving records".
- Scanner plan wizard retired. `openTraceabilityPlanWizard`,
  `generateTraceabilityPlan`, `closeTraceabilityPlanWizard` and the
  `tracplan-modal` markup (about 270 lines) are gone, with a comment at
  each site. The wizard printed an unstored .txt plan with Norwegian
  defaults (Kiwi, Rema, ASKO, country Norway) and OCR-era wording, so it
  had no revert value. The FSMA tab's plan card now reads the stored
  dashboard plan only: "Version N, generated {date} in the corporate
  dashboard" with a View plan button, or "No plan on file. A corporate
  admin generates it in the dashboard under Compliance". The score's plan
  component no longer counts the device-local `batchd_tracplan_date`.
  `fsmaViewStoredPlan()` opens the current traceability_plans row's
  rendered_html in a new tab (opened synchronously so iOS does not treat
  it as a pop-up), wraps a bare fragment in a printable document, adds a
  Print bar hidden in print, and closes the tab with a toast when there is
  no plan or the query fails. Members can read the table (migration 026).
- Citation correction. `_CITATIONS.us.retention` was '21 CFR 1.1455(a)'
  in both apps since Phase 0; (a) is the general records paragraph and
  the 2-year retention is (d). Both tables now read '21 CFR 1.1455(d)',
  and `availability` is '21 CFR 1.1455(c)' ((c)(1) is the 24-hour duty,
  (c)(3) the electronic sortable spreadsheet). Verified 2026-10-07 on two
  eCFR mirrors (law.cornell.edu and govinfo.gov; ecfr.gov itself redirects
  automated fetches). Every surface reads through the table, so the
  compliance panel, plan document, reports and the scanner updated with
  it; SMOKE check 9 and SCHEMA.md were corrected. The inline SQL comment
  in migration 023 still says (a); the file was left as it ran.
- Thresholds verified. 21 CFR 1.1305(i): retail food establishments and
  restaurants with an average annual monetary value of food sold of no
  more than $250,000 over the previous 3 years (rolling, inflation
  adjusted from a 2020 baseline) are exempt. 1.1455(c)(3)(iii): at no more
  than $1 million the records are still due within 24 hours but need not
  be an electronic sortable spreadsheet. The FDA's cut-offs page (updated
  2026-05-13) lists no adjusted values for this rule yet. The constant's
  comment and `thresholdNote` now say so, the "covered, no spreadsheet"
  copy in all three files says the 24-hour duty still applies, and the
  bands are unchanged. The $1 million to $10 million split is Batch'd's
  own granularity, not a regulatory line.
- Dashboard deactivated-member branch (initDashboard) wrote to `main-app`,
  an id that does not exist in dashboard.html (the sign-in overlay is
  `auth-gate`), so a deactivated member got a blank page and a console
  error. It now renders into `auth-gate`. It does not sign out
  automatically because the dashboard's SIGNED_OUT handler reloads the
  page; the Sign out button does that on tap.
- Migration 030 (`030_products_public_ftl_columns.sql`, written
  2026-10-08, Ian's to run). An anon probe showed products_public still
  exposes only the four columns from migration 001, so the scanner's
  third FTL resolution step (products_public.is_ftl by GTIN) has answered
  400 since Phase 2 and the name regex has decided every time. 030
  re-creates the view with is_ftl, ftl_category and ftl_confirmed_source
  appended (CREATE OR REPLACE VIEW keeps the column order and the grants;
  security_invoker stays false as in 001). CHECK_MIGRATIONS has a 030 row;
  SCHEMA.md documents the view. The two scanner call sites tolerate the
  error on an older database, so nothing breaks before it runs.
- html5-qrcode removed from index.html (the unpkg script tag and the
  hidden canvas element). Nothing in the file or the retired stubs ever
  called it; the head comment had said so since the perf pass. One fewer
  third-party script and about 400 KB less on a cold start.
- Dashboard emoji sweep (2026-10-08). The 70 pictographic emoji in
  dashboard.html (Reports cards, Compliance category cards and checks,
  empty states, drill and recall buttons, the certificate badge, CSV
  import result, intelligence risk signals, exposure tiles) are inline
  SVGs from `_ico(name, size)`. Two `textContent` assignments became
  `innerHTML` so the icon renders. Flag glyphs stay. Not swept: the text
  dingbats ✓ ✗ ⚠ ● ★ and index.html.
- netlify.toml: forced 404 for `/netlify/*` (2026-10-08). While verifying
  the upload, probes showed `/netlify/functions/send-invite.js` and
  `/netlify/lib/auth.js` answering HTTP 200 with the source on all three
  domains; the publish directory is the repo root and nothing blocked the
  folder. No secrets live in those files (environment variables only), but
  it is server code. Function invocation goes through
  `/.netlify/functions/<name>`, a different prefix, so the rule does not
  touch it. Found at the same time: the 2026-10-08 functions upload landed
  in `netlify/` instead of `netlify/functions/` (GitHub's uploader puts
  files where you stand), leaving six stray copies to delete and the old
  functions still deployed until the re-upload.
- Live check 2026-10-08 after the root upload: corporate.batchdapp.com
  served dashboard.html byte for byte; batchd-app.netlify.app served
  index.html with one 23-byte difference, Netlify's Pretty URLs
  post-processing rewriting `dashboard.html?panel=recalls` to
  `dashboard?panel=recalls` (the netlify.toml rule from 2026-09-13 301s
  that path to corporate with the query string intact). Expect that
  difference whenever comparing the live scanner to the file.
- Reports panel, Audit trail and Staff activity carry deliveries
  (2026-10-09, US orgs; the NO branch is frozen). Shared helpers before
  `_reportFsmaUsHtml`: `_reportSince()`, `_reportDeliveries()` (received
  rows in the panel's date range with stores(name), tolerant of a missing
  table), `_reportAuditRows(scans, deliveries)` (one list, newest first,
  `kind` scan or delivery) and `_reportStaffRows(scans, deliveries,
  nameOf)` (per-person totals; the table keys on the part before @, the
  CSV on the whole address). Audit trail: a Type column, Delivery rows
  with quantity, reference document, GTIN, "Received" or "Received
  (file)", tiles for deliveries and delivery lot coverage, staff and
  store counts include both kinds. Its CSV gained a leading "Record Type"
  column plus "Reference Document"; "Barcode" became "Barcode / GTIN" and
  "Scanned By" became "Recorded By". Staff activity: a Deliveries column
  and tile, people who only recorded deliveries appear with "No scans",
  "Last active" covers both kinds, the top row reads "most records"; its
  CSV gained "Deliveries Recorded" and renamed "Total Scans" to "Shelf
  Scans". The report cards show deliveries on the Audit trail card.
  Verified: node --check, a Node test of the two pure helpers (ordering,
  delivery-only person, unknown staff, CSV naming, empty inputs), both
  reports in a local preview with sample data.
- Reports panel, Store compliance counts deliveries per store
  (2026-10-09, US orgs). fetchReportData('stores') loads received
  receiving_events (all time, like the scans it already loaded, limit
  5,000) and matches them on store_id. The per-store score keeps its
  weights (frequency 40, lot coverage 40, base 20) but counts records of
  both kinds: frequency and the active/slow/dark status use scans plus
  deliveries in the last 7 and 30 days, lot coverage counts a delivery
  with a lot code or an exempt source as covered, and a store with any
  record gets the base 20. A store that records deliveries but has no
  shelf scans yet is therefore "slow" or "active", not "dark". Table
  columns 7d, 30d and all-time deliveries; the dark-store warning says
  "no scans or deliveries recorded"; the CSV gained 7-Day, 30-Day and
  Total Deliveries. NO orgs load no deliveries, so their numbers are
  unchanged. Verified: node --check and a Node test through a stubbed
  client (mixed store, delivery-only store, dark store, NO branch).
- Lot Lookup overwrote the Overview cache (fixed 2026-10-09). runLotCheck
  ended with `_overviewCache = { html, ... }`, and renderOverview serves
  `_overviewCache.html` while it is fresh (OVERVIEW_CACHE_TTL), so opening
  the Dashboard within two minutes of a lot search rendered the search
  results in place of the overview. Nothing else ever filled that cache,
  so the overview now always renders live; the line is gone.
- Lot Lookup shows deliveries (2026-10-09, US orgs). runLotCheck also
  loads receiving_events (received and expected, last 180 days, store
  scoped for store managers, tolerant of a missing table) and matches on
  lot, GTIN or a 4+ character product name. A "Received N times · units
  · expected" block lists each delivery (store, product, date, supplier,
  reference, who, quantity, lot) above the shelf status; when a recall is
  active on a received lot it adds "hold the received stock and do not
  place it on shelf". The empty state names deliveries.
- Scan History "Trace lot" (traceLot) traces from receiving records.
  The chain is now Supplier (immediate previous source, 21 CFR 1.1345),
  Received at stores (each delivery with quantity, date and reference),
  Scanned onto shelves, Recall status, with a Delivery records table
  above the scan table and tiles for supplier, units received and stores
  received at. Legacy shipments rows (manufacturer era, nothing writes
  them) still render the old manufacturer wording when a lot has
  shipments but no deliveries, so old demo data is not degraded. A
  received lot with no shelf scan reads "Received but not yet scanned
  onto a shelf" and, under a recall, "Hold the received stock".
- Reference document labels: `_refDocLabel(row)` (before the report
  helpers) prints "PO-1042" or "PO 1042", never "PO PO-1042", skipping the
  type when the number already starts with it (the scanner's
  _rcvDocLabel rule). Used by the FSMA report body, the audit report and
  CSV, Lot Lookup and the lot tracer; the Receiving panel keeps its
  equivalent docText.
- Intelligence panel (renderIntelligencePanel, 2026-10-09): reads both
  recall sources, and the manufacturer-era "Shipments" tile and
  "Shipment trail" became a "Deliveries" tile (receiving_events in the
  last 90 days matching the lot or product, US orgs, click opens
  Receiving) with a "Received:" line (store, quantity, date, supplier).
  The legacy shipment trail still renders when shipment rows exist.
- Overview (_renderOverviewLegacy, 2026-10-09): recall exposure
  ("recalled lots match lots you received") is computed from received
  lots (receiving_events, status received, up to 5,000 rows) plus any
  legacy shipments; the banner and the KPI subtitle read from it.
  Recall inbox copy for US orgs says "Pushed recalls and FDA alerts
  matching your products" (RASFF and "manufacturers" wording stays only
  in the frozen NO branch).
- Settings "Integrations" panel replaced (2026-10-09) by "Data in and
  out": a Wholesaler delivery files card (opens Receiving) and a FSMA 204
  records export card (opens Reports). The ERP webhook and "share with
  your manufacturers" cards only applied to manufacturer organizations.
- Store manager overview (renderStoreManagerOverview, 2026-10-09): a
  fifth KPI "Deliveries this week" for US orgs (receiving_events for the
  active store, tolerant of a missing table), click opens Receiving.
- Terminology (dashboard, 2026-10-09): new US entries Receiving record
  (critical tracking event), Key data elements (KDEs), Immediate
  previous source, Delivery file (expected delivery), Records request
  (24 hours); "Trading partner" became "Supplier"; Joint completion
  report names "the recalling firm" rather than the manufacturer; Shelf
  placement is labeled a Batch'd shelf record, not a FSMA 204 CTE; Lot
  code and TLC entries no longer describe the retired AI OCR pipeline;
  Record retention cites 1.1455(d) and explains the two-year receiving
  retention. The compliance detail action that said "use AI OCR" now says
  to scan the GS1-128 label or type the lot.
- Scanner shift summary (buildShiftSummary, 2026-10-09): recall
  cross-check reads both sources; US orgs get a Deliveries tile and a
  "Deliveries you recorded today" list (receiving_events by received_by
  since midnight); the empty state only shows when there are neither
  scans nor deliveries.
- Scanner audit report (generateAuditReport, 2026-10-09): recall matches
  read both sources; US orgs get a Deliveries tile and a "Delivery
  records" section (date, product, lot or exempt, supplier, reference,
  store, quantity) for the period and store filter; `_auditDeliveries`
  holds the rows. auditExportCSV gained a leading "Record Type" column
  ("Shelf scan", "Delivery", "Delivery (file)"), "Supplier" and
  "Reference Document" columns, "Barcode" became "Barcode / GTIN" and
  "Placed By" became "Recorded By"; delivery rows follow the scans. The
  header changes apply to NO orgs too (structure, not copy).
- Scanner terminology (openTerminologyOverlay, 2026-10-09): four
  US-only entries (Receiving record, Key data elements, Immediate
  previous source, Expected delivery) rendered only when the US
  regulation toggle is on, with the English text passed to both language
  slots per the US-only rule; the Shelf placement citation no longer
  calls it the receiving CTE.
- Lot tracer result tiles had two style attributes on clickable tiles,
  so the browser dropped the padding and border on exactly the tiles that
  had an action. Merged into one attribute. That was the last item on the
  design review's "genuinely broken" list; the others were fixed in an
  earlier pass or live in standalone print documents with their own
  palette.
- Recalls panel dead query (2026-10-11). renderRecalls read trading_partners
  in its main Promise.all and mapped the result to `mfrPartners`, which
  nothing read since the manufacturer-era drill launcher went. Query and
  variables removed; one request fewer on every Recalls panel load.
- Overview investigation query short-circuited (2026-10-11).
  _renderOverviewLegacy still reads trading_partners (parallel batch) and
  then queried investigation_requests with `.in('manufacturer_id', [])`
  for every retailer without partners, a round-trip that always came back
  empty. The query now runs only when the org has active partners; the
  "Investigation deadline passed" risk signal is unchanged for legacy data.
  DECISION 2026-10-18 (Ian): the Investigations panel stays. It,
  createInvestigationFromPattern and the intelligence panel's
  investigation query are kept as they are; they only ever return rows
  for an org with manufacturer partners, which no new org has.
- Settings panel token sweep (2026-10-11), the first panel of the design
  review's cosmetic sweep (.ui-polish-checklist.md, local only). Inside
  renderSettings, _notifyToggleRow, the Suppliers card, the supplier form
  and import, and the Listed foods card, every inline `font-size:Npx`
  moved onto the type ladder (10 and the fractional 9.5 and 10.5 to
  `--fs-label`; 11 and 11.5 to `--fs-eyebrow`; 12 to `--fs-meta`; 13 and
  12.5 to `--fs-body`; 15 to `--fs-body-lg`) and every inline
  `border-radius:Npx` onto the radius ladder (4 and 6 to `--r-xs`, 7 and 8
  to `--r-sm`, 10 to `--r-md`, 20 to `--r-2xl`, 999 to `--r-pill`). 83
  sizes and 26 radii; the only visible changes are the half-pixel sizes
  rounding to the ladder and the 4px chip corners becoming 6px. The
  lookback `<select>` options read "90 days (3 months)" and so on, and
  "365 days (1 year, recommended)"; three em dashes on touched Settings
  lines were rewritten. Verified: node --check, a local preview of the
  whole panel in both themes plus the supplier modal, zero elements with
  an unresolved `var(--fs-*)` or `var(--r-*)`. Next panels follow the same
  recipe, one panel per pass, exact ladder matches only; sizes with no
  ladder step (14, 16, 18, 20, 24) are left for a judgment pass.
- Reports panel token sweep (2026-10-11), second panel of the cosmetic
  sweep, same recipe as Settings: renderReports, reportHeader,
  fetchReportData, the report helpers, runReport, matchCustomersToRecall
  and downloadReport. 105 inline sizes and 32 radii onto the ladders
  (exact matches only: 10, 11, 12, 13, 15, 22 and 6, 7, 8, 10). Left as
  pixels on purpose: font-size 14, 16 and 18 (no ladder step; a judgment
  pass decides between neighbors) and the 2px radius on progress bars.
  Trap found and closed: printReport copies the on-screen report HTML into
  a standalone print window whose stylesheet has no tokens, so the new
  `var(--fs-*)` sizes would have collapsed to the body size in print. New
  helper `_printLadderCss()` (right before printReport) reads the 16
  ladder values from the live page and printReport declares them on the
  print document's `:root`; verified in a detached document (22px, 10px
  and the 10px radius resolve). Any other print window that copies panel
  HTML must call the same helper; the certificate, plan and compliance
  documents build their own HTML with literal sizes and are unaffected.
  Copy fixed on the way: the Exposure notice empty state said "No
  manufacturer recalls on record ... manufacturer-pushed recalls" and now
  says pushed recalls; the card description and the print banner lost
  their em dashes; the "No customers matched" sentence was rewritten. The
  em dash empty-cell placeholder in table rows stays: it is a data mark
  used by every table in the file, not prose. Verified: node --check, a
  local preview of the cards grid and all six reports with sample data,
  zero elements with an unresolved ladder token.
- Seven more panels on the ladder (2026-10-18): Lot Lookup (renderLotCheck,
  _loadCorpOnShelf, runLotCheck), Terminology & Help, Receiving (the panel,
  its export, cancel and import helpers), Store Network (renderStores and
  the store form), Scan History (renderTraceability, renderTraceRows,
  traceabilityHeader), Staff Activity (renderStaff through showInvMsg) and
  the store manager overview. Same recipe: 159 inline sizes and 70 radii
  onto `var(--fs-*)` and `var(--r-*)`, exact ladder matches plus the
  half-pixel retirements (9.5 and 10.5 to `--fs-label`, 4px to `--r-xs`).
  Left as pixels: font-size 14 (Lot Lookup, 6), 20 (Lot Lookup, 1) and 16
  (Scan History, 1), and border-radius 9 (Store Network) and 2 (store
  manager progress bar). None of the seven ranges opens a print window.
  Three hex literals in Store Network (#34d399, #7a8985, #f5a623) are the
  map marker and status-dot colors and were left for the color pass. Em
  dashes on touched lines: Lot Lookup "Fuzzy matching:" sentence, the
  Staff header "N team members · staff and managers", and the hidden
  Default region label (display:none since Phase 0) rewritten; the
  empty-cell placeholder stays. Verified: node --check, one local preview
  page per panel with a Proxy-based client stub (Lot Lookup searched a
  recalled lot with a delivery; Staff opened the invite form; the store
  manager overview rendered its five tiles), zero unresolved ladder
  tokens, no console errors from the product code. Still on raw pixels:
  Overview and command center, Onboarding, Recalls (panel, composer, Live
  Recall), Compliance, Complaint Triage, Investigations, Consumer Notify,
  the intelligence panel and the lot tracer; several of those build print
  documents and need the `_printLadderCss()` check first.
- The rest of dashboard.html on the ladder (2026-10-18, second pass of
  the day). Every remaining function with inline sizes: Overview and
  command center (with the store map), Onboarding, Recalls (panel, drill
  launcher, manual recall, composer steps 1 to 4), Live Recall, Compliance
  (dashboard, start, categories, results, records request and plan cards),
  Complaint Triage (list, phone form, detail), Investigations (list and
  response modal), Consumer Notify, the intelligence panel, the lot tracer,
  the store timeline, the CSV import engine, the shell (sign-in, MFA
  modals, toasts, topbar, sidebar) and the static markup. 675 inline sizes
  and 279 radii, exact ladder matches plus the half-pixel retirements.
  Excluded on purpose, still on raw pixels: the standalone print and
  stored documents (_composerOpenCoordinationSheet,
  _generateFdaRecallNotification, _planRenderHtml, generateJointRecallReport,
  generateStoreAuditReport, generateComplianceReport, generateDrillReport,
  generateDrillCertificate, the _batchdDoc* helpers, injectPrintButton,
  printReport's own stylesheet), because their HTML renders in a window
  with no tokens. Left for the judgment pass: font-size 14 (29), 18 (11),
  16 (11), 20 (7), 32 (4), 13.5 (3), 24 (2), 8.5 (2, below the 10px
  floor), 40 (1) and border-radius 2 (15), 14 (13), 9 (5), 5 (4), 3 (2),
  18 (1). 27 em dashes on touched prose lines rewritten (colons, middle
  dots or full stops; the empty-cell placeholder stays). Verified: node
  --check, and a whole-app preview: `.claude/build-app-preview.py` writes
  `.claude/app-preview.html`, the real dashboard.html with the Sentry
  loader removed and the Supabase client swapped for `.claude/app-stub.js`
  (a query-builder stub over sample rows for every table the dashboard
  reads, plus auth, rpc, storage and channel stubs), so the page signs in
  through its own boot path and every panel renders through showPanel.
  Checked in dark and light: all seventeen panels, Live Recall, the drill
  launcher, the composer, the store timeline, the triage phone form and
  detail (with the intelligence block), the investigation response modal,
  the CSV import modal, compliance category and results views, zero
  elements with an unresolved ladder token, no console errors from product
  code (MapTiler answers 403 on localhost, expected). The lot tracer was
  checked through its own input on the Scan History tab (recall banner,
  tiles, supply chain trace). Not visually confirmed: the MFA challenge
  modal (the stub has no enrolled factor). The three .claude files are
  local only, like serve.js; rebuild the preview after editing
  dashboard.html.
- Judgment pass on the off-ladder sizes (2026-10-18, dashboard.html).
  Every inline size with no exact ladder step now sits on the nearest
  step, with these calls: 8.5 up to `--fs-label` (the 10px floor), 13.5
  to `--fs-body`, 14 to `--fs-body` for plain text and `--fs-body-lg`
  for bold titles and counts (31 places), 16 and 18 to `--fs-h4` (26),
  20 and 24 to `--fs-h3` (10), 32 to `--fs-h2` (4), 40 and the results
  page's 56px score to `--fs-h1` (2). Radii: the 2px and 3px bars and step
  tracks are pills (`--r-pill`, they are fully rounded by construction),
  3 and 5px chips to `--r-xs`, 9px buttons and segmented controls to
  `--r-md`, 14px cards to `--r-lg`, the two MFA boxes to `--r-xl` and the
  18px investigation modal to `--r-2xl` like the other modals. One
  multi-value radius (a bar chart column's top corners) stays. The
  visible changes are small: composer step titles 20 to 22px, the big
  results score 56 to 46px, bold 14px titles to 15px.
- Color pass (2026-10-18, dashboard.html). The design review's checklist
  was mostly stale (an earlier pass had already removed the blue CTA, the
  #7ba9ff statutes, the hardcoded scrims, the stale emerald and the white
  light-theme cards), so what remained: every black `rgba(0,0,0,…)`
  shadow in the shell CSS and in panel code moved onto `--shadow-sm/-md/
  -lg/-xl/-accent` (sidebar, topbar, modals, help tip, auth card, KPI
  hover, drill and advance buttons, toast), the light-theme literals
  (`#dc2626`, the placeholder rgba, the kpi and auth shadows) onto tokens,
  `.alert-text strong` onto `--danger`, the CSV preview zebra and header
  onto `--surface2`, the warn fallback literal dropped, the compliance
  gap "Go" buttons onto `--accent`, and the authority contact cards onto
  one neutral treatment (name in `--text`, link in `--accent`; the `color`
  field in the array is now unused). Recall stage colors: two new tokens
  `--stage-pulled-rgb` and `--stage-disposed-rgb` in both theme blocks of
  dashboard.html, index.html and assets/design-tokens.css (dark keeps the
  old yellow and light green; the light values 138,106,0 and 46,125,79
  are Claude's picks for 4.5:1 on white, for the designer to confirm);
  `_RECALL_DETAIL_STAGE_COLORS`, the stage badge tints and the gray
  fallbacks read them (`--muted` for the fallback). Maps: `_MAP_STATUS_
  COLORS.none`, renderStoreMap's fallback, the Store Network marker colors,
  the legend text and note and the map pane background are tokens, and a
  new `_resolveCssColor(c)` turns any var() color into a plain rgb()
  before it reaches Leaflet (the 2026-09-05 comment said var() breaks SVG
  presentation attributes; a probe in Chromium showed it resolves, but
  the dots no longer depend on it). Print and stored documents got
  literal colors for the tokens they referenced in a window that has
  none (`var(--accent-on-primary)` to #065f46, the accent, warn and info
  rgb triples to their light values). Left on purpose: white text on
  danger, warn and info badges, buttons and toasts (signal colors, not
  surfaces), the white box behind the MFA QR code, the dark-on-white text
  inside Leaflet's white popups, the marker ring `#0a1814`, the Leaflet
  attribution, the `theme-color` meta and the print stylesheets. Verified:
  node --check on both apps, the whole-app preview in both themes (marker
  fills resolve to rgb values per theme on the overview, Store Network and
  Live Recall maps; stage badges tint from the new tokens; sidebar and
  modal shadows read the theme's shadow tokens; the gap button and
  authority cards are neutral), zero unresolved tokens.
- Stylesheet pass (2026-10-18, dashboard.html `<style>` block). Every
  rule's raw font size (49), radius (24) and transition duration (26) now
  reads a token; the only judgment calls were the brand mark and card
  values at 16 and 18px to `--fs-h4`, the empty-state icon size to
  `--fs-h2`, the `.text-lg/-xl/-2xl` utilities to h4, h3 and h2, the 9px
  logo corner to `--r-md`, the 2px score bars to `--r-pill` and the half
  pill chips (`padding: 2px 8px; border-radius: 10px`) to `--r-pill`. The
  three patch layers collapsed: `.store-table th` is one rule with the
  later declaration's values, `.kpi-card` has one transition (box-shadow,
  transform, border-color) and one hover, and the `!important` overrides
  for `.nav-item` and `.kpi-card` are gone. `:focus-visible` uses
  `var(--ring-focus)` instead of a plain outline. A `.field textarea`
  rule joins `.field input` and `.field select`. Light-theme nav badges
  take their ink from `--background-base` like the dark rule. Already
  true before this pass, so the checklist entries were stale: body and
  buttons use `var(--font-body)` (Figtree), the mobile sidebar rule, the
  duplicate motion block and the duplicate keyframes are gone, the select
  chevron has a light-theme variant.
- Remaining design review items in panel code (2026-10-18). Inline
  transition durations onto `--dur-fast/-normal/-slow` and
  `--ease-out` (39 lines; print documents excluded). A styled
  `_confirmDialog(message, { okLabel, cancelLabel, danger, title })`
  (before showToast; Promise<boolean>, Enter confirms, Escape or the scrim
  cancels, focus starts on Cancel) replaces every native confirm() except
  the one inside the print document runtime (saveAsPdf), which has no
  access to it: 2FA disable, composer discard (now async), resolve manual
  recall, send reminders, cancel an expected line, deactivate or delete a
  store, delete a learned pattern, deactivate a member, cancel a records
  request drill, delete a supplier, delete a listed-food decision. Icons:
  `_ICON_PATHS` gained x, arrow-right, external-link and chevron-down; the
  "Recall history" report card's emoji is `_ico('alert-triangle',20)`; the
  trailing arrows on 60 CTA labels (buttons, onboarding steps, composer
  nav, "Sign in", "Verify", "Send invitation email", "Launch drill", the
  triage step buttons) are `_ico('arrow-right',12)`; "Open scanning app",
  "Map" and "Notify / report" carry external-link; "Clear" carries x; the
  "View audit trail" button carries a chevron that turns when the log
  opens (toggleCollabLog reads a `data-collab-toggle` attribute). Arrows in
  prose ("Notified → Acknowledged", "Reports → Recall history") stay.
  Complaint Triage: "Log phone complaint", "Submit and triage", "View all
  complaints", "Log another" and the section labels are sentence case; the
  phone complaint form uses the shared `.field` component (16 fields, the
  state wrapper included) instead of hand-rolled label and input pairs.
  The five citation lines under compliance steps and report cards dropped
  their 70 percent opacity. Toasts and the danger badges (nav, triage,
  recall counts, the consumer notify Send button) take their ink from
  `--background-base`, the documented auto-inverting pattern. Keyboard:
  a small shim after showPanel gives every rendered element with onclick
  (and no native focusability) `role="button"` and `tabindex="0"`, and
  Enter or Space activates it; a MutationObserver re-tags after each
  render. Verified: node --check; the whole-app preview rendered every
  change (dialog opens with focus on Cancel and a red confirm button,
  Escape resolves false; the triage form fields are mono inputs on the
  input background with uppercase labels; report icons and CTA arrows are
  SVGs with no literal template text anywhere; toast ink is the base
  color; the sign-in button carries its arrow; the audit log chevron
  flips). Still open on the checklist: spacing onto `--s-*` (incremental
  by rule), and every scanner (index.html) item.
- Scanner design review pass (2026-10-24, index.html). The same ladder
  recipe as the dashboard: every raw font size, radius and transition in
  the `<style>` block and in panel code moved onto `--fs-*`, `--r-*`,
  `--dur-*` and `--ease-out` (825 sizes, 301 radii, 60 transitions), with
  the dashboard's judgment calls (14 to body or body-lg by weight, 16 and
  18 to h4, 20 and 24 to h3, 26 and 32 to h2, 48 to h1; bars to pills,
  chips to xs, 9 to md, 14 to lg, 20 to pill on chips and 2xl on sheets).
  Kept on purpose: 16px on the four input rules and the quick-check
  input (iOS zooms when a focused input is smaller; commented in the
  stylesheet) and the three print documents (printExposureNotice,
  printAuditReport, fsmaViewStoredPlan). Colors: the light-theme
  placeholder, phase header border, mode toggle, input background and
  white surfaces onto `--text-muted`, `--border`, `--surface2` and
  `--background-surface`; the light accent inks onto
  `--accent-on-primary`; the confidence badge, required-store and recall
  banner tints onto the warn and danger rgb triples; the onboarding
  check mark onto `--accent-on-primary`; the complaint submit ink and
  the two danger buttons onto `--background-base`; the primary button
  shadow onto `--shadow-accent`; the history filter chevron onto the
  muted token with a light-theme variant; the drawer "Navigate" label
  at full opacity. `:focus-visible` uses `var(--ring-focus)`, and the
  keyboard shim from the dashboard (role, tab stop, Enter and Space on
  elements with onclick) sits after showView. Already fixed before this
  pass, so the checklist entries were stale: the Figtree body font, the
  Norwegian placeholder precedence bug, the sign-in tab ink, the picker
  color-scheme, the Tailwind blues, the hex-alpha readiness pill, the
  drawer scrim, the camera-frame hex, the ack dot, the pull tint and
  the light-only record-card border. BUG FOUND AND FIXED on the way:
  populateFsmaExportStores read a manager-stores variable nothing had
  ever declared, so opening the manager Audit tab threw a ReferenceError
  and neither store dropdown populated; it now takes store names from
  the loaded scans like populateMgrAuditStores. Noted, not changed:
  fetchUserProfile (second script block) calls applyManagerUI (third
  block); production is safe because the membership query's network
  round-trip lands after parsing, but a client that answered from cache
  on microtasks alone would hit a ReferenceError (the preview stub had
  to resolve queries on a later task to match production). Verified:
  node --check (4 blocks); a stubbed whole-app scanner preview
  (`.claude/build-scanner-preview.py` writes `.claude/scanner-preview.
  html` from index.html with the same `app-stub.js`) at phone width:
  sign-in, store picker, the login recall alert, Shelf and Receiving
  modes, History, Recalls, Settings, the manager dashboard and its
  Audit (store dropdowns populate), FSMA and Receiving tabs, the Help
  overlay, light theme; zero unresolved ladder tokens anywhere and no
  errors on load. Camera access is blocked in the preview, so the
  shelf phases past "Starting camera" and the shift summary were not
  exercised. Left as literals on purpose: the photo lightbox and camera
  overlays (theme-invariant media chrome, checklist items 137 to 139),
  the brand mark fill, the print stylesheets.

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
  manual-recall management lists; loadMgrData (17873, but it also loads
  scan_recall_matches, which holds Path B rows); checkActiveRecalls
  when called without a cache (callers at 9781, 10466, 11802, 19233).
Moved to "reads both" on 2026-10-09: index.html buildShiftSummary and
generateAuditReport (recall_distributions joined to recall_events,
mapped to the recalls shape the exact-match code reads), and
dashboard.html renderIntelligencePanel (which read recall_events only
and now adds the org's active recalls table rows).

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

Shared auth lives in `netlify/lib/auth.js` (outside functions/ so Netlify
does not deploy it; `node_bundler = "esbuild"` in netlify.toml bundles it
into each caller). It exports verifyUser, activeMembership,
isPlatformAdmin, orgAiEnabled, requireMember, requireAi, internalSecretOk
and json. Functions run with the service-role key, which bypasses RLS, so
these checks are the tenant boundary for every function.

Six dead functions were deleted 2026-09-20 (investigation-notify,
manufacturer-welcome, supplier-invite, staff-invite, staff-invite-accept,
bootstrap-off-seed), along with accept-invite.html and send-invite's
demo_request branch. 13 functions remain.

| Function | Purpose | Auth | Env vars | Called by |
|---|---|---|---|---|
| ai-analyze.js | Anthropic proxy: synthesize_investigation, nl_query | `requireAi`: Bearer JWT, active member of body `org_id`, org plan pov/active | ANTHROPIC_API_KEY, SUPABASE_SERVICE_KEY | dashboard.html |
| fetch-recall-feeds.js | Daily FDA + Mattilsynet import into recalls per org | Scheduled, not URL-callable | SUPABASE_SERVICE_KEY, SUPABASE_URL, SCHEDULED_FUNCTIONS_DISABLED, URL | netlify.toml schedule (fetches the upstream feeds directly, NOT via recall-feeds.js) |
| notify-consumers.js | Consumer recall notification emails | Bearer JWT corp_admin of org_id, AND the recall must belong to that org | RESEND_API_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL | dashboard.html |
| notify-event.js | Per-event emails: recall_pushed, complaint_filed, drill_scheduled | INTERNAL_NOTIFY_SECRET or Bearer JWT (active membership only) | APP_BASE_URL, INTERNAL_NOTIFY_SECRET, RESEND_API_KEY, SUPABASE_SERVICE_KEY | dashboard.html, triage-complaint.js |
| ocr.js | Anthropic vision proxy: identify_product, read_barcode, localise_lot, extract_codes, extract_raw_cluster | `requireAi`: Bearer JWT, active member of body `org_id`, org plan pov/active | ANTHROPIC_API_KEY, SUPABASE_SERVICE_KEY | index.html (callOcrFunction) |
| push-recall-email.js | Recall alert emails to org contacts, both recall sources | INTERNAL_NOTIFY_SECRET in the body, constant-time, fails closed | INTERNAL_NOTIFY_SECRET, RESEND_API_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL | webhook-recall.js only |
| recall-escalation.js | 2h and 24h escalation emails for unacknowledged recalls | Scheduled, not URL-callable | RESEND_API_KEY, SCHEDULED_FUNCTIONS_DISABLED, SUPABASE_SERVICE_KEY, SUPABASE_URL | netlify.toml schedule |
| recall-feeds.js | Proxies rasff, mattilsynet_rss, mattilsynet_page feeds to XML | Bearer JWT (any active session) | None | index.html only |
| recall-reminder.js | On-demand reminder emails for the dashboard buttons | Bearer JWT, active corp_admin of orgId | RESEND_API_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL | dashboard.html |
| send-invite.js | Staff invitation emails | Bearer JWT corp_admin **of the invitation's own org** (or platform admin); org name, role and inviter come from the invitation row | RESEND_API_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL | dashboard.html, admin.html |
| trace.js | RETIRED 2026-09-20, always answers 410 | None | None | old QR codes only |
| triage-complaint.js | Complaint intake, AI triage, follow-up emails | Public form (honeypot + per-IP/org/email rate limits; org must be pov/active while PUBLIC_COMPLAINTS_REQUIRE_PLAN is true). Staff identity proven by Bearer JWT, never by body fields | ANTHROPIC_API_KEY, INTERNAL_NOTIFY_SECRET, RESEND_API_KEY, SUPABASE_SERVICE_KEY, URL | complaint.html, complaint-widget.js, dashboard.html, index.html |
| webhook-recall.js | ERP webhook: creates recall_events and distributions for manufacturer orgs | X-Batchd-Api-Key, sha256-hashed against organisation_api_keys; org must be type manufacturer; 50 events/hour | INTERNAL_NOTIFY_SECRET, SUPABASE_SERVICE_KEY | External ERP systems (documented in docs.html) |

Notes:
- fetch-recall-feeds.js line 143 contains a stray control character.
  Node parses the file fine, but grep treats it as binary; use
  `grep -a` when searching it.
- The header comment in fetch-recall-feeds.js says it is also callable
  from the dashboard. No client code calls it, and scheduled functions
  cannot be invoked by URL.
- Model IDs in ai-analyze.js and ocr.js pin claude-sonnet-4-20250514;
  ocr.js and triage-complaint.js also use claude-haiku-4-5-20251001.
- ocr.js owns its prompt text (2026-09-20). The client names a template
  (`promptId`: lot_extract_v1, autocapture_v1) and sends only
  parameters (region, productName, contextHint, cropped, ocrText,
  phase), each length-capped server-side. The US/EU regulatory wording
  for lot extraction now lives in ocr.js REGION_HINT; the scanner passes
  the signed-in user's _userRegion, so the jurisdiction gate is still at
  the leaf.

## Security posture (client-side scan 2026-09-13)
Scanned every .html and .js file in the repo root for JWTs, API keys,
service-role keys, webhook URLs and password literals.
- One Supabase JWT appears in admin.html, dashboard.html, index.html,
  join.html and signup.html. It is the same token in all five and its
  payload says role anon. Expected.
- The demo account's password literal was removed from admin.html
  2026-09-20 and must be rotated: it is still in git history.
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

## Commercial plan flag (organisations.plan)

Added 2026-09-20. Values: `trial` (default for self-serve signup), `pov`,
`active` (paying), `churned`. Only a platform admin can change it;
migration 020's `batchd_guard_org_commercial_columns` trigger blocks
plan, billing_status, trial_expires_at and is_internal for everyone else,
and admin.html's dropdown is the UI.

What it gates:
- Every Anthropic-backed feature. ocr.js and ai-analyze.js use
  `requireAi`, which needs plan IN ('pov','active'). The scanner and the
  dashboard read the plan at sign-in into `window._orgAiEnabled` and skip
  the call (one toast, not one per frame) rather than 403-ing repeatedly.
- Public complaint intake, while `PUBLIC_COMPLAINTS_REQUIRE_PLAN = true`
  in triage-complaint.js. Staff intake is unaffected; AI triage still
  only runs for pov/active, others get the manual-review fallback.

A new org therefore has no AI and no public complaint intake until someone
sets its plan. That is deliberate: Anthropic spend is billed to Batch'd.

Rollout decision 2026-09-20: every organisation that existed at rollout was
put on `pov` in one pass (`migrations/020a_set_existing_orgs_pov.sql`) so
nothing broke on deploy day. Orgs already `active` (paying) and `churned`
were left alone. That file refuses to run a second time, so a later
downgrade from admin.html cannot be silently undone by re-running it.

## Market & jurisdiction
- Only market: United States (FSMA 204). Decided 2026-09-29.
- Norway was the testing ground until 2026-09-29 and is abandoned for
  the foreseeable future. The NO code paths are frozen (see the
  decision at the top of this file).
- Ian is a US citizen living in Norway temporarily; that is a fact
  about the founder, not the market.

## Jurisdiction precedence (critical: never mix jurisdictions)

FROZEN 2026-09-29. This section documents how the existing region layer
works so legacy NO rows keep rendering correctly and so nobody mixes
jurisdictions by accident. It is not an instruction to build Norwegian
variants of anything new. New code is US-only.

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

1. Organization default: organisations.region. Editable in
   Settings, Organization, Region (corp_admin only). Applied to every
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
| `_orgDefaultRegion` | `organisations.region` | The org's stated default | Only the Settings, Organization card dropdown (so the org admin can see and edit it) |
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
3. The org-level dropdown in Settings, Organization is the ONLY surface
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
  regulatory region markers. dashboard.html complies since 2026-10-08:
  every pictographic emoji became an inline SVG through `_ico(name,
  size)` (defined after esc(); 29 Lucide-style paths in `_ICON_PATHS`).
  Use `_ico` for any new icon in the dashboard. index.html was checked
  on 2026-10-09 and has no pictographic emoji at all (a full-range scan
  found only flag glyphs and the text marks). The text marks ✓ ✗ ⚠ ● ★
  stay in both files as typographic status marks: in the scanner 40 of
  the 73 are in textContent, toast, i18n or frozen Norwegian strings,
  where an SVG would need innerHTML writes on messages that include
  error text. Treat them as text, not as emoji to sweep.
  .ui-polish-checklist.md tracks the rest of the design review.
- No purple or blue gradients. No left-border accent cards.
- One saturated color: mint or emerald. Red, orange and blue are state
  signals, never decoration.

### Recall stage tokens
`--stage-pulled-rgb` and `--stage-disposed-rgb` (2026-10-18) color the
two Live Recall stages that sit between warn and accent. Defined per
theme in all three token copies; read as `rgb(var(--stage-pulled-rgb))`
or with an alpha. Anything handed to Leaflet goes through
`_resolveCssColor` first.

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
Type, radius and motion ladders: since 2026-10-18 every rule in
dashboard.html's `<style>` block and every inline style in its panels,
modals and shell read `var(--fs-*)`, `var(--r-*)`, `var(--dur-*)` and
`var(--ease-out)`. The one exception is the standalone print and stored
documents, which keep literal values because their window has no
tokens. index.html followed on 2026-10-24 (its inputs keep 16px for
iOS). Use the ladders for any new style, `_ico()` for any icon in the
dashboard, and `_confirmDialog()` instead of confirm(). A print window
that copies panel HTML must declare the ladder on its own `:root`
through `_printLadderCss()`, as printReport does.

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
  traceability "Scan History", receiving "Receiving" (2026-10-07), staff
  "Staff Activity", compliance
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
  trace.html (now a retired notice), complaint-widget.js and the three
  retired stubs. manufacturer-welcome.js, supplier-invite.js,
  bootstrap-off-seed.js, investigation-notify.js, staff-invite.js,
  staff-invite-accept.js and accept-invite.html were deleted
  2026-09-20. landing.html's demo form now POSTs to a branch of
  send-invite.js that no longer exists.

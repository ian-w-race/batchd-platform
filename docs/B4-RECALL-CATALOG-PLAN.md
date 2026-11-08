# B4: one recall catalog. Build plan

Written 2026-11-01 for Ian. Planning only: no migration and no app code come
with this document. It is item B4 of docs/PLATFORM-IMPROVEMENT-PLAN.md
(Phase 3, the recall engine). Facts come from docs/SCHEMA-REFERENCE.md
(production, 2026-11-01), read-only counts run on production and staging on
2026-11-01, and a line-by-line inventory of every recall read and write in
dashboard.html, index.html, the Netlify functions and the migrations made the
same day. Ian answered every question in section 6 on 2026-11-01; stage 0 ran the same day and stage 1 followed.

## 1. What B4 is for

Three promises in the improvement plan depend on recall data being clean and
read one way:

- "When a recall fires, every affected store knows within minutes." The
  stores can only be told about recalls the apps can see, and today each
  screen decides for itself what counts.
- "A regulator or an insurer can trust what it says." Counts that differ
  between the sign-in alert, the History tab and the Recalls panel are not
  trustworthy.
- "It is the retailer hub that manufacturers and distributors plug into."
  The portals push recalls into the same model; it has to hold.

B4 is done when: each public recall is stored once instead of copied into
every organization; one database function answers "what is active for this
organization right now"; every screen in both apps reads that function; and
CLAUDE.md's "read both sources" rule can be deleted because there is only
one source to read.

## 2. What exists today (facts)

### 2.1 Two tables, two shapes

- `recalls` (9,154 rows): manual recalls typed by the retailer, the linked
  rows a composer push leaves behind (one per lot, `is_pushed`,
  `recall_event_id`), and public feed entries copied per organization
  (`source` fda or mattilsynet). It has `description`, no `reason` and no
  `severity`; severity is folded into the description text. Every column
  except `id` is nullable and there is no unique index besides the primary
  key.
- `recall_events` (9 rows: 5 real, 4 drills) with `recall_distributions`
  (8) and `recall_acknowledgements` (34): the push chain. The retailer's
  own composer pushes, drills, and in the past manufacturer pushes. It has
  `barcode` (not `barcode_number`), `reason` and `severity`, `is_drill`,
  `closed_at`. The Live Recall page, the escalation emails and the five-step
  chain live here and work.
- `scan_recall_matches` (2 rows on production, 28 on staging): a scan that
  matched a recall. `recall_id` has a foreign key to `recalls`, so a pushed
  recall's match points at its linked `recalls` row and carries
  `recall_event_id` as well (CLAUDE.md, "two paths").
- `recall_notices` (migration 040): a supplier notice read by AI, linked to
  the event it became.

### 2.2 The public feed copies are mostly junk

| Source | Rows | Owned by an organization | Distinct entries | Note |
|---|---|---|---|---|
| fda | 7,734 | 784 (3 orgs, 414 distinct entries) | | 25 added in the last 14 days |
| fda, no organization | 6,950 | none | 61 | all created 2026-04-15 to 2026-04-21 |
| mattilsynet | 1,438 | 48 (26 distinct) | | frozen NO feed, URL answers 404 |
| mattilsynet, no organization | 1,390 | none | 11 | same April week |

The 8,340 rows with no organization come from one week in April 2026, an
earlier importer defect that wrote the same 72 entries about 115 times each.
No row-level policy lets a member read a row with a null organization, so no
screen has ever shown them; only `sweep_recall_matches` touches them (it
allows "shared no-org recalls" on purpose). The real per-organization feed
data is 832 rows holding about 440 distinct entries. The improvement plan's
"7,710 copied rows become about 2,600" was based on the raw count; the
catalog will hold about 440 entries plus whatever the feed adds, roughly 25
a fortnight.

### 2.3 Who gets a copy

`fetch-recall-feeds.js` (daily 06:00 UTC) reads the FDA enforcement report
(50 newest), and for every US retailer organization writes one `recalls` row
per FDA entry with a stable id derived from the organization and the recall
number (or product and report day). `organisations.recall_source` is not
read: every US organization gets every FDA entry. The Mattilsynet leg still
runs for non-US organizations against a feed that answers 404. The scanner
also carries three client-side importers of its own (`fetchFDARecalls`,
`fetchRASFFRecalls`, `fetchMattilsynetRecalls` in index.html, Settings) that
insert per-organization rows with random ids; they predate the server
importer and are a second writer of the same data.

### 2.4 Seventeen places build their own "active recalls" list

The scanner builds the list in nine functions and the Retail app in eight,
each with its own query pair and its own rules. The inventory found these
differences, all of which the one function removes by construction:

- Linked pushed rows (`is_pushed`) are dropped in four scanner readers and
  kept in five (multi-store tile, quick check, shift summary, audit report,
  the `checkActiveRecalls` fallback), where a pushed recall counts twice. In
  Retail the Intelligence panel, the lot tracer, Lot Lookup and three
  Recalls-panel tabs keep them too.
- Closed events (`closed_at`) are excluded in three scanner readers and
  ignored in six. Retail's Recalls panel separates them; its lot tracer and
  Intelligence panel do not.
- Drills are excluded almost everywhere, but the recall history report's
  pushed side has no drill filter.
- Two Retail readers (Intelligence panel, lot tracer) read `recall_events`
  with no organization filter at all and rely on row security.
- Of the three scanner functions that create a manual recall, only one
  calls the sweep that back-matches existing scans.
- Eleven different in-memory recall shapes flow through the scanner (raw
  row, normalized pushed, pre-placement pushed, quick-check pushed without
  a barcode, drawer, receiving, and so on). Retail adds seven more.

### 2.5 Rules that must survive (CLAUDE.md, "Database rules")

Pull tracking lives on `scans.removed_from_shelf_at`. A recall requires
action only when it is active, an organization scan matches it by exact lot
or barcode, and that scan is still on shelf; drills never count. Feed
recalls count as active only when confirmed in `scan_recall_matches`;
manual and pushed recalls count on an exact match to an on-shelf scan. A
received lot with no shelf scan is held at receiving and does not count.
The per-step acknowledgement timestamps are never overwritten. Deleting a
`recalls` row must not cascade to its matches; deleting a `recall_events`
row cascades to its chain.

## 3. The target model

Additive. Nothing is dropped until the last stage, and every stage leaves
both apps working on the previous one.

### 3.1 New table: `recall_catalog`

One row per public recall entry, no organization.

| Column | Purpose |
|---|---|
| `id` uuid | primary key |
| `source` text | 'fda' now; 'fsis' when B5 adds USDA; 'mattilsynet' only for the 26 legacy entries |
| `external_key` text | FDA: recall number plus a hash of the product description, because one FDA recall number covers several product lines; otherwise product and report day. UNIQUE (source, external_key) |
| `recall_number` text | the FDA number as published, "F-1234-2026" |
| `product_name`, `product_description` text | the 120-character name the apps match on, and the full text |
| `code_info` text, `lots` text[] | the lot text as published, and the lots parsed from it (B5 improves the parser) |
| `gtins` text[] | GTINs found in the entry, if any |
| `recalling_firm`, `classification`, `reason`, `feed_status` text | Class I, II or III; the firm's stated reason; the FDA status (Ongoing, Completed, Terminated) |
| `report_date` date, `published_at` timestamptz | as published |
| `raw` jsonb | the feed entry, for later re-parsing without a new fetch |
| `created_at`, `updated_at` | |

Row security: SELECT for any active member (`batchd_has_active_membership()`)
and platform admins; no anon access; writes by the service role only (the
importer). The catalog is public information, so there is nothing
tenant-specific to protect; what an organization did about an entry lives
in the next table.

### 3.2 New table: `recall_catalog_org`

What one organization has done with one catalog entry.

| Column | Purpose |
|---|---|
| `organisation_id`, `catalog_id` | primary key |
| `first_seen_at` | when the entry first appeared for this organization |
| `reviewed_at`, `reviewed_by` | an admin looked at it |
| `dismissed_at`, `dismissed_by`, `dismiss_note` | "not our product", which hides it from the active list but keeps it in the feed history |
| `matched_at` | set by the sweep when a scan or receipt of this organization matched the entry |

Row security: members of the organization read; corp admins and store
managers write; platform admins everything.

### 3.3 `scan_recall_matches` grows one column

`catalog_id uuid REFERENCES recall_catalog(id) ON DELETE CASCADE`, nullable,
with a second unique index (scan_id, catalog_id). A match then points at
exactly one of: `recall_id` (manual), `recall_event_id` plus its linked
`recall_id` (pushed), or `catalog_id` (feed). The existing writers do not
change; a new sweep for catalog entries writes the third kind.

### 3.4 One function: `batchd_active_recalls(p_org uuid)`

SQL, STABLE, SECURITY INVOKER so row security still applies. Returns one
row per active recall for the organization, in one shape:

`kind` ('manual' | 'pushed' | 'feed'), `recall_id`, `event_id`,
`catalog_id`, `product_name`, `lot_number` (first lot), `lots` text[] (every
lot: the pushed list split, the linked rows, the catalog's parsed lots),
`barcode`, `gtins`, `description`, `reason`, `severity`, `source`,
`published_at`, `closed_at` (always null here), `dismissed` boolean,
`matched` boolean (a confirmed match exists for this organization),
`recalling_firm`.

Rules inside the function, once:

- manual: `recalls` of the organization with `active`, not `is_pushed`, no
  `recall_event_id`, and source not a feed source.
- pushed: `recall_events` joined through `recall_distributions` on
  `retailer_org_id = p_org`, `is_drill = false`, `closed_at IS NULL`; lots
  from the linked `recalls` rows.
- feed: `recall_catalog` entries for the organization's region (US gets
  fda and later fsis; a legacy NO organization gets mattilsynet), left
  joined to `recall_catalog_org` for `dismissed` and `matched`.

A second function, `batchd_store_recall_status(p_org, p_store)`, applies
the "requires action" rule (active, matched, still on shelf) per store. It
is what the C3 live board and the scanner's badges read later; B4 ships
the first function and leaves the second designed but unbuilt unless the
scanner's badge work needs it in stage 2.

### 3.5 The importer writes once

`fetch-recall-feeds.js` upserts into `recall_catalog` on
(source, external_key) and no longer writes `recalls` rows. It keeps the
job log and the 15-second budget. After each run it calls a new definer
function `sweep_catalog_matches(p_catalog_id)` for every new entry, which
matches the entry's lots and GTINs against every US organization's scans
and receipts (the same exact-lot or barcode rule as `sweep_recall_matches`)
and writes `scan_recall_matches` rows with `catalog_id`, setting
`recall_catalog_org.matched_at`. The Mattilsynet leg is removed (the feed
answers 404; the NO layer is frozen). The scanner's three client-side
importers are removed.

### 3.6 What does not change in B4

`recall_events`, `recall_distributions` and `recall_acknowledgements` stay
as the push chain. Live Recall, the escalation and reminder emails, the
drill launcher, the composer and the supplier notice flow keep writing them
exactly as today. Folding pushed recalls into the catalog is a later
decision, if ever: the portals (docs/PORTALS-PLAN.md, Phase 4) push through
`recall_events`, and the function already presents them in the same shape
as everything else, which is what the screens need.

## 4. Stages and pull requests

Each stage is one or two pull requests through staging and a deploy
preview, as usual. Migrations go to staging first, then production, with
the schema fingerprint rerun.

| Stage | Contents | Done when |
|---|---|---|
| 0. Hygiene (data only, no code). **Done 2026-11-01** | Deleted the 8,340 feed rows with no organization on production, backed up to `backup.recalls_orphan_feed_20261101` (scripts/cleanup-orphan-feed-recalls.sql). Staging had none; the block was rehearsed there rolled back, then dry-run on production rolled back, then run. | `recalls` went from 9,184 to 844 rows (784 fda, 48 mattilsynet, 12 manual or pushed); 0 orphans left; `scan_recall_matches` unchanged |
| 1. Database (migration 043). **Done 2026-11-01, staging then production** | `recall_catalog`, `recall_catalog_org`, the `catalog_id` column and index, `batchd_active_recalls`, `sweep_catalog_matches`, policies and grants (migrations/043_recall_catalog.sql). Verified on staging with rolled-back SQL: the function lists the QA organization's 11 pushed and 0 manual recalls, the same as the old query pair; a test catalog entry swept 2 scans and stamped matched_at; the corp admin sees it as matched and can dismiss it; another organization's id returns no rows; the deactivated member gets no rows; anon is refused. | Staging and production have the objects; the function returns the same recalls for the QA organization as the scanner's sign-in list does today |
| 2. Importer (code). **Built 2026-11-08** | `fetch-recall-feeds.js` writes the catalog and sweeps each new entry. Order change (2026-11-08): it also keeps writing the per-organization copies until every screen reads the function, so no feed recall goes dark in the apps in between; the delete of those copies moves to stage 6. The Mattilsynet leg and the scanner's own importers and fetch button are removed; the health check reads the catalog for the stale-feed rule. | The first scheduled run adds catalog entries (job_runs detail shows catalog_added and catalog_matches) and the per-org rows as before |
| 3. Data move (migration 044) | The per-organization feed rows (934 fda, 48 mattilsynet on 2026-11-08) are copied into the catalog (deduplicated by recall number and product, or product and day) with `recall_catalog_org` rows for every (organization, entry) pair that existed, `dismissed_at` set where the row was inactive. Nothing is deleted yet. | Row counts reconcile in a verification query |
| 4. Scanner (code) | The nine readers call `batchd_active_recalls` through one normalizer that produces the cache shape (`_cachedActiveRecalls`, with `_linkedRecalls` from `lots`). The three client-side importers go. The two manual-recall writers that skip the sweep call it. | The e2e core-flow chain passes; the sign-in alert, History banner, pre-placement warning, receiving hold, multi-store tile, quick check, shift summary, audit report and drawer all show the same set |
| 5. Retail (code) | The eight readers call the function. The Recalls panel's Feed tab reads the catalog with per-organization state (dismiss, reviewed). Lot Lookup, the lot tracer and the Intelligence panel lose their unfiltered `recall_events` reads. | The e2e suite passes; the Recalls badge, Dashboard tiles, Lot Lookup and reports agree with the scanner |
| 6. Retire the copies; rules and docs | The importer stops writing per-organization feed rows and they leave `recalls`, backed up (matches that pointed at them, 0 on production, repointed to the catalog); recall-feeds.js is retired. CLAUDE.md: the "read both sources" rule becomes "every recall check calls `batchd_active_recalls`"; the two-paths section gains the catalog path; SCHEMA.md's stale lines are corrected; a repository check refuses a new direct read of `recalls` or `recall_events` for a list in the pages. | `select count(*) from recalls where source in ('fda','mattilsynet')` is 0; `node scripts/check.mjs` fails on a pasted-back query pair |

Order of value: stage 0 is worth doing on its own. Stages 1 to 3 build and
fill the catalog while the apps keep working on the copies; stage 6 removes
the copies. Stages 4 and 5 are where the hours were lost
(the inconsistencies in 2.4) and where the risk is; each reader moves in
its own commit with the e2e suite run on the preview.

## 5. Verification

- Rolled-back SQL on staging as each role (corp admin, store manager,
  deactivated member, anon, service role) before and after each migration.
- A Node test for the normalizer that turns function rows into the cache
  shape, against fixtures for all three kinds and a pushed recall with two
  lots.
- The end-to-end suite on every preview; the core-flow chain already covers
  a pushed recall through sign-in alert, pre-placement warning and match
  row. A new e2e step: a catalog entry whose lot matches a staging receipt
  shows under Feed alerts as matched.
- A reconciliation query after stage 3: for every organization, the set of
  (recall number, product) the function returns equals the set the deleted
  rows held, minus duplicates.
- Smoke checks for Ian on the preview and after merge, as always.

## 6. Decisions for Ian

1. **Delete the 8,340 orphan feed rows now** (stage 0), with a backup
   table in the private schema? Ian: yes, 2026-11-01. Done the same day.
2. **Keep showing every FDA entry to every US organization** in Feed
   alerts, with a per-organization "dismiss", or show only entries that
   match the organization's products? Recommended: keep showing all for
   now, add dismiss; B5 adds the "matches what you received" flag and can
   narrow the default view then. Ian: yes, 2026-11-01.
3. **Mattilsynet**: move the 26 legacy entries into the catalog for the
   existing NO organizations and remove the importer leg (the feed URL has
   answered 404 for weeks)? Recommended: yes. Nothing new is added, which
   is the frozen-NO rule. Ian: yes, 2026-11-01.
4. **Remove the scanner's own "Fetch FDA / RASFF / Mattilsynet recalls"
   buttons in Settings**, so the server importer is the only writer?
   Recommended: yes. Ian: yes, 2026-11-01.
5. **Pushed recalls stay in `recall_events`** (section 3.6) rather than
   moving into the catalog in B4? Recommended: yes; the portals build on
   them and the function hides the difference from the screens. Ian: yes,
   2026-11-01.
6. **Order**: stage 0 this week; stages 1 to 3 as the next two pull
   requests; stages 4 and 5 as four to six pull requests after that, one
   app at a time. Or hold B4 and do B3 (the manufacturer link) first?
   Ian: in order, 2026-11-01.

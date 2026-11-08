# Batch'd changelog

Newest first. One entry per change Ian ships: the date, what changed,
how it was verified and what is still unverified. Everything before
2026-10-24 is in docs/HISTORY.md.

## 2026-11-08 (B4 stage 5: Retail reads one list of active recalls)
- Every Retail reader that needs the active recalls calls
  batchd_active_recalls once through _fetchActiveRecalls(opts): the
  Dashboard overview (tiles, recall inbox, exposed lots), the Recalls
  panel's Active tab and badge, Lot Lookup, the lot tracer, the
  Intelligence panel, the Store Network command center and the exposure
  report. The lot tracer and the Intelligence panel lose their unfiltered
  recall_events reads (every event of every organization, relying on row
  security); the eight query pairs are gone.
- Feed alerts is now the shared catalog with per-organization state:
  each entry shows its parsed lots, recall number, recalling firm,
  classification and date, with Mark reviewed and Dismiss; a dismissed
  entry leaves the Active tab and the scanner for that organization,
  sits under "Show N dismissed" and can be restored. These write
  recall_catalog_org (corp admins and store managers, policy
  b43_catalog_org_*). An FDA entry that a scan still on shelf matches
  appears in the Active tab with a Dismiss button instead of Resolve.
- Every Retail matching rule reads every lot and GTIN a recall names
  (_recallLotsMatch over lotsMatch; the strict readers through
  Batchd.activeRecalls.recallLots and recallBarcodes), and every
  match-row reader counts recall_id, recall_event_id and catalog_id.
- Kept on the tables on purpose: the Recalls panel's History tab and the
  recall history report (inactive recalls and closed events; the report
  now leaves drills out), Live Recall and the drill pages (one event by
  id) and the Consumer Notify picker (events closed within the last 30
  days are still offered, which the function would hide).
- The Add recall form's notice sources are fda_notice and
  mattilsynet_notice (labels unchanged), so a recall logged by hand from
  an FDA notice is a manual recall to the function and not a feed copy.
- scripts/check.mjs: the single-source check covers dashboard.html (no
  recall_distributions and recall_events query pair, no unfiltered
  recall_events list, no "active recalls" query on the recalls table; the
  RPC and recall_catalog_org must be used).
- Verified: node scripts/check.mjs (11 of 11); node --test (132 tests);
  the end-to-end suite locally against the built site and the staging
  database (11 passed, 1 skipped: the notice test needs functions), so the
  overview, the composer push and Live Recall still work on the new path;
  and a new e2e/feed-alerts.spec.mjs (passed locally): Feed alerts counts
  the catalog, Dismiss moves an entry under the dismissed toggle, Restore
  brings it back, and the staging organization is left as found. Not
  verified in a live session: Lot Lookup and the lot tracer on a pushed
  recall's second lot (SMOKE.md 67).

## 2026-11-08 (B4 stage 4: the scanner reads one list of active recalls)
- Every scanner reader that needs the active recalls (sign-in alert,
  History banner and post-save toast, pre-placement warning, receiving
  hold, multi-store tile, Quick check, shift summary, audit report, the
  Recalls drawer and the checkActiveRecalls fallback) now calls
  batchd_active_recalls once through _fetchActiveRecalls(); the rows become
  the cache shape through Batchd.activeRecalls.normalizeActiveRecalls
  (src/shared/active-recalls.js). Drills, closed events and dismissed feed
  entries are left out by the function, so the 2026-09-09 closed-event
  probe and the ten query pairs are gone. Public feed entries now come from
  the catalog (501 on production) instead of the per-organization copies.
- The shared matcher reads every lot a recall names (`lots`) and every
  GTIN (`gtins`): a recall pushed with several lots matches a scan of any
  of them (the known defect since 2026-10-25), and a feed entry matches on
  its parsed lots or GTINs instead of the whole free-text code line.
  The strict equal-lot-or-barcode rule the reports use is now one shared
  function, exactIdentifierHit.
- Match rows: Batchd.activeRecalls.matchIdColumns decides the id columns
  (manual recall_id; pushed recall_id = linked row plus recall_event_id;
  feed catalog_id) and _writeMatchRows writes them, selecting before
  inserting catalog rows because that unique index is partial. The
  sign-in sweep persists exact hits of every kind, not only pushed ones.
  The two manual-recall writers that never swept (the manager card and
  the recall action sheet) now call sweep_recall_matches and report the
  matched scans.
- One direct read of `recalls` stays in the active path: the linked rows
  of pushed recalls, fetched once per list because the match writers need
  their ids. The manual-recall management lists and the duplicate checks
  read `recalls` on purpose.
- scripts/check.mjs: a new check refuses a page query of
  recall_distributions or recall_events in index.html and requires the RPC
  and the three shared rules.
- Verified: node scripts/check.mjs (11 of 11); node --test (132 tests;
  tests/shared-active-recalls.test.mjs covers the normalizer against the
  three kinds and a pushed recall with two lots, the strict rule, the id
  columns and the matcher on lots and GTINs); the end-to-end suite
  locally against the built site and the staging database (11 passed, 1
  skipped: the notice test needs functions, which the local server lacks),
  so the sign-in alert, the pre-placement warning and the pushed recall's
  match rows all come through the new path. Not verified in a live
  session: the Recalls drawer with a matched feed entry (SMOKE.md 66).

## 2026-11-08 (B4 stage 3: migration 044 copies the feed rows into the catalog)
- migrations/044_recall_catalog_backfill.sql copies every per-organization
  public feed row in recalls (source fda or mattilsynet, with an
  organization) into recall_catalog once, under the same key the importer
  writes (recall number from the end of the description plus the first 12
  hex characters of md5(product name), or product and report day without a
  number), writes one recall_catalog_org row per (organization, entry) with
  first_seen_at from the oldest copy, dismissed_at when every copy the
  organization had was inactive and matched_at from existing scan matches,
  and stamps catalog_id on matches that pointed at a copy. Nothing is
  deleted; the copies keep serving every screen until stage 6. Re-runnable.
- The migration also adds batchd_parse_lots(text), the SQL twin of the
  importer's parseCodeInfo (4 to 30 characters with a digit, no spaces, not
  a date, not a bare number of four digits or fewer, not a UPC), and
  refreshes the lots of migrated entries with it on every run, so a parser
  change reaches entries that have no raw feed text.
- fetch-recall-feeds.js: the catalog key hashes the product name with md5
  (first 12 hex characters) instead of a JavaScript string hash, so
  migrated and imported entries meet on the unique key; the upsert now
  merges (status, classification, raw and the rest refresh on every run,
  reported as catalog_refreshed) and a lookup before the upsert decides
  which entries are new and get a sweep; parseCodeInfo drops bare numbers
  of four digits or fewer (years, counts).
- Applied to staging 2026-11-08 (recorded as 044_recall_catalog_backfill)
  and reconciled: 56 copies, 28 distinct keys, 28 catalog entries, 28
  recall_catalog_org rows, 0 dismissed, 0 matches repointed, and
  batchd_active_recalls returns those 28 feed entries for the QA
  organization; the CHECK_MIGRATIONS 044 row reads true. 13 entries carry
  parsed lots, and no entry carries a bare year as a lot.
- Applied to production the same day with Ian's go-ahead, after a preview
  count (982 copies across 4 organizations, 501 distinct keys, an empty
  catalog). Result: 501 catalog entries (464 fda, 37 mattilsynet; 50
  without a recall number), 980 recall_catalog_org rows (the expected
  count), 0 dismissed, 0 matches repointed (no match pointed at a copy),
  283 entries with parsed lots, none with a bare year; the 044 check row
  reads true; batchd_active_recalls returns 464 feed entries for Ian's
  organization. docs/SCHEMA-REFERENCE.md regenerated (50 functions; the
  one new function is batchd_parse_lots, callable by authenticated and
  service_role, not anon).
- Verified: node scripts/check.mjs (10 of 10); node --test (124 tests,
  the importer's tests covering the md5 key, the merge, the refresh count
  and the tightened lot rule). Not verified: the real FDA run through the
  merge path (SMOKE.md 64 covers the first scheduled run).
## 2026-11-08 (plan decisions recorded)
- Ian answered the decision lists of docs/PLATFORM-IMPROVEMENT-PLAN.md
  and docs/PORTALS-PLAN.md (2026-11-01 and 2026-11-08): every
  recommendation accepted; Supabase Pro off until further notice; push
  notifications only; the build step approved; USDA FSIS later; the
  complaint, consumer-notify and investigations panels stay as sections
  under Recalls; the recall engine comes first; an inbound recall-notice
  address per retailer is approved. Still open: portals plan 7 (who
  pays). The four manufacturer orgs in production were checked read-only
  on 2026-11-01 and are April test data. Docs only; no code.

## 2026-11-08 (B4 stage 2: the importer writes the recall catalog)
- fetch-recall-feeds.js now writes each FDA report entry once into
  recall_catalog, keyed (source, external_key) with the recall number plus
  a hash of the product text (one FDA number covers several product lines)
  or product and report day when the feed sends no number, with the full
  product text, reason, code_info, classification, firm, status, report
  date and the raw entry; parseCodeInfo pulls lot codes and GTINs out of
  the free-text code_info conservatively. Each new entry gets a
  sweep_catalog_matches call (ten at a time), so matching scans of every US
  organization are recorded and recall_catalog_org.matched_at is stamped.
  The job detail gains catalog_added, catalog_skipped and catalog_matches.
- Order change against the plan: the per-organization copies in recalls
  keep being written exactly as before until every screen reads
  batchd_active_recalls (stages 4 and 5), so no new feed recall disappears
  from Feed alerts in between. Deleting those copies moves to stage 6.
- Removed: the Mattilsynet leg (decision 3; its feed answered 404 for
  weeks), and the scanner's own FDA, RASFF and Mattilsynet importers, the
  sign-in and timer fetches that drove them, and the "Fetch latest recalls
  now" button in the manager's Recall Source card. The scanner's 30-minute
  timer still re-syncs its recall cache. recall-feeds.js, the proxy those
  importers called, has no caller left and goes with stage 6.
- health-check.js reads recall_catalog for the stale-feed rule; until the
  first run after this deploy fills it, that rule stays quiet (null).
- Verified: node scripts/check.mjs (10 of 10); node --test (124 tests;
  the importer's tests rewritten with a stub that honors the catalog's
  unique key and counts sweep calls: one catalog row per entry, one sweep
  per new entry, nothing on a second run, several product lines under one
  number as several entries, parseCodeInfo cases); the end-to-end suite
  locally against the built site (11 passed, 1 skipped; the scanner's
  sign-in, timer and Settings paths no longer call a feed). Not verified until the
  06:00 UTC run after the merge: the real FDA feed through the new path
  (SMOKE.md 64); the health check will report a failed run.

## 2026-11-01 (B4 stage 1: migration 043, the recall catalog, on staging)
- migrations/043_recall_catalog.sql adds, without changing anything the apps
  read today: recall_catalog (each public recall entry once, no
  organization; active members read, only the service role writes),
  recall_catalog_org (what one organization did with an entry: reviewed,
  dismissed, matched; members read, corp admins and store managers write),
  scan_recall_matches.catalog_id with a partial unique index on (scan_id,
  catalog_id), batchd_active_recalls(p_org) (SECURITY INVOKER: the one list
  of active recalls for an organization, manual, pushed and feed in one
  shape, with the drill, closed-event and linked-row rules inside, every
  lot of a pushed recall in a lots array, and matched and dismissed flags;
  a signed-in caller outside the organization gets no rows; anon cannot
  execute it) and sweep_catalog_matches(p_catalog_id, p_lookback_days)
  (SECURITY DEFINER, service role only: matches an entry's lots and GTINs
  against every eligible organization's scans and stamps matched_at).
  CHECK_MIGRATIONS.sql has a 043 row.
- Applied to STAGING through the Supabase connector (recorded in
  supabase_migrations). Verified there: the function returns the QA
  organization's 11 pushed and 0 manual recalls, the same counts as the
  old query pair, with the multi-lot push listing both lots; in a
  rolled-back block a test catalog entry swept 2 scans of the matching lot
  and stamped matched_at, the corp admin saw the entry as matched and
  dismissed it, another organization's id returned no rows, the deactivated
  member got no rows and anon was refused. Applied to PRODUCTION the same
  day on Ian's go-ahead (recorded in supabase_migrations): the 043 check
  reads true, both functions are byte-identical to staging (md5 of
  pg_get_functiondef), and for Ian's organization the function returns
  1 manual and 1 pushed recall, the same as the old query pair. The
  catalog is empty until stage 2.

## 2026-11-01 (B4 planned; stage 0 run on production)
- docs/B4-RECALL-CATALOG-PLAN.md: the build plan for one recall catalog
  (improvement plan B4), from a line-by-line inventory of every recall read
  and write in both apps, the functions and the migrations, plus live
  counts. Headlines: 8,340 of the 9,172 public feed rows belonged to no
  organization (one April week, an old importer defect, never visible to
  any screen); 17 screens each built their own active-recall list with
  differing rules (linked pushed rows counted twice in nine, closed events
  ignored in eight, two unfiltered reads of recall_events); the scanner
  carries three client-side feed importers beside the server's. Target:
  recall_catalog, recall_catalog_org, a catalog_id on scan_recall_matches,
  one function batchd_active_recalls(org) that every screen reads, the
  importer writing once. The push chain stays. Six decisions for Ian in
  section 6.
- Stage 0 run on production with Ian's approval
  (scripts/cleanup-orphan-feed-recalls.sql): the 8,340 orphan feed rows
  copied to backup.recalls_orphan_feed_20261101 and deleted inside one
  block that refuses to proceed on an unexpected count. Rehearsed first on
  staging (which had no such rows) and dry-run on production, both rolled
  back. recalls went from 9,184 to 844 rows (784 fda, 48 mattilsynet, 12
  manual or pushed); 0 orphans left; scan_recall_matches unchanged at 2.
  Nothing else changed; the apps never read those rows.

## 2026-11-01 (A2 part 4: the design tokens as one stylesheet)
- src/shared/design-tokens.css is the one source of truth for the design
  tokens: the semantic dark palette on :root and [data-theme="dark"], the
  light palette on [data-theme="light"], the type, radius, spacing and
  motion ladders on :root, and the 24 legacy aliases both apps read
  (--bg, --surface, --text, --muted, --accent and so on). scripts/build.mjs
  copies it to dist/assets/design-tokens.css and index.html, dashboard.html
  and login.html link it in <head> before their own styles. Until now the
  three pages carried identical inline copies and CLAUDE.md named a
  canonical file, assets/design-tokens.css, that had never been committed.
  The scanner's theme-invariant camera scrim token (--scrim-rgb) and
  Retail's four extra rgb triples are in the shared file, so every page has
  the full set.
- Retail keeps the 30 aliases only it uses (sidebar, topbar, auth
  background, elevation steps, tints, glows, blur) in its own first
  <style>. signup.html, join.html and admin.html are untouched: they use
  an older, smaller color set of their own, not copies of the design
  system.
- scripts/check.mjs: a new check that the three pages link the stylesheet
  before their own <style> and declare none of the shared tokens inline,
  and that the built copy exists. tests/design-tokens.test.mjs (5 tests)
  holds the design rules: no pure black and no pure white text in dark,
  mint then emerald accents, every light token overriding a dark one, the
  documented ladders, aliases pointing at semantic tokens.
- The print window still gets the ladder: _printLadderCss reads the
  computed values, which now come from the linked stylesheet.
- Verified: node scripts/check.mjs (10 of 10); node --test (123 tests);
  the built sign-in page in the browser pane with the stylesheet loaded
  (4 rule blocks) and the tokens resolving to #34D399 on #080f12 in dark
  and #077A55 on #F5F7F6 in light, screenshots in both; the end-to-end
  suite locally against the built dist/ on staging (11 passed, 1 skipped).

## 2026-11-01 (A2 part 3: the GS1 parser, the listed-food table and the recall matcher in src/shared)
- Three more modules, moved verbatim out of index.html so behavior does not
  change: src/shared/gs1.js (parseGS1, parseGS1DigitalLink, gs1ParseDate,
  extractBestBefore), src/shared/ftl.js (FTL_CATEGORIES with the exclude
  lists, detectFtlCategory, normaliseProductKey, ftlLabels) and
  src/shared/recall-match.js (recallMatchLevel, checkRecordAgainstRecalls,
  fuzzyProductMatch, levenshtein, with the scanner's debug match log passed
  in as a callback). The bundle exposes them as Batchd.gs1, Batchd.ftl and
  Batchd.recall; the scanner keeps its old names as aliases, so its call
  sites did not change. The region-specific display helper
  formatGS1Expiry stays in the scanner.
- One label list for the 17 listed-food categories. The scanner showed
  title case ("Leafy Greens", "Bivalve Molluscs", "Soft/Semi-Soft Cheese")
  while Retail's suppliers card and signup's focus chips kept their own
  sentence-case copies. All three now read Batchd.ftl.ftlLabels(): "Leafy
  greens", "Bivalve mollusks", "Soft and semi-soft cheese" and so on, per
  the voice rules (sentence case, American English). This is the one
  visible change; smoke check 61 lists where to look.
- scripts/check.mjs: a new check that none of the moved functions or lists
  is defined in a page any more, that the three pages read the modules,
  and that the 17 labels are in house style. tests/scanner-parsers.test.mjs
  now imports the modules instead of cutting code out of index.html and
  adds best-before, label and product-key cases; tests/shared-recall-match.test.mjs
  (8 tests) encodes the counting rule: exact on lot substring or barcode,
  possible on product only, nothing for long feed descriptions or a short
  uncorroborated lot.
- Verified: node scripts/check.mjs (9 of 9); node --test (118 tests); the
  end-to-end suite locally against the built dist/ on staging (11 passed,
  1 skipped), which drives the parser in Receiving, the detector on the
  shelf scan and the matcher in the pre-placement warning.

## 2026-11-01 (A2 part 2: the FSMA rules in one module)
- src/shared/fsma.js now holds, once, the rules that dashboard.html,
  index.html and signup.html carried as hand-kept copies: the 27 export
  columns and the export disclaimer, the US citation table, the sales
  bands with their labels, applicability, copy, closing line and threshold
  note, the $250,000 and $1 million thresholds (THRESHOLDS), the supplier
  completeness rule and the CSV cell guard with the local date and time
  helpers. The bundle exposes it as window.Batchd.fsma; the pages keep
  their old names (_CITATIONS, _FSMA_APPLICABILITY, FSMA204_EXPORT_HEADERS,
  _fsmaCsvCell, supplierIsComplete and so on) as aliases, so the thousands
  of call sites did not change.
- Wording that differs by audience stays per page but flows through the
  module: each page passes its own "not yet answered" sentence to
  applicabilityTable(), and the scanner passes the store-staff version of
  the registered-facility sentence (RFR_FACILITY_STORE) to citationTable().
  Generating the module from the three copies showed they were otherwise
  identical, which is what the old checks guaranteed.
- signup.html renders its "Annual food sales" options from the shared band
  list instead of five hard-coded options, and the dashboard's Terminology
  sentence takes the $1 million figure from THRESHOLDS, so no page carries
  a dollar amount any more.
- scripts/check.mjs: the four copy-comparison checks (export headers,
  citations, supplier fields, dollar thresholds) are replaced by one check
  that the rules exist only in the module, that the pages read Batchd.fsma
  and carry no dollar literal, and that the module has 27 columns.
  tests/shared-fsma.test.mjs (6 tests) covers the module. src/package.json
  marks src/ as ES modules so Node imports them without a warning.
- Verified: node scripts/check.mjs (8 of 8); node --test (106 tests); the
  end-to-end suite locally against the built dist/ on staging (first run 9
  passed, 1 skipped, one failure that was a single 404 for the font file
  while another session's test server shared port 8788; the core-flow chain
  passed 4 of 4 on a clean rerun); the built signup page in the browser
  pane lists the five shared bands and shows the applicability sentence.

## 2026-11-01 (A2 part 1: the build step and the shared database module)
- The site now has a build. `npm run build` (scripts/build.mjs) copies the
  public pages and static files into dist/ from an allowlist (pages,
  images, robots.txt, complaint-widget.js, fonts/) and bundles src/shared/
  with esbuild 0.28.2 into dist/assets/batchd-shared.js, a 4 KB classic
  script. netlify.toml gains [build] with command "npm run build" and
  publish "dist" (Node 22), so Netlify builds every deploy and preview the
  same way, a failed build stops the deploy, and private files (CLAUDE.md,
  SECRETS.md, migrations, functions source) are no longer in the published
  folder at all; the forced 404 rules stay as a second line of defense.
  dist/ is ignored by git.
- First shared rule: the database selection block (BATCHD_ENV, the two
  Supabase URLs and anon keys, batchdLink, the staging badge and the
  preview link rewriter) lives once in src/shared/env.js. Each of the six
  app pages loads /assets/batchd-shared.js right before the script that
  held the block, and the bundle publishes the same globals the pages
  already read, so nothing else in the pages changed. The six inline
  copies are gone, and with them the check that compared them.
- Checks and tests follow: scripts/check.mjs now checks that every app
  page loads the bundle before its Supabase client and keeps no local
  block, that the site builds into dist/ with no private file in it, and
  scans src/shared for keys as well; tests/env-block.test.mjs imports the
  module instead of cutting the block out of dashboard.html. The checks
  workflow installs dependencies first (the build check needs esbuild).
  The end-to-end static server and the local .claude/serve.js serve
  dist/, and Playwright builds before it serves.
- Verified: node scripts/check.mjs (11 of 11, the build included); node
  --test (100 tests); the end-to-end suite locally against the built
  dist/ on staging (11 passed, 1 skipped). Not verified until the
  preview: Netlify's own build (SMOKE.md 59).
- Next for A2: the FSMA rules (export headers, citations, applicability,
  thresholds, supplier completeness, the formula guard), then the GS1
  parser, listed-food detector and recall matcher, then the design tokens
  as one stylesheet. Splitting rarely used panels waits for the redesign.

## 2026-11-01 (Phase 2 cleanup: legacy sign-in forms and manufacturer-era copy)
- The scanner's and Retail's own sign-in forms are gone, with the ?legacy=1
  fallback that showed them for one release after the central sign-in
  shipped. login.html is now the only sign-in form. Both apps still send a
  signed-out visitor to /login with the link kept; their old sign-in
  containers remain only as the brief "Taking you to sign-in" hand-off and
  as the frame for the deactivated and "not linked" screens, whose content
  is written in by the apps. Removed with the forms: the scanner's sign-up
  tab (signup belongs to signup.html), Retail's sign-in two-factor modal
  and old forgot-password handler (both live in login.html now).
- Manufacturer-era copy in retailer screens (plan F5): the manual-recall
  card no longer says "not pushed by a manufacturer via the network"; the
  recall history labels a pushed recall "Pushed" instead of
  "Manufacturer"; the terminology entries for Step 1 Notified and the
  Shelf impact score describe the retailer's own push and receiving
  records instead of a manufacturer's shipment records; the recall audit
  report and its timeline say "Recall initiator" instead of
  "Manufacturer", which is also right for the retailer's own pushes; the
  Investigations toast no longer tells the admin to "connect a
  manufacturer"; the scanner's recall labels read "Pushed Recall" instead
  of "Manufacturer Alert" and "Manufacturer push", and the manual recall
  form's brand placeholder no longer lists Norwegian dairies.
- Not removed, on purpose: the three retired stubs (manufacturer.html,
  supplier.html, manufacturer-signup.html), which login.html, signup.html
  and Retail still route legacy mfr_admin and mfr_qa members to until the
  portals replace them; docs.html, which Netlify observability shows with
  11 requests in the last 7 days; the Investigations panel (decision
  2026-10-18) and its copy; the lot tracer's legacy shipment chain and
  every read of trading_partners and shipments (legacy data).
- Verified: node scripts/check.mjs (10 of 10); node --test (100 tests);
  the end-to-end suite locally against staging: 11 passed, 1 skipped, and
  the deactivated-member test runs through the stripped containers.
  Not verified: a legacy manufacturer member's routing (no such account on
  staging), and the deactivated screen inside the stripped containers on a
  real preview (SMOKE.md 58).

## 2026-11-01 (scanner match rows for pushed recalls)
- FIXED in the scanner, the open item from the safety-net entry below:
  both scanner writers of scan_recall_matches for pushed recalls (the
  upsert in matchScanAgainstRecalls after a shelf scan is saved, and the
  login push sweep in checkRecallsOnLogin) wrote recall_id =
  recall_events.id, which the foreign key to recalls(id) refuses (23503,
  a 409 in devtools, swallowed by a console.warn). A shelf scan made after
  a push therefore never got a match row and was invisible to the Live
  Recall page, the FSMA 204 export and the scanner's ack strip. The pushed
  recall objects now carry the linked recalls rows (_attachLinkedRecalls
  in checkRecallsOnLogin and loadHistory, from the rows the cache
  otherwise drops), and both writers set recall_id to the linked row for
  the scan's lot (_pushedMatchRecallId: the lot found in the raw capture
  when there are several, else the first) with recall_event_id = the
  event and recall_source 'manufacturer_push'. The login sweep also stores
  store_id and now surfaces its error instead of ignoring it. An event
  with no linked row is skipped with a warning (the write cannot succeed).
- Readers widened: checkPriorComplaintsForRecall and the Recalls drawer's
  exposure query accept a recalls id or a recall_events id (filter on both
  columns; the drawer keys its exposure rows by the id it knows); the ack
  strip reads recall_event_id only (recall_id is no longer a stand-in for
  the event); the manager overview's confirmed set includes
  recall_event_id. No database change.
- Verified: node scripts/check.mjs (10 of 10); node --test (100 tests, 7
  new in tests/scanner-pushed-match.test.mjs for the two helpers, loaded
  from index.html). e2e/core-flow.spec.mjs step 4 now saves the scan of
  the recalled lot after the push and asserts two match rows by
  recall_event_id (the step 2 scan and the new one), both with recall_id
  = the one linked recalls row and recall_source 'manufacturer_push', and
  no console error or failed request in that step. The scanner asks "Log
  again anyway?" for the repeated lot, so the test accepts that dialog.
  Run locally against staging on 2026-11-01: the chain passes end to end
  (4 of 4; whole suite 11 passed, 1 skipped), and the rows on staging read back as expected (both match
  rows point at the one linked recalls row, is_pushed true, and carry the
  event and the store). Not verified: a live session on a phone, and the
  deploy preview run of the suite (the e2e workflow runs it on the pull
  request's preview).
- Known, not fixed: a push with several lots gives the event a lot_number
  of the whole list, so the scanner's event-based matcher only fires on a
  scan carrying the whole list (CLAUDE.md, code known and not fixed).

## 2026-11-01 (closing a recall: dialog, Active tab, deep link)
- Mark complete on Live Recall used prompt(), which the dashboard
  convention forbids and some embedded browsers refuse, so the button did
  nothing there. _confirmDialog now takes an optional input
  (opts.input = { placeholder, value }) and resolves with the text, or
  null on Cancel or Escape; markRecallComplete uses it for the closing
  note. No other prompt() is left in the dashboard; the one confirm()
  left is in the generated standalone document (saveAsPdf), where the
  dialog helper does not exist.
- An administratively closed recall (recall_events.closed_at) stayed in
  the Recalls Active tab as ACTION REQUIRED, with its stores counted in
  "stores awaiting action" and the red pill, while the header said 0
  active. renderRecalls now reads closed_at on the acknowledgements join,
  keeps closed events out of the Active tab, the nav badge and both
  counts, and lists them in History with a CLOSED badge and a summary
  line (closed date, stores complete, closing note). "1 store require
  action" also reads "requires" now.
- renderRecalls awaited an unused sb.auth.getUser() before its queries: a
  round trip to the auth server that also waits for the client's auth
  lock, held during the token refresh at page load. Removed. This is the
  likely cause of "Loading recalls" sitting for 10 to 18 s when
  /retail?panel=recalls was opened straight after sign-in; the deep link
  was quick in the stubbed preview, and after the deploy Ian measured
  the live one at about 3 s, down from 10 to 18 s.
- Verified in the stubbed local preview (.claude/app-preview.html built
  from this branch, with a closed, unfinished recall added to the stub
  data): Active hides it and counts 1 store, History shows the CLOSED
  card and summary, the Mark complete dialog focuses the field, Escape
  cancels, Enter closes with the toast. SMOKE.md 55 and 56 cover it on a
  deploy preview. check.mjs 10 of 10, node --test 89 pass.

## 2026-11-01 (end-to-end tests on deploy previews)
- The e2e workflow failed twice on pull request 44's preview while the
  same suite passed locally: Netlify's "Collaborate on this Deploy
  Preview" drawer (a script injected as /.netlify/scripts/cdp on previews
  only) sits across the bottom of the viewport and covered the composer's
  Continue button, so the core-flow chain and the supplier notice test
  timed out on that click. e2e/env.mjs now blocks that one script for
  every test page, which makes the preview behave like production.
- The serial core-flow chain mints a fresh lot and a fresh product name
  per attempt, so a retry (Playwright retries once on the workflow) does
  not reuse the previous attempt's lot, and a live recall pushed by another
  preview's run on the shared staging org (several pull requests run this
  suite at the same time) cannot make the pre-placement warning show for a
  lot it never named. Seen on pull request 48's first preview run.
- The scanner sign-in helper now waits for the "Active Recall Alert" that
  the shared staging org raises after sign-in (a leftover QA recall, or
  another run's) and closes it before and after the store picker, with a
  Playwright locator handler as a second line of defense; the old
  one-shot check raced the alert and the mode switch stayed covered.
- Verified: the whole suite locally against staging (11 passed, 1 skipped)
  and the drawer block on pull request 48's first preview run, where the
  supplier notice test passed for the first time since the central
  sign-in. Not verified until this pull request's preview runs again: the
  two concurrency fixes on a real preview.

## 2026-11-01 (safety net, improvement plan Phase 1)
- End-to-end core flow (plan A3 "done when"). e2e/core-flow.spec.mjs runs
  the whole chain on one fresh lot per run: a delivery recorded from a
  typed GS1 string; a shelf scan of the same lot that shows "Linked to
  delivery" and saves with the store and the receiving_event_id; the
  composer finds the store that received the lot in its scope preview, the
  recall is pushed and lands on Live Recall, and "Produce records" downloads
  a CSV with the 27-column header, the lot and the store; the scanner then
  shows the sign-in recall alert for the product and the red pre-placement
  warning when the lot is scanned again. The test closes the recall at the
  end (closed_at, linked recalls row inactive). The camera is not available
  in the test browser, so the label photo is a tiny stand-in blob and the
  lot is typed. e2e/receiving.spec.mjs is folded into it.
- Sign-out is local (known follow-up). Every sb.auth.signOut() in the
  scanner, Retail, the sign-in page and admin now passes { scope: 'local' },
  so signing out on one device no longer ends the account's sessions on
  every other device (a shared store phone, or the end-to-end workflow's
  session). On one device /retail and /scan share the stored session, so
  signing out of one still signs out of both there.
- Monitoring (plan A4, the gaps). The on-demand email functions
  (push-recall-email, notify-event, recall-reminder, send-invite,
  notify-consumers) record a failed send as an ok=false job_runs row
  (netlify/lib/job-log.js logFailure), so the daily health check reports
  "<function> failed N times in the last 24 hours". The health check also
  sends one "all clear" every Monday with the week's run counts, because an
  alert email that has never fired is not proven: production job_runs shows
  7 health-check runs since 2026-10-26, zero problems, zero emails sent.
  HEALTH_HEARTBEAT=off turns the Monday email off.
- FOUND by the new test, FIXED in the dashboard: after a composer push the
  "convert matches to the event id" update wrote recall_id = the
  recall_events id, but scan_recall_matches.recall_id has a foreign key to
  recalls(id), so the update failed every time (23503, a 409 in devtools,
  swallowed by a console.warn) and the match rows stayed invisible to the
  Live Recall page, the export and the scanner's ack strip, which read by
  recall_event_id. Production has 0 match rows with an event out of 2
  rows, so nothing relied on the old shape. The update now sets only
  recall_event_id and recall_source; recall_id stays the linked recalls
  row. Confirmed on staging with a rolled-back probe (23503) before the
  fix and by the test's new assertion after it. Still open: the scanner's
  two match writers have the same defect (CLAUDE.md, open items).
- FOUND by the new test, FIXED in the scanner: "Cancel and start over" on
  steps 2 and 3 (cancelScan) called hideRegionConfirmation, which read two
  elements that left with the OCR flow and threw on the first line, so the
  cameras stopped but the form never reset and never returned to step 1.
  Both reads are now null-guarded. Verified by the test's last step and
  SMOKE.md 54.
- Verified: node scripts/check.mjs (10 of 10); node --test (93 tests, 4 new
  for the heartbeat rule, the all-clear text and the failure row); the
  whole end-to-end suite locally against staging: 11 passed, 1 skipped (the
  supplier notice test needs a preview), the core-flow chain green end to
  end with every test recall closed again afterwards. The suite also runs
  on the pull request's deploy preview. Not verified: a real failed send recorded on production, and the
  Monday email itself (first one 2026-11-02 07:00 UTC; SMOKE.md 53).
- Not done from Phase 1: A1 Supabase Pro (daily backups, leaked-password
  protection). Ian decided "not now" on 2026-11-01; the free plan stays.

## 2026-11-01 (smoke checks 48 and 51 on production)
- SMOKE.md 48 and 51 run by Claude in the built-in browser on
  app.batchdapp.com after Ian signed in (org Batch'd Admin, plan active,
  7 stores). Both pass. Ian confirmed the same evening that all three
  emails (drill alert, complaint notice, recall alert) arrived.
- 51: the drill (lot DRILL-2026-11-01-SMOKE51, Run drill on the Retail
  dashboard) called notify-event, which answered sent 3, failed 0 for
  drill_scheduled. The phone complaint logged from a History card in the
  scanner (CMP-20261101-1f10ef, triage level monitor, 12 s round trip)
  made triage-complaint call notify-event server to server; the Netlify
  request log shows that second call at 18:38:08 UTC from a Netlify
  address with user agent "node" and no browser session, answering 200.
  Without the shared secret that call answers 403, so
  INTERNAL_NOTIFY_SECRET is set and matches on the site that serves
  app.batchdapp.com (gentle-belekoy-be3cb7).
- 48: the pasted notice (the Holsum spinach tortilla recall from the FDA
  feed, H-0089-2027, three lots) was accepted (202) and read in about
  40 s: firm, Class II, reason, instructions, contact, one product with
  GTIN 810023430629, lots 26187, 26195 and 26210, best-by range
  2026-10-04 to 2026-10-27. "Your stores" said no delivery or shelf scan
  matched (the org has none), and the caution box flagged that the notice
  footer calls itself a smoke check. "Review and push in the composer"
  filled product, lots and barcode; Classify came prefilled with Class II
  and Undeclared allergen; Review listed everything; the push created
  recall event b6d36fc9 (not a drill, on Ian's word), notified 7 stores,
  notify-event answered sent 3, failed 0 for recall_pushed, Live Recall
  opened with 7 of 7 notified, and the notice (status pushed) left the
  list. Claude then closed the recall with the same update Mark complete
  runs (closed_at, closed_by, closed_note on the event; the three linked
  recalls rows set inactive) so the 2 h and 24 h escalations do not fire.
- Found and fixed: the composer's Continue buttons printed the arrow
  icon's SVG source as text, because _composerNavRow ran esc() over a
  label that already contained _ico() markup. The label is now inserted
  as is; all three callers pass a literal string plus the icon.
- Found, not fixed: Mark complete on Live Recall uses prompt(), which the
  built-in browser rejects ("prompt() is not supported") and the dashboard
  convention forbids (use _confirmDialog). After an administrative close
  the Recalls panel's Active tab still shows the recall as ACTION
  REQUIRED with "7 stores require action" while the header says 0 active.
  Opening /retail?panel=recalls directly sat on "Loading recalls..." for
  more than 10 s on the first try and loaded in about 18 s on the second;
  opening the panel from the sidebar was quick. The scanner's
  /.netlify/functions/ocr warm-up answers 204 on production.

## 2026-11-01 (smoke checks on staging)
- SMOKE.md 10 to 13, 17 to 20, 46 and 47 run by Claude in the built-in
  browser on `node e2e/static-server.mjs` (localhost:8788, staging
  database, account qa-active-038). All pass: receiving a typed GS1 label
  with the new supplier and its row in the manager Receiving tab (10); a
  shelf scan of the same lot saved with receiving_event_id (11, phase 3
  reached by setting the photo blob in the console, camera blocked); the
  records request drill produced a 27-column CSV with the cover block and
  recorded the time (12); the traceability plan regenerated to version 3
  with the contact and both active stores in the document (13); a complete
  supplier shows the green dot, appears in the scanner picker without
  "(address incomplete)" and fills the five supplier address columns of
  the manager CSV (17); the sales band shows "Likely exempt" and the
  registered-facility box switches the Compliance authority card to the
  Reportable Food Registry sentence (18); Pepperoni pizza and Eggplant
  give no badge, Bell peppers gives Peppers, and the org's "Not a listed
  food" decision from 2026-10-25 shows in Settings, Listed foods (19); the
  delivery-file import created two expected lines, the scanner chip and
  banner matched lot RM261101, Confirm delivery moved it to received with
  source wholesaler_import, and the dashboard export carries "From
  wholesaler delivery file" (20); dashboard icons, the styled delete
  dialog (Cancel focused, red confirm, Escape cancels), the triage form,
  the audit-trail chevron, keyboard tagging and toast ink (46); scanner
  views, light-theme inputs, the manager Audit tab store dropdowns and the
  Help overlay (47). `npx playwright test` also passed locally (3 passed,
  1 skipped: it needs a preview). Not run: 48 and 51 (Netlify functions
  are not served locally). Also noticed: `/.netlify/functions/ocr` warm-up
  posts answer 404 locally, expected; the receiving form's listed-food
  chip resolves about a second after typing, so a receipt recorded
  immediately after typing the product name can save is_ftl false.
- e2e/sign-in.spec.mjs signs out with scope 'local'. The default global
  sign-out revoked every session of the shared staging account, which
  ended Claude's local smoke session twice while the workflow ran.
- E2E_PASSWORD has been set on GitHub since 2026-10-25 (the open item was
  stale). The demo password rotation and the pull request merges were
  blocked by the app's permission layer and stay with Ian.

## 2026-11-01 (migration 042 applied)
- migrations/042_revoke_anon_definer_execute.sql revokes anon EXECUTE on
  create_organisation_with_admin, get_org_member_emails and
  get_my_organisation_ids (advisor finding of 2026-10-28; each guards
  itself, so this is hygiene). Applied with Ian's go-ahead to staging and
  then production through the Supabase connector (recorded in
  supabase_migrations as 20261101115507). Verified on both: anon false,
  signed-in true, service true on all three; accept_invitation and
  get_invitation_by_token unchanged; the CHECK_MIGRATIONS 042 row reads
  true. The production security advisor now lists seven anon-callable
  definer functions, all intentional (the three invitation RPCs and four
  batchd_user_* RLS helpers).
- docs/SCHEMA-REFERENCE.md regenerated from production (it had not been
  regenerated after 040 and 041: 47 tables, 2 views, 47 functions, 185
  policies, up from 45, 2, 42, 148). Pulled in six chunks through the
  connector; each chunk's md5 matched the server-side md5 of the same text.
- Leaked-password protection (advisor warning) is a Supabase Pro plan
  feature and the project is on the free plan. Ian checked the Auth
  settings on 2026-11-01; the warning stays and is accepted until the
  plan changes.

## 2026-11-01 (misspelled secret fallback removed)
- netlify/lib/auth.js reads the server-to-server secret from
  INTERNAL_NOTIFY_SECRET only. The fallback that accepted the misspelled
  INTERNAL_NOTIFY_SECREY (added 2026-10-25 while batchd-app still stored it
  under that name) is gone, since the variable was recreated under the
  right name on both sites the same day. Verified:
  tests/internal-secret.test.mjs (4 tests; the misspelled name is now
  ignored). Not verified: a live complaint email through batchd-app after
  this deploy (SMOKE.md 51).

## 2026-11-01 (one address, checked on production)
- #30, #39 and #40 merged and deployed. Checked by HTTP right after:
  app.batchdapp.com/ and /login serve the sign-in page; /retail serves the
  Retail app and /scan the scanner (manifest start_url /scan);
  app.batchdapp.com/dashboard(.html) 301 to /retail with the query kept;
  corporate.batchdapp.com/, /?panel=recalls, /dashboard and
  /dashboard.html?panel=triage 301 to app.batchdapp.com/retail with the
  query kept, and /signup and /join?token= to the same path on app.;
  www.batchdapp.com/ 301s to app.batchdapp.com/ and /dashboard to /retail;
  batchdapp.com still 301s to www (two hops to the sign-in page);
  batchd-app.netlify.app/dashboard.html 301s to app.batchdapp.com/retail.
  Private files still answer 404 (CLAUDE.md, netlify/lib/auth.js,
  tests/). Functions are not redirected: the ocr warm-up answers 204 on
  app. and on corporate., and www's triage-complaint answers OPTIONS 200,
  so complaint-widget.js keeps working.
- In a browser: batchd-app.netlify.app shows "Batch'd has moved" with a
  button to app.batchdapp.com/scan (no queued scans in that browser), and a
  signed-out app.batchdapp.com/retail?panel=recalls lands on /login with
  the link kept; no console errors.
- Still owed by Ian: add https://app.batchdapp.com/login to Supabase Auth
  redirect URLs (production and staging), and reinstall the scanner on the
  test phones from app.batchdapp.com/scan.

## 2026-11-01 (one address and the Retail rename, Phase 2a step 2)
- Every app now lives on app.batchdapp.com: / is the sign-in page,
  /retail the Retail app (dashboard.html), /scan the scanner. One sign-in
  opens both apps; signing out of either signs out of both and returns to
  /login.
- Retail and the scanner send signed-out visitors to /login with the link
  they asked for (/retail?panel=recalls comes back to Recalls after
  sign-in). ?legacy=1 shows their old sign-in forms as a fallback for one
  release. Both apps link to each other by same-origin paths, and both
  have a "Switch app" link (dashboard topbar, scanner drawer).
- The sign-in page now opens the app last used on the device directly
  (decision Q17), unless ?choose=1 asks for the chooser. ?next= keeps only
  its query string, appended to the app's own path, so it cannot point at
  another site.
- netlify.toml: corporate.batchdapp.com and every /dashboard path 301 to
  app.batchdapp.com/retail (any other corporate path to the same path on
  app.), www.batchdapp.com/ to app.batchdapp.com/. The block sits first
  because Netlify uses the first matching rule.
- The scanner moved from batchd-app.netlify.app (manifest start_url is now
  /scan). On the old address it keeps running while scans wait in the
  offline queue ("Sending N saved scans first"), then shows "Batch'd has
  moved" with a button to app.batchdapp.com/scan. Only Batch'd's test
  phones had it installed (Ian, 2026-11-01).
- Rename: "Corporate Dashboard" and "corporate dashboard" became Retail in
  the dashboard title, sign-in card, sidebar and help text, and in the
  scanner's dashboard shortcut. Role names (corp_admin, "Corporate admin")
  did not change.
- Links: join.html and signup.html hand everyone to /login (the router);
  email links point at app.batchdapp.com/retail (notify-event,
  triage-complaint, push-recall-email) and app.batchdapp.com/scan (recall
  reminder and escalation buttons). The database selection block maps the
  new app.batchdapp.com paths onto a preview's own origin, identically in
  all six pages.
- The scanner start-up fix listed under step 1 below was found by this
  pull request's end-to-end tests.
- Verified: check.mjs 10 of 10; node --test 89 tests (new: deep-link and
  last-app picking, the preview link map, the old-address hand-off with
  an empty, a draining and a corrupt queue); a local copy on staging: a
  signed-out /retail?panel=recalls and /scan?view=history&lot=A1 land on
  /login with the link kept, ?legacy=1 shows both old forms, titles read
  Retail, no console errors. The end-to-end tests now sign in through
  /login (the existing dashboard and scanner tests included) and add a
  deep-link and a sign-out test; they run on the pull request's preview.
  Not verifiable before merge: the production host rules (corporate,
  www, batchd-app), checked by HTTP after merge.

## 2026-11-01 (central sign-in, Phase 2a step 1)
- New login.html: one sign-in page for every Batch'd app
  (docs/PORTALS-PLAN.md, Phase 2a). After sign-in it reads the person's
  memberships and sends store staff straight to the scanner, legacy
  manufacturer members to the manufacturer page, and shows a short chooser
  to anyone with more than one app (retail admins and store managers:
  Retail and Scanner; platform admins also Admin). The chooser lists the
  last app used on that device first. It handles two-factor codes, the
  deactivated screen, and password recovery with a real "Set a new
  password" form (the dashboard's reset link signed people in without
  asking for a new password). ?app=retail or ?app=scan skips the chooser
  when the person may open that app.
- netlify.toml: /login, /retail (the dashboard) and /scan (the scanner)
  on every host, and app.batchdapp.com/ now opens the sign-in page instead
  of the scanner (nothing linked there; the scanner's address is
  batchd-app.netlify.app). Because /retail and /scan share one address, one
  sign-in opens both. Nothing else moved: corporate.batchdapp.com and
  batchd-app.netlify.app behave as before until step 2.
- FIXED (scanner): it ran its start-up twice whenever it opened with a
  saved sign-in, because the "already started" flag lived on the user
  object and initAuth and the auth listener each pass a fresh copy; with no
  store chosen in the last 12 hours it stacked two "Where are you working
  today?" pickers and taps landed on the hidden one. Already possible when
  reopening the scanner, and every visit through the sign-in page opens
  with a saved session. The guard is now by user id and the picker never
  opens twice. Found by the end-to-end tests on pull request 40.
- scripts/check.mjs counts login.html as a sixth page with the identical
  database selection block; tests/login-router.test.mjs (10 tests) covers
  the routing rules and checks that every app path has a rule.
- Verified: node scripts/check.mjs (10 of 10), node --test (81 tests), and
  a local copy on staging with a stubbed client driven through staff,
  corporate admin, platform admin, deactivated, no membership, signed out,
  wrong password, two-factor (wrong then right code), forgot password, the
  last-used order and ?app=; dark and light, phone width with no sideways
  scroll; /retail and /scan load the real apps with no console errors.
  Not verified: a real sign-in on staging (the staging test password could
  not be read in this session), and the app.batchdapp.com root rule, which
  only exists on production (check it after merge).
- Owed by Ian: add https://app.batchdapp.com/login (and, for previews,
  https://*--gentle-belekoy-be3cb7.netlify.app/login and
  https://*--batchd-app.netlify.app/login) to Supabase Auth, URL
  Configuration, Redirect URLs, in production and staging. Without it the
  reset link falls back to the project's Site URL.

## 2026-10-28 (connector checks)
- Verified through the GitHub, Netlify and Supabase connectors, read-only.
  Only two Netlify sites deploy this repo (www and batchd-app, both on the
  2026-10-25 merge commit); batchdsite is batchd.no from another
  repository with no schedules. job_runs over two days shows every
  scheduled job recorded by www alone, so batchd-app has
  SCHEDULED_FUNCTIONS_DISABLED set and the duplicate-run question is
  closed. Production records migrations 031 to 041 in
  supabase_migrations; job_runs and recall_notices exist; staging and
  production have byte-identical match_recall_notice definitions.
  Security advisor on production: the products_public definer view
  (deliberate), definer functions callable by anon (each guards itself),
  leaked-password protection off (an Auth toggle), two tables with RLS
  and no policies (closed on purpose). CLAUDE.md corrected accordingly.
  Not verified: site-level Netlify variables themselves (the connector
  refuses to list them), and the smoke checks still owed.

## 2026-10-25 (monitoring and end-to-end tests, plan A3 and A4)
- Monitoring. Migration 041 adds job_runs; fetch-recall-feeds and
  recall-escalation record every run through netlify/lib/job-log.js (job,
  site, start, finish, ok, result). The new scheduled function health-check
  (daily 07:00 UTC) emails Batch'd's platform admins only when something is
  wrong: the FDA import has not completed in 26 hours or its newest recall
  is over 21 days old, the escalation job has not completed in 2 hours, a
  job failed in the last 24 hours, the health check skipped a day, or
  supplier notices are stuck or failing. ALERT_EMAIL overrides the
  recipients. It honors SCHEDULED_FUNCTIONS_DISABLED and prunes job_runs
  older than 90 days. Verified: tests/health-check.test.mjs (8 tests on the
  rules and the run logger). Not verified: a real alert email (first run
  07:00 UTC after deploy).
- End-to-end tests. Playwright (1.64.0, dev dependency) in e2e/: dashboard
  sign-in and the Recalls notice strip; a deactivated member locked out of
  both apps; a delivery recorded in the scanner from a typed GS1 string and
  saved with its lot, GTIN and best-by; and, on previews only, a pasted
  supplier notice read by AI, matched and pushed through the composer.
  e2e/env.mjs refuses any host that is not localhost or a deploy preview,
  so the tests can only reach staging. .github/workflows/e2e.yml runs them
  when Netlify reports a batchd-app deploy preview ready; it needs the
  repository secret E2E_PASSWORD. netlify.toml blocks /e2e/* and
  /playwright.config.mjs; .gitignore keeps node_modules and test output out
  of the repository. Verified locally against staging: 3 of 3 (the notice
  test needs a preview); with the scanner's save deliberately broken the
  delivery test failed.

## 2026-10-25 (supplier recall notices, plan B1 and B2)
- Supplier recall notice intake. A corporate admin uploads a notice (PDF,
  image, TXT or EML, up to 15 MB) or pastes the email from the Recalls panel
  ("Read a supplier notice") or the dashboard ("From a supplier notice").
  The file goes to storage under orgs/<org prefix>/recall-notices/ (the
  scan-photos bucket is public by unguessable URL, as for photos), a
  recall_notices row is created, and the new background function
  parse-recall-notice-background has Claude (claude-opus-5-5, structured
  JSON output, server-side refusal fallback) read the firm, class, reason,
  hazard, products, GTINs, lot codes and ranges, best-by window,
  instructions, contact and anything uncertain. Only corp admins of orgs on
  a pov or active plan can run it (same gate as the other AI functions).
  The review screen shows the draft, the uncertainties to check against the
  original, and which stores received or shelved matching product; "Review
  and push in the composer" fills the composer (product, all lots, GTIN,
  class, hazard, reason) and pushing marks the notice pushed and links it.
- Lot-level matching (B2). match_recall_notice (migration 040, SECURITY
  INVOKER) matches deliveries and shelf scans by GTIN, lot code, lot range,
  best-by window and product words, with a reason and a confidence for each
  record. The composer's distribution check now uses it, so it sees
  deliveries, not only shelf scans (the old scan-only check remains as a
  fallback on an older database).
- The composer accepts several lots separated by commas; each lot becomes
  its own linked recalls row so the scanner's placement check, the sweep and
  the dashboard match every lot. A barcode alone is now enough to continue.
  The composer's Norwegian example placeholders are now US examples.
- Migration 040 applied to STAGING only. Verified there: matcher cases
  (GTIN plus range high, same GTIN other lot low, same lot other GTIN
  excluded, best-by window, product-only low, shelf scans, an outsider sees
  nothing); on the pull request's preview against staging, a pasted email
  and a PDF were each read correctly (Class I, Salmonella, both GTINs, the
  lot range kept as a range, best-by window, contact, notice date from the
  PDF), the review showed 2 stores with 12 and 8 cases and left out the
  crunchy product that shares a lot code but not the GTIN, the composer
  pushed with no retyping (event, one linked row, 2 store tasks, notice
  pushed and linked), and a typed two-lot recall wrote one linked row per
  lot. tests/recall-notice.test.mjs adds 7 tests (63 in all).
  Not verified: a real supplier's notice, and production.

## 2026-10-25 (internal secret rotated)
- INTERNAL_NOTIFY_SECRET has a new random value (generated on Ian's machine
  straight to the clipboard; never shown in chat) on both Netlify sites, in
  Production, Deploy Previews, Branch deploys and Preview Server, with Local
  development empty. batchd-app now has it under the correct name and the
  misspelled INTERNAL_NOTIFY_SECREY is deleted. Ian triggered production
  deploys on both sites at about 14:11 UTC.

## 2026-10-25 (copy accuracy)
- FIXED: the drill certificate, a document meant for an inspector, said a
  US drill "satisfies recall readiness exercise requirements under FDA FSMA
  Section 204 / 21 CFR 117.126". FSMA 204 is a record-keeping rule with no
  drill requirement, and 117.126 is the food safety plan for manufacturing
  facilities, not retail stores. The US sentence now says the drill
  documents a readiness exercise, FDA recall guidance recommends practicing
  recall procedures, and neither rule sets a drill requirement for stores.
  The drill report no longer calls one drill a year an FDA "requirement".
  The NO branch is frozen and unchanged.
- Retailer copy that described the retired manufacturer network as current:
  the drill certificate and report ("manufacturer recall push network"), the
  Recalls empty state, the manual recall note (pointed at a manufacturer
  portal that does not exist), the lot tracer subtitle, the compliance step
  "manufacturer links", the readiness score definition, the complaint
  pattern advice, and the "Manufacturer push" source label (composer pushes
  are the retailer's own; now "Pushed recall"). Investigations and exposure
  wording stay, since the manufacturer portal is being planned.

## 2026-10-25 (key rotation)
- Rotated the production Supabase secret key: Ian created a new key and put
  it into Production, Branch deploys and Preview Server on both Netlify
  sites, and emptied the plain-text Local development value. Verified from
  the production API log: both sites' functions and the 13:30 UTC
  recall-escalation run authenticate with the new key; the old key was last
  used at 13:00. The old key is to be deleted in Supabase.
- Rotated the Anthropic key: the new key is in Production, Deploy Previews,
  Branch deploys and Preview Server on both sites (www's variable had to be
  deleted and recreated because edits would not save), both sites
  redeployed at 13:37 UTC, and Ian disabled the old key. Ian also deleted
  the old Supabase secret key. Verified after both deletions: both live
  sites still read the production database, a staging triage call on a
  preview returned a real AI result (serious, spoilage), and the production
  API log shows only the new key with no failed calls.

## 2026-10-25 (internal secret name)
- FOUND: on the batchd-app Netlify site the server-to-server secret is
  stored as INTERNAL_NOTIFY_SECREY (typo). The code reads
  INTERNAL_NOTIFY_SECRET, so on batchd-app, the scanner's canonical URL,
  complaint emails to managers (triage-complaint to notify-event) and the
  push-recall email were refused. www.batchdapp.com has the right name.
  Netlify cannot rename a key, so netlify/lib/auth.js gains internalSecret(),
  which accepts the misspelling as a fallback, and every caller uses it.
  Verified: tests/internal-secret.test.mjs (4 tests). Ian can recreate the
  variable under the right name later; the fallback then does nothing.
- FOUND while reading the variable list: Netlify shows "Local development"
  values of secret variables in full, and ANTHROPIC_API_KEY on batchd-app is
  not marked secret. The production Supabase secret key, the internal secret
  and the Anthropic key were therefore readable to anyone with Netlify team
  access (and passed through a Claude session). Recommended to Ian: clear the
  Local development values, mark the Anthropic key secret, rotate the
  production Supabase secret key and the Anthropic key.

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
## 2026-10-25
- Deploy previews now run their server functions against the staging
  database too (the pages already did). Every function reads SUPABASE_URL
  from the environment with production as the fallback (five had it
  hardcoded); Netlify has SUPABASE_URL set to staging for the Deploy
  Previews context only, on batchd-app and gentle-belekoy-be3cb7. The
  matching staging SUPABASE_SERVICE_KEY must be pasted by Ian in Netlify
  (Deploy Previews context only); until then preview functions fail closed.
  triage-complaint calls notify-event on its own deploy instead of the
  production URL. The ocr warm-up answer carries an X-Batchd-Db header
  (staging or production) so the setting can be checked from outside.
  scripts/check.mjs gained a check that no function hardcodes the URL.
  Ian pasted the staging key on both sites the same day. Verified on the
  pull request's preview: a staging-only org is found and a production org
  is not (functions reach staging only); a full complaint through
  triage-complaint saved every form field, AI triage returned critical, and
  the audit log reads complaint_received, ai_triage_complete,
  critical_alert_sent, follow_up_email_sent (both sends confirmed by Resend,
  to Resend's delivered@resend.dev test inbox); notify-consumers sent a
  notice for a staging manual recall and a repeat of the same request also
  reported sent, as Resend replays an idempotent request. Not verified: that
  Resend delivered one email, not two (needs the Resend dashboard).
- First scheduled run of the rewritten FDA import (06:00 UTC): 200 in
  0.7 s, 3 recalls added, 0 duplicates (7,707 to 7,710 FDA rows).

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

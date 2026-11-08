# B5: public feeds as backstop

Written 2026-11-08 for Ian, after B4 (docs/B4-RECALL-CATALOG-PLAN.md)
shipped. A plan, not a build. B5 is the last item of the recall engine
(docs/PLATFORM-IMPROVEMENT-PLAN.md, track B) before B3 and phase 4.

The promise: a recall the supplier never sent still reaches the stores
that received the product, and reaches them in a day, not weeks.

## 1. Facts, checked 2026-11-08

### The catalog today (production)

| Measure | Value |
|---|---|
| Entries | 501 (451 distinct FDA recall numbers, 50 without a number) |
| With parsed lot codes | 283 |
| With GTINs | 0 (the migrated entries were never parsed for GTINs; the importer finds them only in code_info, and the FDA puts "UPC 712199083411" in the product text) |
| No code text at all | 37 |
| Code text is a date ("Best By 8/21/2026", "Exp: 10/14/26", "USE BY: 10/19/2027") | 172 |
| Code text is a range ("PB24105 through PB24150", "024-057") | 59 |
| Code text says "all lots", "all codes" or "no codes" | 6 and more |
| Report dates | 2026-04-13 to 2026-10-28 |

Today's parser (parseCodeInfo in fetch-recall-feeds.js and its SQL twin
batchd_parse_lots) keeps tokens of 4 to 30 characters with a digit and
drops dates, bare years and UPCs. It misses the three shapes that carry
most of the entries: dates, ranges and GTINs. A scan of "Best By
8/21/2026" stock can never match a feed entry today, nor can a barcode.

### The feeds

| Feed | Verified | What it gives |
|---|---|---|
| openFDA food enforcement report (`api.fda.gov/food/enforcement.json`), the one we import | Yes, 29,586 records, `meta.last_updated` 2026-10-28 | Structured: recall_number, event_id, classification, status, product_description, code_info, more_code_info, reason_for_recall, recalling_firm, distribution_pattern, product_quantity, report_date, recall_initiation_date, center_classification_date. Published weeks after the recall starts (the sample row: initiated 2026-08-24, classified 2026-10-20, reported 2026-10-28). |
| FDA "Recalls, Market Withdrawals, & Safety Alerts" RSS (`fda.gov/.../rss-feeds/recalls/rss.xml`) | Yes, 20 newest items, all product types | Press releases the day the firm announces: title (firm, brand, product, reason), link to the article, pubDate, a description cut at about 300 characters. No product type, no codes in the feed itself; the article page has the lot codes, UPCs, dates, photos and "Product Type". |
| The same page's table download (`.../datatables-data?_format=xlsx`) | Yes, 1,083 rows | Date, Brand-Names, Product-Description, Product-Types, Recall-Reason-Description, Company-Name, Terminated Recall. No link column. |
| USDA FSIS recall API (`fsis.usda.gov/fsis/api/recall/v/1`) | No: HTTP 403 to our fetch | Deferred (Ian, decision 2 of the improvement plan). Needs a working endpoint or key before it is planned. |

The gap B5 closes is the one between the press release (day 0) and the
enforcement report (weeks later), and the one between the FDA's free-text
codes and a store's shelf.

### What already exists to build on

- `recall_catalog` with `lots`, `gtins`, `raw`, `code_info`;
  `recall_catalog_org` with dismissed, reviewed and matched;
  `sweep_catalog_matches(p_catalog_id, p_lookback_days)`;
  `batchd_active_recalls` returning `lots` and `gtins`; both apps reading
  the function; `exactIdentifierHit` and the shared matcher reading every
  lot and GTIN (B4).
- The supplier notice reader (netlify/lib/recall-notice.js, Claude through
  the SDK): a JSON schema with recalling_firm, notice_date, classification,
  reason, hazard, products (description, brand, size, gtins, lots,
  lot_ranges from and to, best_by_from and best_by_to, match_terms),
  instructions, contact, uncertainties, and the prompt that fills it from
  a pasted or attached notice. It already does exactly what an FDA press
  release needs.
- `extractBestBefore` (src/shared/gs1.js) reads a best-before date out of
  a scan's raw capture, so date-coded recalls can be matched on the shelf.
- `recall_notices` (migration 040) links a supplier notice to the recall
  event it became.

## 2. The target

Three things, in order of value:

1. **Every entry carries what a store can match on.** Lots, lot ranges,
   GTINs, best-by dates and an "all lots" flag, parsed once by one shared
   parser, from the enforcement text and from press releases alike. The
   matcher uses all of them.
2. **Announcements arrive on day 0.** Each FDA press release about food
   becomes catalog entries the same day, read by the notice reader, with
   a link to the article. When the enforcement entry arrives weeks later
   it joins the announcement instead of appearing as a second recall.
3. **"No supplier notice" is visible.** A public entry that matches what
   an organization received, where no supplier notice or pushed recall
   covers the same product, is flagged in both apps, so the store pulls
   on the public word alone.

## 3. The model (additive, as in B4)

### recall_catalog gains

| Column | Purpose |
|---|---|
| `kind` text | 'enforcement' (today's rows) or 'announcement' (press release) |
| `notice_url` text | the FDA article for an announcement; the enforcement report has none |
| `event_key` text | FDA `event_id` for enforcement rows; announcements get it when linked |
| `announcement_id` uuid | on an enforcement entry: the announcement it confirms (same firm and product, within 90 days) |
| `lot_ranges` jsonb | `[{"from":"PB24105","to":"PB24150"}]`, as printed, never expanded in storage |
| `best_by_from`, `best_by_to` date | a single date goes in both |
| `all_lots` boolean | the text says all lots, all codes, all dates |
| `match_terms` text[] | two or three lowercase words that name the product type, from the reader |
| `parser_version` int | which parser last filled lots, gtins, ranges and dates; the importer re-parses older entries a hundred a run |

`external_key` for an announcement: `press|<guid>|<n>` (one entry per
product the reader lists). Source stays 'fda', so `batchd_active_recalls`
and the region rule need no change for the feed branch.

### recall_catalog_org gains

| Column | Purpose |
|---|---|
| `covered_by_event_id` uuid | the pushed recall (from a supplier notice or the composer) that covers this entry for this organization, set by a nightly link step and by the composer when a notice is pushed |

"No supplier notice" = `matched_at IS NOT NULL AND covered_by_event_id IS
NULL AND dismissed_at IS NULL`.

### batchd_active_recalls returns

`lot_ranges`, `best_by_from`, `best_by_to`, `all_lots`, `match_terms`,
`kind`, `notice_url`, `covered` (boolean). `lots` stays. Rows keep their
shape otherwise, so the normalizer adds fields and nothing else moves.

### The matcher (src/shared)

One shared module, `src/shared/lot-codes.js`, holds the parser (JavaScript
only; the SQL twin from migration 044 is retired once every entry carries
`parser_version`). `recall-match.js` learns three rules:

- a lot range matches when the scan's lot has the same letter prefix and
  its number falls inside the range (no expansion, no cap needed);
- a best-by window matches when `extractBestBefore(scan.raw_capture)`
  falls inside `best_by_from..best_by_to` and the product corroborates
  (red), or without corroboration when a GTIN also matches;
- `all_lots` matches on GTIN (red) or on product only (orange, "verify on
  shelf"), never red on product alone.

`exactIdentifierHit` (the strict rule the reports use) gains the range and
the GTIN cases and stays strict otherwise.

## 4. Stages and pull requests

| Stage | Contents | Done when |
|---|---|---|
| 1. Parser v2 (code, migration 045). **Built 2026-11-08; 045 on staging and production** | `src/shared/lot-codes.js` parses lots with label priority, ranges, GTINs and UPCs from code text and product text, best-by dates, the all-lots flag; migration 045 adds the columns above and `parser_version`; the importer fills them for new entries and re-parses up to 100 older entries per run from `raw` or `code_info`; the matcher and `exactIdentifierHit` learn ranges, dates and all-lots; Node tests on the fixtures the catalog shows today (the 14 random samples in section 1 become test cases). | On production every entry has `parser_version` 2 within a week; the share of entries with at least one matchable key (lot, range, GTIN or date) goes from 56 percent to above 85 percent; the e2e chain still passes |
| 2. Announcements (code). **Built 2026-11-08** | `fetch-recall-feeds.js` reads the RSS, fetches each new article's text, runs the notice reader (the same schema and prompt as supplier notices, plus one field, `product_type`, to keep food only), writes one entry per product with `kind` 'announcement' and `notice_url`, and sweeps. Feed alerts and the scanner show "Announced <date>" with a link to the FDA article. Spend is Batch'd's: about 20 notices a week, a few cents each on claude-opus-5-5. | A press release published this morning is in Feed alerts tonight with its lots and GTINs; the sweep matched it against receipts |
| 3. Linking (migration 046, code). **Built 2026-11-08; 046 on staging, production pending** | When an enforcement entry arrives, link it to the announcement with the same firm and product within 90 days (`announcement_id`); the apps show one card. For each organization, set `covered_by_event_id` where a pushed recall (supplier notice or composer) names the same product and a shared lot or GTIN. | The duplicate card is gone; a catalog entry pushed from a supplier notice shows "Covered by your recall of <date>" |
| 4. The flag (code) | Feed alerts gets a "No supplier notice" filter and badge; the Active tab and the scanner's sign-in alert and drawer say "Public recall, no supplier notice" on such entries; the Monday health email counts them. | A store whose receipt matches a public entry that no supplier sent sees it at sign-in with that wording |
| 5. FSIS (later) | Only when a working endpoint is confirmed (the public API answered 403). Source 'fsis' already passes the function's region rule. | Deferred by Ian's decision 2 |

Order of value: stage 1 alone makes today's 501 entries matchable; stage
2 is the day-0 promise; stages 3 and 4 are what the retailer sees.

## 5. Verification

- Node tests for the parser against the real code_info shapes (dates,
  ranges, UPC in product text, "all lots", labels), for the three new
  matcher rules and for `exactIdentifierHit`.
- A fixture press release through the notice reader in a test (the reader
  already has tests in tests/recall-notice.test.mjs).
- The reconciliation after stage 1 on production: entries by
  `parser_version`, share with a matchable key, no entry lost a lot it had.
- The e2e suite on every preview, plus one new step in stage 4: a catalog
  entry whose lot matches a staging receipt shows "No supplier notice" in
  Feed alerts and at the scanner's sign-in.
- Smoke checks for Ian after each stage, as always.

## 6. Decisions for Ian

Answered by Ian on 2026-11-08: all five as recommended ("Approve all,
start stage 1").

1. **Claude reads FDA press releases** with the supplier notice reader.
   Batch'd pays: about 20 notices a week at a few cents each on
   claude-opus-5-5, roughly a dollar a week. Recommended: yes; the
   alternative is regex over the article text, which misses most codes.
2. **"All lots" recalls** become a product-level alert (orange, "verify on
   shelf") unless a GTIN matches; never red on product name alone.
   Recommended: yes, the CLAUDE.md counting rule stays exact-identifier.
3. **Date-coded recalls** count as exact when the scan's best-before date
   falls in the window and the product corroborates. Recommended: yes;
   172 of today's entries can match no other way.
4. **"No supplier notice" delivery**: the badge and the sign-in alert in
   stage 4 now; an email digest to corporate admins waits for C1 (push
   notifications), so the recall moment is designed once. Recommended:
   yes.
5. **FSIS** stays deferred until an endpoint answers. Recommended: yes.

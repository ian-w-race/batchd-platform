# Batch'd Recall System — Schema Reference

Verified against `information_schema` on **2026-05-08**.

This document covers only the **recall-flow tables** — the seven tables
the recall publish/match/acknowledge/resolve flow touches. Other tables
(organisations, stores, products, code_patterns, complaint_records,
investigation_responses, etc.) are stable and outside this doc's scope.

When the live schema changes, update this file in the same commit. If
SCHEMA.md disagrees with reality, future Claude sessions and developers
will be sent down the wrong path — that's actively worse than no docs.

For high-impact gotchas only, see CLAUDE.md "Critical database rules".
This file is the long-form reference.

---

## Table of contents

1. [recalls](#recalls)
2. [recall_events](#recall_events)
3. [recall_distributions](#recall_distributions)
4. [recall_acknowledgements](#recall_acknowledgements)
5. [scan_recall_matches](#scan_recall_matches)
6. [mock_recall_drills](#mock_recall_drills)
7. [scans](#scans)
8. [Foreign key map](#foreign-key-map)
9. [Triggers and RPCs](#triggers-and-rpcs)
10. [Two ID columns convention](#two-id-columns-convention)
11. [Migration log](#migration-log)

---

## recalls

**Purpose.** Manual recalls (created by retailer staff via dashboard or
manager view) and feed-imported recalls (FDA, Mattilsynet, RASFF). Also
holds ~7 legacy rows from the retired manufacturer-push flow — those
rows have `is_pushed = true` and `recall_event_id` populated.

**Columns** (verified):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | uuid | NO | |
| created_at | timestamp tz | YES | |
| product_name | text | YES | |
| lot_number | text | YES | |
| batch_number | text | YES | Distinct from lot_number; rarely populated |
| barcode_number | text | YES | Note: this table uses `barcode_number`. `recall_events` uses `barcode` (no suffix). |
| description | text | YES | The reason text. **Use this, not `reason`** — alias via PostgREST: `reason:description`. |
| active | boolean | YES | false = resolved/historical. resolveManualRecall flips this. |
| organisation_id | uuid | YES | FK → organisations(id) ON DELETE SET NULL |
| source_org_id | uuid | YES | FK → organisations(id) ON DELETE SET NULL. Legacy from manufacturer-push flow. |
| is_pushed | boolean | YES | True for ~7 legacy manufacturer-push rows. **Filter when iterating "manual recalls only".** |
| recall_event_id | uuid | YES | Links legacy push rows to recall_events. No FK constraint. |
| source | text | YES | 'manual' \| 'fda' \| 'rasff' \| 'mattilsynet' |
| potential_duplicate | boolean | YES | Used by FDA/feed dedup |
| duplicate_source | text | YES | |
| duplicate_ref | uuid | YES | |
| resolved_at | timestamp tz | YES | Set when active flips to false |

**Does NOT have:** `severity` (fold severity into description text — see
mgrAddRecall and saveManualRecall for the pattern). `reason` (use
`description` aliased as `reason` via PostgREST).

**Read pattern** (from `loadComplianceData`):
```js
sb.from('recalls')
  .select('id, product_name, lot_number, barcode_number, active, source, created_at, reason:description')
  .eq('organisation_id', _orgId)
  .eq('active', true)
```

---

## recall_events

**Purpose.** Manufacturer-pushed recalls. Distinct from `recalls` for
legacy reasons (the manufacturer side was retired in chunk 6 but the
table is still read by recall-distribution joins).

**Columns** (verified):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | uuid | NO | |
| source_org_id | uuid | NO | FK → organisations(id) ON DELETE CASCADE |
| product_id | uuid | YES | FK → products(id) ON DELETE SET NULL |
| product_name | text | NO | |
| lot_number | text | YES | |
| barcode | text | YES | Note: `barcode` (no `_number` suffix). `recalls` table uses `barcode_number`. |
| severity | text | NO | 'class_i' \| 'class_ii' \| 'class_iii' \| other |
| reason | text | NO | |
| description | text | YES | Distinct from `reason`; both exist on this table. Code reads them interchangeably. |
| authority_reference | text | YES | |
| affected_countries | ARRAY | YES | Postgres array column |
| is_drill | boolean | NO | Discriminator for mock drills vs real recalls |
| published_at | timestamp tz | YES | |
| created_at | timestamp tz | NO | |
| cap_data | jsonb | YES | |
| authority_ref | text | YES | Legacy duplicate of authority_reference |

**Does NOT have:** `is_recalled`. Don't query this column — silent 400.

**Drill detection.** `is_drill = true` means a mock drill. Drills should
NEVER count toward active recall numbers (CLAUDE.md rule). Whenever
filtering recall_events for "real recalls", add
`!ev.is_drill` or `.eq('is_drill', false)` to the query.

---

## recall_distributions

**Purpose.** Maps a pushed recall_event to a target retailer org. One
row per (recall_event, retailer) pair. Drills also create a row here.

**Columns** (verified):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | uuid | NO | |
| recall_event_id | uuid | NO | FK → recall_events(id) ON DELETE CASCADE |
| retailer_org_id | uuid | NO | FK → organisations(id) ON DELETE CASCADE. **NOT `initiating_org_id`.** |
| est_affected_units | integer | YES | |
| distributed_at | timestamp tz | NO | |

**Read pattern**:
```js
sb.from('recall_distributions')
  .select('recall_event_id, est_affected_units, distributed_at')
  .eq('retailer_org_id', _orgId)
```

---

## recall_acknowledgements

**Purpose.** Per-store acknowledgement chain for both real recalls and
drills. One row per (recall_event, store) pair.

The 5-step ack chain is:
`notified → acknowledged → pulled → disposed → confirmed`

Each transition stamps a per-step timestamp column (added 2026-05-07).
The chain is advanced by `_advanceLinkedAck` (scanning app) and
`advanceAckStatus` (dashboard).

**Columns** (verified):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | uuid | NO | |
| recall_event_id | uuid | NO | FK → recall_events(id) ON DELETE CASCADE |
| store_id | uuid | NO | FK → stores(id) ON DELETE CASCADE |
| organisation_id | uuid | NO | FK → organisations(id) ON DELETE CASCADE |
| acknowledged_by | uuid | YES | User who first acknowledged the recall |
| status | text | NO | 'notified' \| 'acknowledged' \| 'pulled' \| 'disposed' \| 'confirmed' |
| units_pulled | integer | YES | Required when transitioning to 'pulled' |
| disposal_method | text | YES | |
| notes | text | YES | |
| acknowledged_at | timestamp tz | YES | When entered 'acknowledged' state. **Do not overwrite on later transitions.** |
| pulled_at | timestamp tz | YES | When entered 'pulled' state. Added 2026-05-07. |
| disposed_at | timestamp tz | YES | When entered 'disposed' state. Added 2026-05-07. |
| confirmed_at | timestamp tz | YES | When entered 'confirmed' state. Added 2026-05-07. |
| units_pulled_confirmed_at | timestamp tz | YES | Distinct from pulled_at — when units count was confirmed. |
| units_pulled_confirmed_by | uuid | YES | |
| escalation_2h_sent_at | timestamp tz | YES | -- unverified runtime: confirms staff escalation pings |
| escalation_24h_sent_at | timestamp tz | YES | -- unverified runtime |
| created_at | timestamp tz | NO | When the row was inserted (i.e., when notification was created) |

**Per-step timestamp convention** (round 2 fix):
- Stamp ONLY the column for the step you're entering
- Never overwrite an earlier step's timestamp on later transitions
- `acknowledged_at` records when the ack chain BEGAN (entered 'acknowledged'), not the most recent transition

**Why this convention exists.** Before 2026-05-07 the schema had only
`acknowledged_at`. The chain-advance code overwrote it on every
transition, so the column held the time of the LAST step (often
'confirmed') instead of when the staff member actually acknowledged
the recall. Audit reports and timelines all rendered "—" for every
step past Acknowledged because the per-step columns didn't exist. Both
were fixed in the same migration.

---

## scan_recall_matches

**Purpose.** Confirmed scan ↔ recall pairings. Written when a scan is
matched (exactly) to an active recall. Read by joint recall reports,
exposure metrics, recall-hit counters, and the active-recall counter
on the dashboard.

**Columns** (verified):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | uuid | NO | |
| scan_id | uuid | NO | FK → scans(id) ON DELETE NO ACTION |
| recall_id | uuid | YES | FK → recalls(id) ON DELETE NO ACTION. Polymorphic — see "two ID columns" below. |
| recall_event_id | uuid | YES | FK → recall_events(id) ON DELETE CASCADE. Added 2026-05-07. |
| recall_source | text | YES | 'manual' \| 'fda' \| 'rasff' \| 'mattilsynet' \| 'manufacturer_push'. Discriminator. |
| recall_product | text | YES | Snapshot of recall.product_name at match time |
| recall_lot | text | YES | Snapshot of recall.lot_number at match time |
| match_type | text | NO | 'exact_lot' \| 'exact_barcode' |
| match_confidence | text | NO | 'high' \| (other levels) |
| matched_at | timestamp tz | NO | When the match was created |
| matched_by | text | YES | -- unverified runtime: which path created the match |
| organisation_id | uuid | NO | |
| store_name | text | YES | Snapshot of scan.store_name |
| store_id | uuid | YES | Snapshot of scan.store_id |
| scanned_by | text | YES | Snapshot of scan.scanned_by |
| placed_at | timestamp tz | YES | Original scan creation time |
| quantity | integer | YES | Snapshot of scan.quantity |
| removed_at | timestamp tz | YES | Real column. **NEVER WRITTEN by app code.** Don't rely on it for "is on shelf" checks — use `scans.removed_from_shelf_at`. |
| removed_by | text | YES | Real column, never written |
| complaint_id | uuid | YES | Optional link to a complaint record |
| created_at | timestamp tz | NO | |

**Does NOT have:** Anything. The historical CLAUDE.md gotcha that said
`removed_at` doesn't exist was wrong — the column is real, it's just
never populated. Selecting it returns null but doesn't fail.

**Polymorphic recall_id.** See [Two ID columns convention](#two-id-columns-convention).

---

## mock_recall_drills

**Purpose.** Annual drill tracking, separate from real recalls but
linked to a `recall_events` row marked `is_drill = true`. The
recall_events row drives the per-store ack chain; this row holds
drill-specific metadata.

**Columns** (verified):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | uuid | NO | |
| initiated_by_org | uuid | NO | FK → organisations(id) ON DELETE CASCADE. **NOT `retailer_org_id`.** |
| recall_event_id | uuid | NO | FK → recall_events(id) ON DELETE CASCADE |
| target_retailer_id | uuid | YES | FK → organisations(id) ON DELETE SET NULL |
| started_at | timestamp tz | NO | When the drill was launched. **Canonical timestamp.** |
| completed_at | timestamp tz | YES | When the drill was marked complete |
| results | jsonb | YES | Free-form result payload |
| created_at | timestamp tz | NO | Row creation time. Both `started_at` and `created_at` exist; use `started_at` everywhere except DB audit queries. |
| scenario_text | text | YES | Drill script paragraph from the launcher template (category kits). Shown on the drill certificate. Migration 028, 2026-10-07. |

---

## scans

**Purpose.** Every product placement scan. The single source of truth
for "what's on shelf right now" — `removed_from_shelf_at IS NULL`
identifies on-shelf scans.

**Columns** (verified):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | uuid | NO | |
| created_at | timestamp tz | YES | |
| product_name | text | YES | |
| barcode_number | text | YES | |
| lot_number | text | YES | |
| batch_number | text | YES | |
| product_photo_url | text | YES | |
| barcode_photo_url | text | YES | |
| store_name | text | YES | Legacy text field; new scans should populate store_id too |
| scanned_by | text | YES | Email of staff member |
| notes | text | YES | |
| recall_resolved | boolean | YES | Defaults to false on every insert. **Never use to count active recalls.** |
| recall_resolved_by | text | YES | |
| recall_resolved_at | timestamp tz | YES | |
| quantity | integer | YES | Default 1 |
| shelf_location | text | YES | Free-form aisle/section text |
| removed_from_shelf_at | timestamp tz | YES | **Authoritative pull-tracking column.** IS NULL = still on shelf. |
| removed_from_shelf_by | text | YES | |
| manager_escalated | boolean | YES | |
| manager_escalated_at | timestamp tz | YES | |
| manager_escalated_by | text | YES | |
| is_ftl | boolean | YES | Food Traceability List flag (FSMA 204) |
| ftl_category | text | YES | FSMA 204 category if applicable |
| reference_document | text | YES | PO/BOL reference (FSMA 204 KDE) |
| tlc_source | text | YES | FSMA 204 KDE — where the lot code came from |
| supplier_name | text | YES | One-step-back traceability |
| organisation_id | uuid | YES | FK → organisations(id) ON DELETE SET NULL |
| store_id | uuid | YES | FK → stores(id) ON DELETE SET NULL |
| retain_until | timestamp tz | YES | -- unverified runtime: retention policy enforcement |
| audit_note | text | YES | |
| complaint_filed | boolean | YES | -- unverified runtime |
| label_text | text | YES | OCR'd label content (mirrors raw_capture going forward) |
| expiry_date | text | YES | Best-by / use-by extracted from raw_capture |
| client_uuid | uuid | YES | Idempotency key — UNIQUE constraint prevents duplicate inserts on offline-replay |
| raw_capture | text | YES | Verbatim inkjet date/lot cluster from extract_raw_cluster OCR |

---

## Foreign key map

```
mock_recall_drills.initiated_by_org    → organisations.id    [CASCADE]
mock_recall_drills.recall_event_id     → recall_events.id    [CASCADE]
mock_recall_drills.target_retailer_id  → organisations.id    [SET NULL]

recall_acknowledgements.organisation_id → organisations.id   [CASCADE]
recall_acknowledgements.recall_event_id → recall_events.id   [CASCADE]
recall_acknowledgements.store_id        → stores.id          [CASCADE]

recall_distributions.recall_event_id   → recall_events.id    [CASCADE]
recall_distributions.retailer_org_id   → organisations.id    [CASCADE]

recall_events.product_id               → products.id         [SET NULL]
recall_events.source_org_id            → organisations.id    [CASCADE]

recalls.organisation_id                → organisations.id    [SET NULL]
recalls.source_org_id                  → organisations.id    [SET NULL]

scan_recall_matches.recall_event_id    → recall_events.id    [CASCADE]
scan_recall_matches.recall_id          → recalls.id          [NO ACTION]
scan_recall_matches.scan_id            → scans.id            [NO ACTION]

scans.organisation_id                  → organisations.id    [SET NULL]
scans.store_id                         → stores.id           [SET NULL]
```

**Note on cascade semantics:**
- Deleting a `recall_events` row cascades to delete its acks,
  distributions, mock_recall_drills, AND scan_recall_matches
  (via recall_event_id).
- Deleting a `recalls` row does NOT cascade to scan_recall_matches
  (`ON DELETE NO ACTION`). The scan_recall_matches row will fail to
  delete; the recall delete will error. This is intentional — match
  history should be preserved.
- Deleting an `organisations` row sets recalls/scans org_id to NULL
  rather than cascading. Drill rows fully cascade.

---

## Triggers and RPCs

### `trigger_recall_sweep` (DB trigger on `recalls`)

Fires on `INSERT` and `UPDATE` of the `recalls` table. Inserts matching
rows into `scan_recall_matches` for any existing scan that matches the
new/updated recall by exact lot or barcode. Uses upsert with
`ON CONFLICT (scan_id, recall_id) DO NOTHING`.

The unique index `scan_recall_matches_scan_recall_unique` on
`(scan_id, recall_id)` is required for the upsert — added 2026-05-06.

### `sweep_recall_matches(p_recall_id, p_organisation_id, p_lookback_days)` RPC

Manual retroactive sweep — used by client code (`sweepScansForRecall`
in index.html and dashboard's `saveManualRecall`) to retroactively
match a newly-created recall against existing scans.

Returns: integer count of new match rows inserted.

**Validation note.** The client wrapper logs a console warning if the
RPC returns null or a non-number — schema drift surface (audit fix #44).

---

## Two ID columns convention

`scan_recall_matches.recall_id` is polymorphic for legacy reasons:

| Path | Inserted by | recall_id holds | recall_event_id holds | recall_source |
|---|---|---|---|---|
| **A** (manual / feed) | `matchScanAgainstRecalls` (index.html), `sweep_recall_matches` RPC, `trigger_recall_sweep` | `recalls.id` | NULL | 'manual' \| 'fda' \| 'rasff' \| 'mattilsynet' |
| **B** (manufacturer-push) | Login-time push sweep (index.html) | `recall_events.id` | `recall_events.id` (same value, both populated) | 'manufacturer_push' |

**Querying convention** (audit fix #6, 2026-05-07):

- For manual/feed recalls — use `.eq('recall_id', recalls.id)`. The
  `recall_event_id` column will be NULL.
- For manufacturer-pushed recalls — use `.eq('recall_event_id', recall_events.id)`.
  Has a real FK with CASCADE on delete, type-safe, unambiguous.

The legacy `recall_source` discriminator is still useful for reporting
but no longer needed for disambiguation since `recall_event_id` is
unambiguous on Path B.

**Why this exists.** Before 2026-05-07 the only column was the
polymorphic `recall_id`. `generateJointRecallReport` queried by
`recall_id` against a `recall_events.id` value, which only worked if
matches happened to be inserted via Path B. Path A matches (which is
the main path) didn't appear in joint reports for pushed recalls. The
new column resolves the ambiguity.

---

## Migration log

Each entry: **what changed** + **why** (the symptom that drove the
change). New entries go at the top.

### 2026-05-07 — `scan_recall_matches.recall_event_id`

**Migration:**
```sql
ALTER TABLE scan_recall_matches
  ADD COLUMN IF NOT EXISTS recall_event_id UUID
  REFERENCES recall_events(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS scan_recall_matches_recall_event_id_idx
  ON scan_recall_matches(recall_event_id);

UPDATE scan_recall_matches
SET recall_event_id = recall_id
WHERE recall_source = 'manufacturer_push'
  AND recall_event_id IS NULL
  AND EXISTS (SELECT 1 FROM recall_events WHERE id = scan_recall_matches.recall_id);

DELETE FROM scan_recall_matches
WHERE recall_source = 'manufacturer_push'
  AND NOT EXISTS (SELECT 1 FROM recall_events WHERE id = scan_recall_matches.recall_id);
```

**Symptom that drove it:** Joint Recall Reports for manufacturer-pushed
recalls were rendering "0 matched scans" even when scans existed in
production. Root cause: `generateJointRecallReport` queried
`scan_recall_matches.recall_id = recallEventId`, but Path A (manual /
feed) matches stored `recalls.id` in that column, not `recall_events.id`.
The query only worked for Path B (login push sweep) inserts. Backfill
was needed because Path B had been writing to recall_id (treated as
recall_events.id) before the new column existed; orphan cleanup was
needed because deleted test events had left dangling rows that the new
FK constraint refused.

### 2026-05-07 — `recall_acknowledgements` per-step timestamps

**Migration:**
```sql
ALTER TABLE recall_acknowledgements
  ADD COLUMN IF NOT EXISTS pulled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disposed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
```

**Symptom that drove it:** Joint Recall Reports, Store Audit Records,
Store Timeline, and Collab Log all rendered "—" for every step past
Acknowledged. Root cause: the dashboard read `a.pulled_at`,
`a.disposed_at`, `a.confirmed_at` from the result object, but the
schema only had `acknowledged_at`. JS reads of nonexistent properties
return `undefined`, `fmtT(undefined)` → "—", silently. Stores that
genuinely completed the full chain looked identical to stores that
just clicked "Acknowledge" and stopped. Plus a related bug:
`acknowledged_at` was being overwritten on every chain transition, so
it ended up holding the time of the LAST step instead of when the
staff member actually acknowledged.

### 2026-05-06 — Unique index on `scan_recall_matches`

**Migration:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS scan_recall_matches_scan_recall_unique
  ON scan_recall_matches(scan_id, recall_id);
```

**Symptom that drove it:** "There is no unique or exclusion constraint
matching the ON CONFLICT specification" error when publishing a recall.
The DB-side `trigger_recall_sweep` function tries to upsert into
`scan_recall_matches` with `ON CONFLICT (scan_id, recall_id)`, but no
matching unique constraint or index existed. Adding the unique index
satisfies the upsert and prevents future duplicate match rows for the
same (scan, recall) pair.

## Phase 1 tables (migrations 022 to 026, 2026-10-03)

Added for the FSMA 204 implementation handoff. US-only. Every table has
RLS enabled, no anon privileges, and policies in migration 021's
pattern (`b2N_<table>_<who>_<action>`) using the SECURITY DEFINER
helpers from migration 020: `batchd_my_active_org_ids()`,
`batchd_is_corp_admin_of(uuid)`, `batchd_is_manager_of(uuid)`,
`batchd_is_platform_admin()`. Column lists below are the migration
definitions, not an information_schema dump.

### suppliers (022)
Per-organisation supplier directory. The immediate previous source
"location description" for receiving records (21 CFR 1.1345).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| organisation_id | uuid FK organisations | cascade |
| name | text NOT NULL | unique per org, case-insensitive |
| phone, street_address, city, region, postal_code | text | region is the US state |
| country | text NOT NULL DEFAULT 'US' | ISO 3166-1 alpha-2 |
| gln | text | GS1 Global Location Number, optional |
| supplier_type | text NOT NULL DEFAULT 'distributor' | CHECK: distributor, manufacturer, farm, other |
| is_exempt_entity | boolean NOT NULL DEFAULT false | receiving from an exempt entity relaxes the TLC requirement |
| category_hints | text[] | FTL category keys |
| seeded_from | text | 'category_kit:<key>' when created by a kit |
| active | boolean NOT NULL DEFAULT true | prefer deactivate over delete |
| created_at, updated_at | timestamptz | updated_at kept by trigger batchd_touch_updated_at |
| created_by | uuid FK auth.users | DEFAULT auth.uid() |

Policies: members SELECT; active members INSERT; corp_admin or manager
UPDATE; corp_admin DELETE; platform admin ALL.

### receiving_events (023)
The Receiving critical tracking event, one row per lot per delivery
line. `scans.receiving_event_id` (uuid, FK, ON DELETE SET NULL, indexed)
links a shelf scan to its delivery.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organisation_id | uuid FK organisations NOT NULL | |
| store_id | uuid FK stores | set null on delete |
| supplier_id | uuid FK suppliers | set null on delete |
| supplier_name_snapshot | text | copied at write time |
| product_name | text NOT NULL | |
| gtin | text | normalized AI(01) or retail GTIN |
| traceability_lot_code | text | the TLC |
| tlc_source_type | text | CHECK: supplier_label, shipping_document, assigned_by_us, not_required_exempt_source |
| tlc_source_reference | text | |
| quantity | numeric NOT NULL | CHECK >= 0 |
| unit_of_measure | text NOT NULL | free text; the app offers case, each, bag, lb, pallet |
| received_at | timestamptz NOT NULL DEFAULT now() | editable for back-entry |
| reference_document_type | text | CHECK: PO, BOL, invoice, ASN, other |
| reference_document_number | text | |
| is_ftl, ftl_confirmed_by_staff | boolean NOT NULL DEFAULT false | |
| ftl_category | text | |
| pack_date, best_by | date | AI(11); AI(15) or AI(17) |
| raw_label_capture, label_photo_url | text | |
| source | text NOT NULL DEFAULT 'staff_scan' | CHECK: staff_scan, wholesaler_import, manual_entry |
| status | text NOT NULL DEFAULT 'received' | CHECK: expected, received, rejected |
| import_batch_id | uuid | Phase 7 |
| received_by | text | staff email |
| notes | text | |
| client_uuid | uuid UNIQUE | offline replay idempotency |
| retain_until | timestamptz | trigger sets received_at + 2 years when null (21 CFR 1.1455(d); the inline comment in migration 023 still says (a)) |
| created_at | timestamptz NOT NULL DEFAULT now() | |

Indexes: (organisation_id, traceability_lot_code); (organisation_id,
store_id, received_at desc); (organisation_id, store_id, status).
Policies: members SELECT; active members INSERT; corp_admin or manager
UPDATE; no client DELETE; platform admin ALL. Migration 029 (2026-10-07)
adds b29_receiving_member_confirm_expected: any active member may UPDATE a
row while status = 'expected', so floor staff can confirm a delivery that a
wholesaler file pre-filled. Import rows: source 'wholesaler_import', status
'expected', one import_batch_id per file, tlc_source_type
'shipping_document', tlc_source_reference = the file name.

### organisations, new columns (024)
annual_food_sales_band (CHECK: under_250k, 250k_to_1m, 1m_to_10m,
over_10m, undisclosed), operates_registered_facility boolean,
operates_distribution_center boolean, fsma_applicability (CHECK:
exempt, covered_no_spreadsheet, covered, unknown; computed by the app),
focus_categories text[] NOT NULL DEFAULT '{}', pricing_tier (CHECK:
pilot, starter, essential, professional, readiness; informational, and
distinct from organisations.plan which is the commercial status from
migration 020), network_benchmarks_opt_in boolean DEFAULT false,
traceability_plan_contact_name, traceability_plan_contact_phone,
traceability_plan_updated_at. No policy changes.

### products, new columns, and ftl_overrides (025)
products: is_ftl boolean (null = unknown), ftl_category text,
ftl_confirmed_source (CHECK: staff, admin, wholesaler_feed, regex),
ftl_confirmed_at timestamptz.

ftl_overrides: id, organisation_id FK, gtin, product_name_normalized,
is_ftl NOT NULL, ftl_category, set_by, created_at. CHECK that gtin or
product_name_normalized is present. Unique per org on gtin (where not
null) and on product_name_normalized (where gtin is null). Policies:
members SELECT; corp_admin or manager INSERT and UPDATE; corp_admin
DELETE; platform admin ALL. Resolution order in code: org override by
GTIN, org override by normalized name, products.is_ftl by GTIN (through
the products_public view, which exposes the columns only from migration
030), then the scanner's name regex.

### records_requests and traceability_plans (026)
records_requests: id, organisation_id FK, is_drill DEFAULT true,
requested_at DEFAULT now(), requested_by, scope_lot, scope_product,
scope_date_from, scope_date_to, produced_at, produced_by, row_count,
minutes_to_produce (generated, stored: minutes between requested_at
and produced_at), file_name, notes.

traceability_plans: id, organisation_id FK, version integer NOT NULL
(unique per org), content_json jsonb NOT NULL, rendered_html,
generated_at DEFAULT now(), generated_by, superseded_at.

Policies on both: members SELECT; corp_admin INSERT and UPDATE; no
client DELETE; platform admin ALL.

### Migration log entry

#### 2026-10-03: migrations 022 to 026 written (Phase 1 of the FSMA 204 handoff)
Written on 2026-10-03; applied status is reported by
`migrations/CHECK_MIGRATIONS.sql` and verified by
`docs/verify-022-026.sql`. Numbering shifted up from the handoff's
021 to 025 because migrations 020, 020a and 021 (security hardening,
applied 2026-09-22) already exist. Migration 027 is reserved for the
code_patterns ownership fix noted in docs/WALKTHROUGH.md.

### products_public view (030, 2026-10-08)
Migration 001 defined the view with id, barcode_normalized, product_name
(products.name) and source, filtered to published rows with a normalized
barcode, security_invoker false, SELECT granted to authenticated and anon.
Migration 030 re-creates it with is_ftl, ftl_category and
ftl_confirmed_source appended, so the scanner's GTIN-level FTL lookup
(the third step of the resolution order) answers instead of returning 400.
Until 030 runs, that step fails quietly and the name regex decides.

### stores.external_code (028, 2026-10-07)
text, nullable, with a partial index on (organisation_id, external_code).
The wholesaler's ship-to code for a store. The Phase 7 delivery-file import
matches rows on it before falling back to stores.name. Nothing writes it
yet; the Store Network panel is the intended home for editing it.

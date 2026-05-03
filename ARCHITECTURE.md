# Batch'd Platform Architecture

This document describes the architecture of the Batch'd platform as it evolves through the v2 refactor. It is updated incrementally with each shipped phase.

## Strategic frame

Batch'd is a two-sided lot code intelligence network for food traceability:

- **Manufacturers** register lot code format grammars for their products.
- **Retailers** scan products in the field; their scans validate, refine, and expand the registered patterns.
- **The OCR pipeline** consumes this validated pattern data to constrain extraction, validate output, and reject hallucinations.
- **The recall workflow** sits on top, enabling instant identification of affected inventory across organizations during recall events.

The canonical asset of the system is the **lot code patterns table** (`code_patterns`), validated through cross-organizational scanning. Product name lookup is a commodity; lot code grammar registration validated by retailer scanning is the moat.

## Trust tier model

All product and pattern data carries explicit provenance via a `source` enum with four tiers, in descending order of trust:

| Tier | Origin | Used for |
|------|--------|----------|
| `manufacturer_registered` | The manufacturer org registers the entry directly | Highest-confidence pattern in OCR validation; canonical product identification |
| `retailer_validated` | Auto-promoted from lower tiers after 3+ confirming scans from at least 2 distinct orgs | Trusted enough to skip user confirmation in scanner UX |
| `ai_extracted_unverified` | Created by AI label-scan or single-org scan history; not yet cross-validated | Surfaced to user for explicit confirmation before being relied on |
| `external_api` | Pulled from Open Food Facts, UPC Item DB, etc. | Display-only fallback; never auto-written without user confirmation |

**The trust tier model is structurally enforced via Postgres RLS.** A scanner org cannot INSERT a row with `source = 'manufacturer_registered'` even if it tries — the RLS policy rejects the write. This structural enforcement is what allows the tier model to function as a defensible asset rather than a soft convention.

## Architecture diagram (high level)

```
                    ┌──────────────────────────┐
                    │   Manufacturer portal    │
                    │   (manufacturer.html)    │
                    │                          │
                    │  Registers products      │
                    │  Registers lot patterns  │
                    └───────────┬──────────────┘
                                │
                                │  source = manufacturer_registered
                                ▼
   ┌───────────────────┐   ┌─────────────────┐   ┌──────────────────┐
   │  Scanner app      │──▶│   products      │◀──│   code_patterns  │
   │  (index.html)     │   │  (canonical     │   │  (lot code       │
   │                   │   │   lookup)       │   │   grammars)      │
   │  ZXing barcode    │   └─────────────────┘   └──────────────────┘
   │  AI label fallback│           ▲                       ▲
   │  Lot code OCR     │           │                       │
   └─────────┬─────────┘           │                       │
             │                     │  source = retailer_   │
             │                     │  validated (after     │
             │                     │  3 scans, 2 orgs)     │
             │                     │                       │
             │ source = ai_extracted_unverified            │
             │ (single-source scan or AI label result)     │
             └─────────────────────┴───────────────────────┘
```

## Database schema

### `products` (Phase 1.1 — shipped)

The cross-org product identification table. Combines manufacturer-registered catalog entries and scanner-discovered entries under one trust-tiered roof.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | primary key |
| `name` | text | display name |
| `barcode` | text | original barcode as captured (legacy column, retained for manufacturer.html compatibility) |
| `barcode_normalized` | text | canonical form for cross-system matching (12-digit UPC padded to 13-digit GTIN-13). UNIQUE where non-null. |
| `description` | text | manufacturer-private |
| `category` | text | manufacturer-private |
| `is_ftl` | boolean | manufacturer-private |
| `manufacturer_id` | uuid | nullable. Set by manufacturer registrations; NULL for scanner-created entries |
| `created_by_org_id` | uuid | provenance — which org first added this row |
| `source` | text | enum: see Trust Tier Model |
| `published` | boolean | default true. Whether this row appears in cross-org lookups |
| `created_at`, `updated_at` | timestamptz | standard |

### `products_public` (view — Phase 1.1)

Cross-org lookup view exposing only public-readable columns of published rows:

```sql
SELECT id, barcode_normalized, name AS product_name, source
FROM products
WHERE published = true AND barcode_normalized IS NOT NULL;
```

The view bypasses underlying products RLS (`security_invoker = false`) so any authenticated user can SELECT regardless of org. The view definition itself acts as column-level access control — sensitive columns (`description`, `is_ftl`, `category`) are not exposed.

**Scanner code queries `products_public`. Manufacturer code continues querying `products` directly (RLS-scoped to their own org).**

### RLS policies (Phase 1.1)

In addition to whatever existing manufacturer-scoped policies already protect the `products` table:

- `scanner_orgs_can_insert_unverified_products` — INSERT permitted for any authenticated user, but `source` must be `retailer_validated` or `ai_extracted_unverified`, `created_by_org_id` must match caller's org, and `manufacturer_id` must be NULL or caller's org.
- `scanner_orgs_can_update_own_unverified_names` — UPDATE permitted on rows the caller's org created, with the lower trust tiers, for product_name correction.

These additive policies do not modify existing manufacturer-scoped behavior.

## Future phases (not yet shipped)

| Phase | Goal | Status |
|-------|------|--------|
| 1.1 | Schema: products table with trust tiers | ✅ Shipped |
| 1.2 | Wire ZXing into Step 1 capture flow | ✅ Shipped |
| 1.3 | Bounded fallback chain (1s timeout, parallel) | Pending |
| 1.4 | Unknown barcode flow | Pending |
| 1.5 | Trust tier promotion mechanism | Pending |
| 1.5 (UX) | Two-stage capture (barcode + lot code as distinct sessions) | Pending |
| 2 | Bootstrap migration via `products_pending` staging | Pending |
| 3 | Production validation gate (1-week telemetry) | Pending |
| 4 | OCR pipeline collapse (5 calls → 1 call) | Pending |
| 5 | Pattern learning repurposed (code_patterns trust tiers) | Pending |
| 6 | Defensibility documentation | In progress (this doc) |

## Open architectural questions (deferred)

- **Capacitor / iOS offline sync.** When the scanner is wrapped in Capacitor for iOS, the products table will need to sync to local device storage so it works offline in low-signal store environments. Sync mechanism is TBD and not part of Phase 1.
- **Manufacturer claim flow.** When a manufacturer signs up and their barcodes already exist as scanner-created entries (`source = 'ai_extracted_unverified'` with `manufacturer_id IS NULL`), they should be able to claim those entries. UX and verification approach is TBD; planned for Phase 5.
- **Bad-data correction at scale.** Once cross-org product entries proliferate, mechanisms for flagging and correcting incorrect entries (typos, misidentifications, abuse) will be needed. Out of scope for Phase 1.

## Patent-relevant claim scaffolding (point-to-code, not legal language)

The following architectural patterns are structurally identifiable in the codebase. A patent attorney can draft claims; this document points to the implementation.

- **Two-sided validation loop**: manufacturer-registered patterns validated through cross-org scanning. *Claim scaffolding location TBD as Phase 5 ships.*
- **Barcode-derived identity constraining OCR validation**: barcode → product → format pattern → constrained OCR call → output validated against pattern. *Claim scaffolding location TBD as Phase 4 ships.*
- **Recall trigger workflow on cross-org lot code recognition**: cross-org scan history queryable by lot code pattern enables instant impacted-inventory identification during recall events. *Claim scaffolding location TBD as recall flow integrates with new tier model.*

## Phase 1.2 — ZXing-first product identification (shipped)

The scanner now defaults to barcode mode. ZXing decodes any barcode in view, looks it up against `products_public` first (cross-org instant identification), and auto-advances to Step 2 with a brief toast confirmation. The previous "second barcode prompt" UX is removed in favor of direct progression.

### Lookup chain (in order)

```
products_public  ──▶  code_patterns  ──▶  scans  ──▶  Open Food Facts  ──▶  UPC Item DB
   (NEW)            (org's history)   (org's       (external,           (external,
                                       history)     4M+ products)        US/Canada)
```

The `products_public` view query is a single-row exact match on the unique `barcode_normalized` index — sub-100ms when the barcode is in our database.

External API results are display-only. They populate the product name field for confirmation but do NOT auto-write to `products`. Promotion to the canonical table happens in Phase 1.4 (unknown barcode flow) with explicit user confirmation, gated by the trust tier model.

### Fallback UX

- 3-second timer: if ZXing finds no barcode within 3 seconds, surface a "Can't find a barcode? Tap to identify by photo" prompt that switches to AI label scan.
- ZXing keeps decoding in the background even after switching to label mode. If a barcode comes into view during AI label capture, the scanner auto-switches back to barcode mode (deterministic identification beats AI guess, per plan).

### What Phase 1.2 deliberately defers

- Bounded fallback chain with 1s hard timeout and parallel external API calls — Phase 1.3
- Unknown barcode "new product" flow that writes back to `products` with `source = 'ai_extracted_unverified'` — Phase 1.4
- Trust tier promotion mechanism (3 scans / 2 orgs threshold) — Phase 1.5
- Two-stage capture UX with explicit camera handoff between barcode and lot code — Phase 1.5 (UX)

## Migration history

| Migration | Description | Date |
|-----------|-------------|------|
| `001_products_trust_tier.sql` | Phase 1.1 schema: trust tier columns on products, products_public view, scanner-org RLS policies | 2026-05-03 |

## Code change history

| Commit | Description | Date |
|--------|-------------|------|
| Phase 1.1 | Schema migration (no application code changes) | 2026-05-03 |
| Phase 1.2 | Default to barcode mode, query products_public, auto-advance to Step 2, 3s fallback prompt, keep ZXing running on label fallback | 2026-05-03 |

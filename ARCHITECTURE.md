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
| 1.3 | Bounded fallback chain (1s timeout, parallel) | ✅ Shipped |
| 1.4 | Unknown barcode flow + cross-org write-back | ✅ Shipped |
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

## Phase 1.3 — Bounded fallback chain (shipped)

The product name lookup chain is now race-based instead of sequential. All six sources fire in parallel; first valid result wins.

### Race architecture

```
                        lookupProductName(barcode)
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
    ┌─────────┐             ┌─────────┐             ┌────────────┐
    │ LOCAL   │             │ EXTERNAL │             │ EXTERNAL   │
    │ (3)     │             │ (3)      │             │ (timeout)  │
    │ no cap  │             │ 1s cap   │             │ resolves null
    └────┬────┘             └─────┬────┘             └────────────┘
         │                        │
         │  products_public       │  Open Food Facts v2
         │  code_patterns         │  Open Food Facts v0
         │  scans                 │  UPC Item DB
         │                        │
         └───────── _firstValidName() ──────────┐
                                                ▼
                                  first non-empty name wins
                                  (or null if all empty)
```

### Latency guarantees

- **Happy path (barcode in `products_public`):** sub-100ms — local query wins the race well before external APIs even respond.
- **Cold barcode (only in external DB):** capped at 1 second — external promises hit their `_lookupTimeout` ceiling and resolve null if slow.
- **Unknown to all sources:** capped at 1 second — same timeout boundary, no longer waits for sequential fallbacks.

### Helper primitives

- `_lookupTimeout(promise, ms)` — wraps a promise with hard timeout, resolves null on timeout/error
- `_firstValidName(promises)` — promise-race that resolves to the first non-empty product name string, or null if all resolve null

### What Phase 1.3 deliberately defers

- Tracking which source returned the result (needed for Phase 1.4 to write the right `source` enum value when promoting a result to `products`)
- Auto-write of confirmed AI results to `products` — Phase 1.4
- External API rate-limit / quota awareness (UPC Item DB free tier is 100 lookups/day) — revisit if pilot data shows it bites

## Phase 1.4 — Unknown barcode flow + cross-org write-back (shipped)

This is where the trust-tier model starts paying off — every previously-unknown barcode that an org identifies via the AI label-scan fallback now becomes part of the cross-org `products_public` lookup forever.

### Flow

```
ZXing decodes barcode  →  lookupProductName misses all 6 sources
                                 │
                                 ▼
                  Toast: "✨ New product — let me identify it via the label"
                                 │
                                 ▼
                       Auto-switch to label-photo mode
                                 │
                                 ▼
                  AI identifies product from label image
                                 │
                                 ▼
                 User confirms / edits the suggested name
                                 │
                                 ▼
                User taps "Step 2" (advances past Step 1)
                                 │
                                 ▼
              ┌──────────────────────────────────────────────┐
              │  _writeUnknownProductToCatalog(barcode, name) │
              │                                              │
              │  INSERT INTO products (                      │
              │    barcode_normalized, name,                 │
              │    source = 'ai_extracted_unverified',       │
              │    created_by_org_id = current org,          │
              │    manufacturer_id = NULL,                   │
              │    published = true                          │
              │  )                                           │
              └──────────────────────────────────────────────┘
                                 │
                                 ▼
                Next scan of same barcode (any org, any user)
                       hits products_public instantly.
                              No AI call.
```

### Trust tier this writes

`source = 'ai_extracted_unverified'` — single-source identification, not yet cross-validated. Phase 1.5 defines auto-promotion rules to `retailer_validated` once N independent orgs confirm the same barcode → name pair.

### Failure handling

- **Unique constraint violation** (another org wrote the same barcode concurrently between our lookup miss and our INSERT): logged, swallowed silently. Catalog is now populated either way.
- **RLS rejection** (caller doesn't have org membership): logged, swallowed silently. Worst case: product needs re-identification next scan.
- **Network failure**: logged, swallowed silently.

User-facing impact of any failure: zero. The scan completes normally; the only loss is the next scan of this barcode also has to use AI fallback. No worse than the old behavior.

### Migration 002 — auto-normalize trigger

Phase 1.4 added a Postgres BEFORE INSERT/UPDATE trigger that auto-populates `barcode_normalized` from `barcode` whenever a row is created or `barcode` is changed. This was a Phase 1.1 omission that became blocking for 1.4 — without it, manufacturer-created products (which only set `barcode`, not `barcode_normalized`) would have NULL `barcode_normalized` and be invisible to scanner lookup.

The trigger is defensive: it only writes if `barcode_normalized` is missing, so explicit callers (like Phase 1.4's `_writeUnknownProductToCatalog`) can still set both columns directly.

### What Phase 1.4 deliberately defers

- Trust-tier promotion mechanism (3 scans / 2 orgs auto-promotes `ai_extracted_unverified` → `retailer_validated`) — Phase 1.5
- Manufacturer claim flow (allow a manufacturer to claim ownership of an unverified entry) — Phase 1.5
- Two-stage capture UX (explicit camera handoff between barcode capture and lot code capture, brand-specific lot location hints) — Phase 1.5 (UX)
- Bootstrap migration with US grocery products from Open Food Facts — Phase 2

### US-market notes

This phase is the foundation for solving the "external API coverage gap" problem in any market. For the US specifically:

- UPC Item DB has good US coverage but a 100/day free tier limit. Phase 1.4 means we stop hitting that API for any product anyone has already identified — the catalog covers the gap once a product is known.
- FSMA 204 compliance is fundamentally about cross-org product traceability. The trust-tier `source` enum on `products` is the structural piece that makes "this product was identified by 3 different retailers" meaningfully different from "this product was guessed once by AI."
- Pilot users (US retailers) will identify common US grocery products organically through normal scanning. After ~2-4 weeks of pilot, `products_public` should cover the most common SKUs at participating stores, dropping external API dependency to near-zero for repeat scans.

## Migration history

| Migration | Description | Date |
|-----------|-------------|------|
| `001_products_trust_tier.sql` | Phase 1.1 schema: trust tier columns on products, products_public view, scanner-org RLS policies | 2026-05-03 |
| `002_products_normalize_barcode_trigger.sql` | Phase 1.4 schema: BEFORE INSERT/UPDATE trigger that auto-populates barcode_normalized. Retrofits a Phase 1.1 omission. | 2026-05-03 |

## Code change history

| Commit | Description | Date |
|--------|-------------|------|
| Phase 1.1 | Schema migration (no application code changes) | 2026-05-03 |
| Phase 1.2 | Default to barcode mode, query products_public, auto-advance to Step 2, 3s fallback prompt, keep ZXing running on label fallback | 2026-05-03 |
| Phase 1.3 | Refactor lookupProductName to race all sources in parallel; 1s hard timeout on each external API; first valid result wins | 2026-05-03 |
| Phase 1.4 | Track unknown barcodes through label-fallback flow; write back to products_public with source = 'ai_extracted_unverified' on Step 1→2 transition; new "✨ New product" toast; auto-normalize trigger via migration 002 | 2026-05-03 |

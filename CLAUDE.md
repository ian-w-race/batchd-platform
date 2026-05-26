# Batch'd Platform

## Who I am building with
Ian Race — not a developer. Always provide complete, 
ready-to-use files. Never partial diffs or code snippets 
to manually insert.

## The golden rules
- Think carefully before building anything
- Work surgically — do not break what works
- Never expose API keys in client-side code
- batchd.no is the brand website — never touch it
- All routing is done via JavaScript domain detection 
  inside each HTML file — no _redirects files

## Retailer-only platform (post-chunk-6 pivot)
Batch'd has been streamlined to a retailer-only platform.
The manufacturer side has been retired:
- manufacturer.html, supplier.html, manufacturer-signup.html 
  are now static "retired" landing pages (~80 lines each, 
  noindex, link to batchd.no)
- The Manufacturers panel and Shipments panel were removed 
  from dashboard.html in chunks 6B and 6C-a
- The manufacturer-escalation flow was removed from the 
  Complaint Triage panel in chunk 6C-a
- The trading_partners and shipments tables stay in the 
  DB — they're read by the lot-lookup page, drill launcher, 
  and recall-distribution joins, but no UI in the platform 
  creates new rows in them
- partnerScore was dropped from the dashboard's 4-way 
  readiness average in chunk 6C-b — readiness is now 
  3-way: ackScore + shipScore + scanScore

## The three files
- index.html — staff scanning app (~20,500 lines)
  Deployed to: batchd-app.netlify.app
- dashboard.html — corporate retailer dashboard (~9,900 lines)
  Deployed to: app.batchdapp.com/dashboard.html
- manufacturer.html / supplier.html / manufacturer-signup.html
  — retired stubs (~80 lines each, served from same domain 
  but show "retired" copy)

## Supabase
- Project: lurxucdmrugikdlvvebc.supabase.co
- Ian's org ID: 925923b5-22c6-433c-8812-7e32918dab66
- Ian's user ID: 97da19d3-3daa-4f7a-bd9c-53e7ac8f8a5c

## Critical database rules — never violate these
- recall_resolved on the scans table defaults to false 
  on every insert — never use it to count active recalls
- scan_recall_matches.removed_at IS a real column but is 
  NEVER WRITTEN by app code — pull tracking lives on 
  scans.removed_from_shelf_at. Don't rely on removed_at 
  for "is this scan still on shelf" checks.
- Feed recalls (FDA/Mattilsynet) only count as "active" 
  if confirmed via scan_recall_matches table
- Manual/push recalls count if exact lot or barcode 
  matches an on-shelf scan (removed_from_shelf_at IS NULL)

## Schema reference
See SCHEMA.md (repo root) for the canonical column-by-column 
reference for the 7 recall-flow tables, FK relationships, 
trigger/RPC inventory, and migration log. SCHEMA.md is 
verified against information_schema and updated whenever 
the live schema changes.

## Schema gotchas — column names that bit us
Quick-reference for the highest-impact rules. Full details 
in SCHEMA.md.

- recall_distributions  → retailer_org_id (NOT initiating_org_id)
- mock_recall_drills    → initiated_by_org (NOT retailer_org_id). 
                          Both started_at and created_at exist; 
                          started_at is canonical.
- recalls               → description (NOT reason). Alias 
                          via PostgREST: `reason:description`. 
                          recalls table has NO severity column 
                          — fold severity into description text.
- recall_events         → barcode (NOT barcode_number). Has 
                          BOTH reason AND description; code 
                          reads them interchangeably.
- recalls.is_pushed and recalls.recall_event_id DO exist 
  (legacy from retired manufacturer-push flow, ~7 prod rows). 
  Filter with `if (r.is_pushed || r.recall_event_id) return false;` 
  when iterating "manual recalls only".
- recall_acknowledgements per-step timestamps added 2026-05-07: 
  pulled_at, disposed_at, confirmed_at (alongside acknowledged_at). 
  Earlier rows have NULL for the new three.

Genuine silent 400s — these COLUMNS DO NOT EXIST and a 
SELECT will fail without client-visible feedback unless 
devtools is open:
- recall_events.is_recalled does NOT exist
- recalls.severity does NOT exist
- recalls.reason does NOT exist (use description with PostgREST alias)

## scan_recall_matches — two ID columns, two paths
The recall_id column is polymorphic for legacy reasons:
- Path A (manual / feed recalls): recall_id = recalls.id, 
  recall_event_id IS NULL. Inserted by matchScanAgainstRecalls 
  (index.html) and the sweep_recall_matches RPC (DB-side).
- Path B (manufacturer-pushed recalls): recall_id = 
  recall_events.id AND recall_event_id = recall_events.id 
  (both populated for backward compat). Inserted by the 
  login-time push sweep in index.html.

Convention added 2026-05-07 (audit fix #6):
- Querying by manual/feed recall: use .eq('recall_id', 
  recalls.id). recall_event_id will be NULL on these rows.
- Querying by pushed recall: use .eq('recall_event_id', 
  recall_events.id). Has a real FK to recall_events with 
  CASCADE on delete.
- recall_source is the legacy discriminator ('manual', 
  'fda', 'rasff', 'mattilsynet', 'manufacturer_push'). 
  Still useful for reporting but no longer needed for 
  disambiguation since recall_event_id is unambiguous.

## Recall counting rules (platform-wide)
A recall requires action only when ALL THREE are true:
1. The recall is active (active = true)
2. At least one org scan matches by exact lot or barcode
3. That matched scan is still on shelf
Mock drills never count toward active recall numbers.

## Market & jurisdiction
- Primary market: United States (FSMA 204 compliance)
- Testing ground: Norway (EU 178/2002)
- Ian is a US citizen living in Norway temporarily

## Jurisdiction precedence (CRITICAL — never mix jurisdictions)

Batch'd is a regulatory-assistance platform. The product **must never**
display regulatory copy, regulator names, phone prefixes, currency,
retention rules, or compliance frameworks from one jurisdiction while
the user is assigned to another. A US user must never see Mattilsynet
phrases, Norwegian phone prefixes, EU 178/2002 references, or kr
currency — and vice versa. Cross-user consistency matters for
investigation timelines: every seat in an org must render the same
audit timestamps, regulator citations, and date formats so a recall
post-mortem isn't ambiguous about who saw what.

### Source of truth (admin-controlled, two writers only)

Updated 2026-05-26. Region is set ONLY by the corp admin — never by
the user themselves. There are exactly two places region can be
written:

1. **Organisation default** — `organisations.region`. Editable in
   Settings → Organisation → Region (corp_admin only). Applied to
   every new invitee unless the admin overrides it at invite time.
2. **Per-invitee override** — `invitations.region`. Picked in the
   Staff invite form's "Default region" field. Written to
   `user_settings.region` when the invitee accepts. Useful for a
   multi-region operator inviting, e.g., a Norwegian staff member
   into a US-default org.

Once a user accepts an invite, their `user_settings.region` is locked.
The per-user region pickers in **Settings → Your preferences** (dashboard)
and in the **scanner's Settings overlay** were both removed 2026-05-26
along with the `saveRegion()` / `_setPrefRegion()` handlers. The
`user_settings.region` column is still read at sign-in but is no
longer writable from any user-facing control.

### How the variables resolve

| Variable | Source | Meaning | Used by |
|---|---|---|---|
| `_orgDefaultRegion` | `organisations.region` | The org's stated default | **Only** the Settings → Organisation card dropdown (so the org admin can see/edit it) |
| `_orgRegion` | `user_settings.region` ?? `organisations.region` | **Effective region** for the signed-in user. The `user_settings.region` value is admin-assigned (org default at signup, or `invitations.region` override at accept time) — not user-changeable | **Everything else** in the dashboard — all regulatory copy, FSMA/EU references, regulator contacts, retention rules, recall coordinator notes, terminology entries, currency, date format, phone prefix examples |
| `_userRegion` (scanner) | mirrors `user_settings.region` | Same value as `_orgRegion` on the dashboard side, used by the scanner | All region-dependent surfaces in the scanner (FSMA tab visibility, region badge, dateSep / formatDate, etc.) |

### The rules

1. **Every line of regulatory copy** gates on `_orgRegion` (dashboard)
   or `_userRegion` (scanner) — never on `organisations.region`,
   `_orgDefaultRegion`, or a hardcoded region literal. Inline ternaries
   like `_orgRegion === 'us' ? 'FDA 21 CFR 7.49' : 'Mattilsynet §16'`
   are the canonical pattern.
2. **Date format is locked to region.** No separate user setting.
   `_dashLocale()` (dashboard) and `dateSep` / `formatDate` (scanner)
   derive the format from the region variable. The
   `user_settings.date_format` column added by migration 012 is
   preserved for backward compat but is never written from app code.
3. **The org-level dropdown** in Settings → Organisation is the ONLY
   surface that reads `_orgDefaultRegion`. Everywhere else: `_orgRegion`.
4. **When an admin changes the org region**, `saveOrgSettings()` also
   syncs the admin's own `user_settings.region` to the new value (and
   clears `user_settings.date_format`) so their own view follows the
   change immediately, and re-renders the active panel so on-screen
   regulator copy updates without navigation. Other users in the org
   keep whatever region they were assigned at invite time — bulk
   re-assignment would be a separate explicit action.
5. **Never construct regulatory copy by string-mixing fields from
   different regions.** If you find a card pulling, e.g. coordinator
   contact from one region and the regulator name from another, that's
   a bug. Both come from the same `_orgRegion` switch.

### Things that get region-switched (non-exhaustive)

- Regulator name (FDA / Mattilsynet)
- Statute citations (21 CFR 7.49 / Mattilsynet §16, FSMA 204 / EU 178/2002)
- Phone prefix examples (`+1` / `+47`)
- Retention windows (24 mo FSMA / shelf-life + 6 mo Matloven)
- Compliance score thresholds + category labels
- Severity labels (Class I/II/III vs Klasse I/II/III)
- Regulator portal URLs (access.fda.gov / mattilsynet.no)
- Date format (`MM/DD/YYYY` US vs `DD.MM.YYYY` NO)
- Terminology page entries
- Recall feed sources (FDA enforcement reports / Mattilsynet RSS)

If you add a feature that touches any of these, the region gate must
live at the leaf — not at a panel level — so changing region re-renders
the leaf correctly.

## Design system v2 (Claude Design handoff, 2026-05)

Source of truth: `/assets/design-tokens.css` (the canonical
file from the Claude Design bundle). Both `dashboard.html` and
`index.html` embed the same tokens inline — keep them in sync.

### Token architecture — two layers
- **Layer 1 (semantic)** — `--accent-primary`, `--text-primary`, 
  `--background-base/-surface/-elevated/-input`, 
  `--border-default/-strong/-focus`, `--semantic-danger/-warn/-info`, 
  `--shadow-xs/-sm/-md/-lg/-xl/-accent`, `--ring-focus`. 
  Use these in new code.
- **Layer 2 (legacy aliases)** — `--bg`, `--surface`, `--text`, 
  `--muted`, `--accent`, `--danger`, `--warn`, `--info`, etc. 
  resolve to Layer 1 via aliases at the bottom of each file's 
  `:root` block. Existing markup keeps working unchanged.

### Color palette
| Token | Dark (canonical) | Light (opt-in) |
|---|---|---|
| `--background-base` | `#080F12` deep green-black | `#F5F7F6` warm off-white |
| `--background-surface` | `#0D1E1C` (+1 elev) | `#FFFFFF` |
| `--background-elevated` | `#13302B` (+2 elev) | `#FFFFFF` + `--shadow-md` |
| `--text-primary` | `#EAF6F0` off-white (NEVER `#FFFFFF`) | `#0E1F1A` deep green-black |
| `--accent-primary` | `#34D399` mint | `#077A55` emerald |
| `--semantic-danger` | `#FF6B6B` | `#DC2626` |
| `--semantic-warn` | `#F5A623` | `#BE5A0E` |
| `--semantic-info` | `#5BC9F8` | `#057AAB` |

### Hard rules (non-negotiable)
- **Dark never uses `#000000`** (eye strain on emissive screens). 
  Use `var(--background-base)` (`#080F12`).
- **Dark text never uses `#FFFFFF`** (optical vibration). 
  Use `var(--text-primary)` (`#EAF6F0`).
- **Light is NOT an inversion** — hues are darkened/desaturated so 
  contrast holds against white.
- **Theme is `<html data-theme="dark|light">`**, persisted in 
  `localStorage`. NEVER switch via `prefers-color-scheme` — this 
  is a compliance product; theme is an explicit operator decision.
- **No emoji** except 🇺🇸 🇪🇺 🇳🇴 regulatory flags.
- **No purple/blue gradients.** No left-border accent cards.
- **One saturated color** — mint/emerald. Red/orange/blue are 
  state signals, never decoration.

### Translucent tints — `--*-rgb` triples
For inline `rgba(...)` translucent backgrounds/chips/banners, use 
`rgba(var(--accent-rgb), 0.1)` etc. Both themes override the RGB 
triples so the same alpha gradient recolors correctly per theme. 
Tokens: `--accent-rgb`, `--accent-deep-rgb`, `--danger-rgb`, 
`--warn-rgb`, `--info-rgb`, `--info-light-rgb` (and dashboard 
adds `--accent-alt-rgb`, `--accent-muted-rgb`, `--info-soft-rgb`, 
`--surface-tint-rgb`).

### Typography
- **Display + body:** Figtree (Google Fonts: 400, 500, 600, 700, 
  800, 900). `Figtree-ExtraBold.ttf` (weight 800) is self-hosted 
  from `/fonts/` as the brand weight; other weights load from 
  Google Fonts CDN.
- **Mono:** DM Mono (300, 400, 500). Used for eyebrows, form labels, 
  micro-meta, badges. UPPERCASE + letter-spacing for these.
- **Type ladder:** `--fs-eyebrow 11 / --fs-label 10 / --fs-meta 12 / 
  --fs-body 13 / --fs-body-lg 15 / --fs-h4 17 / --fs-h3 22 / 
  --fs-h2 28 / --fs-h1 46 / --fs-hero clamp(40px, 7vw, 80px)`.
- **Line-height:** `--lh-tight 1.05` (H1/hero) / `--lh-snug 1.20` 
  (H2/H3) / `--lh-body 1.65` (body) / `--lh-loose 1.75` (long-form).
- **Weights as variables:** `--fw-regular/-medium/-semibold/-bold/
  -extrabold/-black`. Don't pass raw numbers.

### Spacing, radii, motion
- **Spacing (4px base):** `--s-1` (4px) through `--s-32` (128px).
- **Radii:** `--r-xs 6 / -sm 8 / -md 10 (button/input) / -lg 12 
  (card) / -xl 16 / -2xl 20 / -pill 999`.
- **Motion:** `--dur-fast 0.15s / -normal 0.20s / -slow 0.40s`. 
  Easings: `--ease-out` default, `--ease-snap` for state transitions. 
  No bounces, no springs, no parallax.

### Iconography
Hand-rolled inline SVG, **stroke-only**, `stroke-width: 2`–`2.5`, 
`currentColor`, 24×24 viewBox at 14–22px. Visual family = Lucide / 
Feather. **Triangle-with-exclamation** is the canonical recall-alert 
glyph (left nav, Push-a-Recall button, all recall surfaces).

### WCAG 2.1 AA — required, not aspirational
- Body text ≥ **4.5 : 1** · Large text ≥ **3.0 : 1** · Non-text UI ≥ **3.0 : 1**.
- Focus rings use `var(--ring-focus)` — 2px base offset + 2px accent.
- Audit grid: `preview/theme-contrast-pairs.html` in the design bundle.

### Voice & copy
- Statements over slogans. Brand line: *"When a recall fires, every 
  second counts."*
- Numbers are load-bearing — use them in headlines (24h, 4.5:1, etc.).
- Procedural verbs: *push, match, acknowledge, confirm, pull, dispose, 
  audit*. Never marketing-ese ("revolutionary", "synergy").
- **Sentence case** for body, buttons, links.
- **UPPERCASE + DM Mono + 0.06–0.12em tracking** for eyebrows, 
  form labels, badges.
- Person: "**you**" for the reader; "**Batch'd**" as third-person 
  actor; **never "we"** in product copy.

### Files / Assets
- `/assets/design-tokens.css` — canonical token source. Don't edit 
  in the HTML inline copies; update this first, then mirror.
- `/assets/batchd-logo-mark.svg` (dark bg) and 
  `/assets/batchd-logo-mark-dark.svg` (light bg) — 2×2 grid mark.
- `/assets/batchd-wordmark.svg` — Figtree-900 wordmark.
- `/assets/batchd-square-logo.png` — social square logo.
- `/assets/favicon.png`, `/assets/icon-192.png`, `/assets/icon-512.png`, 
  `/assets/apple-touch-icon.png` — PWA / favicons.
- `/fonts/Figtree-ExtraBold.ttf` — self-hosted brand weight (loaded 
  via `@font-face` in both HTML files).

### Out of scope (kept as Phase 2)
The inline `style="..."` attributes scattered across both files still 
reference legacy token names. They keep rendering correctly via the 
alias bridge but should be migrated to semantic tokens incrementally 
for new components. Don't try to do a sweep — the migration is 
incremental per feature.

## UI conventions
- Every panel has exactly ONE page-title — the topbar text 
  set by the `panels` mapping in showPanel(). Inner page 
  bodies should NOT add a duplicate h1 row. Subtitles 
  (instructional text, regulatory context, dynamic stats) 
  are fine and encouraged.
- Topbar labels in `panels` should match the sidebar nav 
  text exactly — e.g. sidebar "Store Network" → topbar 
  "Store Network", not "Stores".

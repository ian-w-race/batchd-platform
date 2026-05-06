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
- scan_recall_matches.removed_at does NOT exist as a 
  column — never select it or Supabase silently fails
- Feed recalls (FDA/Mattilsynet) only count as "active" 
  if confirmed via scan_recall_matches table
- Manual/push recalls count if exact lot or barcode 
  matches an on-shelf scan (removed_from_shelf_at IS NULL)

## Schema gotchas — column names that bit us
These tables don't have the column names you'd expect from 
nearby code patterns. Always verify against Supabase Table 
Editor before adding new SELECTs:
- recall_distributions  → retailer_org_id (NOT initiating_org_id)
- mock_recall_drills    → initiated_by_org + started_at 
                          (NOT retailer_org_id + created_at)
- recalls               → description (NOT reason). Alias 
                          via PostgREST: `reason:description`
- investigation_responses → retailer_org_id (NOT initiating_org_id)
- recalls table also has no is_pushed and no recall_event_id 
  columns despite their use elsewhere
- recall_events has no is_recalled column

These are silent 400s — Supabase returns Postgres 42703 
"column X does not exist" with no client-visible error 
unless you're watching devtools.

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
- _orgRegion drives all jurisdiction switching — never 
  hardcode regulatory copy for one region only

## Design system
- Dark mode: elevation-based (#111918 bg, #1E2E2A cards, 
  #283C37 inputs) — no pure black, desaturated accents
- Light mode: #F5F7F6 bg, #1A201D text, white cards
- Accent: #4DC99A dark / #077A55 light
- dashboard.html and index.html are the two live UIs to 
  keep visually consistent (manufacturer.html is retired)

## UI conventions
- Every panel has exactly ONE page-title — the topbar text 
  set by the `panels` mapping in showPanel(). Inner page 
  bodies should NOT add a duplicate h1 row. Subtitles 
  (instructional text, regulatory context, dynamic stats) 
  are fine and encouraged.
- Topbar labels in `panels` should match the sidebar nav 
  text exactly — e.g. sidebar "Store Network" → topbar 
  "Store Network", not "Stores".

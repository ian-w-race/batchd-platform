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

## The three files
- index.html — staff scanning app (19,400+ lines)
  Deployed to: batchd-app.netlify.app
- dashboard.html — corporate dashboard (10,500+ lines)
  Deployed to: app.batchdapp.com/dashboard.html
- manufacturer.html — manufacturer portal (8,000+ lines)
  Deployed to: app.batchdapp.com/manufacturer.html

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
- Both files (dashboard + manufacturer) share identical 
  CSS variable values — keep them in sync

## Manufacturer portal & incoming shipments
- Marked ALPHA in the nav — early stage features
- Manufacturer portal is lower priority than scanning 
  app and corporate dashboard for pilot readiness

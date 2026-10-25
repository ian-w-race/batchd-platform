# Platform improvement plan (before the portals)

Written 2026-10-25 for Ian. A plan, not a build. Nothing here is started.
It sits before docs/PORTALS-PLAN.md: several items below are the
foundations the portals need anyway, so doing them first makes the portals
cheaper, not later.

## 1. What Batch'd has to be able to do

Batch'd wins if a grocery chain can say all five of these are true:

1. **We can hand the FDA our records within 24 hours.** FSMA 204 makes this
   the legal obligation (21 CFR 1.1455(c)), from July 20, 2028. Every
   receiving record needs its key data elements, or the export is a list of
   gaps.
2. **When a recall fires, every affected store knows within minutes and
   can prove the product came off the shelf.** This is the brand promise
   ("every second counts") and what an insurer or a buyer would pay for.
3. **Store staff barely notice it.** If capturing a delivery costs more
   than a few seconds, staff skip it, and promises 1 and 2 quietly fail.
4. **A regulator, an insurer or an auditor can trust what it says.** The
   numbers are explainable, every change is logged, and the copy never
   overclaims (the drill certificate fixed today is the warning).
5. **It is the retailer hub that manufacturers and distributors plug into.**
   The portals only add value if the retailer side already holds clean,
   linked data.

Everything below is judged against those five.

## 2. Honest assessment

What is strong today:
- The FSMA 204 receiving model, export, records request drill and
  traceability plan are real and match the rule.
- Security is now in good shape (migrations 031 to 039, key rotation).
- Staging, deploy previews and automatic checks make changes safe to ship.

What holds it back:

| Area | Today | Why it matters |
|---|---|---|
| Code shape | Two single files of about 1.2 MB each (scanner 23,144 lines, dashboard 18,021), 485 and 289 top-level functions, no shared code | Rules kept "in step" by hand across files (export columns, listed foods, citations, thresholds). Every change is slow and risky. The portals would make a third copy |
| Recall coverage | One source: the FDA enforcement report, newest 50 entries a day | No USDA recalls (meat, poultry, egg products) at all. Enforcement reports often lag the FDA's own recall notice by days or weeks |
| Recall data model | Each FDA recall copied into every organization (7,710 rows for 3 orgs), two recall tables, two match paths | The "read both sources" rule has regressed repeatedly. It will not scale to hundreds of stores |
| Alerts | Email only | A store manager on the floor does not see an email for hours |
| Offline | The scanner has no service worker | A phone that opens the app with no signal (back room, cooler, dock) gets nothing. The offline queue only helps if the page was already open |
| Capture effort | Typed or GS1-scanned per case; wholesaler files by manual upload | Fine for a pilot, too slow for a full store |
| Testing | 56 unit tests with stand-ins; no test drives the real app | Screens can break without any check failing. Today's smoke run found a bug no test caught |
| Monitoring | None beyond what someone looks at | The FDA import failed for a week before anyone noticed |
| Backups | Supabase free plan, no restorable backups | One bad deletion is permanent |
| Navigation | 17 dashboard panels, several from the manufacturer era | New users cannot tell where to start; the important things compete with legacy ones |

## 3. The improvements

Grouped into six tracks. Size is relative: S is days, M is one to two
weeks, L is several weeks of Claude work plus Ian's review.

### Track A. Foundations (do first, everything else gets easier)

| # | Improvement | Size | Done when |
|---|---|---|---|
| A1 | **Supabase Pro** for daily backups and leaked-password protection ($25 a month) | S | A test restore of yesterday's backup into staging works |
| A2 | **Shared code.** Move the rules both apps use into small shared modules: FSMA export builder, listed-food categories and detector, citations, applicability copy, GS1 parser, recall matcher, CSV guard, design tokens. Add a light build step (Vite) that bundles each page and splits rarely used panels out of the first download | L | Each rule exists once; the "keep in step" checks become unnecessary; first load of the scanner is a fraction of today's |
| A3 | **End-to-end tests** (Playwright) that sign in as the staging test accounts on every pull request's preview: receive a delivery, shelf-scan it, push a recall, see it in the store, produce records | M | A broken core flow fails the pull request before Ian sees it |
| A4 | **Monitoring.** A daily health check function plus alerts: FDA import ran and added rows, escalation runs, function error rates, failed emails. One email or text to Ian when something is off | S | A deliberately broken import alerts within a day |
| A5 | **Real offline.** A service worker so the scanner opens with no signal, plus offline receiving confirmations (today only new records queue) | M | Airplane mode: open the app, record a delivery, reconnect, it syncs once |

### Track B. Recall engine (promise 2)

| # | Improvement | Size | Done when |
|---|---|---|---|
| B1 | **Add USDA FSIS recalls** (meat, poultry, egg products). FSIS publishes recalls through a public feed; verify the current endpoint when building | M | A recent FSIS recall appears for a store that received the product |
| B2 | **Faster FDA source.** Add the FDA's recall notices (the press-release list), not just the weekly enforcement report, and link the two when the report catches up | M | Time from FDA notice to store alert is hours, not weeks |
| B3 | **One recall catalog.** Store each public recall once, globally, with structured product, GTIN/UPC, lot and date fields. Organizations get matches, not copies. Replace the two recall paths with one database function that answers "what is active for this store right now" | L | The 7,710 copied rows become about 2,600 shared ones; every screen reads one function; the "both sources" rule disappears |
| B4 | **Better matching.** Match on GTIN and lot first, then product text, with a confidence level. Uncertain matches go to a short review queue for the corporate admin instead of either alarming or staying silent | M | Each match shows why it matched; false alarms drop |

### Track C. Store execution (promises 2 and 3)

| # | Improvement | Size | Done when |
|---|---|---|---|
| C1 | **Push notifications** on the installed scanner (Android, and iOS 16.4 or later for apps added to the Home Screen), with text message as a fallback for managers | M | A pushed recall reaches a locked phone in under a minute |
| C2 | **Store pull list.** One screen per store: what to pull, how much, where it was placed, with a photo as proof of removal and disposal | M | A manager can clear a recall from one screen and the dashboard shows the proof |
| C3 | **Live recall board** for the corporate admin: every store's status updating in real time, with one-tap reminders to lagging stores | S | No refresh needed during a live recall |

### Track D. Capture with less effort (promises 1 and 3)

| # | Improvement | Size | Done when |
|---|---|---|---|
| D1 | **Tune the GS1 parser on real labels** (waits on Ian's three photos) and add a "scan the pallet, confirm the cases" flow | S | Real romaine and nut butter labels read correctly first time |
| D2 | **Delivery paperwork photo to records.** Photograph the invoice or bill of lading; AI reads supplier, PO, products, lots and quantities into expected deliveries for staff to confirm. Gated by plan, like today's AI | M | A 12-line invoice becomes 12 expected deliveries in under a minute |
| D3 | **Automatic wholesaler files.** A per-organization email address or SFTP drop that imports delivery files without anyone uploading them (EDI 856 later) | M | Tomorrow's deliveries appear as expected lines before the truck arrives |
| D4 | **Product catalog by GTIN,** so a product is typed once per organization and its listed-food category is remembered | M | Second delivery of the same product needs no typing |

### Track E. Records and proof (promises 1 and 4)

| # | Improvement | Size | Done when |
|---|---|---|---|
| E1 | **Completeness board.** Per store, today: which deliveries are missing a key data element, with a one-tap fix | S | The receiving score explains itself and points at the fix |
| E2 | **One-click records package:** the sortable spreadsheet, the current traceability plan, supplier list and drill history in one file for a 24-hour request | S | A records request drill produces the whole package |
| E3 | **Audit log** of who changed what (records, recalls, settings, members), visible to corporate admins and included in exports | M | Every edit to a receiving record is traceable |
| E4 | **Copy audit.** Review every regulatory sentence and citation against the eCFR once, with a check that blocks unreviewed citations | S | No screen or document claims more than the rule says |

### Track F. Product and visual redesign

The design system is solid; the structure is what feels a year old.

| # | Improvement | Size | Done when |
|---|---|---|---|
| F1 | **Organize the dashboard around four jobs:** Today (what needs action now), Recalls, Records (receiving, exports, drills, plan), Network and setup (stores, staff, suppliers, settings). Fold Terminology into inline help; move Complaint Triage, Consumer Notify and Investigations under Recalls | M | A new corporate admin knows where to go without training |
| F2 | **Role-based home screens.** Corporate admin sees the network; a store manager sees their store's list for today; staff see one big "Receive" and "Scan" | M | Each role's first screen answers "what do I do now" |
| F3 | **Scanner redesign for speed:** task-first home, one-thumb layout, fewer steps from open to saved delivery, larger targets, haptic and sound confirmations | M | A delivery is recorded in under 10 seconds by a new user |
| F4 | **Accessibility and performance pass** after A2: keyboard, screen reader labels, contrast, and a load budget for low-end Android phones | S | WCAG 2.1 AA spot checks pass; the scanner opens fast on a cheap phone |
| F5 | **Clean out the retired manufacturer-era screens and copy** that the portals will replace, so the portals start from a clean slate | S | No retailer screen describes a feature that does not exist |

### Track G. Ready for the portals

These overlap with Phase 1 of docs/PORTALS-PLAN.md and should be built
once, here:
- Organization identity: GLN on organizations and stores, verified.
- The GTIN product catalog (D4) becomes the manufacturer's product master.
- The single recall catalog (B3) is what a manufacturer's pushed recall
  joins, so retailers see one list.
- Shared code (A2) means the portals reuse the export builder, parser and
  design instead of copying them.

## 4. Order of work

| Phase | Contents | Why this order |
|---|---|---|
| 1. Safety net | A1 backups, A4 monitoring, A3 end-to-end tests | Protects real data and catches breakage before the big changes |
| 2. Shared code | A2, F5 | Every later change touches less code; the portals inherit it |
| 3. Recall engine | B3, B1, B2, B4 | The core promise; biggest gap versus competitors |
| 4. The recall moment | C1, C2, C3, A5 | Turns faster detection into faster pulls |
| 5. Less typing | D4, D1, D2, D3 | Makes the data complete without staff effort |
| 6. Redesign | F1, F2, F3, F4 | Built on shared code, so it is done once for every app |
| 7. Proof | E1 to E4 | Polishes what an inspector or insurer sees |
| Then | Portals, starting at their Phase 2 | Phase 1 foundations are already in place from Track G |

Each phase ships as small pull requests through staging and previews, as
today.

## 5. How we will know it worked

| Measure | Today | Target |
|---|---|---|
| FDA or USDA notice to store alert | Days to weeks (enforcement report lag) | Under 1 hour |
| Store alert to product off shelf, confirmed | Not measured | Median under 2 hours |
| Seconds to record a delivery | Not measured, estimated 30 to 60 | Under 10 |
| Receiving records with every key data element | Measured per org on Compliance | 95 percent or more |
| Minutes to produce a records request | Measured by the drill | Under 15 |
| Breakages found by Ian instead of a check | Several this month | Rare |

## 6. Decisions for Ian

1. **Supabase Pro now?** $25 a month for backups. Recommended.
2. **USDA FSIS recalls:** in scope for the wedge? Leafy greens and nut
   butters are FDA products, but a grocery chain will expect one recall
   inbox for everything.
3. **Text messages for alerts:** they cost per message (Twilio or similar).
   Push notifications are free. Start with push only?
4. **A build step:** it changes how files are uploaded (Netlify builds them,
   as it already does for functions). Acceptable?
5. **Complaint Triage, Consumer Notify and Investigations:** keep them as
   sections under Recalls, or park them until a customer asks?
6. **Order:** this plan first, then the portals? Or the recall engine
   (phase 3) first because it matters most to pilots?

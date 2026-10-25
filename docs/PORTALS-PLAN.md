# Manufacturer and distributor portals: build plan

Written 2026-10-25. Planning only. No app code and no migrations come with
this document. Facts about the database come from
`docs/SCHEMA-REFERENCE.md` (generated from production on 2026-10-24),
migrations 020, 038 and 039, `CLAUDE.md`, `docs/HISTORY.md`, and a
read-only count run on production on 2026-10-25. Anything not confirmed is
marked "needs verification".

How to read this: section 1 says what the portals are for. Section 2 lists
what already exists. Sections 3 and 4 are the design. Section 5 is the
build order. Section 6 is the list of decisions only Ian can make. Nothing
in sections 3 to 5 should start before Ian answers section 6.

---

## 1. What each portal is for

### The FSMA 204 chain in one picture

Food moves down a chain. Each business in the chain has its own record
keeping duty under 21 CFR Part 1, Subpart S:

```
Manufacturer or packer  ->  Distributor (wholesaler, DC)  ->  Retailer stores
  ships (Shipping CTE)        receives, then ships             receive (Receiving CTE)
  assigns the lot code        keeps the lot code               keeps the lot code
  starts recalls              forwards recalls                 pulls product
```

Batch'd today covers only the right-hand box. Retailers type or scan what
arrives (receiving_events), import delivery files from wholesalers, and
receive pushed recalls. The two new portals cover the two boxes on the
left.

A rule worth stating plainly: every business keeps its own records. The
FDA asks each one for its records within 24 hours. Sharing data between
partners helps each side fill in its own records faster. It never makes
one business responsible for another's records. Batch'd copy must keep
saying "Batch'd supports FSMA 204 record keeping" and never "compliant".

Citations to check against eCFR before any of them reach UI copy: Shipping
KDEs 21 CFR 1.1340, Receiving KDEs 1.1345, Transformation 1.1350, lot code
assignment 1.1320, records within 24 hours 1.1455(c). Recall duties:
21 CFR 7.46, 7.49 and 7.55. A manufacturer runs a registered facility, so
the Reportable Food Registry sentence (`_CITATIONS.us.rfrFacility`) applies
to it by default. Needs verification before use: 1.1320 and 1.1350.

### Manufacturer portal

Who uses it:
- A food manufacturer or packer of a listed food. For the wedge, that means
  a bagged leafy greens packer or a nut butter maker.
- Inside the company: a recall coordinator or quality lead (admin), and
  shipping or quality staff (members).

Jobs they do:
1. Keep a product list (name, GTIN, listed-food category) and a lot list
   (lot code, pack or production date, best-by date).
2. Record outbound shipments: which lot, how much, shipped to which
   customer and location, on which reference document. This is their
   Shipping CTE. FSMA 204 also says the shipper must pass the lot code and
   key data to the next business. The portal does that passing for them.
3. Start a recall and push it to every customer that received the affected
   lots, then watch who has acknowledged and pulled.
4. Answer a traceback: "which customers got lot X?" in minutes.
5. Produce their own records for the FDA within 24 hours (a sortable
   spreadsheet), and practice that with a records request drill.

How they exchange data with the retailer side:
- Pushed recalls: they create a recall_events row and distribute it to
  linked customers. Retailers already see pushed recalls in the dashboard
  and the scanner (Path B in scan_recall_matches), so this side needs
  almost no retailer change.
- Shipments and lot data: each shipment to a linked customer shows up on
  the customer's side as an "expected delivery". That is the same
  receiving_events status 'expected' that Phase 7 built for wholesaler
  files, and the scanner already confirms those.
- Receiving records: when the retailer confirms the delivery, the
  manufacturer sees "received on {date}, {quantity}" on its own shipment.
  It does not see the retailer's other receiving records.
- Delivery files: a manufacturer that ships straight to stores replaces
  the CSV the retailer would otherwise import.
- Records requests: a retailer or distributor can ask the manufacturer for
  upstream records on a lot (a traceback request). The manufacturer
  answers with a file built from its own records.

### Distributor (wholesaler) portal

Who uses it:
- A wholesaler or distribution center that buys from manufacturers and
  ships to stores. Many independent grocers get most of their listed foods
  this way.
- Inside the company: an admin (food safety or operations lead), DC
  managers, and receiving or shipping staff.

Jobs they do:
1. Keep a list of their distribution centers (locations).
2. Receive inbound product from manufacturers (Receiving CTE). Inbound
   shipments from a linked manufacturer arrive as expected deliveries, just
   like at a retailer.
3. Ship to stores (Shipping CTE). Most distributors already export a
   shipping file from their own system, so file upload comes first and
   typed entry second.
4. Forward recalls: when a manufacturer pushes a recall, find which stores
   got the lots and pass the recall on to those retailers.
5. Answer tracebacks in both directions and produce records within 24
   hours, with both a Receiving sheet and a Shipping sheet.

How they exchange data with the retailer side:
- Pushed recalls: they forward a manufacturer's recall (same event, so the
  retailer sees the original manufacturer as the source) or start their
  own.
- Shipments and lot data: the shipping file they upload becomes expected
  deliveries at each linked retailer. That replaces the Phase 7 CSV that
  the retailer imports today. Retailers whose wholesaler is not on Batch'd
  keep the CSV import.
- Receiving records: they see confirmations on their own shipments, as
  above.
- Delivery files: the distributor portal is where delivery files now come
  from.
- Records requests: the same traceback requests, both upstream and
  downstream.

---

## 2. What exists today

### Production counts (read-only, 2026-10-25)

| Item | Rows |
|---|---|
| Organizations of type manufacturer | 4 |
| Organizations of type retailer | 5 |
| Members with role mfr_admin | 4 |
| trading_partners | 1 |
| shipments | 2 |
| product_lots | 1 |
| recall_events | 7 |
| recall_distributions | 6 |
| organisation_api_keys | 3 |
| supplier_connections, supplier_manufacturer_links, investigation_requests | 0 each |
| suppliers, receiving_events | 0 each |
| b38_active_members_only policies | 31 |

The four manufacturer orgs and three API keys are leftovers from the
manufacturer era. Whether any is a real customer needs verification with
Ian (question Q4).

### Tables

| Table | What it is | Verdict |
|---|---|---|
| `organisations.type` | CHECK allows retailer, manufacturer, platform. No distributor value. | Reuse. Add 'distributor'. |
| `organisation_members.role` | CHECK allows platform_admin, corp_admin, store_manager, staff, mfr_admin, mfr_qa. | Reuse. See Q3 for which roles the portals use. |
| `trading_partners` | Manufacturer to retailer link (status pending, active, suspended; share_scan_intelligence flag). Read by the lot tracer, the intelligence panel, the overview, webhook-recall.js and the investigation and product_lots policies. | Replace. It can only link a manufacturer to a retailer, so it cannot express distributor links. Its policies pick the caller's org with `LIMIT 1`, which breaks for anyone in two orgs. Backfill its 1 row into the new link table, keep it read-only until every reader has moved, then drop it. |
| `shipments` | Legacy manufacturer to retailer shipment (lot, quantity, reference, shipped and received dates). Same `LIMIT 1` policies. | Replace with a new shipping table (section 3). Keep for legacy reads, as today. |
| `recall_events` | One recall. `source_org_id` is any org. Policies: b20_events_source_admin_write (corp_admin of the source org), drill policies, distributed-to-me reads, plus legacy "Manufacturers can manage" (mfr_admin, mfr_qa). | Reuse as is. This is the core of pushed recalls. |
| `recall_distributions` | Event to receiving org. `retailer_org_id` is the receiving org. Policy b20_dist_insert only lets you distribute your own event to your own org. | Reuse. Add a forwarding column and an approved path to distribute to linked partners (section 3). Keep the column name `retailer_org_id`; renaming breaks code. |
| `recall_acknowledgements` | Per-store progress. Legacy policy lets an mfr_admin of the source org read every store row. | Reuse. Replace the legacy read with an org-level summary (Q6). |
| `product_lots` | Manufacturer lot master (product, lot, production and expiry dates). 1 row. `LIMIT 1` policies. | Reuse. Rewrite its policies on the new helpers. |
| `supplier_connections` | Manufacturer to ingredient supplier link. 0 rows. Its only caller (supplier-invite.js) was deleted. | Retire. Drop in the cleanup phase after a backup. |
| `supplier_manufacturer_links`, `supplier_ingredients`, `supplier_lot_codes`, `supplier_shipments`, `ingredient_receipts` | Ingredient-supplier era. 0 rows each. | Park. Ingredient receiving is a real FSMA 204 duty for manufacturers (Transformation), but it is not in this plan. Drop or revive later (Q10). |
| `investigation_requests`, `investigation_responses` | Manufacturer asks retailers to inspect product. 0 rows. Policies read trading_partners. The Investigations panel stays (decision 2026-10-18). | Reuse later. Re-point policies at the new link table in the last phase. |
| `organisation_api_keys` | sha256-hashed ERP keys, service role only. 3 keys. | Reuse for portal integrations. |
| `suppliers` (migration 022) | The retailer's own supplier directory with the 1.1345 location fields. | Reuse. Add an optional link from a supplier row to a partner org, so the retailer's directory and the real partner stay one thing. |
| `receiving_events` (023) | The Receiving CTE. Status expected, received, rejected. Source staff_scan, wholesaler_import, manual_entry. | Reuse for retailers and distributors. Add source 'partner_shipment' and a link to the shipment that created the row. |
| `stores.external_code` (028) | The wholesaler's ship-to code for a store. | Reuse. It is how a distributor's shipment finds the right store. |
| `records_requests` (026) | FDA records request drill, org-scoped. | Reuse for portal orgs unchanged. |

### Pages and functions

| Item | Today | Verdict |
|---|---|---|
| `manufacturer.html`, `supplier.html`, `manufacturer-signup.html` | 80-line retired notices. index.html redirects the manufacturer. and supplier. hostnames to them. signup.html and join.html send an existing mfr_admin or mfr_qa there. | Keep the files as stubs. Change the stubs' link and the routing to point at the new portal once it exists. |
| `webhook-recall.js` | ERP recall webhook. Key hashed against organisation_api_keys. Org must be type manufacturer. Distributes through trading_partners. 50 events per hour. | Reuse. Allow distributor orgs and read the new link table. |
| `docs.html` | Webhook API docs. Served, linked from nowhere. | Rewrite when the webhook moves, and link it from the portal. |
| `create_organisation_with_admin` (migration 020) | Raises "Manufacturer sign-up is no longer available" for p_type manufacturer, and inserts type 'retailer' whatever p_type says. | Change the body (same signature) to accept manufacturer and distributor. |
| `notify-event.js`, `send-invite.js` | Recall, complaint and drill emails; staff invites. | Reuse. Add partner events and portal role wording. |

### RLS helpers and policy families

- `batchd_my_active_org_ids()`: the caller's orgs where the membership is
  active. SECURITY DEFINER. Most new policies build on it.
- `batchd_is_corp_admin_of(org)` and `batchd_is_manager_of(org)`: role
  checks per org, active only. They test the role name 'corp_admin' (and
  'store_manager'), not mfr_admin. That matters for Q3.
- `batchd_is_platform_admin()`: Batch'd staff.
- `batchd_my_source_event_ids()`: recall events my orgs created.
- `batchd_my_partner_source_org_ids()`: orgs that distributed a recall to
  me. Used by b20_orgs_partner_select so a retailer can read the name of a
  recall's source org.
- b20 policies (migration 020 and 021): org-scoped permissive policies on
  the tenant tables.
- b38_active_members_only (migration 038): one RESTRICTIVE policy on each
  of 31 tables. Restrictive policies are ANDed with the others. It requires
  the caller to hold at least one active membership anywhere. It does not
  say which org. The permissive policies still do the org scoping.
- b39_members_own_or_active (039): on organisation_members, you always
  read your own rows and read other rows only while active.

What this means for sharing: b38 does not block cross-org reads by
itself. A partner who is an active member of their own org passes b38, and
then a permissive policy decides what they may see. So every new sharing
policy must be precise on its own. Two traps:
- b38's known limit: a user active in one org and deactivated in another
  keeps legacy access in the second. Portal users who belong to two orgs
  (a consultant, a broker) make this more likely. New policies must use
  the active-only helpers, never a bare organisation_members lookup.
- Every new table must get the b38 policy too, by extending migration
  038's table list in the new migration.

---

## 3. Data model and RLS design for sharing

### Principles

1. One owner per row. Every row belongs to exactly one org. No table is
   writable by two orgs.
2. Data crosses between orgs in two ways only:
   - Read-through, where it already works: a retailer reads a recall event
     distributed to it.
   - Copy by a trusted database function: when a shipper publishes a
     shipment, a SECURITY DEFINER function writes an expected delivery into
     the receiver's own receiving_events. When the receiver confirms it,
     the function writes the confirmation back onto the shipper's own row.
     Each side then reads only its own rows, which is the simplest RLS
     there is.
3. Nothing crosses without an active, approved link between the two orgs,
   and each link says which kinds of data it carries.
4. The organisations table stays closed. Partners learn each other's name
   and contact through a narrow function, not by widening the organisations
   policies (that table holds plan, notes and coordinator contacts).
5. Same pattern as John's work: SECURITY DEFINER helpers, `bNN_` policy
   names, active-only checks, re-runnable migrations in one transaction.

### New and changed tables

`partner_links` (new). One row per pair of orgs that trade.
- `id`, `upstream_org_id` (the shipper), `downstream_org_id` (the
  receiver), `status` (pending, active, suspended, declined),
  `requested_by_org_id`, `requested_by` (user), `approved_by`,
  `approved_at`, `suspended_at`, `created_at`.
- Scope flags: `share_recalls`, `share_shipments`, `share_trace_requests`.
  All default true on approval; either side can turn one off.
- `downstream_supplier_id`: optional link to the receiver's own suppliers
  row, so "Fresh Greens Co." in a retailer's directory is the same company
  as the linked org.
- Unique on (upstream_org_id, downstream_org_id). Both sides must be
  different orgs. Manufacturer to distributor, manufacturer to retailer and
  distributor to retailer are all allowed. Retailer to retailer is not.

`partner_invites` (new). How a link starts.
- `token`, `from_org_id`, `direction` (I ship to you, or you ship to me),
  `invitee_email`, `expires_at`, `accepted_at`, `accepted_org_id`.
- An admin creates one and Batch'd emails the link. The other side's admin
  opens it, signs in or signs up, and accepts. Accepting creates the
  partner_links row as active (the invite was the request, the accept is
  the approval). Q5 decides whether either side may send invites.

`shipping_events` (new). The Shipping CTE, modeled on receiving_events.
- Owner: `organisation_id` (the shipper) and `location_id` (the shipper's
  location, a stores row; see Q9).
- What shipped: `product_name`, `gtin`, `traceability_lot_code`,
  `tlc_source_location` fields, `quantity`, `unit_of_measure`, `pack_date`,
  `best_by`.
- Where to: `ship_to_org_id` (null when the customer is not on Batch'd),
  `ship_to_code` (matches stores.external_code at the receiver),
  `ship_to_name` and address fields.
- `shipped_at`, `reference_document_type`, `reference_document_number`,
  `source` (manual_entry, file_import, api), `import_batch_id`,
  `client_uuid`, `retain_until` (two years, same trigger idea as 023).
- Feedback from the receiver: `receiver_status` (not_sent, expected,
  received, rejected), `receiver_confirmed_at`, `receiver_quantity`.
- Policies: members of the owner org read and insert; admins and managers
  update; no client delete. Nobody else reads it.

Changes to existing tables:
- `organisations.type` CHECK adds 'distributor'.
- `receiving_events.source` CHECK adds 'partner_shipment'; new column
  `shipping_event_id` (no foreign key across orgs is needed; a plain uuid
  is enough and keeps deletes simple).
- `recall_distributions` gains `via_org_id` (the distributor that
  forwarded the recall, null for a direct push).
- `suppliers` gains nothing; the link lives on partner_links.

`trace_requests` (new, later phase). One org asks a linked partner for
records about a lot.
- `requesting_org_id`, `responding_org_id`, lot, GTIN, product, date
  range, `reason` (drill, recall, FDA request), `due_at` (default 24
  hours), `status` (open, answered, declined, canceled), `response_file`
  in storage, `row_count`, `answered_at`.
- Both orgs read the row. Only the responder answers. The response file
  sits in storage under the responder's folder with a signed link for the
  requester.

### Helper functions

All SECURITY DEFINER, `SET search_path = public`, EXECUTE revoked from
anon:
- `batchd_my_partner_org_ids(p_scope text)`: orgs linked to any of my
  active orgs by an active link whose scope flag is on. Used by policies.
- `batchd_is_downstream_of(p_upstream uuid, p_scope text)` and
  `batchd_is_upstream_of(...)`: yes or no for one pair.
- `get_partner_directory()`: name, type, contact email and recall
  coordinator for each linked org. This is how the UI shows partner names.
- `accept_partner_invite(p_token)`: corp admin of the accepting org only.
- `set_partner_link_status(p_link, p_status)` and
  `set_partner_link_scope(...)`: admins of either side.
- `distribute_recall(p_event uuid, p_org_ids uuid[])`: caller must be an
  admin of the event's source org, or (for forwarding) an admin of an org
  the event was distributed to. Every target must be an active downstream
  partner with share_recalls on. Writes recall_distributions with
  `via_org_id` when forwarding.
- `publish_shipments(p_ids uuid[])`: for each shipment with an active
  link and share_shipments on, writes an expected receiving_events row in
  the receiver org (store found by ship_to_code against
  stores.external_code, else no store), and sets receiver_status. Same
  duplicate rule as Phase 7 (store, lot, GTIN).
- A trigger on receiving_events: when a row with a shipping_event_id moves
  to received or rejected, copy status, time and quantity back onto the
  shipping_events row.
- `get_recall_progress(p_event uuid)`: for the source org (and
  forwarders), per receiving org: acknowledged, pulled, disposed, units
  pulled. Org-level counts only, no store names (Q6).

### Who sees what

| Data | Manufacturer | Distributor | Retailer |
|---|---|---|---|
| Its own rows (shipments, receiving, lots, plans, drills) | Yes | Yes | Yes |
| A partner's org name and recall contact | Linked only, via get_partner_directory | Same | Same |
| A recall it started | Full | Full | Full |
| A recall pushed or forwarded to it | Read | Read and forward | Read (today) |
| Progress on its recall at a partner | Org-level counts | Org-level counts for what it forwarded | Its own stores in full |
| A shipment sent to it | As an expected delivery in its own receiving | Same | Same (today's expected rows) |
| Whether its shipment was received | On its own shipment row | Same | n/a |
| A partner's other receiving, scans, stores, complaints | Never | Never | Never |
| Trace requests | Ones it sent or must answer | Same | Same |

What stays private on purpose: shelf scans, store lists, staff, complaints,
compliance scores, plan and billing fields. A manufacturer never learns
which stores a distributor serves, except through what the distributor
chooses to forward.

### How links are created and approved

1. An admin at org A opens Partners and invites org B by email, saying who
   ships to whom.
2. Batch'd emails B a link (new notify-event type `partner_invite`).
3. If B is on Batch'd, B's admin signs in and accepts. If not, the link
   leads to signup with the org type preselected, then accepts.
4. The link is active. Both admins see it under Partners and can turn
   scopes off or suspend it. Suspending stops new data from crossing;
   copies already made stay with their owners, because each side's records
   are its own.
5. A Batch'd platform admin can see and suspend any link from admin.html.

---

## 4. Signup, onboarding and roles

### Signup

- signup.html step 0 gets its type cards back: Retailer, Manufacturer or
  packer, Distributor. The manufacturer card was removed 2026-09-20; this
  brings back a card, not the old code.
- `create_organisation_with_admin` keeps its signature. The new body
  accepts retailer, manufacturer and distributor, inserts the type it was
  given (today it always inserts retailer), still rejects anything else,
  and still forces region 'us', plan 'trial'. For a distributor,
  `p_store_names` becomes its distribution centers.
- Step 3 asks portal orgs different questions from retailers: listed-food
  categories they ship (the wedge chips), whether they run a registered
  facility (default yes for manufacturers), and a recall coordinator.
- An invite token in the URL (from a partner invite) carries through
  signup and is accepted at the end.
- Q8 decides whether self-serve signup for portal types opens at all, or
  whether portal orgs only arrive by partner invite or by Batch'd creating
  them in admin.html.

### Roles

Recommended (Q3): use the same two roles everywhere, `corp_admin` and
`staff`, plus `store_manager` for a distributor's DC manager. The UI labels
them "Admin", "Team member" and "Location manager". Reason: every b20
helper already checks those names, so portal orgs get correct RLS with no
new helper per role. mfr_admin and mfr_qa stay in the CHECK for the four
legacy orgs, and the legacy policies that name them are retired in the
cleanup phase.

Invitations reuse `send_invitation`, `accept_invitation` and
send-invite.js. join.html routes by org type: retailer roles go to the
dashboard and scanner as today, portal orgs go to the portal.

### The US-only decision

- Every portal org gets region 'us' and recall_source 'fda'. The portal
  has no region layer at all: no `_orgRegion` branches, no Norwegian
  strings, no +47, no kr, no DD.MM.YYYY. Dates are MM/DD/YYYY.
- Citations come from one `_CITATIONS.us` table copied into the portal,
  and scripts/check.mjs must check it agrees with the other two copies.
- A new check in check.mjs should fail if the portal file contains
  Norwegian markers (Mattilsynet, Matloven, +47, Klasse).
- Recall severity reads Class I, II, III.

---

## 5. Phased build order

Each phase is one pull request that Ian can test on its Netlify preview.
Migration numbers start at 040.

### How testing works for every phase

- Pages on a deploy preview (any `name--site.netlify.app` host) and on
  localhost use the staging database (tiwrrocdwljazweveeth). They show a
  "Staging database" badge. Netlify functions on previews read
  SUPABASE_URL and SUPABASE_SERVICE_KEY set to staging for the Deploy
  Previews context, so emails and AI also run against staging.
- Every migration runs on staging first through the Supabase connector,
  with rolled-back checks as real roles: an admin and a member of each org
  type, a deactivated member, and a user of an unlinked org. Then
  production on Ian's yes, then a regenerated SCHEMA-REFERENCE.md and the
  staging to production fingerprint comparison.
- Staging needs three standing test orgs: QA Grocer (retailer), QA Greens
  (manufacturer), QA Wholesale (distributor), with an admin and a member
  each. Passwords go in `.claude/staging-test-accounts.txt` (local only).
  Staging has email confirmation ON and production has it OFF, so signup
  tests on staging need a confirmed address.
- Each phase adds numbered checks to SMOKE.md and a dated entry to
  docs/CHANGELOG.md. `node scripts/check.mjs` and
  `node --test tests/*.test.mjs` pass before the pull request opens.
- The portal page must carry the same database selection block as the
  other five pages (check.mjs already enforces it for five; extend it to
  six).

### Phase 1. Link foundations (database only)

- Migration 040: organisations.type adds 'distributor'; partner_links and
  partner_invites with policies; the helpers above (directory, accept,
  status, scope, partner ids); b38 extended to the new tables; backfill the
  one trading_partners row into partner_links.
- Files: migrations/040_partner_links.sql, migrations/CHECK_MIGRATIONS.sql,
  docs/SCHEMA-REFERENCE.md (regenerated), tests for the helpers where they
  can run in Node, SMOKE.md, docs/CHANGELOG.md.
- Acceptance: rolled-back checks show an unlinked org reads no link and no
  directory entry; a pending link carries nothing; only the other side's
  admin can accept; a member cannot; a deactivated admin cannot; existing
  retailer reads and writes are unchanged (policy fingerprint differs only
  by the new policies); the security advisor shows no new warnings.
- Risks: a helper that reads partner_links from inside a partner_links
  policy can recurse (keep the helpers SECURITY DEFINER); performance of
  `IN (SELECT helper())` on large tables (same pattern as today, so low).

### Phase 2. Portal shell and signup

- New `portal.html`: sign-in, org-type gate (retailers are sent to the
  dashboard), a Getting started page, Settings (organization profile,
  team and invites, locations for distributors), the design tokens, the
  `_ico` icon set and `_confirmDialog` copied from the dashboard. No data
  sharing yet.
- Migration 041: create_organisation_with_admin accepts manufacturer and
  distributor (same signature).
- Files: portal.html, signup.html (type cards, step 3 questions, routing),
  join.html (route portal orgs and the mfr roles to the portal),
  manufacturer.html and supplier.html (link to the portal),
  index.html (subdomain redirect targets), netlify.toml (a `/portal`
  alias), admin.html (type filter and org type on create),
  send-invite.js (role wording), scripts/check.mjs (six-page database
  block, US-only check on portal.html), SMOKE.md, CHANGELOG.md.
- Acceptance: on a preview, sign up a manufacturer and a distributor
  against staging, land in the portal, invite a teammate, the teammate
  joins and lands in the portal; a retailer sign-up still lands in the
  dashboard; a retailer opening /portal is sent to the dashboard; no
  console errors in both themes at phone width.
- Risks: the signup file is shared with retailers, so a mistake breaks
  retailer onboarding (test the retailer path first on every preview);
  Q2 (where the portal lives) must be settled before this phase.

### Phase 3. Partners screen on both sides

- Portal: Partners panel (invite, pending, active, scopes, suspend).
- Dashboard: a Partners card in Settings, and a "Linked on Batch'd" tag
  in the Suppliers card with a way to attach a supplier row to a link.
- notify-event.js: `partner_invite` and `partner_link_active` emails.
- Files: portal.html, dashboard.html, signup.html (carry the invite
  token), netlify/functions/notify-event.js, tests, SMOKE.md, CHANGELOG.md.
- Acceptance: QA Greens invites QA Grocer; QA Grocer's admin accepts;
  both see the link; a staff member sees it but cannot change it;
  suspending on either side shows on the other; an invite to an address
  with no account goes through signup and ends linked.
- Risks: email on previews goes through Resend for real (use Resend's test
  inbox); invite tokens must expire and be single use.

### Phase 4. Pushed recalls from the portal

- Portal: products and lots (product_lots with rewritten policies),
  a recall composer, a recall detail page with per-partner progress from
  get_recall_progress, drills.
- Migration 042: distribute_recall, get_recall_progress,
  recall_distributions.via_org_id, product_lots policies rebuilt on the
  helpers, the legacy store-level acknowledgement read for mfr roles
  dropped (after Q6).
- Distributor forwarding: a forwarded recall shows in the distributor
  portal with the list of linked retailers to forward to.
- webhook-recall.js: accept distributor orgs, distribute through
  distribute_recall rules (partner_links instead of trading_partners).
  docs.html refreshed and linked from portal Settings.
- Retailer side: the dashboard shows the source org name (already readable
  through b20_orgs_partner_select) and "forwarded by" when via_org_id is
  set. Recall matching in the scanner needs no change (Path B).
- Files: portal.html, dashboard.html (small label change),
  netlify/functions/webhook-recall.js, notify-event.js, docs.html,
  migrations/042_partner_recalls.sql, tests, SMOKE.md, CHANGELOG.md.
- Acceptance: QA Greens pushes a Class I recall to QA Grocer; the
  dashboard and the scanner show it; a staging scan of the lot matches;
  QA Grocer acknowledges and pulls; QA Greens sees the counts and no store
  names; an unlinked retailer sees nothing; a recall forwarded through QA
  Wholesale shows both orgs; the webhook pushes with a staging key; every
  recall check still reads both sources.
- Risks: this is the most sensitive data in the product; a wrong policy
  could push recalls into the wrong org. The distribute function is the
  only write path and gets the heaviest tests. Escalation emails
  (recall-escalation.js) will now fire for portal-pushed recalls too,
  which is intended but must be checked for duplicates.

### Phase 5. Shipments become expected deliveries

- Portal: Shipping panel (typed entry, file import through a copy of the
  dashboard's CSV import engine, remembered column mappings), shipment list
  with receiver status.
- Migration 043: shipping_events, publish_shipments, the confirm-back
  trigger, receiving_events source 'partner_shipment' and
  shipping_event_id.
- Dashboard Receiving panel: a "Partner" source tag. Scanner: the expected
  delivery list already works; the banner names the partner.
- Files: portal.html, dashboard.html, index.html (label only),
  migrations/043_shipping_events.sql, tests (store matching by ship-to
  code, duplicates, confirm-back), SMOKE.md, CHANGELOG.md.
- Acceptance: QA Wholesale uploads a shipping file with two stores; QA
  Grocer sees two expected deliveries on the right stores; the scanner
  confirms one with a different quantity; QA Wholesale sees "received,
  11 of 12"; re-uploading the same file adds nothing; a store with no
  ship-to code lands with no store and a warning; the retailer's own CSV
  import still works.
- Risks: a wrong ship-to code puts product on the wrong store's list
  (show unmatched rows instead of guessing); the trigger runs inside the
  retailer's confirm, so a failure there must not block the retailer's
  save.

### Phase 6. Distributor receiving and the manufacturer lot master

- Distributor portal Receiving panel on receiving_events (same table, the
  distributor's org and DC locations). Manufacturer shipments to a
  distributor arrive as expected deliveries there. The portal confirms
  them on a desktop or phone browser; whether the scanner PWA serves
  distributor staff is Q12.
- Manufacturer lots: lot list with pack and best-by dates, used to fill
  shipments.
- Files: portal.html, possibly index.html (Q12), tests, SMOKE.md,
  CHANGELOG.md. No migration expected.
- Acceptance: QA Greens ships to QA Wholesale; QA Wholesale confirms;
  QA Wholesale ships the same lot to QA Grocer; the lot code is the same
  at all three; a trace from the lot shows each hop on each side's own
  screen.
- Risks: receiving_events was built for stores; check every dashboard and
  scanner query that assumes the org is a retailer.

### Phase 7. Records: export, drill and traceback requests

- Portal export builder with a Receiving sheet and a Shipping sheet (the
  Shipping sheet is new; `FSMA204_EXPORT_HEADERS` stays as the Receiving
  sheet so check.mjs keeps agreeing), records request drill on
  records_requests, traceability plan reuse where it fits.
- Migration 044: trace_requests and its storage policy.
- Retailer side: "Ask supplier for records" on a recall or lot in the
  dashboard, sent to a linked partner.
- Files: portal.html, dashboard.html, migrations/044_trace_requests.sql,
  notify-event.js (trace request emails), scripts/check.mjs (Shipping
  headers identical wherever they appear), tests, SMOKE.md, CHANGELOG.md.
- Acceptance: QA Grocer asks QA Wholesale for lot X; QA Wholesale answers
  in a click with a file built from its records; QA Grocer downloads it;
  the timer shows minutes to answer; an unlinked org cannot send a
  request; the file is not readable by anyone else.
- Risks: response files are the first cross-org storage objects; signed
  links must expire.

### Phase 8. Investigations and legacy cleanup

- Re-point investigation_requests and investigation_responses policies at
  partner_links. Move the lot tracer, intelligence panel, overview and
  webhook off trading_partners and shipments. Drop the legacy mfr policies
  once the four legacy orgs are handled (Q4). Back up and drop
  supplier_connections and, if Q10 says so, the ingredient-era tables.
- Files: dashboard.html, migrations/045_legacy_cleanup.sql, tests,
  SMOKE.md, CHANGELOG.md.
- Acceptance: legacy demo data still renders or is archived as Ian
  decided; no policy references trading_partners; backups sit in the
  private backup schema.
- Risks: deleting the wrong thing. Preview counts and backups first, as
  CLAUDE.md requires.

### Rough order of value

Phases 1 to 4 deliver the first sellable thing: a manufacturer can push a
recall to its retail customers and see who pulled. Phase 5 is the biggest
daily-use win for distributors. Phases 6 to 8 complete the chain.

---

## 6. Decisions Ian must make

Each one has a recommendation. Building waits on Q1 to Q5 at minimum.

1. **One portal or two?** One page, `portal.html`, that shows manufacturer
   or distributor screens by org type, or two separate pages.
   Recommended: one page. Most screens are shared (recalls, shipments,
   partners, records).
2. **Where does the portal live?** A path such as
   corporate.batchdapp.com/portal (no DNS work), or a new subdomain such as
   partners.batchdapp.com (DNS and a Netlify domain alias). Recommended:
   the path first, a subdomain later if sales want it. Unlike the scanner,
   moving it later is easy because it is not an installed app.
3. **Which roles do portal users get?** Reuse corp_admin, store_manager
   and staff with portal labels, or bring back mfr_admin and mfr_qa and
   add distributor roles. Recommended: reuse, because every security
   helper already understands them.
4. **What happens to the four old manufacturer orgs and their three API
   keys?** Convert them into portal orgs, or archive them. Recommended:
   tell me which (if any) are real; archive the rest after a backup.
5. **Who may start a partner link?** Either side invites and the other
   side's admin accepts, or only the downstream business (the buyer)
   invites. Recommended: either side, with admin acceptance.
6. **How much does a manufacturer see about a recall at a retailer?**
   Org-level counts only (acknowledged, pulled, units), or per-store
   detail. Recommended: org-level counts. Store detail can be a per-link
   opt-in later.
7. **Who pays, and what is free?** Portal orgs start on 'trial' with no
   AI. Decide whether a supplier invited by a paying retailer is free,
   and whether manufacturers pay per customer. This does not block the
   build, but it decides what the signup page says.
8. **Self-serve signup for portal orgs, or invite only?** Recommended:
   invite only at first (partner invite or Batch'd creates the org), self
   serve once Phase 4 is live.
9. **Do distributor locations reuse the stores table?** Recommended: yes,
   labeled "Distribution centers" in the portal. It avoids a parallel
   locations table and keeps receiving_events working.
10. **Ingredient-era tables: drop or keep for later?**
    (supplier_manufacturer_links, supplier_ingredients, supplier_lot_codes,
    supplier_shipments, ingredient_receipts, all empty.) Recommended: drop
    in Phase 8 after a backup; build ingredient receiving fresh if
    manufacturers ask for it.
11. **Does the manufacturer portal start with the wedge only?** Bagged
    leafy greens and nut butters, as the retailer side does. Recommended:
    yes. Copy, drill scripts and category kits focus there; nothing blocks
    other listed foods.
12. **Do distributor floor staff use the scanner app?** Reuse index.html
    for distributor receiving, or have them use the portal in a phone
    browser. Recommended: the portal first; the scanner is 23,000 lines
    built around stores and shelves.
13. **Does a distributor forward recalls automatically or by hand?**
    Recommended: by hand with one click, showing which retailers got the
    lot. Automatic forwarding can come later as a per-link setting.

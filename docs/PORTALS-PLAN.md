# Manufacturer and distributor portals: build plan

Written 2026-10-25, revised 2026-11-01 (recall notices go to
distributors too, store matching research, two citations verified,
migration numbers moved past the ones now taken; central sign-in on one
address, and "Corporate" renamed "Retail"). Planning only. No app code and no migrations come with
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
  starts recalls              holds and stops shipping         pulls product
        |                                                         ^
        +---- recall notice goes to BOTH distributors and retailers -+
```

How recalls really move (Ian, 2026-11-01): the manufacturer sends its
recall notice to its retail customers and to its distributors. The
distributor gets it so it can halt shipments: hold the lot in its
warehouses and stop it going out to stores. Forwarding to stores is the
distributor's backup job, for stores the manufacturer does not know
about.

Batch'd today covers only the right-hand box. Retailers type or scan what
arrives (receiving_events), import delivery files from wholesalers, and
receive pushed recalls. The two new portals cover the two boxes on the
left.

A rule worth stating plainly: every business keeps its own records. The
FDA asks each one for its records within 24 hours. Sharing data between
partners helps each side fill in its own records faster. It never makes
one business responsible for another's records. Batch'd copy must keep
saying "Batch'd supports FSMA 204 record keeping" and never "compliant".

Citations, checked against the eCFR text (law.cornell.edu) on
2026-11-01:
- 21 CFR 1.1320, "When must I assign traceability lot codes to foods on
  the Food Traceability List?": a lot code is assigned only when you
  initially pack a raw agricultural commodity, do the first land-based
  receiving of food from a fishing vessel, or transform a food. Paragraph
  (b): you may not create a new lot code for other activities, such as
  shipping. So a distributor keeps the manufacturer's lot code; it never
  makes its own.
- 21 CFR 1.1340, "What records must I keep and provide when I ship a food
  on the Food Traceability List?": eight KDEs in (a), and (b) says the
  shipper must provide (a)(1) to (a)(7) to the next business. The
  reference document (a)(8) is kept but need not be sent.
- 21 CFR 1.1345, receiving KDEs.
- 21 CFR 1.1350, "What records must I keep when I transform a food on the
  Food Traceability List?": input lots (lot code, description, quantity)
  and the new output lot (new lot code, where and when transformed,
  description, quantity, reference document). This is the nut butter
  maker's duty when peanuts become peanut butter.
- 21 CFR 1.1455(c), records within 24 hours.
- Recall duties: 21 CFR 7.46, 7.49 and 7.55.
- A manufacturer runs a registered facility, so the Reportable Food
  Registry sentence (`_CITATIONS.us.rfrFacility`) applies to it by
  default.

A "location description" (1.1310) is the business name, phone number,
physical address, city, state and ZIP. The rule does not require any
location code or GLN. That matters for store matching (section 3).

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
   Shipping CTE. 21 CFR 1.1340(b) also says the shipper must pass the lot
   code and the other shipping KDEs to the next business. The portal does
   that passing for them.
3. Start a recall and send the notice to every customer that received the
   affected lots: retailers and distributors alike. Then watch who has
   acknowledged, who has put stock on hold, and who has pulled.
4. Answer a traceback: "which customers got lot X?" in minutes.
5. Produce their own records for the FDA within 24 hours (a sortable
   spreadsheet), and practice that with a records request drill.

How they exchange data with the retailer side:
- Pushed recalls: they create a recall_events row and distribute it to
  linked customers of both kinds in one step. Retailers already see pushed
  recalls in the dashboard and the scanner (Path B in scan_recall_matches),
  so this side needs almost no retailer change. Distributors get the same
  event in their portal as a hold instruction (see the distributor jobs).
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
4. Halt shipments when a recall arrives. The manufacturer's notice lands
   in the portal. The distributor sees how much of the lot sits in each
   DC, marks it on hold, and the portal stops any new shipment of that lot
   to a store (a warning that needs a written reason to override). It also
   lists which stores already got the lot.
5. Forward the recall as a backup: pass it on to the stores on that list
   that the manufacturer did not already notify.
6. Answer tracebacks in both directions and produce records within 24
   hours, with both a Receiving sheet and a Shipping sheet.

How they exchange data with the retailer side:
- Pushed recalls: they receive the manufacturer's notice directly, hold
  stock, and forward the same event to stores the manufacturer missed (so
  the retailer sees the original manufacturer as the source, and a store
  that got it both ways sees one recall, not two). They can also start
  their own recall.
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
| `stores.external_code` (028) | One wholesaler ship-to code per store. | Keep for the CSV import. Not enough for the portals: a store that buys from two distributors has two codes. See "Store matching" in section 3. |
| `records_requests` (026) | FDA records request drill, org-scoped. | Reuse for portal orgs unchanged. |
| `recall_notices` and `match_recall_notice()` (040, on main since 2026-10-25) | A retailer uploads a recall notice (email or PDF); Claude reads it into fields; match_recall_notice finds matching deliveries and scans by GTIN, lot, lot range, best-by or product words. The source CHECK already allows 'manufacturer_link'. | Reuse. A notice pushed from the manufacturer portal skips the upload and reading steps, and the same matcher runs on it at the retailer and at the distributor. Notices from manufacturers not on Batch'd keep coming in by upload. |

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
  `ship_to_code` (the shipper's own customer or store number),
  `ship_to_gln` (optional), and the full location description: name,
  phone, street, city, state, ZIP. The location description is what
  1.1340 requires; the code and GLN are only for matching.
- `shipped_at`, `reference_document_type`, `reference_document_number`,
  `source` (manual_entry, file_import, api), `import_batch_id`,
  `client_uuid`, `retain_until` (two years, same trigger idea as 023).
- Feedback from the receiver: `receiver_status` (not_sent, expected,
  received, rejected), `receiver_confirmed_at`, `receiver_quantity`.
- Policies: members of the owner org read and insert; admins and managers
  update; no client delete. Nobody else reads it.

`partner_location_codes` (new). The store matching table (see "Store
matching" below).
- `link_id` (partner_links), `store_id` (the receiver's store or DC),
  `code` (the shipper's number for that location), `confirmed_by`,
  `confirmed_at`.
- Unique on (link_id, code) and on (link_id, store_id).
- Owned by the receiver: the receiver's admins and managers write it, the
  receiver's members read it. The shipper never reads it; it only sees
  "matched" or "not matched" on its own shipment rows, through
  publish_shipments.

`recall_holds` (new). A distributor's hold on a recalled lot.
- `organisation_id` (the distributor), `recall_event_id`, `location_id`
  (a DC), lot code, GTIN, quantity held, `status` (on_hold, released,
  disposed, returned), `placed_by`, `placed_at`, `released_at`, notes.
- Owned by the distributor. The manufacturer sees only a summary per
  distributor (lots on hold, quantity) through get_recall_progress.

Changes to existing tables:
- `organisations.type` CHECK adds 'distributor'.
- `stores` gains `gln` (optional 13 digits), so a store or DC can be
  matched by GLN when both sides use them.
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
  partner with share_recalls on, of any type: a manufacturer sends to
  retailers and distributors in one call. Writes recall_distributions with
  `via_org_id` when forwarding. The existing unique key on
  (recall_event_id, retailer_org_id) means a store org that gets the
  recall from both the manufacturer and the distributor still has one
  recall; a forward to an org that already has it changes nothing.
- `publish_shipments(p_ids uuid[])`: for each shipment with an active
  link and share_shipments on, finds the receiver's location (see "Store
  matching"), writes an expected receiving_events row there, and sets
  receiver_status. Same duplicate rule as Phase 7 (store, lot, GTIN). It
  refuses a shipment whose lot is on an active recall_holds row for the
  shipper, unless the shipper's admin overrides with a written reason,
  which is stored on the shipment.
- A trigger on receiving_events: when a row with a shipping_event_id moves
  to received or rejected, copy status, time and quantity back onto the
  shipping_events row.
- `get_recall_progress(p_event uuid)`: for the source org (and
  forwarders), per receiving org: acknowledged, pulled, disposed, units
  pulled for retailers; lots and quantity on hold for distributors.
  Org-level counts only, no store or DC names (Q6).

### Store matching

The question: when a distributor ships to "store 0412", how does Batch'd
know which of the retailer's stores that is?

What the research found (2026-11-01):
- FSMA 204 does not require any location code. A location description in
  21 CFR 1.1310 is name, phone, address, city, state and ZIP. GS1 US's own
  FSMA 204 location guidance says the rule "does not require unique
  identification of products and locations".
- GS1 US recommends GLNs, and lists among their uses replacing "internal
  numbers, DUNS+4, etc." with trading partners. That wording confirms that
  internal numbers are what most partners use today.
- In EDI shipping notices (the X12 856) the ship-to sits in the N1 "ST"
  segment. GS1 US's FSMA 204 EDI guidance recommends a GLN there
  (qualifier UL). Retailer specifications seen in practice also use a
  store or DC number assigned by the buyer (qualifier 92). Which one a
  partner uses is set by each retailer's own EDI guide.
- Wholesalers assign each customer an account number when credit is
  approved (SpartanNash's credit application process says so). Where that
  number sits on a given wholesaler's invoice could not be confirmed from
  public sources; a real delivery file will settle it.

So the guess holds: a distributor's file almost always carries its own
customer or store number, sometimes a GLN, and always a name and address.
Two corrections follow for the design:
1. Codes belong to the pair of companies, not to the store. Two
   distributors give the same store two different numbers. The single
   `stores.external_code` column cannot hold that, so the portals use
   `partner_location_codes` per link. external_code stays for the CSV
   import of wholesalers not on Batch'd.
2. A code alone is not proof. Matching runs in this order and stops at the
   first hit:
   a. GLN on the shipment equals `stores.gln` at the receiver.
   b. The shipper's code is in `partner_location_codes` for this link.
   c. Address match: same ZIP and the same street number and name, after
      the same normalizing the supplier form uses. A hit here is a
      suggestion, not a match.
   Anything that is not an a or b match lands in a "Match these
   locations" list on the receiver's side, showing the shipper's code,
   name and address next to a store picker. Once the receiver's admin
   picks a store, the code is saved for that link and every later
   shipment matches on its own. The expected delivery is held in that list
   until then; it is never guessed onto a store.
3. The first file from a new partner is the setup step: the receiver maps
   each new code once. That is a one-time job of a few minutes for a
   10-store chain.

Sources: eCFR 21 CFR 1.1310 and 1.1340 (law.cornell.edu); GS1 US, "Global
Location Number Recommendations for FSMA Rule 204" (R1.0, Jan 2024) and
"EDI Recommendations for FSMA 204 Critical Tracking Events" (R2.0);
SpartanNash credit application instructions (spartannash.com). EDI vendor
guides (betteredi.com, ediacademy.com) were used for the N1 qualifier
practice; they are vendor sources, not standards.

### Who sees what

| Data | Manufacturer | Distributor | Retailer |
|---|---|---|---|
| Its own rows (shipments, receiving, lots, plans, drills) | Yes | Yes | Yes |
| A partner's org name and recall contact | Linked only, via get_partner_directory | Same | Same |
| A recall it started | Full | Full | Full |
| A recall pushed or forwarded to it | Read | Read, hold stock, forward | Read (today) |
| Progress on its recall at a partner | Org-level counts, including distributor holds | Org-level counts for what it forwarded | Its own stores in full |
| Its customers' location codes | Never (only matched or not) | Never (only matched or not) | Its own, per partner |
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

### Central sign-in and one address (Ian, 2026-11-01)

Everyone signs in at one place, and Batch'd sends them to the right app.
The apps are:
- **Retail**: today's corporate dashboard, renamed. "Corporate" stops
  meaning anything once there are three company types.
- **Manufacturer** and **Distributor**: the new portal (one page, two
  modes, per Q1).
- **Scanner**: the staff app for stores.
- **Admin**: Batch'd staff only, shown to platform admins.

How the sign-in page decides:
1. After sign-in it reads the person's active memberships: which company,
   what type, which role.
2. If that adds up to exactly one app, it goes straight there. Store staff
   go to the scanner. A packer goes to Manufacturer. Most people never see
   a choice.
3. Only someone with more than one real option sees a short chooser. A
   retail admin or store manager can open Retail or the scanner. A platform
   admin also sees Admin. The chooser remembers the last pick on that
   device, so the second visit is one tap.
4. It never shows an app the person cannot use. Each app still checks the
   person itself and sends them back to sign-in if they open the wrong one
   by hand. The routing is a convenience; the database rules remain the
   real boundary.

Why everything has to sit on one web address:
- A sign-in is stored by the browser per address (the Supabase session
  lives in that address's local storage). Today the scanner is on
  batchd-app.netlify.app and Retail is on corporate.batchdapp.com, so a
  login on one does not carry to the other, and a separate login site
  would sign you in to neither.
- So all apps move under one domain with paths, on app.batchdapp.com
  (Ian, 2026-11-01, Q15):
  - `app.batchdapp.com/` the sign-in page and router (new file
    `login.html`)
  - `app.batchdapp.com/retail` today's dashboard.html
  - `app.batchdapp.com/manufacturer` and `/distributor` the portal
  - `app.batchdapp.com/scan` today's index.html
  - `/join`, `/signup`, `/terms`, `/privacy` stay as they are
- app.batchdapp.com already points at this Netlify site and has a
  certificate, so this needs no DNS work. Only netlify.toml rules change.
- One address also means signing out in one app signs you out of all of
  them on that device. That is the expected behavior for a single sign-in.
- Deploy previews are already one address per preview, so the whole flow
  (sign-in, chooser, every app) can be tested on one preview.

What the move costs, and why now:
- The scanner is installed on phones. Its install and its offline queue
  (`batched_offline_queue`, scans saved while offline) belong to its
  current address. Its manifest is inline in index.html with start_url
  "/", and there is no service worker.
- Moving it means each phone reinstalls the scanner once, and any scans
  waiting offline must sync before the switch. The old address keeps
  serving the scanner during a transition: on load it syncs the queue,
  and only when the queue is empty does it send the person to the new
  address with a short "Batch'd has moved, add it to your home screen
  again" screen. Nothing queued is lost.
- CLAUDE.md already says to settle the scanner's address before the first
  design partner installs it. Ian confirmed on 2026-11-01 that only
  Batch'd's own test phones have it (Q16), so this is the cheapest the
  move will ever be.

What the rename touches (labels and links, never identifiers):
- Visible text that says "corporate dashboard" or "Corporate" in the
  dashboard, the scanner's "Open dashboard" buttons, signup, join, admin,
  emails and SMOKE.md.
- Links to corporate.batchdapp.com: 12 lines in netlify.toml and a few in
  join.html, admin.html, index.html, dashboard.html, signup.html,
  notify-event.js, send-invite.js, triage-complaint.js and
  tests/env-block.test.mjs (counted 2026-11-01).
- corporate.batchdapp.com keeps working: it 301s to
  app.batchdapp.com/retail, with the path and query string kept, so old
  bookmarks and links in sent emails still land.
- Not renamed: the role corp_admin, the organisations table, file names
  (dashboard.html stays dashboard.html behind the /retail path), and any
  column.

Known limit for later: the apps assume one company per person (signup
refuses a second, and several helpers pick "the" org). The chooser covers
"several apps, one company" now. "Several companies" needs an active-org
switch in every app and comes after the portals ship.

### Roles

Recommended (Q3): use the same two roles everywhere, `corp_admin` and
`staff`, plus `store_manager` for a distributor's DC manager. The UI labels
them "Admin", "Team member" and "Location manager". Reason: every b20
helper already checks those names, so portal orgs get correct RLS with no
new helper per role. mfr_admin and mfr_qa stay in the CHECK for the four
legacy orgs, and the legacy policies that name them are retired in the
cleanup phase.

Invitations reuse `send_invitation`, `accept_invitation` and
send-invite.js. After accepting, join.html hands the person to the
central sign-in router, which sends them to the right app.

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
Migration numbers start at the next free number when each phase is built.
At the time of writing 040 (recall notices) and 041 (job runs) are on
main and 042 is in review, so the numbers below start at 043. Recheck
before writing each file.

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

- Migration 043: organisations.type adds 'distributor'; stores.gln;
  partner_links, partner_invites and partner_location_codes with policies; the helpers above (directory, accept,
  status, scope, partner ids); b38 extended to the new tables; backfill the
  one trading_partners row into partner_links.
- Files: migrations/043_partner_links.sql, migrations/CHECK_MIGRATIONS.sql,
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

### Phase 2a. Central sign-in, one address, Retail rename

Done before any portal screen, so the portals are born on the new address.
Can run alongside Phase 1 (no shared files).
- New `login.html` at app.batchdapp.com/: sign-in, password reset, the
  two-factor challenge, the "account deactivated" screen, and the router
  and chooser described in section 4. It reads memberships with the
  existing helpers; no migration.
- netlify.toml: on app.batchdapp.com, `/` serves login.html, `/retail`
  serves dashboard.html, `/scan` serves index.html; corporate.batchdapp.com
  and its /dashboard paths 301 to app.batchdapp.com/retail with the query
  kept; www.batchdapp.com 301s to app.batchdapp.com. The private-path 404
  rules stay.
- dashboard.html and index.html: when there is no session, send the
  person to the sign-in page instead of showing their own login form (the
  forms stay in the files for one release as a fallback, then go). The
  scanner's manifest start_url becomes "/scan". Every "corporate" label
  becomes "Retail".
- The old scanner address (batchd-app.netlify.app) keeps serving the
  scanner and runs the move flow: sync the offline queue, then forward
  with the "add it to your home screen again" screen once the queue is
  empty.
- The database selection block (BATCHD_ENV, batchdPreviewUrl,
  batchdLink) is updated identically in all pages, login.html included,
  so previews and localhost still use staging and links stay on the
  preview.
- Emails and functions: links in notify-event.js, send-invite.js and
  triage-complaint.js point at the new paths. join.html and signup.html
  send people to the sign-in page's router instead of hardcoded
  destinations.
- Files: login.html (new), dashboard.html, index.html, join.html,
  signup.html, admin.html, netlify.toml, netlify/functions/notify-event.js,
  send-invite.js, triage-complaint.js, scripts/check.mjs (six pages share
  the database block; forced 404s unchanged), tests/env-block.test.mjs,
  CLAUDE.md (domains section), SMOKE.md, docs/CHANGELOG.md. No migration.
- Acceptance, on a preview against staging and then on production:
  - store staff sign in and land in the scanner with no chooser;
  - a retail admin sees Retail and Scanner, picks Retail, and on the next
    visit the last pick is preselected;
  - signing in once opens both Retail and the scanner without a second
    login; signing out of one signs out of both;
  - a staff member who types /retail is sent back to the router;
  - a deactivated member sees the deactivated screen;
  - an old corporate.batchdapp.com link with ?panel=recalls lands on the
    same panel under /retail;
  - on a phone with the old scanner installed and two scans queued
    offline, both scans sync before the move screen shows, and the
    reinstalled scanner opens at /scan;
  - invitation emails and recall emails link to the new paths;
  - no console errors in both themes at phone width.
- Risks: this touches how every user gets in, so a mistake locks people
  out. Mitigations: ship the router first while the apps keep their own
  forms, switch the apps over in a second step, keep every old address
  working by redirect, and test the offline queue hand-off on a real
  phone before production. Netlify's Pretty URLs rewriting (noted in
  CLAUDE.md) must be checked against the new paths.

### Phase 2b. Portal shell and signup

- New `portal.html`, served at /manufacturer and /distributor: org-type
  gate (anyone else goes back to the router), a Getting started page,
  Settings (organization profile, team and invites, locations for
  distributors), the design tokens, the `_ico` icon set and
  `_confirmDialog` copied from the dashboard. Sign-in is the central page
  from Phase 2a. No data sharing yet.
- Migration 044: create_organisation_with_admin accepts manufacturer and
  distributor (same signature).
- Files: portal.html, signup.html (type cards, step 3 questions, routing),
  login.html (the router learns the two portal apps),
  manufacturer.html and supplier.html (link to the sign-in page),
  index.html (subdomain redirect targets), netlify.toml (/manufacturer
  and /distributor serve portal.html; today /manufacturer rewrites to the
  retired stub, so that rule changes), admin.html (type filter and org
  type on create),
  send-invite.js (role wording), scripts/check.mjs (six-page database
  block, US-only check on portal.html), SMOKE.md, CHANGELOG.md.
- Acceptance: on a preview, sign up a manufacturer and a distributor
  against staging, land in the portal, invite a teammate, the teammate
  joins and lands in the portal; a retailer sign-up still lands in the
  Retail app; a retail user opening /manufacturer is sent back to the
  router; no console errors in both themes at phone width.
- Risks: the signup file is shared with retailers, so a mistake breaks
  retailer onboarding (test the retailer path first on every preview).
  Needs Phase 2a live first.

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
- Migration 045: distribute_recall, get_recall_progress, recall_holds,
  recall_distributions.via_org_id, product_lots policies rebuilt on the
  helpers, the legacy store-level acknowledgement read for mfr roles
  dropped (after Q6).
- The composer sends to retailers and distributors in one step, preselecting
  every linked customer that received the lot (once Phase 5 exists; before
  that, the manufacturer picks customers by hand).
- Distributor side: the recall lands as a hold instruction. The distributor
  records what it holds at each DC (recall_holds) and sees which stores
  already got the lot, through match_recall_notice on its own receiving and
  shipping rows. Forwarding is a one-click backup for stores the
  manufacturer did not notify.
- webhook-recall.js: accept distributor orgs, distribute through
  distribute_recall rules (partner_links instead of trading_partners).
  docs.html refreshed and linked from portal Settings.
- Retailer side: the dashboard shows the source org name (already readable
  through b20_orgs_partner_select) and "forwarded by" when via_org_id is
  set. Recall matching in the scanner needs no change (Path B).
- Files: portal.html, dashboard.html (small label change),
  netlify/functions/webhook-recall.js, notify-event.js, docs.html,
  migrations/045_partner_recalls.sql, tests, SMOKE.md, CHANGELOG.md.
- Acceptance: QA Greens pushes a Class I recall to QA Grocer and QA
  Wholesale in one step; the dashboard and the scanner show it; a staging
  scan of the lot matches; QA Grocer acknowledges and pulls; QA Wholesale
  records a hold at its DC; QA Greens sees the retailer counts and the
  distributor hold, with no store or DC names; an unlinked retailer sees
  nothing; QA Wholesale forwards to QA Grocer and QA Grocer still has one
  recall, not two; the webhook pushes with a staging key; every recall
  check still reads both sources.
- Risks: this is the most sensitive data in the product; a wrong policy
  could push recalls into the wrong org. The distribute function is the
  only write path and gets the heaviest tests. Escalation emails
  (recall-escalation.js) will now fire for portal-pushed recalls too,
  which is intended but must be checked for duplicates.

### Phase 5. Shipments become expected deliveries

- Portal: Shipping panel (typed entry, file import through a copy of the
  dashboard's CSV import engine, remembered column mappings), shipment list
  with receiver status.
- Migration 046: shipping_events, publish_shipments, the confirm-back
  trigger, receiving_events source 'partner_shipment' and
  shipping_event_id.
- Store matching as designed in section 3: GLN, then the per-link code,
  then an address suggestion. Unmatched rows wait in a "Match these
  locations" list in the dashboard's Receiving panel (and the
  distributor's), and a mapping saved there applies to every later file.
- Shipments of a lot on hold are refused unless an admin overrides with a
  reason.
- Dashboard Receiving panel: a "Partner" source tag. Scanner: the expected
  delivery list already works; the banner names the partner.
- Files: portal.html, dashboard.html, index.html (label only),
  migrations/046_shipping_events.sql, tests (matching order, unmatched
  list, duplicates, confirm-back, hold refusal), SMOKE.md, CHANGELOG.md.
- Acceptance: QA Wholesale uploads a shipping file with three stores, one
  by GLN, one by a mapped code and one by an unknown code; QA Grocer sees
  two expected deliveries on the right stores and one row in "Match these
  locations"; after QA Grocer maps it, the next file matches on its own;
  the scanner confirms one with a different quantity; QA Wholesale sees
  "received, 11 of 12"; re-uploading the same file adds nothing; a
  shipment of a held lot is refused; the retailer's own CSV import still
  works.
- Risks: a wrong mapping puts product on the wrong store's list (only the
  receiver maps, and an address match is never applied on its own); the
  trigger runs inside the retailer's confirm, so a failure there must not
  block the retailer's save. The first real distributor file (still owed)
  must be run through the matcher on staging before a customer sees this.

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
- Migration 047: trace_requests and its storage policy.
- Retailer side: "Ask supplier for records" on a recall or lot in the
  dashboard, sent to a linked partner.
- Files: portal.html, dashboard.html, migrations/047_trace_requests.sql,
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
- Files: dashboard.html, migrations/048_legacy_cleanup.sql, tests,
  SMOKE.md, CHANGELOG.md.
- Acceptance: legacy demo data still renders or is archived as Ian
  decided; no policy references trading_partners; backups sit in the
  private backup schema.
- Risks: deleting the wrong thing. Preview counts and backups first, as
  CLAUDE.md requires.

### Rough order of value

Phase 2a pays off even with no portal: one sign-in for Retail and the
scanner, and the scanner's address settled before stores install it.
Phases 1 to 4 deliver the first sellable thing: a manufacturer can send a
recall to its retailers and distributors at once, see which distributors
have stopped shipping and which stores have pulled. Phase 5 is the biggest
daily-use win for distributors. Phases 6 to 8 complete the chain.

---

## 6. Decisions Ian must make

Each one has a recommendation. Building waits on Q1, Q3, Q4 and Q5 at
minimum for the portal phases. Phase 2a has everything it needs (Q2, Q15
and Q16 are settled) and can start once this plan is merged; it follows
the Q17 recommendation unless Ian says otherwise.

1. **One portal or two?** One page, `portal.html`, that shows manufacturer
   or distributor screens by org type, or two separate pages.
   Recommended: one page. Most screens are shared (recalls, shipments,
   partners, records).
2. **Where does the portal live?** SETTLED 2026-11-01 (Ian): a central
   sign-in that routes everyone to Retail (renamed from Corporate),
   Manufacturer, Distributor or the scanner, with all of them on one
   address. Details in section 4, build in Phase 2a. Q15 to Q17 are the
   follow-up choices.
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
    Since manufacturers usually notify retailers directly (Ian,
    2026-11-01), forwarding is a backup. Recommended: by hand with one
    click, showing only the stores that got the lot and do not have the
    recall yet. Automatic forwarding can come later as a per-link setting.
14. **Does a hold block shipping, or only warn?** When a distributor has a
    lot on hold, the portal either refuses a shipment of it or warns and
    lets it through. Recommended: refuse, with an admin override that
    records a written reason (some holds are released after testing).
15. **Which address do all the apps share?** SETTLED 2026-11-01 (Ian):
    app.batchdapp.com. It is already attached to the site, so no DNS work
    is needed.
16. **How many phones have the scanner installed today, and whose?**
    SETTLED 2026-11-01 (Ian): only Batch'd's own test phones. No store
    uses it, so the move in Phase 2a needs no date agreed with a customer
    and no one on site. The test phones reinstall once. The queue hand-off
    and the redirect from the old address are still built, because they
    are cheap and protect anyone who installed it unnoticed.
17. **Should the chooser remember the last pick?** A retail admin who
    always opens Retail could skip the chooser after the first time.
    Recommended: remember it per device, with a "Switch app" link in every
    app's menu.

Also settled 2026-11-01 (Ian): one central sign-in on one address (Q2),
and "Corporate" becomes "Retail" in everything people see.

Settled 2026-11-01 (Ian): manufacturers send recall notices to retailers
and to distributors; distributors receive them to halt shipments. Store
matching by the distributor's own store number is confirmed as the common
case by the research in section 3.

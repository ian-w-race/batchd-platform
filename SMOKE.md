# Batch'd smoke checks

Manual checks to run after a deploy. Each takes under two minutes. Run
the block for whatever shipped, plus the "Always" block. Record the
date and the result next to each line when you run it.

Created 2026-09-29 for Phase 0 of the FSMA 204 implementation handoff.
The security rollout's own tests live in docs/WALKTHROUGH.md and are
not repeated here.

## Always

1. Sign in to the scanner at https://batchd-app.netlify.app/. Scan or
   type a product, save it, see it in History.
2. Sign in to the dashboard at https://corporate.batchdapp.com/. The
   Recalls panel loads and shows the same recalls as before the deploy.
3. Open https://app.batchdapp.com/signup in a private window. Only the
   Retailer card shows. No region picker shows.

## Phase 0: regulatory copy, US defaults, picker removal

4. Search the two apps for the retired instruction. In the dashboard,
   open Compliance, the recall coordination sheet (Live Recall, print),
   Reports and Terminology. In the scanner, open a recall's Take Action
   sheet and the manager view's regulatory quick reference. Nowhere
   should a retail store be told to file with the Reportable Food
   Registry. Every US surface that mentions FDA notification should say
   the recalling firm notifies the FDA and the store pulls, holds and
   documents.
5. Dashboard, Settings, Organization card: no Region dropdown. Save
   changes still works and the topbar still shows the organization's
   region.
6. Dashboard, Staff Activity, invite form: no Default region field.
   Send an invite to a plus-address; it arrives.
7. Join page from that invite: name, phone, store role and badge ID
   arrive prefilled; the phone placeholder, when empty, reads +1.
8. Signup, private window, throwaway plus-address: complete all three
   steps. Then in Supabase run
   `select region, recall_source from organisations order by created_at desc limit 1;`
   and expect `us` and `fda`.
9. Compliance panel, US organization: the record retention line cites
   21 CFR 1.1455(d); the receiving key data element lines cite
   21 CFR 1.1345; nothing cites 1.1330 or 1.337.

## Later phases (from the implementation handoff, section 12)

10. US org: switch to Receiving, scan a GS1-128 case label, save with
    supplier and PO, see the row in the manager Receiving tab.
11. Same org: shelf-scan a unit with the same lot, see the "Linked to
    delivery" chip.
12. Same org, dashboard, Compliance, Records request drill: enter a lot
    or a date range, Start the clock, then Produce records. The CSV has
    the cover block and the 27 Phase 4 columns, the card shows the
    minutes, and the next drill certificate carries a "Records produced
    in" line.
13. Same org, Compliance, Traceability plan: save a contact, Generate
    plan, confirm the contact and every active store appear, then
    Regenerate and confirm the card shows version 2.
14. Signup: pick the two starter categories, confirm suggested
    suppliers appear inactive in Settings and the two drill templates
    appear in the launcher.
15. Compliance: readiness can reach 100 percent; no mention of partners
    or shipments remains.
16. Offline: a receiving save with the network off replays on reconnect
    without duplicating.
17. Dashboard, Settings, Suppliers card: add a supplier with phone,
    street, city, state and ZIP; the row shows a green dot. Scanner,
    Receiving: the supplier is in the picker without "(address
    incomplete)". Manager Receiving tab, Export CSV: the supplier_phone,
    supplier_street, supplier_city, supplier_state and supplier_zip
    columns are filled for a receipt from that supplier.
18. Dashboard, Settings, Organization card: set annual food sales to
    "Under $250,000" and save. Compliance shows "Likely exempt" and the
    exempt sentence; the Overview readiness ring reads "Deliveries
    recorded" and can reach 100 percent. Tick the registered-facility
    box and save: the FDA authority card on Compliance now names the
    Reportable Food Registry duty of a registered facility.
19. Scanner, Shelf mode, as a manager: type "Pepperoni pizza" as the
    product and see no FTL badge; "Eggplant" none; "Bell peppers" shows
    Peppers. On a detected item tap "Not a listed food"; the badge
    clears and Dashboard, Settings, Listed foods shows the decision.
    Settings, Organization: the focus chips show Leafy greens and Nut
    butters; Suppliers lists the suggested seeds as inactive; the drill
    launcher offers the two scripts first and the certificate names the
    scenario once migration 028 is applied.
20. Dashboard, Receiving, Import a delivery file: download the
    template, change the store column to one of your store names or
    wholesaler codes, upload it. Two expected lines appear. Phone,
    Receiving mode: the chip says 2 expected deliveries; type the lot
    RM240928; the banner shows the expected quantity; Confirm delivery.
    The line moves to Received with source File, and the dashboard
    export carries "From wholesaler delivery file" in Notes. Needs
    migration 029 for a floor-staff account.
21. Settings, Organization card shows "Network benchmarks" unchecked
    (Elliott approved the copy 2026-10-07); tick it, save, reload; it is
    still ticked. Untick, save; it is off. Nothing else changes anywhere.

## Follow-ups shipped 2026-10-07

22. Scanner, as a manager, FSMA tab: the score lists seven components
    starting with "Lot code on every delivery", and the delivery counts
    agree with the Receiving tab for the same stores. With a plan
    generated in the dashboard, the plan card reads "Version N, generated
    {date} in the corporate dashboard" and shows no print button. The
    "What applies to you" banner sits above the score.
23. Scanner: deactivate a test staff account in the dashboard (Staff
    Activity), then sign in as that account on the phone. The login
    overlay shows "Account deactivated" with a Sign out button and the
    console shows no error.
24. Dashboard, Staff Activity: invite a staff-role address. The email
    reads "on Batch'd as a staff member". Settings: the first card is
    titled "Organization" and the sign-in page says "command center".
25. Join page: send an invite with phone, store role, badge ID and hire
    date filled in. The join form shows those four fields locked (dashed
    border) under "Profile details · entered by your administrator" with
    the note beneath; accept, and the values appear unchanged on the
    member in Staff Activity. Send a second invite with only the phone
    filled: only the phone is locked, the other three are editable.
26. Dashboard, Reports and Exports, US org: the "FSMA 204 receiving
    records" card counts delivery records; open it and the table lists
    deliveries, not shelf scans, with "Missing" in red where a lot code is
    absent. Download CSV: the file starts with the cover block and has
    the 27 Phase 4 columns, the same shape as the records request export.
27. Scanner, Manager view, FSMA tab, plan card: with a dashboard plan on
    file it reads "Version N, generated {date} in the corporate dashboard"
    and View plan opens the stored document in a new tab with a Print
    button; with no plan it says a corporate admin generates it in the
    dashboard and shows no button. No "Download Traceability Plan" modal
    exists anywhere in the scanner.
28. Dashboard: sign in as a deactivated corp admin or store manager (a
    test account deactivated in Staff Activity). The sign-in overlay
    shows "Account deactivated" with a Sign out button; the console shows
    no error. Compliance panel: the retention line now cites
    21 CFR 1.1455(d) and the applicability note under the sales band says
    the FDA has not published adjusted figures.

## Migration 030 (products_public FTL columns)

29. Supabase SQL editor: run migrations/CHECK_MIGRATIONS.sql; the 030 row
    reads APPLIED. Then `select is_ftl, ftl_category from products_public
    limit 1;` returns the two columns (rows may be empty). Scanner, Shelf
    mode: scan a product whose products row has is_ftl set and no org
    override; the FTL badge follows the product flag rather than the name
    regex. Browser console shows no 400 on products_public.

## Dashboard icon sweep

30. Dashboard: Reports and Exports shows line icons (clipboard, person,
    store, megaphone, flag) on the cards, not emoji; Compliance category
    cards and the live-check headings show line icons; the "Produce
    records" area and empty states have no color emoji anywhere. The US
    flag on the FSMA card stays. After a drill certificate downloads, the
    button reads "Download certificate" with a medal icon.

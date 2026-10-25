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
    exempt sentence. (The "Deliveries recorded" readiness ring lived in the
    retired legacy overview and is no longer shown.) Tick the registered-facility
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

## Function source blocked (netlify.toml, 2026-10-08)

31. In a private window open
    https://app.batchdapp.com/netlify/functions/send-invite.js and
    https://corporate.batchdapp.com/netlify/lib/auth.js: both return the
    404 page, not JavaScript. Then send a staff invite from the dashboard:
    the email still arrives (the function itself is unaffected).

## Reports carry deliveries (2026-10-09)

32. Dashboard, Reports and Exports, US org, after at least one delivery
    is recorded in the scanner: the Audit trail card counts deliveries;
    open it and the table shows a Type column with Delivery and Shelf scan
    rows in one date order, a delivery row showing quantity and PO. Its
    CSV starts with a "Record Type" column. Staff activity shows a
    Deliveries column; a person who only recorded a delivery appears with
    "No scans". Its CSV has "Deliveries Recorded".
33. Same panel, Store compliance: the table has 7d, 30d and all-time
    delivery columns; a store with a delivery this week and no shelf
    scans is "slow" or "active", not "dark"; the CSV has the three
    delivery columns.
34. Dashboard, Lot Lookup: search a lot that has a delivery recorded. A
    "Received N times" block lists the delivery with store, supplier,
    reference and quantity above the shelf status; a reference typed as
    "PO-1042" shows once, not "PO PO-1042". Search again, then open
    Dashboard in the sidebar within a minute: the overview renders, not
    the search results.
35. Dashboard, Scan History, Trace lot, same lot: the chain reads
    Supplier, Received at stores, Scanned onto shelves, Recall status, and
    a Delivery records table sits above the scan records.
36. Dashboard, Settings: the third row is "Data in and out" with two
    cards, Wholesaler delivery files (opens Receiving) and FSMA 204
    records export (opens Reports). No ERP webhook card.
37. Dashboard, Terminology & Help: the traceability section lists
    Receiving record, Key data elements, Immediate previous source,
    Delivery file and Records request; the roles section lists Supplier,
    not Trading partner. Nothing mentions AI OCR.
38. Dashboard as a store manager: the overview shows a fifth tile,
    "Deliveries this week", and clicking it opens Receiving. Overview as
    corp admin with an active recall on a received lot: the banner says
    "match lots you received".
39. Scanner, End shift summary after recording a delivery today: a
    Deliveries tile and "Deliveries you recorded today" list appear.
    Manager, Audit report for a period with deliveries: a Deliveries tile
    and a "Delivery records" section; the CSV starts with "Record Type"
    and lists delivery rows after the scans. A pushed recall on a
    scanned lot counts in Recall matches.

## Settings token sweep and dead queries (2026-10-11)

40. Dashboard, Settings, in dark and then light theme (the toggle in Your
    preferences): every card reads as before; labels, helper text, chips
    and buttons are not visibly larger or smaller, nothing is blank or
    unstyled. Recall management, lookback dropdown: the options read
    "90 days (3 months)", "180 days (6 months)", "270 days (9 months)",
    "365 days (1 year, recommended)". Suppliers card: Edit opens the
    modal with rounded corners and the "Typically ships" chips are pills.
41. Dashboard with devtools Network open, filter "trading_partners":
    opening Recalls makes no request to that table. Then clear, filter
    "investigation_requests" and open Dashboard (overview): for an org with
    no active manufacturer partners, no request to that table either.
42. Dashboard, Reports and Exports, US org: the six cards and each report
    (Audit trail, Staff activity, Store compliance, Recall history,
    Exposure notice, FSMA 204 receiving records) look as before in dark
    and light theme: tiles, table text and buttons at their usual sizes,
    nothing blank. Open Audit trail and press Print / PDF: in the print
    window the stat tiles keep their large numbers and the table text its
    small size (the same as on screen), and the green banner reads
    "Report ready to print or save as PDF". Exposure notice with no pushed
    recalls reads "No pushed recalls on record".

## Seven more panels on the ladder (2026-10-18)

43. Dashboard, dark and then light theme: open Lot Lookup, Terminology &
    Help, Receiving, Store Network, Scan History, Staff Activity and (as a
    store manager) the overview. Each reads as before: labels, table text,
    chips and buttons at their usual sizes, nothing blank or unstyled.
    Lot Lookup's hint under the search box starts "Fuzzy matching:"; the
    Staff Activity header reads "N team members · staff and managers";
    Store Network's Edit form and Staff Activity's Invite form open with
    rounded corners and readable labels.

## Rest of the dashboard on the ladder (2026-10-18)

44. Dashboard, dark and then light theme: Dashboard (overview), Getting
    started, Recalls (open Run drill, then Add recall, then a recall card
    to reach Live Recall, then a store's timeline), Compose recall,
    Compliance (the live view, one category and the results page),
    Complaint Triage (list, Log Phone Complaint, one complaint's detail),
    Investigations (and Submit response), Consumer Notify, Store Network's
    Import stores dialog and Scan History's Trace lot. Each reads as
    before: no text visibly larger or smaller, no blank or unstyled
    element, buttons and chips keep their corners. Sign out and back in:
    the sign-in card looks as before.

## Judgment and color passes (2026-10-18)

45. Dashboard, dark then light theme. Recalls, open a live recall with
    stores at different stages: on the map the dots read red (notified),
    orange (acknowledged), amber (pulled), green (disposed), mint
    (resolved), and the stage pills in the store rows use the same
    colors; in light theme the amber and green are darker and still
    readable. Dashboard overview and Store Network map: dots are mint or
    gray, the legend text follows the theme. Light theme: the sidebar,
    modals and the help tip cast soft gray shadows, not black ones.
    Compliance: authority cards have plain names and mint "Notify /
    report" links; gap "Go" buttons are mint. Compose recall: the step
    titles read slightly larger than before; the results page's big
    score reads slightly smaller. Open any report's Print / PDF: the
    green status badges in the document have dark green text.

## Stylesheet pass and review leftovers (2026-10-18)

46. Dashboard: buttons and links that used to end in a text arrow (Sign
    in, Verify, Add stores, Run a drill, Launch drill, Continue to
    Classify, Send invitation email, View, Review) show a small arrow icon
    instead; "Open scanning app" shows an external-link icon. Settings,
    Suppliers, Delete on a supplier: a styled dialog appears (not the
    browser's gray box) with Cancel focused and a red "Delete supplier"
    button; Escape closes it without deleting; the same for Disable 2FA,
    Deactivate on a staff member, Cancel drill and discarding a composer
    draft. Complaint Triage, Log phone complaint: field labels are small
    uppercase, inputs match the Settings forms, the submit button reads
    "Submit and triage". Recalls, expand a recall card, View audit trail:
    the chevron turns when the log opens. Tab through the overview: KPI
    cards and other clickable tiles take focus with a visible ring and
    open on Enter. Toasts: text is dark on red, orange and blue toasts in
    dark theme and light on them in light theme.

## Scanner on the ladder (2026-10-24)

47. Scanner, signed in as a manager: Shelf and Receiving modes, History,
    Recalls, Settings and the manager dashboard look as before (no text
    visibly larger or smaller, inputs still readable, buttons keep their
    corners); in light theme the inputs are white on a light page and
    the dropdown chevron is visible. Manager dashboard, Audit export tab:
    both store dropdowns list your stores (this tab used to fail
    silently). Tab through the History list: cards take focus with a
    visible ring and open on Enter. Help & Terminology opens and closes.

## Supplier recall notices (2026-10-25)

48. Dashboard as a corporate admin, Recalls: "Got a recall notice from a
    supplier?" shows a "Read a supplier notice" button. Upload a real
    supplier recall PDF (or paste the email). Within about a minute the
    review shows the firm, class, reason, products with GTINs and lots, and
    anything to check against the original. "Your stores" lists the stores
    whose deliveries match, with cases received. "Review and push in the
    composer" fills every composer field; pushing lands on Live Recall and
    the notice leaves the Supplier notices list. Needs migration 040 and an
    org on a pilot or paid plan.


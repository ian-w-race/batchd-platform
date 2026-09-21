# Batch'd security hardening — rollout runbook

Branch: `security-hardening-2026-09` · Prepared 2026-09-20 · Not merged, not deployed.

This runbook is the only document you need to ship this work. Follow the
phases in order. Nothing here has been applied to production.

---

## 0. What Claude Code could and could not do

Checked at the start of the work:

| Capability | Available? | Consequence |
|---|---|---|
| Run SQL against Supabase (CLI / MCP / DATABASE_URL) | **No** | Every migration and every check query is a manual step for you. |
| Read or set Netlify env vars (`netlify env:list`) | **No** | Env var steps are manual. |
| Read Netlify function logs | **No** | The "was anything calling the deleted functions?" check is manual (and optional). |
| Node, npm, python3 | Yes | All static checks were run; results in section 6. |

**Because there was no database access, the Phase 0 preflight SQL was never
run.** Its output is supposed to confirm that migration 020's CHECK
constraints fit the existing data. 020 is written so that this is safe: every
constraint block tests the data first and prints `SKIPPED …` instead of
failing. So you can run 020 without the preflight — but read the NOTICE
output, because a `SKIPPED` line means real data needs cleaning.

---

## 1. Phase 0 — preflight SQL (run this first)

Supabase dashboard → project `lurxucdmrugikdlvvebc` → SQL Editor → New query.
Paste and run. Everything below is read-only.

```sql
-- 1. Live policies on the tables this work touches
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('organisations','organisation_members','invitations','scans','stores',
                    'recall_distributions','recall_acknowledgements','recall_events','recalls',
                    'user_profiles','complaints','code_patterns','store_manager_stores')
ORDER BY tablename, policyname;

-- 2. Has 019 already been applied? (expect 4 rows if NOT yet applied)
SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' AND policyname IN
 ('Anyone can read invitation by token','Insert own membership','Admins can update org memberships','Delete own memberships');

-- 3. Values that the new CHECK constraints must accommodate
SELECT 'member_role' AS what, role AS value, count(*) FROM organisation_members GROUP BY role
UNION ALL SELECT 'invite_role', role, count(*) FROM invitations GROUP BY role
UNION ALL SELECT 'org_type', type, count(*) FROM organisations GROUP BY type
UNION ALL SELECT 'org_region', region, count(*) FROM organisations GROUP BY region
UNION ALL SELECT 'org_plan', plan, count(*) FROM organisations GROUP BY plan
ORDER BY 1, 2;

-- 4. Duplicates that would block the unique indexes
SELECT user_id, organisation_id, count(*) FROM organisation_members GROUP BY 1,2 HAVING count(*) > 1;
SELECT token, count(*) FROM invitations GROUP BY token HAVING count(*) > 1;

-- 5. Rows that become invisible under org-scoped policies
SELECT count(*) AS scans_without_org FROM scans WHERE organisation_id IS NULL;
SELECT count(*) AS stores_without_org FROM stores WHERE organisation_id IS NULL;

-- 6. The RPCs that are not in the repo
SELECT proname, prosecdef AS security_definer, proconfig, prosrc
FROM pg_proc WHERE proname IN ('send_invitation','sweep_recall_matches','trigger_recall_sweep','get_my_organisation_ids');

-- 7. Invitation token shape
SELECT length(token) AS len, token ~ '^[0-9a-f-]{36}$' AS is_uuid, count(*) FROM invitations GROUP BY 1,2;

-- 8. Who is a platform admin today (must be at least one, or admin.html locks you out)
SELECT user_id, organisation_id, role, active FROM organisation_members WHERE is_batched_admin = true;

-- 9. Columns 020/021 assume exist
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' AND (
  (table_name='organisation_members' AND column_name IN ('is_batched_admin','active','primary_store_id','store_id'))
  OR (table_name='organisations' AND column_name IN ('plan','billing_status','trial_expires_at','is_internal','api_key'))
  OR (table_name='invitations' AND column_name IN ('expires_at','accepted','manager_store_ids','invited_by'))
  OR (table_name='user_profiles' AND column_name='is_manager')
  OR (table_name='recall_events' AND column_name IN ('source_org_id','closed_at','is_drill')))
ORDER BY 1,2;

-- 10. EXTRA (not in the original brief): does code_patterns have an organisation_id?
--     See section 5, "Open items". This decides one follow-up.
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='code_patterns' ORDER BY 1;
```

### What to do with the output

- **Query 4** — any duplicate `(user_id, organisation_id)` rows must be cleaned
  before 020, or the unique index is skipped. Keep the row with the higher
  role, delete the other:
  `DELETE FROM public.organisation_members WHERE id IN (<the ids to drop>);`
- **Query 5** — if `scans_without_org` is non-zero, those scans become invisible
  after 021. Backfill what you can:
  ```sql
  UPDATE public.scans SET organisation_id = '<org id>'
  WHERE organisation_id IS NULL
    AND store_id IN (SELECT id FROM public.stores WHERE organisation_id = '<org id>');
  ```
  Anything still NULL afterwards cannot be attributed; note the count.
- **Query 6 — `send_invitation` needs your eyes.** Claude Code could not read it.
  It must (a) be SECURITY DEFINER with `SET search_path = public`, (b) refuse
  callers who are neither a corp_admin of `p_organisation_id` nor a platform
  admin, (c) accept only roles staff / store_manager / corp_admin, (d) generate
  the token with `gen_random_uuid()` or `encode(gen_random_bytes(32),'hex')`,
  (e) set `expires_at`. If **(b)** is missing, any member of any org can mint an
  invitation into any organisation — paste the function body back and it can be
  hardened before 020 runs. At minimum it needs, as its first statement:
  ```sql
  IF NOT (public.batchd_is_corp_admin_of(p_organisation_id) OR public.batchd_is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorised to invite into this organisation.';
  END IF;
  ```
  and `PERFORM set_config('batchd.bypass_guards','on',true);` before its INSERT.
- **Query 8 — important.** If this returns no row with `is_batched_admin = true`
  and `active` not false, admin.html will lock you out once 021's platform-admin
  policies replace the open ones. Fix it inside 020 (service role bypasses the
  new trigger):
  ```sql
  UPDATE public.organisation_members SET is_batched_admin = true
  WHERE user_id = '97da19d3-3daa-4f7a-bd9c-53e7ac8f8a5c'
    AND organisation_id = '925923b5-22c6-433c-8812-7e32918dab66';
  ```
- **Query 9** — every listed column must come back. If one is missing, stop and
  report it; 020/021 reference them.

---

## 2. Order of operations

```
Phase 0  preflight SQL  ──▶  Phase 1  run 019 then 020
                                    │
                                    ▼
                          Phase 2  merge the branch (Netlify deploys both sites)
                                    │
                                    ▼
                          Same hour: INTERNAL_NOTIFY_SECRET on both sites,
                                     rotate demo password, set org plans
                                    │
                                    ▼
                          Phase 3  run 021        ──▶  Phase 4  acceptance checks
```

**Why this order.** 020 removes the policies that let anyone write their own
membership, and the same deploy removes the client code that depended on them.
If the deploy went first, join and signup would still work through the RPCs,
but the window would stay open. 021 locks stores, scans and organisations; if
it ran before the deploy, the scanner's manager store tab and the join page's
store chips would break. The env var must exist before the first ERP webhook
after deploy, or its alert email silently fails. Org plans must be set before
or with the deploy, or OCR and NL query stop for every current user.

**Rollback.** 019 has a commented rollback block. 020 and 021 each run in one
transaction, so a failure applies nothing, and every `CREATE POLICY` is preceded
by `DROP POLICY IF EXISTS`, so re-running is safe. Code rollback is a Netlify
"redeploy previous"; the old clients still work against the new policies, except
the legacy onboarding fallbacks, which were already dead paths.

---

## 3. Manual steps, in order

### Before the merge

**M-1. Run the preflight SQL.** Section 1. Act on the output before continuing.

**M-2. Apply migration 019.** SQL Editor → paste the whole of
`migrations/019_lock_down_membership_policies.sql` → Run. Confirm the editor's
destructive-operations warning. If it fails with `40P01` (deadlock against a
concurrent dashboard read), retry — the file is idempotent.

**M-3. Apply migration 020.** SQL Editor → paste the whole of
`migrations/020_helpers_membership_ai_flag.sql` → Run.
Read the NOTICE output. The last line must be:

> `OK: 019 policies gone; 020 helpers, guards, invitation policies and plan flag in place.`

Any line starting `SKIPPED` names data that needs cleaning; the migration still
succeeds, but that one constraint or index was not created. Clean the data and
re-run 020 (safe — it is `CREATE OR REPLACE` / `IF NOT EXISTS` throughout).

**M-4. Confirm the platform admin.** Only if preflight query 8 returned nothing.
SQL in section 1.

**M-5. Set the plans.** Do this before or immediately after the deploy, or OCR
and NL query stop for everyone.
```sql
UPDATE public.organisations SET plan = 'active' WHERE id IN ('<paying org ids>');
UPDATE public.organisations SET plan = 'pov'    WHERE id IN ('<design partner org ids>');
-- Your own org, so you keep AI while testing:
UPDATE public.organisations SET plan = 'pov' WHERE id = '925923b5-22c6-433c-8812-7e32918dab66';
SELECT id, name, plan FROM public.organisations ORDER BY plan, name;  -- check
```
After the deploy you can also do this from admin.html's plan dropdown
(Trial / POV / Active / Churned).

**M-6. `INTERNAL_NOTIFY_SECRET` on BOTH Netlify sites.**
Netlify → Sites → pick the site → Site configuration → Environment variables.
Confirm `INTERNAL_NOTIFY_SECRET` exists, then repeat for the second site and
confirm **the value is identical**. push-recall-email now *requires* it and
fails closed, so if it is missing or different on the site the ERP webhook hits,
recall alert emails stop silently.
Optional cleanup after the deploy: delete `BOOTSTRAP_ADMIN_TOKEN` (its function
is gone).

**M-7. Rotate the demo password.** Supabase → Authentication → Users → search
`demo@batchdapp.com` → Reset password. The old password was printed in
admin.html's page source and **is still in git history**, so removing it from
the file is not enough. Store the new one in a password manager and tell any
prospect currently using it.

### The merge

**M-8. Merge and deploy.** Merge `security-hardening-2026-09`. Netlify deploys
both sites. Wait for both to show **Published** before Phase 3.
Do not deploy before M-2 and M-3: join.html and signup.html lose their legacy
fallbacks in this deploy.

### After the merge

**M-9. Apply migration 021.** SQL Editor → paste the whole of
`migrations/021_tenant_tables_lockdown.sql` → Run. The last line must be:

> `OK: no USING(true)/CHECK(true) policies remain on the tenant tables.`

It also prints a `BEFORE …` line per existing policy (a record of what was there)
and a `dropped open policy …` line per removal. If it prints `STILL OPEN`
warnings, send them back.

**M-10. Anthropic spend ceiling.** console.anthropic.com → Settings → Limits (or
Billing): set a monthly spend limit and an email alert at half of it, for the key
the functions use. This bounds anything the code does not catch.

**M-11. Optional — check for external callers of the deleted functions.**
Netlify → Site → Logs → Functions: look for `investigation-notify`,
`manufacturer-welcome`, `supplier-invite`, `staff-invite`,
`staff-invite-accept`, `bootstrap-off-seed` in the last 90 days. Claude Code
found no caller anywhere in the repo, so this only matters if an outside system
was calling one. If you find hits, say so before merging.

**M-12. Optional — existing ERP integrations.** Any manufacturer with a live API
key keeps working: 021 copies the key's sha256 hash into
`organisation_api_keys` and nulls `organisations.api_key`. To issue a new key
later, generate 32 random bytes as hex, give it to the manufacturer, and run:
```sql
INSERT INTO public.organisation_api_keys (organisation_id, key_hash, label)
VALUES ('<org id>', encode(digest('<the hex key>','sha256'),'hex'), '<label>');
```

---

## 4. What changed, per item

### Database (not applied by the merge)
| File | Closes | Summary |
|---|---|---|
| `migrations/020_helpers_membership_ai_flag.sql` | C1, C2, H15, H16, H17, H19 | Org-parameterised SECURITY DEFINER RLS helpers; insert/update guard triggers on `organisation_members` (no self-promotion, no org transfer, `is_batched_admin` is Batch'd-only); corp-admin-only policies on `invitations`; `organisations.plan` CHECK + guard trigger; hardened `create_organisation_with_admin` / `accept_invitation` / `get_invitation_by_token` (signatures verified character-for-character against 018); new `get_invitation_store_names`; `complaints.ip_hash`. |
| `migrations/021_tenant_tables_lockdown.sql` | C3, C4, H2, H3, H17, H18 | Drops every open policy on scans, stores, organisations, recall_distributions, recall_acknowledgements and replaces them with org-scoped ones; `user_profiles` locked to its owner with an `is_manager` guard; ERP keys moved to the service-role-only `organisation_api_keys` as sha256 hashes; retailer-targeted complaints backfilled onto `receiving_org_id`. |

### Functions
| File | Item | Summary |
|---|---|---|
| `netlify/lib/auth.js` (new) | Access model | Shared tenant boundary: `verifyUser`, `activeMembership`, `isPlatformAdmin`, `orgAiEnabled`, `requireMember`, `requireAi`, constant-time `internalSecretOk` (fails closed), `json`. Outside `functions/` so Netlify does not deploy it; esbuild bundles it. |
| `push-recall-email.js` | H1, L3 | Now requires `INTERNAL_NOTIFY_SECRET`; was callable by anyone. Also ignores closed events and inactive recalls, escapes severity and store names, stops leaking upstream error text. |
| `webhook-recall.js` | H2, C4 | API key matched by sha256 hash against `organisation_api_keys`; full body validation with length caps and a severity allow-list (422); 50 events/hour/org; stopped trusting the `Host` header to build its own callback URL; sends the internal secret; no internal error text in the 500. |
| `notify-consumers.js` | H5 | The recall is resolved server-side and must belong to the org; subject, sender, product, lot and reason come from that row, not the request body. 5000-address cap, real address validation. |
| `triage-complaint.js` | H4 | Staff identity proven by JWT, never by body fields; target org, name and type read from the database; public intake gated on plan (`PUBLIC_COMPLAINTS_REQUIRE_PLAN`); honeypot; per-IP (salted hash), per-org and per-email rate limits; whole-body normalisation; 7 s Anthropic timeout that fails soft; org filter on store/shipment matching; match data returned to staff only. |
| `send-invite.js` | H7 | Caller must be corp_admin **of the invitation's own org**; org name, role and inviter come from the invitation row and the session. Demo-request branch deleted (it could not run — it read `refererOrigin` above its own `const`). |
| `ocr.js` | Access model, M7 | `requireAi` (plan-gated); prompt templates moved server-side (see section 5). |
| `ai-analyze.js` | Access model | `requireAi`; array guard on `responses`; no upstream error body in the 502. |
| `notify-event.js` | L4 | Membership check now ignores deactivated members. |
| `recall-feeds.js` | Access model | Requires any active session; it was an open relay. |
| `trace.js` | H14 | Retired: always 410. |
| deleted | H6, M13, L1 | `investigation-notify`, `manufacturer-welcome`, `supplier-invite`, `staff-invite`, `staff-invite-accept`, `bootstrap-off-seed`, `accept-invite.html`. 13 functions remain. |

### Hosting
| File | Item | Summary |
|---|---|---|
| `netlify.toml` | H8, M1 | Forced 404s for CLAUDE.md, SECRETS.md, SCHEMA.md, README.md, the roadmap, the design brief, the UI checklist, netlify.toml, package.json, package-lock.json, `migrations/*`, `docs/*`. Security headers (frame-ancestors DENY, nosniff, referrer policy, Permissions-Policy **without** `camera=()`, HSTS). `/join` gets no-referrer + no-store; admin.html gets noindex + no-store. `node_bundler = "esbuild"`. |
| `package.json` | M9 | `@supabase/supabase-js` pinned to `2.112.1` (matches the SRI-pinned browser bundles); `package-lock.json` committed. |

### Clients
| File | Items | Summary |
|---|---|---|
| `dashboard.html` | D1–D7, H10, H11 | 103 tenant-data interpolations escaped, four of them at the leaf (`sevPill`, `chainNode`, the store-filter `<option>`s, the customer-match rows) so every call site is covered. Four inline handlers now pass ids instead of names. Deep link validated against a panel allow-list and a uuid pattern. NL query sends `org_id` and respects the plan. Staff triage intake sends its JWT. Complaint and recall_events writes carry the org. Consumer Notify hides events closed >30 days. |
| `index.html` | I1–I9, H12 | `esc()` now escapes `'` (this is what makes the rest sound). Photo URLs, scan fields, store names, learned-pattern fields, print title and triage summary escaped. Report-concern and both store buttons pass ids / data attributes — which also **fixes the Rename button**, broken today for every store because `JSON.stringify` emits a double-quoted string inside a double-quoted attribute. Manager store list/insert/update and the FSMA export carry `organisation_id`. OCR sends `org_id` + a prompt id. Triage and the three feed calls send the JWT. Offline replay discards other orgs' queued scans. |
| `admin.html` | A1–A4, H9, H13 | Demo credentials block removed; `esc()` added and applied to org names, emails, types, plans, notes and error text; invite button passes the id only; POV added to both plan dropdowns; noindex; unused admin-id literal removed. |
| `join.html` | C1, M11, H18, J1–J4 | Legacy client-side acceptance path deleted (it inserted `organisation_members` from the browser); RPCs are the only path and every error surfaces; store chips via `get_invitation_store_names`; token moved out of the URL into sessionStorage; `esc()` hoisted to module scope. |
| `signup.html` | H19, C1, M11 | Manufacturer card and all its branches removed; `p_type: 'retailer'`; legacy client-side org/membership/store inserts deleted. |
| `complaint.html`, `complaint-widget.js` | H4 | Honeypot field added and sent. |
| `trace.html` | H14, M4 | Static retirement notice, no network call. |
| `docs.html` | H2 | Documents the `retailer_org_ids` alias, the new 429, and the **real** response keys (the documented ones never existed). |

---

## 5. Things you should know (deviations and findings)

**1. The OCR prompt change was done differently from the brief — deliberately.**
The brief said to copy "the two prompt strings" from index.html verbatim into a
server-side dictionary keyed by `promptId`. There are no two static strings: the
main `extract_codes` prompt is assembled at runtime from the user's region (the
long FSMA / EU wording), the product name, a learned `code_patterns` hint, a crop
note and on-device OCR text; the autocapture prompt is one of two strings chosen
by `_acPhase`. Copying either verbatim would have broken lot-code accuracy and
moved the jurisdiction gate off the leaf, against CLAUDE.md's region rule.
You chose the alternative: **ocr.js owns the templates and the client sends only
validated parameters** (`region`, `productName`, `contextHint`, `cropped`,
`ocrText`, `phase`), each type-checked and length-capped, newlines preserved
where they are structural. A parity harness confirmed the generated prompt is
**byte-identical** to today's across both regions, with and without crop and OCR
text. No caller-controlled instruction text reaches Anthropic any more.

**2. The `code_patterns` org-scoping from the brief was NOT applied.** The brief
asked for `organisation_id` on two `code_patterns` inserts and on one update and
two deletes. That table is not defined in any migration, `docs/ARCHITECTURE.md`
line 14 calls it cross-organizational by design ("the moat"), and migration 021
explicitly leaves it alone. If the column does not exist, the inserts 400 and
pattern learning silently stops; if it exists but existing rows have NULL, every
update becomes a no-op and learning stops too. Neither failure is visible without
devtools. **Preflight query 10 settles it.** If `organisation_id` is present on
`code_patterns`, tell Claude Code (or apply it yourself) — the change is: add
`organisation_id: _currentOrgId` to the two inserts (`code_patterns` insert in
the learn path and in `mgrAddSchema`), and `.eq('organisation_id', _currentOrgId)`
to the update and the two deletes. The **reads** must stay unscoped either way.
There is a real underlying issue here — today any user can edit or delete any
org's learned pattern — but closing it needs a schema change, which is outside
this brief.

**3. `send_invitation` was never inspected.** It is not in the repo and there was
no database access. Preflight query 6 is how you check it. If it lacks a caller
check it is a live privilege-escalation path into any organisation, independent
of everything else here.

**4. Bug found while removing the demo-request branch.** `send-invite.js` read
`refererOrigin` several lines above its own `const` declaration, so every
demo-request POST would have thrown a `ReferenceError`. That path was dead in
both senses. landing.html still posts to it and is now definitively broken; it
is unlinked, and the brand site owns demo requests.

**5. Bug found and fixed while changing the dashboard handlers.** After removing
the `productName` parameter, `generateJointRecallReport` still read it in its
`<title>` — which would have thrown. It now uses the event row, escaped.

**6. The Rename button in the scanner's manager store tab is broken today** for
every store, not just oddly-named ones: `JSON.stringify(esc(s.name))` emits a
double-quoted string inside a double-quoted HTML attribute. The data-attribute
change fixes it.

**7. `fetch-recall-feeds.js` does not call `recall-feeds.js`.** CLAUDE.md said it
did. It fetches the FDA and Mattilsynet feeds directly, which is why adding a JWT
requirement to the proxy does not break the daily import. CLAUDE.md is corrected.

**8. The 404 rules point at `/404.html`, which does not exist.** The status code
is still 404, which is what matters, but the body will be Netlify's default. If
you want a branded page, add a `404.html` at the repo root.

**9. `Strict-Transport-Security` includes `includeSubDomains`.** Per CLAUDE.md's
2026-09-13 verification every `batchdapp.com` hostname is on this one Netlify
site over HTTPS, so this is safe. If a plain-HTTP subdomain ever exists, drop
that directive.

**10. Not in scope, noted only.** landing.html and recall-roi-calculator.html are
still served and unlinked; `is_drill = false` inserts by the composer may or may
not pass the existing recall_events INSERT policies (the brief's open question,
unchanged); the remaining Medium findings from the review (2FA on the dashboard
boot path, CSV formula neutralisation, a private photo bucket, the cron-singleton
guard) are untouched.

---

## 6. Acceptance checks

### Static — already run on the branch, all passing

| Check | Result |
|---|---|
| `node --check` on all 13 functions | pass (no output) |
| `node -e "require('./netlify/lib/auth.js')"` export count | **13** |
| `netlify.toml` parses (`tomllib`) | pass — 26 redirects, 3 header blocks, esbuild |
| `grep -c "esc(esc("` in dashboard/index/admin/join | **0** each |
| `grep -n "Batchd2026"` / `BATCHED_ADMIN_USER_ID` in admin.html | **0** / **0** |
| `grep -n "type-manufacturer"` in signup.html | **0** |
| `grep -n "LEGACY CLIENT-SIDE PATH"` in join.html | **0** |
| `demo_request` / `handleDemoRequest` in send-invite.js | **0** |
| `extra.prompt` in ocr.js (strict, excluding `promptId`) | **0** |
| `promptId` in index.html | **2** |
| `event.headers.host` in webhook-recall.js | **0** |
| `requireAi` in ocr.js and ai-analyze.js | one call each |
| Six functions + accept-invite.html deleted | yes, 13 functions remain |
| Every inline `<script>` in the five HTML files parses | pass |
| OCR prompt parity vs today's client prompt | **byte-identical, 4/4 cases** |

Re-run them all at any time:
```bash
for f in netlify/functions/*.js; do node --check "$f" || echo "FAIL $f"; done
node -e "console.log(Object.keys(require('./netlify/lib/auth.js')).length)"
python3 -c "import tomllib; tomllib.load(open('netlify.toml','rb')); print('toml ok')"
grep -c "esc(esc(" dashboard.html index.html admin.html join.html
```

### After Phase 1 (019 + 020)

Replace `<ANON>` with the anon key from any HTML file and `<JWT>` with a
throwaway account's access token.

- [ ] `curl -s 'https://lurxucdmrugikdlvvebc.supabase.co/rest/v1/invitations?select=token&limit=1' -H 'apikey: <ANON>'` returns `[]`
- [ ] With `<JWT>`: `POST /rest/v1/organisation_members` naming another org and `role: corp_admin` is rejected
- [ ] Same JWT: `PATCH /rest/v1/organisation_members?user_id=eq.<me>` with `{"is_batched_admin":true}` is rejected by the trigger
- [ ] Same JWT: `PATCH /rest/v1/organisations?id=eq.<own org>` with `{"plan":"active"}` is rejected ("managed by Batch'd")
- [ ] Dashboard Staff panel still lists invitations; a new invite arrives and can be accepted in a private window
- [ ] admin.html signs in and lists customers
- [ ] Signing in as `demo@batchdapp.com` with the **old** password fails

### After Phase 2 (deploy)

- [ ] `curl -sI https://app.batchdapp.com/CLAUDE.md | head -1` → 404; `/migrations/019_lock_down_membership_policies.sql` → 404; `/docs.html` and `/docs` → 200
- [ ] `curl -sI https://corporate.batchdapp.com/ | grep -iE 'x-frame|content-security|referrer|nosniff|strict-transport'` shows all five
- [ ] `curl -s https://app.batchdapp.com/admin.html | grep -c Batchd2026` → 0
- [ ] `curl -X POST .../push-recall-email -d '{"recall_event_id":"x"}'` → 401
- [ ] `curl -X POST .../manufacturer-welcome -d '{}'` → 404
- [ ] `curl -s '.../trace?lot=%25'` → 410
- [ ] `curl -X POST .../ocr -d '{}'` → 401; with `<JWT>` + a **trial** org id → 403 `code: ai_disabled`; with a **pov** org and a real image → 200
- [ ] `curl -X POST .../triage-complaint -d '{"receiving_org_id":"<pov org>","complaint_text":"test one"}'` eleven times from one IP: the eleventh is 429. With a trial org id, 403 on the first call. With `"website":"x"`, 200 but no row created.
- [ ] complaint.html opened via a POV org's `?org=` link submits, and the consumer's follow-up email names the org
- [ ] Dashboard phone intake and scanner staff intake create complaints whose audit row says Staff — including for a trial org
- [ ] Consumer Notify to one test address works; posting a random `recall_event_id` → 403
- [ ] Staff invite from the dashboard and from admin.html both deliver, naming the real org and your login address
- [ ] Scanner: camera opens; scan with photo saves; OCR runs for a POV org and shows the "not enabled" toast once for a trial org; History, On Shelf and Store Management render a store renamed to `O'Brien & Sons <b>x</b>` literally; **the Rename button works**
- [ ] Dashboard: `?panel=<b>x</b>` shows escaped text; `?panel=recalls` opens Recalls; Reports → Audit trail renders a scan named `<img src=x onerror=alert(1)>` as text
- [ ] join.html: open a real invite link; the address bar loses `?token=`; refresh; the form still renders; accept

### After Phase 3 (021)

- [ ] With a throwaway `<JWT>`: `GET /rest/v1/scans?select=id&limit=1` → `[]`; `GET /rest/v1/stores?select=id&limit=1` → `[]`; `GET /rest/v1/organisations?select=id,name` returns only that caller's own org
- [ ] `POST /rest/v1/recall_distributions` naming another org's event and org id is rejected
- [ ] `POST /rest/v1/rpc/bootstrap_products_pending` with the anon key → 401/403
- [ ] Scanner: scan, photo, pull from shelf, offline replay; manager tab lists only own stores; FSMA export downloads own rows
- [ ] Dashboard: composer push creates event + distribution + acks; drill launches as corp_admin **and** as store_manager; acknowledge, complete, close a recall; deactivate a member; save Settings; a recall pushed from a second test org shows the source org's name
- [ ] admin.html: customer list, org detail, create org, plan dropdown including POV, seed and reset demo
- [ ] A store-manager invite accepted by a user who already had a scanner login (exercises the `bypass_guards` path)
- [ ] Any live ERP key still authenticates:
      `curl -X POST .../webhook-recall -H 'X-Batchd-Api-Key: <key>' -d '{"product_name":"test","is_drill":true}'` → 200

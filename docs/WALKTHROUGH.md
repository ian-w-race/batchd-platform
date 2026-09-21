# Batch'd security rollout — step by step

Updated 2026-09-21, after the pre-flight diagnostics.

## Where you are

| | |
|---|---|
| ✅ Done | Pre-flight queries 1 and 2 |
| ✅ Found | `send_invitation` had no authorisation check — anyone could make themselves a corp admin of any org. **Fixed**, inside migration 020. No extra step for you. |
| ✅ Confirmed | You have an active platform admin, so no lock-out risk. No orphaned scans or stores. No duplicate memberships or tokens. Migration 019 is already applied. |
| ⬜ Remaining | One 10-second query (Part 0), then Parts 1–4. |

**Nothing is live yet.** All the code is on a branch that has not been merged or deployed.

---

## Before you start

Open these in browser tabs and leave them open:

1. **Supabase** — https://supabase.com/dashboard → click project `lurxucdmrugikdlvvebc`
2. **GitHub** — https://github.com/ian-w-race/batchd-platform
3. **Netlify** — https://app.netlify.com

Every `Run` button in this document just copies a file onto your clipboard. None of them change anything.

**How to run a query in Supabase** (you'll do this several times):
Left sidebar → **SQL Editor** → **+ New query** → click in the big box → **Cmd+V** → green **Run** button (or **Cmd+Enter**).
Always use **+ New query** for a fresh one rather than typing over the last.

---

## PART 0 — One last query (~1 min)

Read-only. `code_patterns` has an `organisation_id` column; this asks whether existing rows actually have it filled in.

Copy it:

    cat /Users/johnponchak/batchd-platform/docs/preflight-3-code-patterns.sql | pbcopy

Paste into a new Supabase query, Run, and send me the two-row result.

**This does not block you.** If the rows are populated I'll add one more fix so it ships in this same deploy; if not, I'll leave it out. Either way the branch is safe to ship. You can carry straight on to Part 1 while I look at it.

---

## PART 1 — Run the migrations (~15 min)

Supabase SQL Editor. **One at a time, in this order.** After each, read the messages panel underneath the editor.

### 1.1 — Migration 019

    cat /Users/johnponchak/batchd-platform/migrations/019_lock_down_membership_policies.sql | pbcopy

New query → paste → **Run**.

Supabase shows an orange **"Query has destructive operation"** warning. That's expected — the file drops old security policies. Click **Run this query**.

**Expected:** it reports nothing changed. This migration was already applied. Run it anyway; it costs two seconds and removes all doubt.

*If you see `40P01 deadlock detected`:* harmless — someone had the dashboard open. Click Run again.

### 1.2 — Migration 020 (this now contains the `send_invitation` fix)

    cat /Users/johnponchak/batchd-platform/migrations/020_helpers_membership_ai_flag.sql | pbcopy

New query → paste → **Run** → confirm the destructive-operation warning.

**Now read the messages panel.** The last line must read exactly:

> `OK: 019 policies gone; 020 helpers, guards, invitation policies, hardened send_invitation and plan flag in place.`

⚠️ **If any line starts with `SKIPPED`** — copy those lines and send them to me before going further. It means existing data doesn't fit a new rule. Not an error, but one safeguard didn't get created.

### 1.3 — Verify the takeover hole is closed

New query → paste this → **Run**:

```sql
SELECT prosecdef                                        AS security_definer,
       proconfig                                        AS search_path_pinned,
       position('Not authorised to invite' in prosrc) > 0 AS has_authorisation_check
FROM pg_proc WHERE proname = 'send_invitation';
```

**Expected:** `security_definer = true`, `search_path_pinned = {search_path=public}`, `has_authorisation_check = true`.

❌ If `has_authorisation_check` is `false`, migration 020 didn't fully apply. Stop and tell me.

### 1.4 — Turn the plans on

    cat /Users/johnponchak/batchd-platform/migrations/020a_set_existing_orgs_pov.sql | pbcopy

New query → paste → **Run**.

**Expected:** `OK: 6 organisation(s) set to pov. Paying orgs on active and churned orgs were left alone.`

This is the step that keeps AI working. **Skip it and product recognition stops for every user.**

### 1.5 — Confirm the plans

New query → paste → **Run**:

```sql
SELECT name, plan FROM public.organisations ORDER BY plan, name;
```

Every row should say `pov` or `active`. If any still say `trial` or are blank, stop and tell me.

---

## PART 2 — Netlify and the merge (~15 min)

### 2.1 — Check the environment variable on BOTH sites

In Netlify click **Sites** in the top nav. Two sites deploy this repo.

For **each** site:
1. Click the site name
2. Left sidebar → **Site configuration**
3. Left sidebar → **Environment variables**
4. Find `INTERNAL_NOTIFY_SECRET`

**Both sites must have it, with the same value.** Click the reveal/eye icon to compare. If one is missing it, click **Add a variable** and copy the value from the other.

Why: recall alert emails now require this secret. If the site your ERP webhook hits doesn't have it, those emails stop and nothing visibly errors.

### 2.2 — Push the branch

    cd /Users/johnponchak/batchd-platform && git push -u origin security-hardening-2026-09

*If it asks for a username and password:* GitHub no longer accepts passwords here — you need a personal access token. Tell me and I'll walk you through it.

### 2.3 — Open the pull request

Go to:
https://github.com/ian-w-race/batchd-platform/compare/main...security-hardening-2026-09

Click **Create pull request** → title it `Security hardening 2026-09` → **Create pull request** again.

Netlify posts a **Deploy Preview** link within a couple of minutes. You can look around, but the preview URL doesn't have your real domain routing, so the dashboard/scanner split won't behave normally there. Real testing happens after the merge.

### 2.4 — Merge

Green **Merge pull request** → **Confirm merge**.

### 2.5 — Wait for both deploys

Netlify → **each** of the two sites → **Deploys** tab. Wait until both show a green **Published**. Usually 1–3 minutes.

**Do not start Part 3 until both say Published.**

---

## PART 3 — The final migration (~3 min)

    cat /Users/johnponchak/batchd-platform/migrations/021_tenant_tables_lockdown.sql | pbcopy

Supabase → new query → paste → **Run** → confirm the destructive-operation warning.

The messages panel prints a lot of `BEFORE ...` lines (a record of the old rules) and `dropped open policy ...` lines. The **last** line must read:

> `OK: no USING(true)/CHECK(true) policies remain on the tenant tables.`

⚠️ If any line starts `STILL OPEN:` — copy it and send it to me.

---

## PART 4 — Testing (~25 min)

In order. For each, I've said what correct looks like.

### 1. Internal files are no longer public

    curl -sI https://app.batchdapp.com/CLAUDE.md | head -1

✅ `HTTP/2 404` — ❌ anything else means the file is still being served.

### 2. Invitation tokens are no longer dumpable

Open https://batchd-app.netlify.app/ → press **F12** (or right-click → Inspect) → **Console** tab → paste and Enter:

```
await (await fetch(SUPABASE_URL+'/rest/v1/invitations?select=token&limit=1',{headers:{apikey:SUPABASE_KEY}})).json()
```

✅ `[]` — ❌ if it returns invitation rows, 019/020 didn't apply.

### 3. The takeover hole is closed (the important one)

You need a login that is **not** a platform admin. If you have a staff or store-manager test account, sign into the scanner with it. If you don't, skip to test 4 — step 1.3 already proved the guard is in the function.

With that account signed in, Console tab, paste and Enter:

```
await sb.rpc('send_invitation', {p_organisation_id:'925923b5-22c6-433c-8812-7e32918dab66', p_email:'test@example.com', p_role:'corp_admin', p_store_id:null})
```

✅ An `error` containing **"Not authorised to invite into this organisation."**
❌ If it returns a `token`, stop immediately and tell me — that account can take over your organisation.

### 4. Scanner — the core loop

https://batchd-app.netlify.app/ → sign in.
- Scan or enter a product, take the photo, save
- ✅ It saves and appears in History
- History → open a scan → pull one from shelf → ✅ marks as removed

### 5. Scanner — AI

Take a product photo on the scan screen.
- ✅ The product name auto-fills
- ❌ If you see the toast *"AI product recognition is not enabled for this organisation"*, that org's plan didn't get set — go back to step 1.5

### 6. Scanner — store rename (currently broken, should now work)

Manager view → **Store Management**.
- ✅ You only see your own stores
- Click **Rename** on any store → ✅ the dialog opens with the current name filled in. Before this change it opened blank.

### 7. Invitations

Dashboard (https://corporate.batchdapp.com/) → **Staff Activity** → invite someone, using an address you can check.
- ✅ Email arrives, names your real organisation and your address as the inviter
- Open the link in a **private/incognito window**
- ✅ Watch the address bar: `?token=...` disappears shortly after load
- Press **Cmd+R** → ✅ the form is still there (not "invitation not found")
- Complete it → ✅ signs you in

### 8. Recalls

Dashboard → push a recall from the composer → acknowledge it → close it. ✅ all three work.

### 9. Signup

https://app.batchdapp.com/signup in a private window.
- ✅ Step 1 shows **only** a Retailer card — no Manufacturer card
- Complete with a throwaway email → ✅ lands in the dashboard

### 10. Admin

https://app.batchdapp.com/admin.html
- ✅ You can sign in and see the customer list
- ✅ Open any org → the Plan dropdown has **POV** between Trial and Active
- ✅ The "Share with prospects" box with the demo password is gone
- ✅ **Invite admin** on any org still sends

---

## If something breaks

**Roll the code back:** Netlify → the site → **Deploys** → the deploy from before the merge → **⋯** → **Publish deploy**. The old code works fine against the new database rules.

**The migrations generally don't need rolling back** — they're additive or replace policies, and each runs in a single transaction so a failure applies nothing. If you truly need to undo 019, its rollback block is commented out at the bottom of the file.

**Anything unexpected:** copy the exact error text or screenshot it and send it. Don't re-run a migration that errored until I've looked.

---

## Afterwards — two things not to forget

1. **Rotate the demo password.** Supabase → **Authentication** → **Users** → search `demo@batchdapp.com` → **Reset password**. The old one was printed in `admin.html`'s source and is still in your git history, so deleting it from the file wasn't enough.
2. **Cap the Anthropic spend.** console.anthropic.com → **Settings** → **Limits** → monthly cap plus an alert at half of it.

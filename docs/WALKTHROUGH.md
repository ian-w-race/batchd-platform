# Batch'd security rollout — the complete steps

Updated 2026-09-21. This is the only document you need.

## Status

All pre-flight checks are done. Every question is answered:

| Check | Result |
|---|---|
| Platform admin exists | ✅ yours, active — no lock-out risk |
| Orphaned scans / stores | ✅ none |
| Duplicate memberships / invite tokens | ✅ none |
| Migration 019 | ✅ already applied (step 1 will be a no-op) |
| `send_invitation` | ⚠️ had **no authorisation check** — anyone could make themselves a corp admin of any org. **Fixed inside migration 020.** |
| `code_patterns` scoping | ✅ decided — deliberately left out, recorded as a follow-up |

**Nothing is live.** All code is on branch `security-hardening-2026-09`, not merged, not deployed.

There are **21 steps**: 11 to ship, 10 to test.

---

## Before you start

Open these tabs and leave them open:

1. **Supabase** — https://supabase.com/dashboard → click project `lurxucdmrugikdlvvebc`
2. **GitHub** — https://github.com/ian-w-race/batchd-platform
3. **Netlify** — https://app.netlify.com

**How to run a query in Supabase** (you'll do this several times):
left sidebar → **SQL Editor** → **+ New query** → click in the big box → **Cmd+V** → green **Run** button (or **Cmd+Enter**).
Always use **+ New query** for a fresh one rather than typing over the last.

Every `Run` button in this document only copies a file onto your clipboard. None of them change anything.

---

# SHIPPING — steps 1 to 11

## Step 1 — Migration 019 (~2 min)

Copy it:

    cat /Users/johnponchak/batchd-platform/migrations/019_lock_down_membership_policies.sql | pbcopy

New Supabase query → **Cmd+V** → **Run**.

Supabase shows an orange **"Query has destructive operation"** warning. Expected — the file drops old security policies. Click **Run this query**.

**Expected:** it reports nothing changed. This migration is already applied. Run it anyway — two seconds, removes all doubt.

*If you see `40P01 deadlock detected`:* harmless, someone had the dashboard open. Click Run again.

## Step 2 — Migration 020 (~3 min)

This is the big one. It also contains the `send_invitation` fix.

    cat /Users/johnponchak/batchd-platform/migrations/020_helpers_membership_ai_flag.sql | pbcopy

New query → paste → **Run** → confirm the destructive-operation warning.

**Now read the messages panel below the editor.** The last line must read exactly:

> `OK: 019 policies gone; 020 helpers, guards, invitation policies, hardened send_invitation and plan flag in place.`

🛑 **STOP AND MESSAGE ME IF:** any line starts with `SKIPPED`, or the last line differs. `SKIPPED` means existing data doesn't fit a new rule — not an error, but a safeguard didn't get created.

## Step 3 — Verify the takeover hole is closed (~1 min)

New query → paste this → **Run**:

```sql
SELECT prosecdef                                          AS security_definer,
       proconfig                                          AS search_path_pinned,
       position('Not authorised to invite' in prosrc) > 0 AS has_authorisation_check
FROM pg_proc WHERE proname = 'send_invitation';
```

**Expected:** `security_definer = true`, `search_path_pinned = {search_path=public}`, `has_authorisation_check = true`.

🛑 **STOP AND MESSAGE ME IF** `has_authorisation_check` is `false`. This is the most important fix in the whole release.

## Step 4 — Turn the plans on (~1 min)

    cat /Users/johnponchak/batchd-platform/migrations/020a_set_existing_orgs_pov.sql | pbcopy

New query → paste → **Run**.

**Expected:** `OK: 6 organisation(s) set to pov. Paying orgs on active and churned orgs were left alone.`

⚠️ **Do not skip this.** Without it, AI product recognition stops for every user the moment you deploy.

## Step 5 — Confirm the plans (~1 min)

New query → paste → **Run**:

```sql
SELECT name, plan FROM public.organisations ORDER BY plan, name;
```

Every one of the 9 rows should say `pov` or `active`.

🛑 **STOP AND MESSAGE ME IF** any still says `trial` or is blank.

## Step 6 — Check the environment variable on BOTH Netlify sites (~5 min)

In Netlify click **Sites** in the top nav. Two sites deploy this repo.

For **each** site:
1. Click the site name
2. Left sidebar → **Site configuration**
3. Left sidebar → **Environment variables**
4. Find `INTERNAL_NOTIFY_SECRET` in the list

**Both sites must have it, and the value must be the same.** Click the reveal/eye icon to compare. If one site is missing it, click **Add a variable** and copy the value across from the other.

Why this matters: recall alert emails now require this secret. If the site your ERP webhook hits doesn't have it, those emails stop and nothing visibly errors.

## Step 7 — Push the branch (~1 min)

    cd /Users/johnponchak/batchd-platform && git push -u origin security-hardening-2026-09

*If it asks for a username and password:* GitHub no longer accepts passwords here — you need a personal access token. Message me and I'll walk you through it.

## Step 8 — Open the pull request (~2 min)

Go to:
https://github.com/ian-w-race/batchd-platform/compare/main...security-hardening-2026-09

Click **Create pull request** → title it `Security hardening 2026-09` → click **Create pull request** again.

Netlify posts a **Deploy Preview** link within a minute or two. You can click it to look around, but the preview URL doesn't have your real domain routing, so the dashboard/scanner split won't behave normally there. Real testing happens after the merge.

## Step 9 — Merge (~1 min)

Click the green **Merge pull request** → **Confirm merge**.

## Step 10 — Wait for both deploys (~3 min)

Netlify → **each** of the two sites → **Deploys** tab. Wait until **both** show a green **Published**.

🛑 **Do not do step 11 until both say Published.** Migration 021 locks the stores table, and the code that keeps the scanner's store tab working ships in this deploy.

## Step 11 — Migration 021, the final one (~3 min)

    cat /Users/johnponchak/batchd-platform/migrations/021_tenant_tables_lockdown.sql | pbcopy

New query → paste → **Run** → confirm the destructive-operation warning.

The messages panel prints a lot of `BEFORE ...` lines (a record of the old rules) and `dropped open policy ...` lines. That's normal. The **last** line must read:

> `OK: no USING(true)/CHECK(true) policies remain on the tenant tables.`

🛑 **STOP AND MESSAGE ME IF** any line starts with `STILL OPEN:`.

---

# TESTING — tests 1 to 10 (~25 min)

## Test 1 — Internal files are no longer public

    curl -sI https://app.batchdapp.com/CLAUDE.md | head -1

✅ `HTTP/2 404` · ❌ anything else means the file is still being served to the world.

## Test 2 — Invitation tokens are no longer dumpable

Open https://batchd-app.netlify.app/ → press **F12** (or right-click → **Inspect**) → **Console** tab → paste and press Enter:

```
await (await fetch(SUPABASE_URL+'/rest/v1/invitations?select=token&limit=1',{headers:{apikey:SUPABASE_KEY}})).json()
```

✅ `[]` · ❌ if it returns invitation rows, 019/020 didn't apply.

## Test 3 — The takeover hole is closed (the important one)

You need a login that is **not** a platform admin — a staff or store-manager test account. If you don't have one, skip this; step 3 already proved the guard is in the function.

Sign into the scanner with that account, open the **Console**, paste and Enter:

```
await sb.rpc('send_invitation', {p_organisation_id:'925923b5-22c6-433c-8812-7e32918dab66', p_email:'test@example.com', p_role:'corp_admin', p_store_id:null})
```

✅ An `error` reading **"Not authorised to invite into this organisation."**
🛑 ❌ **If it returns a `token`, stop everything and message me** — that account can take over your organisation.

## Test 4 — Scanner, the core loop

https://batchd-app.netlify.app/ → sign in.
- Scan or enter a product, take the photo, save it → ✅ saves and appears in History
- History → open a scan → pull one from shelf → ✅ marks as removed

## Test 5 — Scanner, AI

On the scan screen, take a product photo.
- ✅ The product name auto-fills
- ❌ If you see the toast *"AI product recognition is not enabled for this organisation"*, that org's plan didn't get set — go back to step 5

## Test 6 — Scanner, store rename (broken today, should now work)

Manager view → **Store Management**.
- ✅ You only see your own stores
- Click **Rename** on any store → ✅ the dialog opens with the current name filled in. Before this change it opened blank for every store.

## Test 7 — Invitations

Dashboard (https://corporate.batchdapp.com/) → **Staff Activity** → invite someone, using an address you can check.
- ✅ Email arrives, naming your real organisation and your address as the inviter
- Open the link in a **private/incognito window**
- ✅ Watch the address bar: `?token=...` disappears shortly after the page loads
- Press **Cmd+R** to refresh → ✅ the form is still there (not "invitation not found")
- Complete it → ✅ it signs you in

## Test 8 — Recalls

Dashboard → push a recall from the composer → acknowledge it → close it. ✅ all three work.

## Test 9 — Signup

https://app.batchdapp.com/signup in a private window.
- ✅ Step 1 shows **only** a Retailer card — no Manufacturer card
- Complete it with a throwaway email → ✅ lands you in the dashboard

## Test 10 — Admin

https://app.batchdapp.com/admin.html
- ✅ You can sign in and see the customer list
- ✅ Open any org → the Plan dropdown has **POV** between Trial and Active
- ✅ The "Share with prospects" box with the demo password is gone
- ✅ **Invite admin** on any org still sends

---

# If something breaks

**Roll the code back:** Netlify → the site → **Deploys** → find the deploy from before the merge → **⋯** → **Publish deploy**. The old code works fine against the new database rules.

**The migrations generally don't need rolling back.** Each runs in a single transaction, so a failure applies nothing at all. If you ever truly need to undo 019, its rollback block is commented out at the bottom of that file.

**Anything unexpected:** copy the exact error text or take a screenshot and send it. Don't re-run a migration that errored until I've looked at it.

---

# Afterwards — two things not to forget

1. **Rotate the demo password.** Supabase → **Authentication** → **Users** → search `demo@batchdapp.com` → **Reset password**. The old one was printed in `admin.html`'s source and **is still in your git history**, so deleting it from the file wasn't enough.
2. **Cap the Anthropic spend.** console.anthropic.com → **Settings** → **Limits** → set a monthly cap and an email alert at half of it.

---

# Known follow-ups (not part of this release)

- **`code_patterns` ownership.** Any signed-in user can still update or delete any organisation's learned lot-code pattern. Closing it needs an ownership rule for shared patterns, a backfill for the 12 rows with no `organisation_id`, and an RLS policy — a migration 022. Left out deliberately: see `docs/SECURITY-ROLLOUT-2026-09.md` section 5.
- **Four of your nine organisations are `type=manufacturer`** test data from the retired side of the platform. Cleaning them up would make the admin list much easier to read.
- The remaining Medium findings from the review: two-factor on the dashboard, CSV formula neutralisation, a private photo bucket, the cron-singleton guard.

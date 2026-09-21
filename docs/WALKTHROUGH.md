# Batch'd security rollout — the complete steps

Updated 2026-09-21. This is the only document you need.

## Status

All pre-flight checks are done:

| Check | Result |
|---|---|
| Platform admin exists | ✅ yours, active — no lock-out risk |
| Orphaned scans / stores | ✅ none |
| Duplicate memberships / invite tokens | ✅ none |
| Migration 019 | ✅ already applied — step 2 will drop nothing |
| `send_invitation` | ⚠️ had **no authorisation check** — anyone could make themselves a corp admin of any org. **Fixed inside migration 020.** |
| `code_patterns` scoping | ✅ decided — deliberately left out, recorded as a follow-up |

**Nothing is live.** All code is on branch `security-hardening-2026-09`, not merged, not deployed.

**13 steps to ship, 10 to test.**

## What these migrations do and don't do

Across all four files there is **no** `DROP TABLE`, `TRUNCATE`, `DELETE FROM` or
`DROP COLUMN`. **No statement anywhere deletes a row.**

The many `DROP POLICY` lines remove *security rules* — "who may read this
table" — not data. That is the entire point: your tables currently carry rules
saying `USING (true)` ("everyone, always"), and these replace them with
org-scoped ones. The handful of `DROP FUNCTION` / `DROP TRIGGER` lines are each
followed by a `CREATE` of the same thing, in the same transaction.

There are exactly **three** statements that change data, all shown in step 1.

Every file runs inside one `BEGIN`/`COMMIT`. If any statement fails, Postgres
rolls the whole file back — you cannot end up half-migrated. That is also why
re-running any of them is safe.

---

## Before you start

Open these tabs and leave them open:

1. **Supabase** — https://supabase.com/dashboard → click project `lurxucdmrugikdlvvebc`
2. **GitHub** — https://github.com/ian-w-race/batchd-platform
3. **Netlify** — https://app.netlify.com

**How to run a query in Supabase** (you'll do this a lot):
left sidebar → **SQL Editor** → **+ New query** → click in the big box → **Cmd+V** → green **Run** (or **Cmd+Enter**).
Always use **+ New query** for a fresh one rather than typing over the last.

Every `Run` button below only copies a file onto your clipboard. None of them change anything.

---

# SHIPPING — steps 1 to 13

## Step 1 — Preview exactly what will change (~2 min) — READ-ONLY

Do this first. It changes nothing and you can run it as often as you like.

    cat /Users/johnponchak/batchd-platform/docs/preview-what-will-change.sql | pbcopy

New Supabase query → **Cmd+V** → **Run**.

You get one table. Sections 1–5 are security rules that will be dropped (for
021's dynamic loop it reuses the loop's own condition, so it is the exact list,
not an estimate). Sections 6–8 are the only data changes in the whole release:

- **6** — the six organisations going `trial` → `pov`
- **7** — organisations whose `api_key` gets blanked (a SHA-256 hash is kept, so existing ERP keys keep working)
- **8** — complaints being moved onto `receiving_org_id`, where the dashboard actually looks for them

If anything in that result surprises you, send it to me before going further.

**Optional but recommended:** Supabase → **Database** → **Backups**, and note
the current timestamp so you know your restore point.

## Step 2 — Migration 019 (~2 min)

    cat /Users/johnponchak/batchd-platform/migrations/019_lock_down_membership_policies.sql | pbcopy

New query → paste → **Run**.

Supabase shows an orange **"Query has destructive operation"** warning. Expected — the file contains `DROP POLICY`. Click **Run this query**.

**Expected:** nothing changes. This migration is already applied, and it is only those four `DROP POLICY` lines. Run it anyway — two seconds, removes all doubt.

*If you see `40P01 deadlock detected`:* harmless, someone had the dashboard open. Click Run again.

## Step 3 — Migration 020 (~3 min)

The big one. Also contains the `send_invitation` fix.

    cat /Users/johnponchak/batchd-platform/migrations/020_helpers_membership_ai_flag.sql | pbcopy

New query → paste → **Run** → confirm the destructive-operation warning.

**Read the messages panel below the editor.** The last line must read exactly:

> `OK: 019 policies gone; 020 helpers, guards, invitation policies, hardened send_invitation and plan flag in place.`

🛑 **Stop and message me if** any line starts `SKIPPED`, or the last line differs. `SKIPPED` means existing data doesn't fit a new rule — not an error, but a safeguard didn't get created.

## Step 4 — Verify the takeover hole is closed (~1 min)

New query → paste → **Run**:

```sql
SELECT prosecdef                                          AS security_definer,
       proconfig                                          AS search_path_pinned,
       position('Not authorised to invite' in prosrc) > 0 AS has_authorisation_check
FROM pg_proc WHERE proname = 'send_invitation';
```

**Expected:** `true`, `{search_path=public}`, `true`.

🛑 **Stop and message me if** `has_authorisation_check` is `false`. This is the single most important fix in the release.

## Step 5 — Turn the plans on (~1 min)

    cat /Users/johnponchak/batchd-platform/migrations/020a_set_existing_orgs_pov.sql | pbcopy

New query → paste → **Run**.

**Expected:** `OK: 6 organisation(s) set to pov. Paying orgs on active and churned orgs were left alone.`

⚠️ **Do not skip.** Without it, AI product recognition stops for every user the moment you deploy.

## Step 6 — Confirm the plans (~1 min)

New query → paste → **Run**:

```sql
SELECT name, plan FROM public.organisations ORDER BY plan, name;
```

All 9 rows should say `pov` or `active`.

🛑 **Stop and message me if** any still says `trial` or is blank.

## Step 7 — Check the environment variable on BOTH Netlify sites (~5 min)

Netlify → **Sites** in the top nav. Two sites deploy this repo.

For **each** site:
1. Click the site name
2. Left sidebar → **Site configuration**
3. Left sidebar → **Environment variables**
4. Find `INTERNAL_NOTIFY_SECRET`

**Both sites must have it, and the value must be identical.** Click the reveal/eye icon to compare. If one is missing it, click **Add a variable** and copy the value across from the other.

Why: recall alert emails now require this secret. If the site your ERP webhook hits doesn't have it, those emails stop and nothing visibly errors.

## Step 8 — Push the branch (~1 min)

    cd /Users/johnponchak/batchd-platform && git push -u origin security-hardening-2026-09

*If it asks for a username and password:* GitHub no longer accepts passwords here — you need a personal access token. Message me and I'll walk you through it.

## Step 9 — Open the pull request (~2 min)

Go to:
https://github.com/ian-w-race/batchd-platform/compare/main...security-hardening-2026-09

Click **Create pull request** → title it `Security hardening 2026-09` → click **Create pull request** again.

Netlify posts a **Deploy Preview** link within a minute or two. You can look around, but the preview URL doesn't have your real domain routing, so the dashboard/scanner split won't behave normally there. Real testing happens after the merge.

## Step 10 — Merge (~1 min)

Click green **Merge pull request** → **Confirm merge**.

## Step 11 — Wait for both deploys (~3 min)

Netlify → **each** of the two sites → **Deploys** tab. Wait until **both** show a green **Published**.

🛑 **Do not go further until both say Published.** Migration 021 locks the stores table, and the code that keeps the scanner's store tab working ships in this deploy.

## Step 12 — Save the ERP API keys (~1 min)

Migration 021 replaces the plaintext keys with one-way hashes. Existing keys keep working, but the plaintext will no longer exist in the database. Take a copy first:

```sql
SELECT id, name, api_key FROM public.organisations WHERE api_key IS NOT NULL;
```

Save the result somewhere safe (a password manager). If step 1 section 7 was empty, this returns nothing and you can skip it.

## Step 13 — Migration 021, the final one (~3 min)

    cat /Users/johnponchak/batchd-platform/migrations/021_tenant_tables_lockdown.sql | pbcopy

New query → paste → **Run** → confirm the destructive-operation warning.

The messages panel prints a lot of `BEFORE ...` lines (a record of the old rules) and `dropped open policy ...` lines. That is normal and is exactly what step 1 predicted. The **last** line must read:

> `OK: no USING(true)/CHECK(true) policies remain on the tenant tables.`

🛑 **Stop and message me if** any line starts with `STILL OPEN:`.

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

You need a login that is **not** a platform admin — a staff or store-manager test account. If you don't have one, skip; step 4 already proved the guard is in the function.

Sign into the scanner with that account, open the **Console**, paste and Enter:

```
await sb.rpc('send_invitation', {p_organisation_id:'925923b5-22c6-433c-8812-7e32918dab66', p_email:'test@example.com', p_role:'corp_admin', p_store_id:null})
```

✅ An `error` reading **"Not authorised to invite into this organisation."**
🛑 ❌ **If it returns a `token`, stop everything and message me** — that account can take over your organisation.

## Test 4 — Scanner, the core loop

https://batchd-app.netlify.app/ → sign in.
- Scan or enter a product, take the photo, save → ✅ saves and appears in History
- History → open a scan → pull one from shelf → ✅ marks as removed

## Test 5 — Scanner, AI

On the scan screen, take a product photo.
- ✅ The product name auto-fills
- ❌ If you see *"AI product recognition is not enabled for this organisation"*, that org's plan didn't get set — go back to step 6

## Test 6 — Scanner, store rename (broken today, should now work)

Manager view → **Store Management**.
- ✅ You only see your own stores
- Click **Rename** on any store → ✅ the dialog opens with the current name filled in. Before this change it opened blank for every store.

## Test 7 — Invitations

Dashboard (https://corporate.batchdapp.com/) → **Staff Activity** → invite someone, using an address you can check.
- ✅ Email arrives, naming your real organisation and your address as the inviter
- Open the link in a **private/incognito window**
- ✅ Watch the address bar: `?token=...` disappears shortly after the page loads
- Press **Cmd+R** → ✅ the form is still there (not "invitation not found")
- Complete it → ✅ it signs you in

## Test 8 — Recalls

Dashboard → push a recall from the composer → acknowledge it → close it. ✅ all three work.

## Test 9 — Signup

https://app.batchdapp.com/signup in a private window.
- ✅ Step 1 shows **only** a Retailer card — no Manufacturer card
- Complete with a throwaway email → ✅ lands in the dashboard

## Test 10 — Admin, including creating an organisation

https://app.batchdapp.com/admin.html
- ✅ You can sign in and see the customer list
- ✅ Open any org → the Plan dropdown has **POV** between Trial and Active
- ✅ The "Share with prospects" box with the demo password is gone
- ✅ **Invite admin** on any org still sends
- ✅ **Create a throwaway organisation.** 021 drops the old
  `Authenticated users can create an organisation` policy (it let *any*
  signed-in account insert *any* organisation row). Your admin path works
  instead through the new platform-admin policy, so this proves it. Delete the
  test org afterwards, or leave it — it costs nothing.

## Test 11 — Self-serve signup still creates an organisation

Already covered by test 9, but this is the other half of the same question:
signup works through the `create_organisation_with_admin` function, which is
`SECURITY DEFINER` and bypasses row-level security, so the dropped policy does
not affect it. If test 9 put you in a dashboard with your new org's name in the
corner, this path is proven.

---

# If something breaks

**Roll the code back:** Netlify → the site → **Deploys** → the deploy from before the merge → **⋯** → **Publish deploy**. The old code works fine against the new database rules.

**The migrations generally don't need rolling back.** Each runs in one transaction, so a failure applies nothing at all. If you ever truly need to undo 019, its rollback block is commented out at the bottom of that file.

**Anything unexpected:** copy the exact error text or screenshot it and send it. Don't re-run a migration that errored until I've looked at it.

---

# Afterwards — two things not to forget

1. **Rotate the demo password.** Supabase → **Authentication** → **Users** → search `demo@batchdapp.com` → **Reset password**. The old one was printed in `admin.html`'s source and **is still in your git history**, so deleting it from the file wasn't enough.
2. **Cap the Anthropic spend.** console.anthropic.com → **Settings** → **Limits** → monthly cap plus an email alert at half of it.

---

# Known follow-ups (not this release)

- **`code_patterns` ownership.** Any signed-in user can still update or delete any organisation's learned lot-code pattern. Closing it needs an ownership rule for shared patterns, a backfill for the 12 rows with no `organisation_id`, and an RLS policy — a migration 022. Left out deliberately: see `docs/SECURITY-ROLLOUT-2026-09.md` section 5.
- **Four of your nine organisations are `type=manufacturer`** test data from the retired side of the platform. Cleaning them up would make the admin list much easier to read.
- Remaining Medium findings from the review: two-factor on the dashboard, CSV formula neutralisation, a private photo bucket, the cron-singleton guard.

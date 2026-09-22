# Batch'd security rollout — all steps

Updated 2026-09-21. **You are here: step 8.**

## Progress

| | Step | Status |
|---|---|---|
| 1 | Preview what will change | ✅ done |
| 2 | Migration 019 | ✅ done |
| 3 | Migration 020 | ✅ done |
| 4 | Verify 020 | ✅ done — all 9 PASS, nothing skipped. **The org-takeover hole is closed.** |
| 5 | Turn the plans on | ✅ done |
| 6 | Confirm the plans | ✅ done |
| 7 | Netlify env vars, all THREE sites | ✅ done |
| 8 | Push the branch | ⬅️ **you are here** |
| 9 | Open the pull request | |
| 10 | Merge | |
| 11 | Wait for both deploys | |
| 12 | Save the ERP API keys | |
| 13 | Migration 021 + verify | |
| — | Tests 1–11 | |

## Two things to know

**Supabase does not display `RAISE NOTICE` output.** A migration that worked
shows **`Success. No rows returned`**. That is what success looks like. Each
migration is followed by a verify query that returns real rows.

**No statement in any of these files deletes a row.** No `DROP TABLE`,
`TRUNCATE`, `DELETE FROM` or `DROP COLUMN` anywhere. `DROP POLICY` removes a
*security rule*, not data. Every file runs in one `BEGIN`/`COMMIT`, so a failure
rolls the whole thing back and you cannot end up half-migrated.

## How to run a query in Supabase

Left sidebar → **SQL Editor** → **+ New query** → click in the big box →
**Cmd+V** → green **Run** (or **Cmd+Enter**). Always **+ New query** rather than
typing over the last one.

Tabs to keep open:
- **Supabase** — https://supabase.com/dashboard → project `lurxucdmrugikdlvvebc`
- **GitHub** — https://github.com/ian-w-race/batchd-platform
- **Netlify** — https://app.netlify.com

---

# ✅ Step 1 — Preview what will change — DONE

    cat /Users/johnponchak/batchd-platform/docs/preview-what-will-change.sql | pbcopy

Read-only. Shows every policy that will be dropped and the only three data
changes in the release. Re-run any time.

# ✅ Step 2 — Migration 019 — DONE

    cat /Users/johnponchak/batchd-platform/migrations/019_lock_down_membership_policies.sql | pbcopy

# ✅ Step 3 — Migration 020 — DONE

    cat /Users/johnponchak/batchd-platform/migrations/020_helpers_membership_ai_flag.sql | pbcopy

# ✅ Step 4 — Verify 020 — DONE, all 9 PASS

    cat /Users/johnponchak/batchd-platform/docs/verify-020.sql | pbcopy

All four CHECK constraints and both unique indexes applied, so your existing
data was already clean. `send_invitation` is hardened.

---

# ✅ Step 5 — Turn the plans on — DONE

    cat /Users/johnponchak/batchd-platform/migrations/020a_set_existing_orgs_pov.sql | pbcopy

New query → paste → **Run**. Expect **`Success. No rows returned`**.

⚠️ **Do not skip.** Without it, AI product recognition stops for every user the
moment you deploy.

# ✅ Step 6 — Confirm the plans — DONE

New query → paste → **Run**:

```sql
SELECT name, plan FROM public.organisations ORDER BY plan, name;
```

All 9 rows should read `pov` or `active` — 3 staying `active` (Batch'd Admin,
Batch'd Demo, Test Manufacturer Co) and 6 flipping to `pov`.

🛑 **Stop and message me if** any still says `trial` or is blank.

# ✅ Step 7 — Environment variables on ALL THREE Netlify sites — DONE

Confirmed 2026-09-21: **three** sites deploy this repo, not two as the docs
previously said. All three show `github.com/ian-w-race/batchd-platform`.

## 7a — `INTERNAL_NOTIFY_SECRET` on all three

Netlify → **Sites**. For **each** of the three:
1. Click the site name
2. Left sidebar → **Site configuration**
3. Left sidebar → **Environment variables**
4. Find `INTERNAL_NOTIFY_SECRET`

**All three must have it, with an identical value.** Click the reveal/eye icon
to compare.

**If it does not exist anywhere (confirmed 2026-09-21 — it didn't), create it:**

    openssl rand -hex 32 | tr -d '\n' | pbcopy

That puts a 64-character random secret on your clipboard without printing it.
**Do not copy anything else until you have pasted it into all three sites.**
Save it to a password manager too.

Then on each site: **Add a variable** → **Add a single variable** →
key `INTERNAL_NOTIFY_SECRET` → value **Cmd+V** → scopes must include
**Functions** → **Same value for all deploy contexts** → **Create variable**.

Don't tick "Contains secret values" on the first one — Netlify then hides the
value and you can't read it back to confirm the other two match. Add it to all
three first, mark it secret afterwards if you want.

Why it matters:
- `push-recall-email` now **requires** it and fails closed, so the ERP webhook's
  recall alert emails don't send without it.
- `notify-event` already required it and already failed closed, which means
  `triage-complaint`'s `complaint_filed` notifications to corp admins and store
  managers **have never been sent**. Setting this fixes that too.
- `triage-complaint` also uses it to salt the complaint IP hash. Changing it
  later only resets public rate-limit counters.

**Also check on each site:** Site configuration → **Build & deploy** →
**Branch to deploy**. The repo has a `staging` branch; any site watching it
rather than `main` will not pick up the merge in step 10 and will keep running
old code against the new database rules.

## 7b — `SCHEDULED_FUNCTIONS_DISABLED` on all three (check, don't change yet)

On the same screen, note whether `SCHEDULED_FUNCTIONS_DISABLED` exists and what
it is set to, for each site.

`netlify.toml` arms `recall-escalation` (every 30 minutes) and
`fetch-recall-feeds` (daily) on **every** site that deploys it. Exactly **one**
site should be missing this variable or have it `false`; the other two must have
it `true`.

- Missing/false on more than one site → stores receive **duplicate** recall
  escalation emails
- `true` on all three → escalation emails and the daily feed import **never run**

This is a pre-existing condition, not something this release introduces. Report
what you find before changing it.

# ⬅️ Step 8 — Push the branch (~5 min)

    cd /Users/johnponchak/batchd-platform && git push -u origin security-hardening-2026-09

GitHub no longer accepts passwords for git. If you get
`Invalid username or token`, you need a **classic** personal access token.

**It must be a classic token, not a fine-grained one.** Fine-grained tokens only
reach repos owned by the token's own account; this repo belongs to `ian-w-race`
and you push as `John-ponchak`, so only a classic token works.

## 8a — Create the token

Open **https://github.com/settings/tokens/new**
(If you land on "Fine-grained tokens", click **Tokens (classic)** in the left
sidebar → **Generate new token (classic)**.)

- **Note:** `batchd-platform push`
- **Expiration:** 90 days
- **Scopes:** tick the top-level **`repo`** checkbox — that is the only one needed
- Scroll down → **Generate token**

Copy it now; GitHub shows it once. **Do not paste it into chat.**

## 8b — Push again

    cd /Users/johnponchak/batchd-platform && git push -u origin security-hardening-2026-09

- **Username:** `John-ponchak`
- **Password:** paste the **token**

Nothing appears as you paste — that is normal. Press Enter. `osxkeychain` is
already configured, so it is saved and you won't be asked again.

## 8c — If it fails again

| Error | Meaning | Fix |
|---|---|---|
| `Invalid username or token` | Wrong username, or token not copied fully | Username is `John-ponchak`; regenerate the token |
| `403` / `Permission denied` | Token valid, but your account lacks **write** access | Ian must add you as a collaborator with Write on `ian-w-race/batchd-platform` (repo Settings → Collaborators) |
| No prompt at all | Stale keychain entry | Clear it, then retry the push |

Clear a stale credential:

    printf "protocol=https\nhost=github.com\n\n" | git credential reject

# Step 9 — Open the pull request (~2 min)

Go to:
https://github.com/ian-w-race/batchd-platform/compare/main...security-hardening-2026-09

**Create pull request** → title it `Security hardening 2026-09` → **Create pull
request** again.

Netlify posts a **Deploy Preview** link within a minute or two. You can look
around, but the preview URL doesn't have your real domain routing, so the
dashboard/scanner split won't behave normally there. Real testing happens after
the merge.

# Step 10 — Merge (~1 min)

Green **Merge pull request** → **Confirm merge**.

# Step 11 — Wait for both deploys (~3 min)

Netlify → **each** of the two sites → **Deploys** tab. Wait until **both** show
a green **Published**.

🛑 **Do not go further until both say Published.** Migration 021 locks the stores
table, and the code that keeps the scanner's store tab working ships in this
deploy.

# Step 12 — Save the ERP API keys (~1 min)

Migration 021 replaces plaintext keys with one-way hashes. Existing keys keep
working, but the plaintext won't exist in the database afterwards. Copy them
first:

```sql
SELECT id, name, api_key FROM public.organisations WHERE api_key IS NOT NULL;
```

Save the result to a password manager. If step 1 section 7 was empty, this
returns nothing and you can skip it.

# Step 13 — Migration 021, the final one (~3 min)

    cat /Users/johnponchak/batchd-platform/migrations/021_tenant_tables_lockdown.sql | pbcopy

New query → paste → **Run** → confirm the destructive-operation warning.
Expect **`Success. No rows returned`**.

Then verify it:

    cat /Users/johnponchak/batchd-platform/docs/verify-021.sql | pbcopy

New query → paste → **Run**. You get 7 rows. **Every one must say `PASS`**, in
particular `NO open policies left on tenant tables`.

🛑 **Stop and message me if any row says `*** FAIL ***`.**

---

# TESTING — tests 1 to 11 (~25 min)

## Test 1 — Internal files are no longer public

    curl -sI https://app.batchdapp.com/CLAUDE.md | head -1

✅ `HTTP/2 404` · ❌ anything else means the file is still being served.

## Test 2 — Invitation tokens are no longer dumpable

https://batchd-app.netlify.app/ → **F12** (or right-click → **Inspect**) →
**Console** tab → paste and Enter:

```
await (await fetch(SUPABASE_URL+'/rest/v1/invitations?select=token&limit=1',{headers:{apikey:SUPABASE_KEY}})).json()
```

✅ `[]` · ❌ if it returns invitation rows.

## Test 3 — The takeover hole is closed (the important one)

Needs a login that is **not** a platform admin — a staff or store-manager test
account. If you don't have one, skip; step 4 already proved the guard is in the
function.

Sign into the scanner with that account, **Console**, paste and Enter:

```
await sb.rpc('send_invitation', {p_organisation_id:'925923b5-22c6-433c-8812-7e32918dab66', p_email:'test@example.com', p_role:'corp_admin', p_store_id:null})
```

✅ An `error` reading **"Not authorised to invite into this organisation."**
🛑 ❌ **If it returns a `token`, stop everything and message me.**

## Test 4 — Scanner, the core loop

https://batchd-app.netlify.app/ → sign in.
- Scan or enter a product, take the photo, save → ✅ saves and appears in History
- History → open a scan → pull one from shelf → ✅ marks as removed

## Test 5 — Scanner, AI

Take a product photo on the scan screen.
- ✅ The product name auto-fills
- ❌ If you see *"AI product recognition is not enabled for this organisation"*,
  that org's plan didn't get set — go back to step 6

## Test 6 — Scanner, store rename (broken today, should now work)

Manager view → **Store Management**.
- ✅ You only see your own stores
- Click **Rename** on any store → ✅ the dialog opens with the current name
  filled in. Before this change it opened blank for every store.

## Test 7 — Invitations

Dashboard (https://corporate.batchdapp.com/) → **Staff Activity** → invite
someone, using an address you can check.
- ✅ Email arrives, naming your real organisation and your address as the inviter
- Open the link in a **private/incognito window**
- ✅ Watch the address bar: `?token=...` disappears shortly after the page loads
- Press **Cmd+R** → ✅ the form is still there (not "invitation not found")
- Complete it → ✅ it signs you in

## Test 8 — Recalls

Dashboard → push a recall from the composer → acknowledge it → close it.
✅ all three work.

## Test 9 — Signup creates an organisation

https://app.batchdapp.com/signup in a private window.
- ✅ Step 1 shows **only** a Retailer card — no Manufacturer card
- Complete with a throwaway email → ✅ lands in the dashboard

This also proves that dropping the old "Authenticated users can create an
organisation" policy was safe: signup works through
`create_organisation_with_admin`, which is `SECURITY DEFINER` and bypasses
row-level security.

## Test 10 — Admin, including creating an organisation

https://app.batchdapp.com/admin.html
- ✅ You can sign in and see the customer list
- ✅ Open any org → the Plan dropdown has **POV** between Trial and Active
- ✅ The "Share with prospects" box with the demo password is gone
- ✅ **Invite admin** on any org still sends
- ✅ **Create a throwaway organisation** — proves the other org-creation path,
  which now runs through the new platform-admin policy

## Test 11 — Consumer Notify

Dashboard → **Consumer Notify** → pick a recall → send to one test address.
✅ It sends. The recall picker should only offer open recalls, or ones closed
within the last 30 days.

---

# If something breaks

**Roll the code back:** Netlify → the site → **Deploys** → the deploy from
before the merge → **⋯** → **Publish deploy**. The old code works fine against
the new database rules.

**The migrations generally don't need rolling back.** Each runs in one
transaction, so a failure applies nothing at all. If you ever truly need to undo
019, its rollback block is commented out at the bottom of that file.

**Anything unexpected:** copy the exact error text or screenshot it and send it.
Don't re-run a migration that errored until I've looked at it.

---

# Afterwards — two things not to forget

1. **Rotate the demo password.** Supabase → **Authentication** → **Users** →
   search `demo@batchdapp.com` → **Reset password**. The old one was printed in
   `admin.html`'s source and **is still in your git history**, so deleting it
   from the file wasn't enough.
2. **Cap the Anthropic spend.** console.anthropic.com → **Settings** →
   **Limits** → monthly cap plus an email alert at half of it.

---

# Known follow-ups (not this release)

- **`code_patterns` ownership.** Any signed-in user can still update or delete
  any organisation's learned lot-code pattern. Closing it needs an ownership
  rule, a backfill for the 12 rows with no `organisation_id`, and an RLS policy
  — a migration 022.
- **Four of your nine organisations are `type=manufacturer`** test data from the
  retired side of the platform.
- Remaining Medium findings: two-factor on the dashboard, CSV formula
  neutralisation, a private photo bucket, the cron-singleton guard.

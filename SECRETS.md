# Secrets & environment variables

Runbook for the Netlify environment variables the platform depends on.
**Never put secret values in this file, in code, or in commits** — this
documents what each one is, where it's used, and how to rotate it.

Set/inspect at: Netlify → Site settings → Environment variables.

⚠️ **THREE Netlify sites deploy this repo** (verified 2026-09-21). Every
variable below must exist with the SAME value on all three, except
`SCHEDULED_FUNCTIONS_DISABLED`, which is deliberately different per site.

| Variable | Used by | What it is | Rotation |
|---|---|---|---|
| `SUPABASE_SERVICE_KEY` | All functions that read/write the DB (`recall-*`, `notify-*`, `ai-analyze`, `ocr`, `fetch-recall-feeds`, `send-invite`, `triage-complaint`, …) | Supabase **service-role** key — bypasses RLS. The most sensitive secret in the stack. | Supabase → Project Settings → API → rotate service role key, then update here. Everything server-side breaks until updated. |
| `SUPABASE_ANON_KEY` | No longer read by any function (its only reader, supplier-invite, was deleted 2026-09-20) | Supabase anon (public) key — same value that's embedded in the HTML apps. Not actually secret. | Rotating it also requires updating the inline key in `index.html` / `dashboard.html` / `join.html` / `signup.html`. |
| `SUPABASE_URL` | Functions (optional — they fall back to the hardcoded project URL) | Supabase project URL. Not secret. | Only changes if the Supabase project changes. |
| `RESEND_API_KEY` | `recall-escalation`, `recall-reminder`, `notify-event`, `notify-consumers`, `send-invite`, `triage-complaint`, `push-recall-email` | Resend email API key. **Was leaked and rotated 2026-05-27** — never hardcode a fallback again. | Resend dashboard → API keys → create new, update in Netlify, delete old. |
| `ANTHROPIC_API_KEY` | `ai-analyze`, `ocr` | Anthropic API key for AI product identification / NL query. Billing-sensitive. | console.anthropic.com → API keys. |
| `INTERNAL_NOTIFY_SECRET` | `notify-event`, `push-recall-email` (required, fails closed), `triage-complaint` (also salts the complaint IP hash) | Shared secret allowing internal functions to trigger notifications without a user JWT. **Must exist on BOTH Netlify sites with the same value** — push-recall-email rejects the ERP webhook's alert without it. Changing it re-salts complaints.ip_hash, which only resets public rate-limit counters. | Generate a new long random string, update in Netlify — used only inside this site, so no external coordination needed. |
| `APP_BASE_URL` | Email templates (links back to the dashboard) | Public dashboard URL; defaults to `https://corporate.batchdapp.com`. Not secret. | — |
| `SCHEDULED_FUNCTIONS_DISABLED` | `recall-escalation`, `fetch-recall-feeds` | Cron-singleton switch. **THREE** Netlify sites deploy this repo (corrected 2026-09-21; this file previously said two), and every one of them arms the netlify.toml schedules. Set to `true` on all sites EXCEPT the single one designated to run crons. Missing on more than one site = duplicate escalation emails to stores. `true` on all three = no escalation emails and no feed imports at all. Verify in the Netlify UI. | — |
| MapTiler key (in `dashboard.html`, not an env var) | The shared store-map renderer (Command Center / Store Network / recall detail) | **Publishable** map-tile key, embedded client-side BY DESIGN and locked to our domains via MapTiler's allowed-HTTP-origins list (cloud.maptiler.com → API Keys). Same category as the Supabase anon key — an audit finding it in the HTML is a false alarm. | Rotate in MapTiler's dashboard + update `_MAPTILER_KEY` in dashboard.html if abused; free tier = 100k tiles/month, usage visible in MapTiler Analytics. |
| `URL` | `fetch-recall-feeds` (self-calls the recall-feeds proxy) | **Set automatically by Netlify** to the site's primary URL. Do not create manually. | — |

## Deleted 2026-09-20

`bootstrap-off-seed`, `investigation-notify`, `manufacturer-welcome`,
`supplier-invite`, `staff-invite` and `staff-invite-accept` were removed
from the repo. `BOOTSTRAP_ADMIN_TOKEN` can be deleted from Netlify; no
code reads it any more.

The demo account password (`demo@batchdapp.com`) was removed from
admin.html on the same date. It is still in git history, so it must be
rotated in Supabase → Authentication → Users, not just deleted.

## Rotation cadence

- Rotate `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, and `ANTHROPIC_API_KEY`
  **immediately** if a laptop is lost, a suspicious commit appears, or a
  function log ever prints a key.
- Otherwise rotate the three above **every 6 months** (next: February 2027).
- After any rotation: trigger a Netlify redeploy, then run one smoke test
  (send a recall reminder, run an NL query, scan one product).

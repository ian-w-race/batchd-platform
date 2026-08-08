# Secrets & environment variables

Runbook for the Netlify environment variables the platform depends on.
**Never put secret values in this file, in code, or in commits** — this
documents what each one is, where it's used, and how to rotate it.

Set/inspect at: Netlify → Site settings → Environment variables.

| Variable | Used by | What it is | Rotation |
|---|---|---|---|
| `SUPABASE_SERVICE_KEY` | All functions that read/write the DB (`recall-*`, `notify-*`, `ai-analyze`, `ocr`, `fetch-recall-feeds`, `send-invite`, `triage-complaint`, …) | Supabase **service-role** key — bypasses RLS. The most sensitive secret in the stack. | Supabase → Project Settings → API → rotate service role key, then update here. Everything server-side breaks until updated. |
| `SUPABASE_ANON_KEY` | A few functions using client-grade access | Supabase anon (public) key — same value that's embedded in the HTML apps. Not actually secret. | Rotating it also requires updating the inline key in `index.html` / `dashboard.html` / `join.html` / `signup.html`. |
| `SUPABASE_URL` | Functions (optional — they fall back to the hardcoded project URL) | Supabase project URL. Not secret. | Only changes if the Supabase project changes. |
| `RESEND_API_KEY` | `recall-escalation`, `recall-reminder`, `notify-event`, `notify-consumers`, `send-invite`, `investigation-notify` | Resend email API key. **Was leaked and rotated 2026-05-27** — never hardcode a fallback again. | Resend dashboard → API keys → create new, update in Netlify, delete old. |
| `ANTHROPIC_API_KEY` | `ai-analyze`, `ocr` | Anthropic API key for AI product identification / NL query. Billing-sensitive. | console.anthropic.com → API keys. |
| `INTERNAL_NOTIFY_SECRET` | `notify-event` (server-to-server calls from other functions) | Shared secret allowing internal functions to trigger notifications without a user JWT. | Generate a new long random string, update in Netlify — used only inside this site, so no external coordination needed. |
| `BOOTSTRAP_ADMIN_TOKEN` | `bootstrap-off-seed` | Token guarding the one-off seeding endpoint. | If the seeding function is no longer needed, prefer deleting the function over keeping the token. |
| `APP_BASE_URL` | Email templates (links back to the dashboard) | Public dashboard URL; defaults to `https://corporate.batchdapp.com`. Not secret. | — |
| `SCHEDULED_FUNCTIONS_DISABLED` | `recall-escalation`, `fetch-recall-feeds` | Cron-singleton switch: two Netlify sites deploy this repo, and both arm the netlify.toml schedules. Set to `true` on every site EXCEPT the one designated to run crons (the www.batchdapp.com site). If this is set to `true` on ALL sites, no escalation emails and no feed imports run at all. | — |
| `URL` | `fetch-recall-feeds` (self-calls the recall-feeds proxy) | **Set automatically by Netlify** to the site's primary URL. Do not create manually. | — |

## Rotation cadence

- Rotate `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, and `ANTHROPIC_API_KEY`
  **immediately** if a laptop is lost, a suspicious commit appears, or a
  function log ever prints a key.
- Otherwise rotate the three above **every 6 months** (next: February 2027).
- After any rotation: trigger a Netlify redeploy, then run one smoke test
  (send a recall reminder, run an NL query, scan one product).

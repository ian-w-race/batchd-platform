-- 013_user_notification_prefs.sql
--
-- Settings backlog item #1 (2026-05):
-- Per-user opt-in/out for the three email notification events Ian
-- decided to wire (a, c, d from the May 2026 settings backlog):
--   - recall_pushed:    a recall is pushed in my org (a)
--   - complaint_filed:  a complaint is filed at my store (c)
--   - drill_scheduled:  a mock drill is launched (d)
--
-- Single JSONB column instead of three booleans so the schema can grow
-- without further migrations as new event types are added. Reader
-- treats absent keys as TRUE (default-on), so new event types added
-- in code (without re-writing every row) still fire emails until a
-- user opts out.
--
-- Email delivery: see netlify/functions/notify-event.js. Receivers
-- scoped per event type (corp_admin always; store_manager for events
-- touching their stores; floor staff currently excluded — they get
-- in-app alerts via the scanner instead).
--
-- Safe to re-run.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb
    DEFAULT '{"recall_pushed":true,"complaint_filed":true,"drill_scheduled":true}'::jsonb;

COMMENT ON COLUMN public.user_settings.notification_prefs IS
  'Per-user email notification opt-in/out toggles. JSONB so new event types can be added without further migrations. Default: all three keys = true. Keys: recall_pushed, complaint_filed, drill_scheduled. Reader (notify-event.js) treats absent keys as TRUE — new event types ship default-on unless a user explicitly opts out.';

-- Done.

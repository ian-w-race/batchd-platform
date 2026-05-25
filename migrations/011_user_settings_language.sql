-- 011_user_settings_language.sql
--
-- Adds an optional user-level language preference column so a user's
-- chosen UI language survives device switches. Currently the scanner
-- app stores language in localStorage (per-device) and the dashboard
-- has no UI for language at all. This column lets both surfaces read
-- the same persisted value once they're wired up to it.
--
-- Values: 'en' (English, default) | 'no' (Norwegian). Other ISO 639-1
-- codes are allowed (TEXT, no CHECK constraint) so future locales can
-- be added without a migration.
--
-- Safe to re-run.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS language text;

COMMENT ON COLUMN public.user_settings.language IS
  'Optional UI-language preference (ISO 639-1: en, no, etc.). NULL means "use device default / browser locale". Currently surfaced in the corporate dashboard Settings → Your preferences panel; the scanning app will read it on next deploy to honour cross-device language continuity.';

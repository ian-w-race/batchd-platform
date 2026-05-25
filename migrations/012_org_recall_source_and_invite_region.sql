-- 012_org_recall_source_and_invite_region.sql
--
-- Settings backlog (2026-05):
--   §1  Promote recall_source from user_settings to organisations.
--       Compliance decisions belong at org level — staff inherit the
--       same feed selection so the whole org agrees on which
--       regulatory data feeds (FDA, Mattilsynet, both) drive recalls.
--       This mirrors the existing precedent for recall_lookback_days
--       (index.html: "compliance decisions belong at org level, not
--       individual level").
--
--   §2  Add invitations.region so a corp admin inviting staff can
--       pick the invitee's default region per-invite. NULL means
--       "inherit org.region at accept time" — same behavior as
--       before this column existed.
--
--   §3  Add user_settings.date_format so users can explicitly choose
--       a date format instead of inheriting from their region. NULL
--       means "auto — derive from region" (the existing _dashLocale()
--       behaviour).
--
-- After this migration runs:
--   - public.organisations.recall_source exists (text, default 'both',
--     check constraint on the three valid values).
--   - public.invitations.region exists (text, nullable, check
--     constraint on 'us'/'no'/NULL).
--   - Existing per-user user_settings.recall_source values are left
--     in place — they become inert (no longer read by the scanner)
--     but are preserved for audit. A future migration may drop them.
--
-- Safe to re-run (ADD COLUMN IF NOT EXISTS + ALTER COLUMN ... is
-- idempotent; CHECK constraints use DO blocks to avoid duplicate
-- constraint errors on re-run).

-- ════════════════════════════════════════════════════════════════════
-- §1  organisations.recall_source
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS recall_source text NOT NULL DEFAULT 'both';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organisations_recall_source_check'
  ) THEN
    ALTER TABLE public.organisations
      ADD CONSTRAINT organisations_recall_source_check
      CHECK (recall_source IN ('fda', 'mattilsynet', 'both'));
  END IF;
END$$;

COMMENT ON COLUMN public.organisations.recall_source IS
  'Which regulatory recall feeds Batch''d ingests for this org. ''fda'' = US FDA enforcement reports only; ''mattilsynet'' = Norway Mattilsynet + RASFF only; ''both'' = both (default — recommended for multi-region operators). Staff/managers inherit this org-wide; no per-user override.';

-- ════════════════════════════════════════════════════════════════════
-- §2  invitations.region
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS region text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invitations_region_check'
  ) THEN
    ALTER TABLE public.invitations
      ADD CONSTRAINT invitations_region_check
      CHECK (region IS NULL OR region IN ('us', 'no'));
  END IF;
END$$;

COMMENT ON COLUMN public.invitations.region IS
  'Default region for the invitee on acceptance. NULL means "inherit organisations.region at accept time" (the original behaviour). Set explicitly when a corp admin wants to invite, e.g., a Norwegian staff member into a US-default org. Written to user_settings.region by join.html on accept.';

-- ════════════════════════════════════════════════════════════════════
-- §3  user_settings.date_format
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS date_format text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_settings_date_format_check'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_date_format_check
      CHECK (date_format IS NULL OR date_format IN ('auto', 'us', 'eu'));
  END IF;
END$$;

COMMENT ON COLUMN public.user_settings.date_format IS
  'Explicit date-format preference. NULL or "auto" means inherit from region (US → MM/DD/YYYY, NO → DD/MM/YYYY). "us" = en-US locale (MM/DD/YYYY), "eu" = en-GB locale (DD/MM/YYYY). The dashboard''s _dashLocale() helper reads this and maps it to a BCP-47 locale tag. ISO format was considered but removed because the codebase passes month-name options to toLocaleDateString in many places, which would produce localised month names under sv-SE rather than pure ISO numerics; a future refactor could re-introduce it with a dedicated formatter.';

-- Done.

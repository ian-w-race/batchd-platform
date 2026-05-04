-- ════════════════════════════════════════════════════════════════════════════
-- Migration 005: scan_telemetry table for Phase 3 validation gate
-- Phase 3 of refactor plan v2 — production validation observation period
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES
--
-- Creates `scan_telemetry` — a lightweight table that records, per-scan,
-- which identification path was taken (ZXing success vs AI label fallback) and
-- how long it took. Populated by the scanner client; queried to evaluate the
-- Phase 3 validation gate criterion: "ZXing succeeds on at least 80% of real
-- scans" before proceeding to Phase 4 (OCR pipeline collapse).
--
-- CRITICAL — DO NOT SKIP PHASE 3
--
-- Per plan v2: Phase 4 deletes the working 5-call OCR pipeline. The new single-
-- call pipeline relies on Phase 1's product identification being reliable enough
-- to provide useful priors. If ZXing isn't actually succeeding most of the time,
-- the OCR collapse will degrade accuracy. This telemetry is the data we use to
-- decide whether to proceed.
--
-- HOW TO APPLY
--
-- 1. Open Supabase dashboard → SQL Editor
-- 2. Paste the entire file into a new query
-- 3. Click "Run"
-- 4. Verify with the SELECT statements at the bottom
-- 5. Then ship the corresponding index.html changes (separate commit) — those
--    add the client-side INSERT calls
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Step 1: Telemetry table ───────────────────────────────────────────────
-- Lightweight: one row per identification attempt (saved scan or abandoned).
-- scan_id is nullable so we can track abandoned attempts (where the user
-- never reached Save). organisation_id is required so we can scope analysis.

CREATE TABLE IF NOT EXISTS scan_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope
  scan_id uuid REFERENCES scans(id) ON DELETE SET NULL,
  organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL,

  -- Identification path taken. Two-bucket model — keeps the validation gate
  -- query simple (% ZXing vs % AI). Sub-categorization can come later if
  -- pilot data shows it's useful.
  path text NOT NULL CHECK (path IN ('zxing_success', 'ai_fallback')),

  -- Sub-detail of why we ended up at AI fallback (null for zxing_success path)
  ai_fallback_reason text CHECK (ai_fallback_reason IN (
    'zxing_decoded_but_unknown',     -- ZXing read the barcode, but no DB had it
    'zxing_failed_then_prompt',      -- ZXing didn't decode in 5s, user tapped fallback prompt
    'user_manual_toggle',            -- User explicitly switched to label mode
    NULL
  )),

  -- Timing in milliseconds: scan start → product confirmed (Step 1 → Step 2)
  time_to_identification_ms int,

  -- External API health snapshot — true if any external API call hit the 1s
  -- timeout cap during this scan's lookup chain. Null if no external lookup
  -- happened (e.g., cache hit on products_public).
  external_apis_timed_out boolean,

  -- Useful for cross-checking iOS vs Android vs desktop pilot behavior
  user_agent text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for the validation gate queries
CREATE INDEX IF NOT EXISTS scan_telemetry_path_created_idx
  ON scan_telemetry (created_at DESC, path);

CREATE INDEX IF NOT EXISTS scan_telemetry_org_idx
  ON scan_telemetry (organisation_id, created_at DESC);

-- ── Step 2: RLS ───────────────────────────────────────────────────────────
-- Authenticated org members can INSERT their own org's telemetry rows.
-- Authenticated users can SELECT all rows (for cross-org pilot analysis).
-- This is internal observability data, not user-facing or sensitive — fine to
-- be readable platform-wide for analysis purposes.

ALTER TABLE scan_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_can_insert_telemetry" ON scan_telemetry
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organisation_id IS NULL
    OR organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "authenticated_can_read_telemetry" ON scan_telemetry
  FOR SELECT
  TO authenticated
  USING (true);

-- ── Verification queries (uncomment to run after migration) ───────────────
--
-- Table exists:
-- SELECT count(*) FROM scan_telemetry;  -- expect 0
--
-- Policies exist:
-- SELECT policyname FROM pg_policies WHERE tablename = 'scan_telemetry';
--
-- ── PHASE 3 VALIDATION GATE QUERIES (run after a week of pilot scanning) ──
--
-- (1) Overall ZXing success rate — the gate criterion (≥80% to proceed to Phase 4)
--
-- SELECT
--   path,
--   count(*) AS scans,
--   ROUND(100.0 * count(*) / SUM(count(*)) OVER (), 1) AS pct
-- FROM scan_telemetry
-- WHERE created_at > now() - interval '7 days'
-- GROUP BY path
-- ORDER BY scans DESC;
--
-- (2) Median time-to-identification per path
--
-- SELECT path,
--        percentile_disc(0.5) WITHIN GROUP (ORDER BY time_to_identification_ms) AS median_ms,
--        percentile_disc(0.9) WITHIN GROUP (ORDER BY time_to_identification_ms) AS p90_ms
-- FROM scan_telemetry
-- WHERE created_at > now() - interval '7 days'
-- GROUP BY path;
--
-- (3) AI fallback breakdown — why are we falling back?
--
-- SELECT ai_fallback_reason, count(*)
-- FROM scan_telemetry
-- WHERE path = 'ai_fallback' AND created_at > now() - interval '7 days'
-- GROUP BY ai_fallback_reason
-- ORDER BY count DESC;
--
-- (4) External API timeout rate
--
-- SELECT
--   count(*) FILTER (WHERE external_apis_timed_out = true) AS timed_out,
--   count(*) FILTER (WHERE external_apis_timed_out = false) AS responded,
--   count(*) FILTER (WHERE external_apis_timed_out IS NULL) AS no_external_call_needed
-- FROM scan_telemetry
-- WHERE created_at > now() - interval '7 days';
--
-- (5) Per-org breakdown (useful when multiple pilot stores onboard)
--
-- SELECT
--   o.name AS org,
--   count(*) AS scans,
--   ROUND(100.0 * count(*) FILTER (WHERE st.path = 'zxing_success') / count(*), 1) AS zxing_pct
-- FROM scan_telemetry st
-- LEFT JOIN organisations o ON o.id = st.organisation_id
-- WHERE st.created_at > now() - interval '7 days'
-- GROUP BY o.name
-- ORDER BY scans DESC;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK BLOCK (only run if migration needs to be undone)
-- ════════════════════════════════════════════════════════════════════════════
-- BEGIN;
--   DROP POLICY IF EXISTS "authenticated_can_read_telemetry" ON scan_telemetry;
--   DROP POLICY IF EXISTS "authenticated_can_insert_telemetry" ON scan_telemetry;
--   DROP TABLE IF EXISTS scan_telemetry;
-- COMMIT;

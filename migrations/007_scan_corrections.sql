-- 007_scan_corrections.sql
--
-- Captures every (AI OCR output → user-corrected final value) pair on
-- Phase 2 raw-capture confirmation. The corpus is engine-agnostic and
-- serves as the training signal for:
--   - Manual prompt refinement (most-common substitutions/missed fields)
--   - Brand-specific hint seeding (per-product correction patterns)
--   - code_patterns table auto-population (learned regex per product)
--   - Native iOS port tuning (data carries over — Apple Vision can use
--     the same correction corpus to bias its character recognition)
--
-- Inserted from index.html's submitScan path after the scan row is saved,
-- as a fire-and-forget side effect (failure doesn't block submit).
--
-- This is append-only audit data. No UPDATE/DELETE policy is provided —
-- corrections are immutable training records by design.

CREATE TABLE IF NOT EXISTS public.scan_corrections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id          uuid REFERENCES public.scans(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  store_id         uuid REFERENCES public.stores(id) ON DELETE SET NULL,

  -- Product context — captured for grouping/analytics
  product_name     text,
  barcode          text,

  -- The two strings we're comparing
  ocr_output       text,        -- What the AI returned. NULL/empty = no characters detected.
  ocr_source       text,        -- 'sonnet' | 'tesseract_fallback' | 'none' | 'manual_only'
  user_final       text,        -- What the user actually saved.

  -- Convenience flag — generated, so queries can filter quickly to
  -- only rows where staff edited the AI's output.
  was_edited       boolean GENERATED ALWAYS AS (
                     COALESCE(NULLIF(ocr_output, ''), NULL)
                       IS DISTINCT FROM
                     COALESCE(NULLIF(user_final,  ''), NULL)
                   ) STORED,

  -- Field-count metrics. The OCR prompt asks Sonnet to return distinct
  -- traceability fields separated by ' · ', so the count is a useful
  -- signal: fields_final > fields_ocr means staff manually added a
  -- missed field (e.g. the AI captured only a date and staff added the
  -- batch number).
  fields_ocr       integer,
  fields_final     integer,

  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Query patterns we'll want for analytics + auto-correction logic:
--   "show me edited corrections for product X, last 30 days" → product + org + created_at
--   "show me edited corrections for barcode Y" → barcode (when present)
CREATE INDEX IF NOT EXISTS scan_corrections_org_product_idx
  ON public.scan_corrections (organisation_id, product_name, created_at DESC)
  WHERE was_edited = true;

CREATE INDEX IF NOT EXISTS scan_corrections_org_barcode_idx
  ON public.scan_corrections (organisation_id, barcode, created_at DESC)
  WHERE was_edited = true AND barcode IS NOT NULL;

-- Row-level security: each org sees only its own corrections.
ALTER TABLE public.scan_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scan_corrections_org_select ON public.scan_corrections;
CREATE POLICY scan_corrections_org_select
  ON public.scan_corrections FOR SELECT
  USING (organisation_id IN (
    SELECT organisation_id FROM public.organisation_members
    WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS scan_corrections_org_insert ON public.scan_corrections;
CREATE POLICY scan_corrections_org_insert
  ON public.scan_corrections FOR INSERT
  WITH CHECK (organisation_id IN (
    SELECT organisation_id FROM public.organisation_members
    WHERE user_id = auth.uid()
  ));

COMMENT ON TABLE  public.scan_corrections IS
  'Append-only log of (AI OCR output, user-corrected final value) pairs from Phase 2 raw-capture confirmation. Training corpus for prompt refinement, brand hints, and future OCR-engine tuning.';
COMMENT ON COLUMN public.scan_corrections.ocr_source IS
  'Which engine produced ocr_output: ''sonnet'' (primary), ''tesseract_fallback'' (when Sonnet returned empty or errored), ''none'' (both engines returned nothing), ''manual_only'' (user typed without any AI output).';
COMMENT ON COLUMN public.scan_corrections.was_edited IS
  'Generated. TRUE when ocr_output and user_final differ in any way (after empty/NULL normalization). FALSE means the user accepted the AI output verbatim.';

-- 045_recall_catalog_codes.sql (2026-11-08)
--
-- Improvement plan B5, stage 1 (docs/B5-FEEDS-BACKSTOP-PLAN.md): what a
-- store can match on, and where an entry came from.
--
-- recall_catalog gains the parser's outputs beyond lots and gtins (printed
-- lot ranges, a best-by window, the "all lots" flag, the reader's match
-- terms) and a parser_version so the importer can re-parse older entries a
-- hundred a run; plus the columns stage 2 (FDA announcements) and stage 3
-- (linking) will fill: kind, notice_url, event_key, announcement_id.
-- recall_catalog_org gains covered_by_event_id for stage 3's "no supplier
-- notice" flag. batchd_active_recalls returns the new fields in the same
-- row shape plus `covered`; its return type changes, so it is dropped and
-- recreated with the same grants (migration 043).
--
-- Additive: no row is changed except event_key, filled from the raw FDA
-- entry where one is stored. Staging first, then production.

BEGIN;

ALTER TABLE public.recall_catalog
  ADD COLUMN IF NOT EXISTS kind            text NOT NULL DEFAULT 'enforcement',
  ADD COLUMN IF NOT EXISTS notice_url      text,
  ADD COLUMN IF NOT EXISTS event_key       text,
  ADD COLUMN IF NOT EXISTS announcement_id uuid REFERENCES public.recall_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_ranges      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS best_by_from    date,
  ADD COLUMN IF NOT EXISTS best_by_to      date,
  ADD COLUMN IF NOT EXISTS all_lots        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS match_terms     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS parser_version  integer NOT NULL DEFAULT 1;

ALTER TABLE public.recall_catalog DROP CONSTRAINT IF EXISTS recall_catalog_kind_check;
ALTER TABLE public.recall_catalog
  ADD CONSTRAINT recall_catalog_kind_check CHECK (kind IN ('enforcement', 'announcement'));

CREATE INDEX IF NOT EXISTS recall_catalog_parser_version_idx ON public.recall_catalog (parser_version, created_at DESC);
CREATE INDEX IF NOT EXISTS recall_catalog_event_key_idx ON public.recall_catalog (source, event_key) WHERE event_key IS NOT NULL;

-- The FDA event id, where the raw entry is stored (importer rows).
UPDATE public.recall_catalog
   SET event_key = NULLIF(raw->>'event_id', '')
 WHERE event_key IS NULL AND raw IS NOT NULL AND raw ? 'event_id';

ALTER TABLE public.recall_catalog_org
  ADD COLUMN IF NOT EXISTS covered_by_event_id uuid REFERENCES public.recall_events(id) ON DELETE SET NULL;

-- ── The one list returns the new fields ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.batchd_active_recalls(uuid);
CREATE FUNCTION public.batchd_active_recalls(p_org uuid)
RETURNS TABLE (
  kind            text,          -- 'manual' | 'pushed' | 'feed'
  recall_id       uuid,
  event_id        uuid,
  catalog_id      uuid,
  product_name    text,
  lot_number      text,
  lots            text[],
  barcode         text,
  gtins           text[],
  description     text,
  reason          text,
  severity        text,
  source          text,
  published_at    timestamptz,
  recalling_firm  text,
  dismissed       boolean,
  matched         boolean,
  -- B5 stage 1
  lot_ranges      jsonb,         -- [{"from":"PB24105","to":"PB24150"}]
  best_by_from    date,
  best_by_to      date,
  all_lots        boolean,
  match_terms     text[],
  feed_kind       text,          -- 'enforcement' | 'announcement' for a feed entry
  notice_url      text,
  covered         boolean        -- a pushed recall of this organization covers the entry (stage 3)
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH me AS (
  SELECT (auth.uid() IS NULL OR public.batchd_is_platform_admin() OR p_org IN (SELECT public.batchd_my_active_org_ids())) AS allowed,
         COALESCE((SELECT o.region FROM public.organisations o WHERE o.id = p_org), 'us') AS region
),
manual AS (
  SELECT 'manual'::text AS kind, r.id AS recall_id, NULL::uuid AS event_id, NULL::uuid AS catalog_id,
         r.product_name, r.lot_number,
         ARRAY(SELECT trim(x) FROM unnest(string_to_array(COALESCE(r.lot_number, ''), ',')) AS x WHERE trim(x) <> '') AS lots,
         r.barcode_number AS barcode, '{}'::text[] AS gtins,
         r.description, r.description AS reason, NULL::text AS severity, COALESCE(r.source, 'manual') AS source,
         r.created_at AS published_at, NULL::text AS recalling_firm, false AS dismissed,
         EXISTS (SELECT 1 FROM public.scan_recall_matches m WHERE m.recall_id = r.id AND m.organisation_id = p_org) AS matched,
         '[]'::jsonb AS lot_ranges, NULL::date AS best_by_from, NULL::date AS best_by_to, false AS all_lots, '{}'::text[] AS match_terms,
         NULL::text AS feed_kind, NULL::text AS notice_url, false AS covered
  FROM public.recalls r, me
  WHERE me.allowed AND r.organisation_id = p_org AND r.active IS TRUE
    AND COALESCE(r.is_pushed, false) = false AND r.recall_event_id IS NULL
    AND COALESCE(r.source, 'manual') NOT IN ('fda', 'fsis', 'mattilsynet', 'rasff')
),
pushed AS (
  SELECT 'pushed'::text, NULL::uuid, ev.id, NULL::uuid,
         ev.product_name, ev.lot_number,
         COALESCE(
           NULLIF(ARRAY(SELECT l.lot_number FROM public.recalls l WHERE l.recall_event_id = ev.id AND l.lot_number IS NOT NULL ORDER BY l.created_at), '{}'),
           ARRAY(SELECT trim(x) FROM unnest(string_to_array(COALESCE(ev.lot_number, ''), ',')) AS x WHERE trim(x) <> '')),
         ev.barcode, '{}'::text[],
         ev.description, ev.reason, ev.severity, 'manufacturer_push'::text,
         COALESCE(ev.published_at, ev.created_at),
         (SELECT o.name FROM public.organisations o WHERE o.id = ev.source_org_id), false,
         EXISTS (SELECT 1 FROM public.scan_recall_matches m WHERE m.recall_event_id = ev.id AND m.organisation_id = p_org),
         '[]'::jsonb, NULL::date, NULL::date, false, '{}'::text[],
         NULL::text, NULL::text, false
  FROM public.recall_events ev
  JOIN public.recall_distributions d ON d.recall_event_id = ev.id AND d.retailer_org_id = p_org, me
  WHERE me.allowed AND ev.is_drill = false AND ev.closed_at IS NULL
),
feed AS (
  SELECT 'feed'::text, NULL::uuid, NULL::uuid, c.id,
         c.product_name, c.lots[1], c.lots, NULL::text, c.gtins,
         COALESCE(c.reason, '') || CASE WHEN c.recall_number IS NOT NULL THEN ' [' || c.recall_number || ']' ELSE '' END,
         c.reason,
         CASE c.classification WHEN 'Class I' THEN 'class_i' WHEN 'Class II' THEN 'class_ii' WHEN 'Class III' THEN 'class_iii' ELSE NULL END,
         c.source, COALESCE(c.published_at, c.report_date::timestamptz, c.created_at), c.recalling_firm,
         (o.dismissed_at IS NOT NULL),
         (o.matched_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.scan_recall_matches m WHERE m.catalog_id = c.id AND m.organisation_id = p_org)),
         COALESCE(c.lot_ranges, '[]'::jsonb), c.best_by_from, c.best_by_to, COALESCE(c.all_lots, false), COALESCE(c.match_terms, '{}'::text[]),
         c.kind, c.notice_url, (o.covered_by_event_id IS NOT NULL)
  FROM public.recall_catalog c
  LEFT JOIN public.recall_catalog_org o ON o.catalog_id = c.id AND o.organisation_id = p_org, me
  WHERE me.allowed
    AND ((me.region = 'us' AND c.source IN ('fda', 'fsis')) OR (me.region <> 'us' AND c.source = 'mattilsynet'))
)
SELECT * FROM manual
UNION ALL SELECT * FROM pushed
UNION ALL SELECT * FROM feed
ORDER BY published_at DESC NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.batchd_active_recalls(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batchd_active_recalls(uuid) TO authenticated, service_role;

COMMIT;

-- Verification (read-only, run after):
-- select count(*) filter (where parser_version = 1) as to_reparse,
--        count(*) filter (where event_key is not null) as with_event_key
--   from recall_catalog;
-- select kind, count(*) from batchd_active_recalls('<org id>') group by kind;

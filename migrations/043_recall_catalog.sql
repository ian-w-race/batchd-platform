-- 043_recall_catalog.sql (2026-11-01)
--
-- Improvement plan B4, stage 1 (docs/B4-RECALL-CATALOG-PLAN.md): one recall
-- catalog. Adds, without changing anything the apps read today:
--   recall_catalog        each public recall entry once (FDA now, FSIS later,
--                         the 26 legacy Mattilsynet entries), no organization
--   recall_catalog_org    what one organization did with one entry (reviewed,
--                         dismissed, matched)
--   scan_recall_matches.catalog_id  a match that points at a catalog entry
--   batchd_active_recalls(p_org)    the one list of active recalls for an
--                         organization: manual, pushed and feed in one shape,
--                         with the drill, closed and linked-row rules inside
--   sweep_catalog_matches(p_catalog_id, p_lookback_days)  matches a catalog
--                         entry's lots and GTINs against every eligible
--                         organization's scans (service role only; the
--                         importer calls it for each new entry)
-- Stage 2 (the importer) and stage 3 (the data move) use these; until then
-- the catalog is empty and every screen still reads the old pair of tables.
--
-- Rules kept (CLAUDE.md, "Database rules"): drills never count; closed events
-- never count; a pushed recall's linked recalls rows are not listed again;
-- feed entries only ever point at scans through scan_recall_matches; pull
-- tracking stays on scans.removed_from_shelf_at.
--
-- Re-runnable. One transaction. Apply to staging first, then production, and
-- regenerate docs/SCHEMA-REFERENCE.md afterwards.

BEGIN;

-- ── 1. The catalog ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recall_catalog (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text NOT NULL CHECK (source IN ('fda', 'fsis', 'mattilsynet')),
  external_key        text NOT NULL,                 -- fda: recall number + product hash; see the importer
  recall_number       text,                          -- as published, "F-1234-2026"
  product_name        text NOT NULL,                 -- the 120-character name the apps match and show
  product_description text,                          -- the full text
  code_info           text,                          -- lot text as published
  lots                text[] NOT NULL DEFAULT '{}',  -- parsed from code_info (B5 improves the parser)
  gtins               text[] NOT NULL DEFAULT '{}',
  recalling_firm      text,
  classification      text,                          -- "Class I", "Class II", "Class III"
  reason              text,
  feed_status         text,                          -- FDA: Ongoing, Completed, Terminated
  report_date         date,
  published_at        timestamptz,
  raw                 jsonb,                         -- the feed entry, for re-parsing without a new fetch
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_key)
);
CREATE INDEX IF NOT EXISTS recall_catalog_source_published_idx ON public.recall_catalog (source, published_at DESC);
CREATE INDEX IF NOT EXISTS recall_catalog_lots_gin ON public.recall_catalog USING gin (lots);
CREATE INDEX IF NOT EXISTS recall_catalog_gtins_gin ON public.recall_catalog USING gin (gtins);
DROP TRIGGER IF EXISTS recall_catalog_touch ON public.recall_catalog;
CREATE TRIGGER recall_catalog_touch BEFORE UPDATE ON public.recall_catalog
  FOR EACH ROW EXECUTE FUNCTION public.batchd_touch_updated_at();

ALTER TABLE public.recall_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recall_catalog FROM anon, authenticated;
GRANT SELECT ON public.recall_catalog TO authenticated;
GRANT ALL ON public.recall_catalog TO service_role;
-- Public information: any active member may read every entry. Only the
-- service role (the importer) writes.
DROP POLICY IF EXISTS b43_catalog_select ON public.recall_catalog;
CREATE POLICY b43_catalog_select ON public.recall_catalog FOR SELECT TO authenticated
  USING (public.batchd_has_active_membership() OR public.batchd_is_platform_admin());
DROP POLICY IF EXISTS b38_active_members_only ON public.recall_catalog;
CREATE POLICY b38_active_members_only ON public.recall_catalog AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.batchd_has_active_membership())) WITH CHECK ((SELECT public.batchd_has_active_membership()));

-- ── 2. What an organization did with an entry ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.recall_catalog_org (
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  catalog_id      uuid NOT NULL REFERENCES public.recall_catalog(id) ON DELETE CASCADE,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid REFERENCES auth.users(id),
  dismissed_at    timestamptz,                       -- "not our product": hidden from the active list, kept in history
  dismissed_by    uuid REFERENCES auth.users(id),
  dismiss_note    text,
  matched_at      timestamptz,                       -- set by the sweep when a scan of this organization matched
  PRIMARY KEY (organisation_id, catalog_id)
);
CREATE INDEX IF NOT EXISTS recall_catalog_org_catalog_idx ON public.recall_catalog_org (catalog_id);

ALTER TABLE public.recall_catalog_org ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recall_catalog_org FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.recall_catalog_org TO authenticated;
GRANT ALL ON public.recall_catalog_org TO service_role;
DROP POLICY IF EXISTS b43_catalog_org_select ON public.recall_catalog_org;
CREATE POLICY b43_catalog_org_select ON public.recall_catalog_org FOR SELECT TO authenticated
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()) OR public.batchd_is_platform_admin());
DROP POLICY IF EXISTS b43_catalog_org_insert ON public.recall_catalog_org;
CREATE POLICY b43_catalog_org_insert ON public.recall_catalog_org FOR INSERT TO authenticated
  WITH CHECK (public.batchd_is_manager_of(organisation_id) OR public.batchd_is_platform_admin());
DROP POLICY IF EXISTS b43_catalog_org_update ON public.recall_catalog_org;
CREATE POLICY b43_catalog_org_update ON public.recall_catalog_org FOR UPDATE TO authenticated
  USING (public.batchd_is_manager_of(organisation_id) OR public.batchd_is_platform_admin())
  WITH CHECK (public.batchd_is_manager_of(organisation_id) OR public.batchd_is_platform_admin());
DROP POLICY IF EXISTS b38_active_members_only ON public.recall_catalog_org;
CREATE POLICY b38_active_members_only ON public.recall_catalog_org AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.batchd_has_active_membership())) WITH CHECK ((SELECT public.batchd_has_active_membership()));

-- ── 3. A match may point at a catalog entry ─────────────────────────────────
ALTER TABLE public.scan_recall_matches
  ADD COLUMN IF NOT EXISTS catalog_id uuid REFERENCES public.recall_catalog(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS scan_recall_matches_scan_catalog_unique
  ON public.scan_recall_matches (scan_id, catalog_id) WHERE catalog_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scan_recall_matches_catalog_idx ON public.scan_recall_matches (catalog_id) WHERE catalog_id IS NOT NULL;

-- ── 4. The one list ─────────────────────────────────────────────────────────
-- SECURITY INVOKER: row security applies to every table it reads, so a caller
-- only ever sees what they could read directly. A signed-in caller outside
-- p_org (and not a platform admin) gets no rows. The service role (no
-- auth.uid()) may ask for any organization.
CREATE OR REPLACE FUNCTION public.batchd_active_recalls(p_org uuid)
RETURNS TABLE (
  kind            text,          -- 'manual' | 'pushed' | 'feed'
  recall_id       uuid,          -- recalls.id for a manual recall
  event_id        uuid,          -- recall_events.id for a pushed recall
  catalog_id      uuid,          -- recall_catalog.id for a feed entry
  product_name    text,
  lot_number      text,          -- the first lot, for screens that show one
  lots            text[],        -- every lot: the linked rows of a push, the parsed lots of a feed entry
  barcode         text,
  gtins           text[],
  description     text,
  reason          text,
  severity        text,          -- class_i | class_ii | class_iii | null
  source          text,          -- manual | manufacturer_push | fda | fsis | mattilsynet
  published_at    timestamptz,
  recalling_firm  text,
  dismissed       boolean,       -- feed entries this organization dismissed
  matched         boolean        -- a scan of this organization matched it
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
         EXISTS (SELECT 1 FROM public.scan_recall_matches m WHERE m.recall_id = r.id AND m.organisation_id = p_org) AS matched
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
         EXISTS (SELECT 1 FROM public.scan_recall_matches m WHERE m.recall_event_id = ev.id AND m.organisation_id = p_org)
  FROM public.recall_events ev
  JOIN public.recall_distributions d ON d.recall_event_id = ev.id AND d.retailer_org_id = p_org, me
  WHERE me.allowed AND ev.is_drill = false AND ev.closed_at IS NULL
),
feed AS (
  SELECT 'feed'::text, NULL::uuid, NULL::uuid, c.id,
         c.product_name, c.lots[1], c.lots, NULL::text, c.gtins,
         -- the recall number stays at the end of the description, as the old per-organization rows had it
         COALESCE(c.reason, '') || CASE WHEN c.recall_number IS NOT NULL THEN ' [' || c.recall_number || ']' ELSE '' END,
         c.reason,
         CASE c.classification WHEN 'Class I' THEN 'class_i' WHEN 'Class II' THEN 'class_ii' WHEN 'Class III' THEN 'class_iii' ELSE NULL END,
         c.source, COALESCE(c.published_at, c.report_date::timestamptz, c.created_at), c.recalling_firm,
         (o.dismissed_at IS NOT NULL),
         (o.matched_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.scan_recall_matches m WHERE m.catalog_id = c.id AND m.organisation_id = p_org))
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

-- ── 5. Matching a catalog entry against scans ───────────────────────────────
-- Same rule as sweep_recall_matches, for every eligible organization at once:
-- a scan matches when a catalog lot (4 or more characters, normalized) is
-- inside its captured lot text, or its barcode equals a catalog GTIN. Writes
-- one match per scan and stamps recall_catalog_org.matched_at. Service role
-- only: the importer calls it after each new entry.
CREATE OR REPLACE FUNCTION public.sweep_catalog_matches(p_catalog_id uuid, p_lookback_days integer DEFAULT 180)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v       public.recall_catalog%ROWTYPE;
  v_lots  text[];
  v_gtins text[];
  v_count integer := 0;
BEGIN
  SELECT * INTO v FROM public.recall_catalog WHERE id = p_catalog_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_lots  := ARRAY(SELECT public.batchd_norm_lot(x) FROM unnest(v.lots) AS x WHERE length(public.batchd_norm_lot(x)) >= 4);
  v_gtins := ARRAY(SELECT public.batchd_norm_gtin(x) FROM unnest(v.gtins) AS x WHERE public.batchd_norm_gtin(x) <> '');
  IF cardinality(v_lots) = 0 AND cardinality(v_gtins) = 0 THEN RETURN 0; END IF;

  INSERT INTO public.scan_recall_matches
    (scan_id, catalog_id, recall_source, recall_product, recall_lot, match_type, match_confidence,
     organisation_id, store_name, store_id, scanned_by, placed_at, quantity)
  SELECT s.id, v.id, v.source, v.product_name, v.lots[1],
         CASE WHEN EXISTS (SELECT 1 FROM unnest(v_lots) AS l WHERE public.batchd_norm_lot(COALESCE(s.raw_capture, s.lot_number)) LIKE '%' || l || '%')
              THEN 'exact_lot' ELSE 'exact_barcode' END,
         'high', s.organisation_id, s.store_name, s.store_id, s.scanned_by, s.created_at, COALESCE(s.quantity, 1)
  FROM public.scans s
  JOIN public.organisations o ON o.id = s.organisation_id
  WHERE s.organisation_id IS NOT NULL
    AND s.created_at >= now() - make_interval(days => p_lookback_days)
    AND ((v.source IN ('fda', 'fsis') AND COALESCE(o.region, 'us') = 'us')
      OR (v.source = 'mattilsynet' AND COALESCE(o.region, 'us') <> 'us'))
    AND (EXISTS (SELECT 1 FROM unnest(v_lots) AS l WHERE public.batchd_norm_lot(COALESCE(s.raw_capture, s.lot_number)) LIKE '%' || l || '%')
      OR (s.barcode_number IS NOT NULL AND public.batchd_norm_gtin(s.barcode_number) = ANY (v_gtins)))
  ON CONFLICT (scan_id, catalog_id) WHERE catalog_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.recall_catalog_org (organisation_id, catalog_id, matched_at)
  SELECT DISTINCT m.organisation_id, m.catalog_id, now()
  FROM public.scan_recall_matches m WHERE m.catalog_id = v.id
  ON CONFLICT (organisation_id, catalog_id) DO UPDATE
    SET matched_at = COALESCE(public.recall_catalog_org.matched_at, EXCLUDED.matched_at);

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_catalog_matches(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_catalog_matches(uuid, integer) TO service_role;

COMMIT;

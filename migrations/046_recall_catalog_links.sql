-- 046_recall_catalog_links.sql (2026-11-08)
--
-- Improvement plan B5, stage 3 (docs/B5-FEEDS-BACKSTOP-PLAN.md): two links.
--
-- 1. An enforcement entry joins the announcement it confirms. The FDA's
--    enforcement report lists a recall weeks after the firm's press release
--    (stage 2 puts those in the catalog as kind 'announcement'). When the
--    enforcement entry arrives, link_catalog_announcements() finds the
--    announcement from the same firm within the window that shares a GTIN,
--    a lot, or the announcement's match terms, sets announcement_id and
--    announced_at on the enforcement entry, copies the notice_url, and
--    carries every organization's state (reviewed, dismissed, matched,
--    covered) over. batchd_active_recalls then hides the announcement and
--    shows the enforcement entry with its announced date and notice link.
-- 2. A public entry is covered for an organization when one of its own
--    pushed recalls (a supplier notice or the composer; never a drill) names
--    a shared lot or GTIN, or, for an "all lots" entry, the same product.
--    link_catalog_coverage() sets recall_catalog_org.covered_by_event_id;
--    the importer runs it nightly and the composer runs it for the event
--    it just pushed through link_catalog_coverage_for_event(), which a
--    corporate admin of the pushing organization may call.
--
-- batchd_active_recalls returns announced_at (its return type changes, so
-- it is dropped and recreated with the same grants). Additive otherwise.
-- Staging first, then production.

BEGIN;

ALTER TABLE public.recall_catalog ADD COLUMN IF NOT EXISTS announced_at timestamptz;
CREATE INDEX IF NOT EXISTS recall_catalog_announcement_idx ON public.recall_catalog (announcement_id) WHERE announcement_id IS NOT NULL;

-- Firm names compared loosely: lower case, legal suffixes and punctuation gone.
CREATE OR REPLACE FUNCTION public.batchd_norm_firm(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(regexp_replace(
           regexp_replace(lower(coalesce(p, '')), '\m(inc|llc|ltd|co|corp|corporation|company|dba|d/b/a|the|incorporated|limited|lp|llp)\M\.?', ' ', 'g'),
           '[^a-z0-9]+', '', 'g'), '');
$$;
REVOKE ALL ON FUNCTION public.batchd_norm_firm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batchd_norm_firm(text) TO authenticated, service_role;

-- ── 1. Enforcement entries join their announcements ─────────────────────────
CREATE OR REPLACE FUNCTION public.link_catalog_announcements(p_days integer DEFAULT 120)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (e.id) e.id AS enforcement_id, a.id AS announcement_id, a.published_at AS announced_at, a.notice_url
    FROM public.recall_catalog e
    JOIN public.recall_catalog a
      ON a.kind = 'announcement' AND a.source = e.source
     AND a.published_at <= COALESCE(e.published_at, e.created_at) + interval '7 days'
     AND a.published_at >= COALESCE(e.published_at, e.created_at) - interval '120 days'
     AND public.batchd_norm_firm(a.recalling_firm) IS NOT NULL
     AND public.batchd_norm_firm(a.recalling_firm) = public.batchd_norm_firm(e.recalling_firm)
     AND (
       EXISTS (SELECT 1 FROM unnest(a.gtins) g
                WHERE public.batchd_norm_gtin(g) <> '' AND public.batchd_norm_gtin(g) IN (SELECT public.batchd_norm_gtin(x) FROM unnest(e.gtins) x))
       OR EXISTS (SELECT 1 FROM unnest(a.lots) l
                   WHERE length(public.batchd_norm_lot(l)) >= 4 AND public.batchd_norm_lot(l) IN (SELECT public.batchd_norm_lot(x) FROM unnest(e.lots) x))
       OR (cardinality(a.match_terms) > 0
           AND NOT EXISTS (SELECT 1 FROM unnest(a.match_terms) t WHERE lower(e.product_name) NOT LIKE '%' || lower(t) || '%'))
     )
    WHERE e.kind = 'enforcement' AND e.announcement_id IS NULL
      AND e.created_at >= now() - make_interval(days => p_days)
    ORDER BY e.id, a.published_at DESC
  LOOP
    UPDATE public.recall_catalog
       SET announcement_id = r.announcement_id,
           announced_at    = r.announced_at,
           notice_url      = COALESCE(notice_url, r.notice_url)
     WHERE id = r.enforcement_id;
    INSERT INTO public.recall_catalog_org (organisation_id, catalog_id, first_seen_at, reviewed_at, reviewed_by, dismissed_at, dismissed_by, dismiss_note, matched_at, covered_by_event_id)
    SELECT o.organisation_id, r.enforcement_id, o.first_seen_at, o.reviewed_at, o.reviewed_by, o.dismissed_at, o.dismissed_by, o.dismiss_note, o.matched_at, o.covered_by_event_id
      FROM public.recall_catalog_org o
     WHERE o.catalog_id = r.announcement_id
    ON CONFLICT (organisation_id, catalog_id) DO UPDATE SET
      first_seen_at       = LEAST(public.recall_catalog_org.first_seen_at, EXCLUDED.first_seen_at),
      reviewed_at         = COALESCE(public.recall_catalog_org.reviewed_at, EXCLUDED.reviewed_at),
      reviewed_by         = COALESCE(public.recall_catalog_org.reviewed_by, EXCLUDED.reviewed_by),
      dismissed_at        = COALESCE(public.recall_catalog_org.dismissed_at, EXCLUDED.dismissed_at),
      dismissed_by        = COALESCE(public.recall_catalog_org.dismissed_by, EXCLUDED.dismissed_by),
      dismiss_note        = COALESCE(public.recall_catalog_org.dismiss_note, EXCLUDED.dismiss_note),
      matched_at          = COALESCE(public.recall_catalog_org.matched_at, EXCLUDED.matched_at),
      covered_by_event_id = COALESCE(public.recall_catalog_org.covered_by_event_id, EXCLUDED.covered_by_event_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.link_catalog_announcements(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_catalog_announcements(integer) TO service_role;

-- ── 2. A pushed recall covers a public entry for its organization ───────────
CREATE OR REPLACE FUNCTION public.link_catalog_coverage(p_event uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH ev AS (
    SELECT e.id, lower(COALESCE(e.product_name, '')) AS product,
      ARRAY(SELECT public.batchd_norm_lot(x) FROM (
              SELECT l.lot_number AS x FROM public.recalls l WHERE l.recall_event_id = e.id AND l.lot_number IS NOT NULL
              UNION SELECT trim(y) FROM unnest(string_to_array(COALESCE(e.lot_number, ''), ',')) AS y) s
            WHERE length(public.batchd_norm_lot(x)) >= 4) AS lots,
      ARRAY(SELECT public.batchd_norm_gtin(x) FROM (
              SELECT e.barcode AS x
              UNION SELECT l.barcode_number FROM public.recalls l WHERE l.recall_event_id = e.id) s
            WHERE public.batchd_norm_gtin(COALESCE(x, '')) <> '') AS gtins
    FROM public.recall_events e
    WHERE e.is_drill = false
      AND (p_event IS NULL OR e.id = p_event)
      AND (p_event IS NOT NULL OR e.created_at >= now() - interval '180 days')
  ),
  pairs AS (
    SELECT DISTINCT ON (d.retailer_org_id, c.id) d.retailer_org_id AS organisation_id, c.id AS catalog_id, ev.id AS event_id
    FROM ev
    JOIN public.recall_distributions d ON d.recall_event_id = ev.id
    JOIN public.recall_catalog c ON c.source IN ('fda', 'fsis')
    WHERE (cardinality(ev.lots) > 0 AND EXISTS (SELECT 1 FROM unnest(c.lots) l WHERE public.batchd_norm_lot(l) = ANY (ev.lots)))
       OR (cardinality(ev.gtins) > 0 AND EXISTS (SELECT 1 FROM unnest(c.gtins) g WHERE public.batchd_norm_gtin(g) = ANY (ev.gtins)))
       OR (c.all_lots AND cardinality(c.match_terms) > 0
           AND NOT EXISTS (SELECT 1 FROM unnest(c.match_terms) t WHERE ev.product NOT LIKE '%' || lower(t) || '%'))
    ORDER BY d.retailer_org_id, c.id, ev.id
  ),
  ins AS (
    INSERT INTO public.recall_catalog_org (organisation_id, catalog_id, covered_by_event_id)
    SELECT organisation_id, catalog_id, event_id FROM pairs
    ON CONFLICT (organisation_id, catalog_id) DO UPDATE
      SET covered_by_event_id = COALESCE(public.recall_catalog_org.covered_by_event_id, EXCLUDED.covered_by_event_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.link_catalog_coverage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_catalog_coverage(uuid) TO service_role;

-- The composer calls this for the event it just pushed. Only a corporate
-- admin of the pushing organization (or a platform admin) may.
CREATE OR REPLACE FUNCTION public.link_catalog_coverage_for_event(p_event uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src uuid;
BEGIN
  SELECT source_org_id INTO v_src FROM public.recall_events WHERE id = p_event;
  IF v_src IS NULL THEN RETURN 0; END IF;
  IF NOT (public.batchd_is_corp_admin_of(v_src) OR public.batchd_is_platform_admin()) THEN
    RAISE EXCEPTION 'Only a corporate admin of the pushing organization can link coverage' USING ERRCODE = '42501';
  END IF;
  RETURN public.link_catalog_coverage(p_event);
END;
$$;
REVOKE ALL ON FUNCTION public.link_catalog_coverage_for_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_catalog_coverage_for_event(uuid) TO authenticated, service_role;

-- ── The one list: announced_at, superseded announcements hidden ─────────────
DROP FUNCTION IF EXISTS public.batchd_active_recalls(uuid);
CREATE FUNCTION public.batchd_active_recalls(p_org uuid)
RETURNS TABLE (
  kind            text,
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
  lot_ranges      jsonb,
  best_by_from    date,
  best_by_to      date,
  all_lots        boolean,
  match_terms     text[],
  feed_kind       text,
  notice_url      text,
  covered         boolean,
  announced_at    timestamptz    -- B5 stage 3: the press release date, on an enforcement entry that joined one
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
         NULL::text AS feed_kind, NULL::text AS notice_url, false AS covered, NULL::timestamptz AS announced_at
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
         NULL::text, NULL::text, false, NULL::timestamptz
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
         (o.matched_at IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.scan_recall_matches m WHERE m.catalog_id = c.id AND m.organisation_id = p_org)
           OR (c.announcement_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.scan_recall_matches m WHERE m.catalog_id = c.announcement_id AND m.organisation_id = p_org))),
         COALESCE(c.lot_ranges, '[]'::jsonb), c.best_by_from, c.best_by_to, COALESCE(c.all_lots, false), COALESCE(c.match_terms, '{}'::text[]),
         c.kind, c.notice_url, (o.covered_by_event_id IS NOT NULL), c.announced_at
  FROM public.recall_catalog c
  LEFT JOIN public.recall_catalog_org o ON o.catalog_id = c.id AND o.organisation_id = p_org, me
  WHERE me.allowed
    AND ((me.region = 'us' AND c.source IN ('fda', 'fsis')) OR (me.region <> 'us' AND c.source = 'mattilsynet'))
    -- an announcement that an enforcement entry has joined is shown once, as that entry
    AND NOT EXISTS (SELECT 1 FROM public.recall_catalog s WHERE s.announcement_id = c.id)
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
-- select count(*) filter (where announcement_id is not null) as linked_enforcement from recall_catalog;
-- select count(*) filter (where covered_by_event_id is not null) as covered from recall_catalog_org;

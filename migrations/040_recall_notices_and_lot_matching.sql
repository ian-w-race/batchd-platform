-- 040_recall_notices_and_lot_matching.sql (2026-10-25)
--
-- Improvement plan, Track B: B1 (recall notice intake) and B2 (lot-level
-- matching). Most recalls reach a retailer as an email or PDF from the
-- recalling firm or the distributor. A corporate admin uploads or pastes
-- that notice; a background function has Claude read it into structured
-- fields; the admin reviews the draft and pushes it through the recall
-- composer.
--
-- 1. recall_notices: one row per notice. Members who manage the org
--    (corp_admin, store_manager) read them; corp_admins create and update
--    them (only corp_admins can push a recall). The background function
--    writes the extraction with the service role. No client DELETE.
-- 2. match_recall_notice(): finds deliveries (receiving_events) and shelf
--    scans in the caller's organization that match a notice by GTIN, lot
--    code, lot range, best-by window or product words, and says why and how
--    confident. SECURITY INVOKER, so RLS limits it to the caller's org.
--
-- Re-runnable. One transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS public.recall_notices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  source           text NOT NULL DEFAULT 'upload'
                   CHECK (source IN ('upload','paste','email','manufacturer_link')),
  status           text NOT NULL DEFAULT 'processing'
                   CHECK (status IN ('processing','ready','failed','pushed','dismissed')),
  file_path        text,
  file_name        text,
  file_type        text,
  raw_text         text CHECK (raw_text IS NULL OR length(raw_text) <= 100000),
  extracted        jsonb,
  error            text,
  model            text,
  recall_event_id  uuid REFERENCES public.recall_events(id) ON DELETE SET NULL,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  pushed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS recall_notices_org_created_idx
  ON public.recall_notices (organisation_id, created_at DESC);

DROP TRIGGER IF EXISTS recall_notices_touch ON public.recall_notices;
CREATE TRIGGER recall_notices_touch BEFORE UPDATE ON public.recall_notices
  FOR EACH ROW EXECUTE FUNCTION public.batchd_touch_updated_at();

ALTER TABLE public.recall_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recall_notices FROM anon;
REVOKE ALL ON public.recall_notices FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.recall_notices TO authenticated;
GRANT ALL ON public.recall_notices TO service_role;

DROP POLICY IF EXISTS b40_notices_select ON public.recall_notices;
CREATE POLICY b40_notices_select ON public.recall_notices FOR SELECT TO authenticated
  USING (public.batchd_is_manager_of(organisation_id) OR public.batchd_is_platform_admin());

DROP POLICY IF EXISTS b40_notices_insert ON public.recall_notices;
CREATE POLICY b40_notices_insert ON public.recall_notices FOR INSERT TO authenticated
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id) AND status = 'processing'
              AND extracted IS NULL AND recall_event_id IS NULL);

DROP POLICY IF EXISTS b40_notices_update ON public.recall_notices;
CREATE POLICY b40_notices_update ON public.recall_notices FOR UPDATE TO authenticated
  USING (public.batchd_is_corp_admin_of(organisation_id))
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id));

-- Same restrictive rule as the other tenant tables (migration 038).
DROP POLICY IF EXISTS b38_active_members_only ON public.recall_notices;
CREATE POLICY b38_active_members_only ON public.recall_notices AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.batchd_has_active_membership()))
  WITH CHECK ((SELECT public.batchd_has_active_membership()));

-- Lot and GTIN normalization shared by the matcher.
CREATE OR REPLACE FUNCTION public.batchd_norm_lot(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION public.batchd_norm_gtin(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(ltrim(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '0'), '');
$$;

-- True when lot p_lot falls inside a range given as from/to codes that share
-- a letter prefix and differ only in a trailing number (A100 to A120).
CREATE OR REPLACE FUNCTION public.batchd_lot_in_range(p_lot text, p_from text, p_to text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  l text := public.batchd_norm_lot(p_lot);
  f text := public.batchd_norm_lot(p_from);
  t text := public.batchd_norm_lot(p_to);
  lp text; ln text; fp text; fn text; tp text; tn text;
BEGIN
  IF l IS NULL OR f IS NULL OR t IS NULL THEN RETURN false; END IF;
  lp := substring(l from '^(.*?)([0-9]+)$'); ln := substring(l from '([0-9]+)$');
  fp := substring(f from '^(.*?)([0-9]+)$'); fn := substring(f from '([0-9]+)$');
  tp := substring(t from '^(.*?)([0-9]+)$'); tn := substring(t from '([0-9]+)$');
  IF ln IS NULL OR fn IS NULL OR tn IS NULL THEN RETURN false; END IF;
  IF coalesce(lp,'') <> coalesce(fp,'') OR coalesce(fp,'') <> coalesce(tp,'') THEN RETURN false; END IF;
  IF length(ln) > 18 OR length(fn) > 18 OR length(tn) > 18 THEN RETURN false; END IF;
  RETURN ln::numeric BETWEEN fn::numeric AND tn::numeric;
END $$;

-- p_lot_ranges: jsonb array of {"from": "...", "to": "..."}.
-- p_terms: lowercase product words that must all appear in the product name.
CREATE OR REPLACE FUNCTION public.match_recall_notice(
  p_org          uuid,
  p_gtins        text[]  DEFAULT '{}',
  p_lots         text[]  DEFAULT '{}',
  p_lot_ranges   jsonb   DEFAULT '[]'::jsonb,
  p_best_by_from date    DEFAULT NULL,
  p_best_by_to   date    DEFAULT NULL,
  p_terms        text[]  DEFAULT '{}',
  p_since        timestamptz DEFAULT now() - interval '2 years'
)
RETURNS TABLE (
  kind text, record_id uuid, store_id uuid, store_name text, product_name text,
  gtin text, lot text, quantity numeric, unit text, record_date timestamptz,
  best_by date, supplier_name text, status text, on_shelf boolean,
  match_reason text, confidence text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH params AS (
    SELECT
      coalesce((SELECT array_agg(DISTINCT public.batchd_norm_gtin(g)) FROM unnest(p_gtins) g
                WHERE public.batchd_norm_gtin(g) IS NOT NULL), '{}') AS gtins,
      coalesce((SELECT array_agg(DISTINCT public.batchd_norm_lot(l)) FROM unnest(p_lots) l
                WHERE public.batchd_norm_lot(l) IS NOT NULL), '{}') AS lots,
      coalesce((SELECT array_agg(lower(trim(w))) FROM unnest(p_terms) w WHERE length(trim(w)) >= 3), '{}') AS terms
  ),
  recs AS (
    SELECT 'delivery'::text AS kind, r.id AS record_id, r.store_id, s.name AS store_name,
           r.product_name, r.gtin, r.traceability_lot_code AS lot, r.quantity,
           r.unit_of_measure AS unit, r.received_at AS record_date, r.best_by,
           r.supplier_name_snapshot AS supplier_name, r.status, NULL::boolean AS on_shelf
    FROM public.receiving_events r LEFT JOIN public.stores s ON s.id = r.store_id
    WHERE r.organisation_id = p_org AND r.status IN ('received','expected')
      AND r.received_at >= p_since
    UNION ALL
    SELECT 'shelf_scan', sc.id, sc.store_id, coalesce(st.name, sc.store_name),
           sc.product_name, sc.barcode_number, sc.lot_number, sc.quantity::numeric,
           'each', sc.created_at, NULL::date, sc.supplier_name, NULL,
           (sc.removed_from_shelf_at IS NULL)
    FROM public.scans sc LEFT JOIN public.stores st ON st.id = sc.store_id
    WHERE sc.organisation_id = p_org AND sc.created_at >= p_since
  ),
  scored AS (
    SELECT rc.*,
      (public.batchd_norm_gtin(rc.gtin) IS NOT NULL AND public.batchd_norm_gtin(rc.gtin) = ANY (p.gtins)) AS gtin_hit,
      (public.batchd_norm_gtin(rc.gtin) IS NOT NULL AND cardinality(p.gtins) > 0
         AND NOT (public.batchd_norm_gtin(rc.gtin) = ANY (p.gtins))) AS gtin_conflict,
      (public.batchd_norm_lot(rc.lot) IS NOT NULL AND (
         public.batchd_norm_lot(rc.lot) = ANY (p.lots)
         OR EXISTS (SELECT 1 FROM unnest(p.lots) nl
                    WHERE length(nl) >= 4 AND public.batchd_norm_lot(rc.lot) LIKE nl || '%')
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_lot_ranges, '[]'::jsonb)) rg
                    WHERE public.batchd_lot_in_range(rc.lot, rg->>'from', rg->>'to')))) AS lot_hit,
      (rc.best_by IS NOT NULL AND (p_best_by_from IS NOT NULL OR p_best_by_to IS NOT NULL)
         AND rc.best_by >= coalesce(p_best_by_from, rc.best_by)
         AND rc.best_by <= coalesce(p_best_by_to, rc.best_by)) AS best_by_hit,
      (cardinality(p.terms) > 0 AND NOT EXISTS (
         SELECT 1 FROM unnest(p.terms) w WHERE position(w IN lower(coalesce(rc.product_name, ''))) = 0)) AS product_hit,
      cardinality(p.lots) > 0 OR jsonb_array_length(coalesce(p_lot_ranges, '[]'::jsonb)) > 0 AS notice_has_lots,
      cardinality(p.gtins) > 0 AS notice_has_gtins,
      (p_best_by_from IS NOT NULL OR p_best_by_to IS NOT NULL) AS notice_has_best_by
    FROM recs rc CROSS JOIN params p
  ),
  judged AS (
    SELECT s.*,
      CASE
        WHEN gtin_hit AND lot_hit THEN 'GTIN and lot code match'
        WHEN lot_hit AND NOT gtin_conflict AND product_hit THEN 'Lot code and product match'
        WHEN lot_hit AND NOT gtin_conflict THEN 'Lot code matches'
        WHEN gtin_hit AND best_by_hit THEN 'GTIN and best-by date match'
        WHEN gtin_hit AND NOT notice_has_lots AND NOT notice_has_best_by THEN 'GTIN matches (the notice names no lots)'
        WHEN product_hit AND best_by_hit AND NOT gtin_conflict THEN 'Product and best-by date match'
        WHEN product_hit AND NOT notice_has_lots AND NOT notice_has_gtins THEN 'Product name matches (the notice names no lots or GTINs)'
        WHEN gtin_hit AND notice_has_lots THEN 'Same GTIN, different lot'
        WHEN gtin_hit THEN 'Same GTIN, best-by date outside the notice'
      END AS match_reason,
      CASE
        WHEN gtin_hit AND lot_hit THEN 'high'
        WHEN lot_hit AND NOT gtin_conflict AND (product_hit OR gtin IS NULL) THEN 'high'
        WHEN lot_hit AND NOT gtin_conflict THEN 'medium'
        WHEN gtin_hit AND best_by_hit THEN 'high'
        WHEN gtin_hit AND NOT notice_has_lots AND NOT notice_has_best_by THEN 'medium'
        WHEN product_hit AND best_by_hit AND NOT gtin_conflict THEN 'medium'
        WHEN product_hit AND NOT notice_has_lots AND NOT notice_has_gtins THEN 'low'
        WHEN gtin_hit THEN 'low'
      END AS confidence
    FROM scored s
  )
  SELECT kind, record_id, store_id, store_name, product_name, gtin, lot, quantity, unit,
         record_date, best_by, supplier_name, status, on_shelf, match_reason, confidence
  FROM judged
  WHERE match_reason IS NOT NULL
  ORDER BY CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           store_name NULLS LAST, record_date DESC
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION public.match_recall_notice(uuid, text[], text[], jsonb, date, date, text[], timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_recall_notice(uuid, text[], text[], jsonb, date, date, text[], timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.batchd_lot_in_range(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batchd_lot_in_range(text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.batchd_norm_lot(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batchd_norm_lot(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.batchd_norm_gtin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batchd_norm_gtin(text) TO authenticated, service_role;

COMMIT;

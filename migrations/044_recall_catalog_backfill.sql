-- 044_recall_catalog_backfill.sql (2026-11-08)
--
-- Improvement plan B4, stage 3 (docs/B4-RECALL-CATALOG-PLAN.md): copy the
-- per-organization public feed rows that still live in `recalls` (source
-- fda or mattilsynet, with an organization) into the catalog, once each,
-- and record what each organization had: a recall_catalog_org row per
-- (organization, entry), dismissed where the organization's copy was
-- inactive, matched where a scan match pointed at the copy. Matches that
-- pointed at a copy also gain the entry's catalog_id.
--
-- Nothing is deleted. The copies keep serving every screen until B4 stage 6
-- removes them. Deleting rows from `recalls` is NOT part of this migration.
--
-- The key is the one fetch-recall-feeds.js writes, so a migrated entry and
-- a freshly imported one meet on the unique key (source, external_key):
--   with a recall number:  <number>|<first 12 hex of md5(product_name)>
--   without one:           pd|<product_name>|<report day>
-- The recall number is read from the end of the description ("... [F-1234-2026]"),
-- which the importer has always kept there. The 2026-04 orphan rows
-- (no organization) were removed by scripts/cleanup-orphan-feed-recalls.sql.
--
-- Re-runnable: every insert is ON CONFLICT DO NOTHING or an update that only
-- fills empty columns. One transaction. Staging first, then production.

BEGIN;

-- ── 0. The lot parser (also used to refresh migrated entries) ─────────────────
CREATE OR REPLACE FUNCTION public.batchd_parse_lots(p_text text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(ARRAY(
    SELECT DISTINCT t FROM regexp_split_to_table(COALESCE(p_text, ''), '[,;\s/]+') AS t
    WHERE t ~ '^[A-Za-z0-9][A-Za-z0-9.-]{3,29}$' AND t ~ '\d'
      AND t !~ '^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$' AND t !~ '^\d{1,2}[./-]\d{2,4}$'
      AND t !~ '^\d{1,4}$' AND t !~ '^\d{12,14}$'
    LIMIT 50), '{}');
$$;
REVOKE ALL ON FUNCTION public.batchd_parse_lots(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batchd_parse_lots(text) TO authenticated, service_role;

-- ── 1. The entries ──────────────────────────────────────────────────────────
WITH src AS (
  SELECT r.id AS recall_id, r.organisation_id, r.source, r.product_name, r.lot_number, r.description,
         r.active, r.resolved_at, r.created_at,
         substring(r.description FROM '\[([A-Z]-\d{4}-\d{4})\]$') AS recall_number
  FROM public.recalls r
  WHERE r.source IN ('fda', 'mattilsynet') AND r.organisation_id IS NOT NULL AND r.product_name IS NOT NULL
),
keyed AS (
  SELECT *,
         CASE WHEN recall_number IS NOT NULL
              THEN recall_number || '|' || left(md5(product_name), 12)
              ELSE 'pd|' || product_name || '|' || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') END AS external_key
  FROM src
),
entries AS (
  SELECT DISTINCT ON (source, external_key)
         source, external_key, recall_number, product_name,
         lot_number AS code_info,
         -- conservative lot parse, the same rule as parseCodeInfo in the importer:
         -- 4 to 30 characters, at least one digit, no spaces, not a date, not a
         -- bare number of four digits or fewer (years, counts), not a UPC
         public.batchd_parse_lots(lot_number) AS lots,
         NULLIF(regexp_replace(description, '\s*\[[A-Z]-\d{4}-\d{4}\]$', ''), '') AS reason,
         (created_at AT TIME ZONE 'UTC')::date AS report_date,
         created_at AS published_at,
         created_at
  FROM keyed
  ORDER BY source, external_key, created_at
)
INSERT INTO public.recall_catalog (source, external_key, recall_number, product_name, code_info, lots, reason, report_date, published_at, created_at)
SELECT source, external_key, recall_number, product_name, code_info, lots, reason, report_date, published_at, created_at
FROM entries
ON CONFLICT (source, external_key) DO NOTHING;

-- Migrated entries (no raw feed text yet) take the current parser's lots, so
-- a rerun after a parser change refreshes them.
UPDATE public.recall_catalog SET lots = public.batchd_parse_lots(code_info)
 WHERE raw IS NULL AND code_info IS NOT NULL AND lots IS DISTINCT FROM public.batchd_parse_lots(code_info);

-- ── 2. What each organization had ───────────────────────────────────────────
WITH src AS (
  SELECT r.id AS recall_id, r.organisation_id, r.source, r.product_name, r.active, r.resolved_at, r.created_at,
         substring(r.description FROM '\[([A-Z]-\d{4}-\d{4})\]$') AS recall_number
  FROM public.recalls r
  WHERE r.source IN ('fda', 'mattilsynet') AND r.organisation_id IS NOT NULL AND r.product_name IS NOT NULL
),
keyed AS (
  SELECT *, CASE WHEN recall_number IS NOT NULL THEN recall_number || '|' || left(md5(product_name), 12)
                 ELSE 'pd|' || product_name || '|' || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') END AS external_key
  FROM src
),
per_org AS (
  SELECT k.organisation_id, c.id AS catalog_id,
         min(k.created_at) AS first_seen_at,
         -- dismissed only when every copy the organization had is inactive
         CASE WHEN bool_and(k.active IS NOT TRUE) THEN COALESCE(max(k.resolved_at), now()) END AS dismissed_at,
         (SELECT min(m.matched_at) FROM public.scan_recall_matches m
           WHERE m.recall_id = ANY (array_agg(k.recall_id)) AND m.organisation_id = k.organisation_id) AS matched_at
  FROM keyed k
  JOIN public.recall_catalog c ON c.source = k.source AND c.external_key = k.external_key
  GROUP BY k.organisation_id, c.id
)
INSERT INTO public.recall_catalog_org (organisation_id, catalog_id, first_seen_at, dismissed_at, matched_at)
SELECT organisation_id, catalog_id, first_seen_at, dismissed_at, matched_at FROM per_org
ON CONFLICT (organisation_id, catalog_id) DO UPDATE
  SET first_seen_at = LEAST(public.recall_catalog_org.first_seen_at, EXCLUDED.first_seen_at),
      dismissed_at  = COALESCE(public.recall_catalog_org.dismissed_at, EXCLUDED.dismissed_at),
      matched_at    = COALESCE(public.recall_catalog_org.matched_at, EXCLUDED.matched_at);

-- ── 3. Matches that pointed at a copy also point at the entry ───────────────
WITH src AS (
  SELECT r.id AS recall_id, r.source, r.product_name, r.created_at,
         substring(r.description FROM '\[([A-Z]-\d{4}-\d{4})\]$') AS recall_number
  FROM public.recalls r
  WHERE r.source IN ('fda', 'mattilsynet') AND r.organisation_id IS NOT NULL AND r.product_name IS NOT NULL
),
keyed AS (
  SELECT *, CASE WHEN recall_number IS NOT NULL THEN recall_number || '|' || left(md5(product_name), 12)
                 ELSE 'pd|' || product_name || '|' || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') END AS external_key
  FROM src
)
UPDATE public.scan_recall_matches m
   SET catalog_id = c.id
  FROM keyed k
  JOIN public.recall_catalog c ON c.source = k.source AND c.external_key = k.external_key
 WHERE m.recall_id = k.recall_id AND m.catalog_id IS NULL;

COMMIT;

-- ── Verification (read-only, run after) ─────────────────────────────────────
-- Every per-organization feed row must have exactly one catalog entry.
-- SELECT
--   (SELECT count(*) FROM recalls WHERE source IN ('fda','mattilsynet') AND organisation_id IS NOT NULL) AS copies,
--   (SELECT count(DISTINCT (source, CASE WHEN substring(description FROM '\[([A-Z]-\d{4}-\d{4})\]$') IS NOT NULL
--        THEN substring(description FROM '\[([A-Z]-\d{4}-\d{4})\]$') || '|' || left(md5(product_name), 12)
--        ELSE 'pd|' || product_name || '|' || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') END))
--      FROM recalls WHERE source IN ('fda','mattilsynet') AND organisation_id IS NOT NULL) AS distinct_keys,
--   (SELECT count(*) FROM recall_catalog) AS catalog_entries,
--   (SELECT count(*) FROM recall_catalog_org) AS org_rows,
--   (SELECT count(*) FROM scan_recall_matches WHERE catalog_id IS NOT NULL) AS matches_pointed;

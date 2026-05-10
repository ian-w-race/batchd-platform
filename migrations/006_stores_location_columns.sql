-- 006_stores_location_columns.sql
--
-- Add structured location columns to stores so the dashboard map UI
-- (Claude Design pivot, 2026-05) and recall-distribution geographic
-- views have something to render against. Existing single-line `address`
-- column is preserved for backward compatibility — the new registration
-- flow will populate both the structured fields AND assemble a freeform
-- `address` string so older code paths (Stores panel, lot lookup, etc.)
-- keep working unchanged.
--
-- All columns nullable. Existing rows are not backfilled — they continue
-- to work with just `name + address`. New registrations should require
-- the structured fields once the new UI is in.
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS (Postgres 9.6+).

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS street_address  text,
  ADD COLUMN IF NOT EXISTS city            text,
  ADD COLUMN IF NOT EXISTS region          text,           -- US state or Norwegian fylke
  ADD COLUMN IF NOT EXISTS postal_code     text,
  ADD COLUMN IF NOT EXISTS country         text,           -- ISO-2: 'US' or 'NO'
  ADD COLUMN IF NOT EXISTS phone           text,
  ADD COLUMN IF NOT EXISTS latitude        double precision,
  ADD COLUMN IF NOT EXISTS longitude       double precision,
  ADD COLUMN IF NOT EXISTS geocoded_at     timestamp with time zone,
  ADD COLUMN IF NOT EXISTS geocoding_source text;          -- 'manual', 'browser_geo', 'mapbox', etc.

-- Light validation: latitude in [-90, 90], longitude in [-180, 180].
-- Skipped if the constraint already exists (safe to re-run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stores_latitude_range_check'
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_latitude_range_check
        CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stores_longitude_range_check'
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_longitude_range_check
        CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stores_country_iso2_check'
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_country_iso2_check
        CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
  END IF;
END $$;

-- No new index. Map queries filter by organisation_id (which is already
-- indexed via the existing FK) and pull all rows for that org — usually
-- < 500 rows — then render client-side. If we ever do bounding-box
-- geo-queries at scale, add a PostGIS GIST index then, not now.

COMMENT ON COLUMN public.stores.region IS
  'Subnational region. US: 2-letter state code (e.g. ''CA''). NO: fylke name (e.g. ''Oslo'').';
COMMENT ON COLUMN public.stores.country IS
  'ISO 3166-1 alpha-2 country code. Currently ''US'' or ''NO''.';
COMMENT ON COLUMN public.stores.geocoding_source IS
  'How latitude/longitude were obtained. ''manual'' = user typed in. ''browser_geo'' = navigator.geolocation. ''mapbox'' / other = third-party geocoding service.';

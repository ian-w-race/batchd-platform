-- 023_receiving_events.sql
-- Phase 1 of the FSMA 204 handoff, step 2 of 5. US-only (2026-09-29).
-- One transaction; re-runnable. Requires 022 (suppliers) first.
--
-- The Receiving critical tracking event: one row per lot per delivery
-- line, carrying every receiving key data element in 21 CFR 1.1345.
-- Shelf scans link to a receiving record through the new
-- scans.receiving_event_id column; the link is best-effort, the
-- receiving record is the legal record regardless.
--
-- Policies follow migration 021's pattern. Members read; active members
-- insert into their own organisation; managers and corp admins update;
-- nobody deletes from the client.
--
-- Run in the Supabase SQL editor. Expect "Success. No rows returned".
-- The destructive-operations warning is expected (DROP POLICY IF EXISTS).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 1. Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.receiving_events (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id            uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  store_id                   uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  supplier_id                uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name_snapshot     text,                       -- copied at write time so exports survive supplier edits
  product_name               text NOT NULL,
  gtin                       text,                       -- AI(01) or retail GTIN, normalized
  traceability_lot_code      text,                       -- AI(10) or typed; the TLC
  tlc_source_type            text
                             CHECK (tlc_source_type IS NULL OR tlc_source_type IN
                                    ('supplier_label','shipping_document','assigned_by_us','not_required_exempt_source')),
  tlc_source_reference       text,                       -- URL or document id pointing at the TLC source
  quantity                   numeric NOT NULL CHECK (quantity >= 0),
  unit_of_measure            text NOT NULL,              -- 'case' | 'each' | 'lb' | 'bag' | 'pallet' | free text
  received_at                timestamptz NOT NULL DEFAULT now(),
  reference_document_type    text
                             CHECK (reference_document_type IS NULL OR reference_document_type IN
                                    ('PO','BOL','invoice','ASN','other')),
  reference_document_number  text,
  is_ftl                     boolean NOT NULL DEFAULT false,
  ftl_category               text,
  ftl_confirmed_by_staff     boolean NOT NULL DEFAULT false,
  pack_date                  date,                       -- AI(11)
  best_by                    date,                       -- AI(15) or AI(17)
  raw_label_capture          text,                       -- verbatim GS1 element string or photo-derived text
  label_photo_url            text,
  source                     text NOT NULL DEFAULT 'staff_scan'
                             CHECK (source IN ('staff_scan','wholesaler_import','manual_entry')),
  status                     text NOT NULL DEFAULT 'received'
                             CHECK (status IN ('expected','received','rejected')),
  import_batch_id            uuid,                       -- set by the wholesaler import (Phase 7)
  received_by                text,                       -- staff email
  notes                      text,
  client_uuid                uuid UNIQUE,                -- idempotency for offline replay
  retain_until               timestamptz,                -- received_at + 2 years (21 CFR 1.1455(a)); set by trigger when null
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receiving_events_org_lot_idx
  ON public.receiving_events (organisation_id, traceability_lot_code);
CREATE INDEX IF NOT EXISTS receiving_events_org_store_received_idx
  ON public.receiving_events (organisation_id, store_id, received_at DESC);
CREATE INDEX IF NOT EXISTS receiving_events_org_store_status_idx
  ON public.receiving_events (organisation_id, store_id, status);

-- Retention default. The rule's two-year minimum is applied when the
-- client does not supply its own retain_until.
CREATE OR REPLACE FUNCTION public.batchd_receiving_set_retention()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.retain_until IS NULL THEN
    NEW.retain_until := NEW.received_at + interval '2 years';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS receiving_events_set_retention ON public.receiving_events;
CREATE TRIGGER receiving_events_set_retention
  BEFORE INSERT OR UPDATE OF received_at ON public.receiving_events
  FOR EACH ROW EXECUTE FUNCTION public.batchd_receiving_set_retention();

-- ── 2. Link from shelf scans ────────────────────────────────────────────
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS receiving_event_id uuid REFERENCES public.receiving_events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS scans_receiving_event_idx ON public.scans (receiving_event_id);

-- ── 3. Privileges and RLS ───────────────────────────────────────────────
ALTER TABLE public.receiving_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receiving_events FROM public, anon;
GRANT SELECT, INSERT, UPDATE ON public.receiving_events TO authenticated;   -- no DELETE for clients
GRANT ALL ON public.receiving_events TO service_role;

DROP POLICY IF EXISTS b23_receiving_member_select ON public.receiving_events;
CREATE POLICY b23_receiving_member_select ON public.receiving_events FOR SELECT
  USING (organisation_id IN (SELECT public.batchd_my_active_org_ids()));

DROP POLICY IF EXISTS b23_receiving_member_insert ON public.receiving_events;
CREATE POLICY b23_receiving_member_insert ON public.receiving_events FOR INSERT
  WITH CHECK (organisation_id IN (SELECT public.batchd_my_active_org_ids()));

DROP POLICY IF EXISTS b23_receiving_manager_update ON public.receiving_events;
CREATE POLICY b23_receiving_manager_update ON public.receiving_events FOR UPDATE
  USING      (public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_manager_of(organisation_id))
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_manager_of(organisation_id));

DROP POLICY IF EXISTS b23_receiving_platform_admin ON public.receiving_events;
CREATE POLICY b23_receiving_platform_admin ON public.receiving_events FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

COMMENT ON TABLE public.receiving_events IS
  'Receiving critical tracking event, one row per lot per delivery line (21 CFR 1.1345 key data elements). Shelf scans link via scans.receiving_event_id. Added 2026-10-03, migration 023.';

-- ── 4. Post-check ───────────────────────────────────────────────────────
DO $$
DECLARE n int; has_col boolean;
BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename='receiving_events';
  IF n < 4 THEN RAISE EXCEPTION 'receiving_events: expected 4 policies, found %', n; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='scans' AND column_name='receiving_event_id') INTO has_col;
  IF NOT has_col THEN RAISE EXCEPTION 'scans.receiving_event_id was not added'; END IF;
  RAISE NOTICE 'OK: receiving_events created with % policies; scans.receiving_event_id present', n;
END $$;

COMMIT;

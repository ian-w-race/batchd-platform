-- 020_helpers_membership_ai_flag.sql
-- Run AFTER 019. One transaction: a failure applies nothing; re-running is safe.
-- Closes review items C1, C2, H15, H16, H17, H19 and adds the plan-based AI flag.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 0. 019's drops, repeated as no-ops ───────────────────────────────────
DROP POLICY IF EXISTS "Anyone can read invitation by token" ON public.invitations;
DROP POLICY IF EXISTS "Insert own membership"              ON public.organisation_members;
DROP POLICY IF EXISTS "Admins can update org memberships"  ON public.organisation_members;
DROP POLICY IF EXISTS "Delete own memberships"             ON public.organisation_members;

-- ── 1. Org-parameterised RLS helpers (SECURITY DEFINER, pinned search_path) ─
CREATE OR REPLACE FUNCTION public.batchd_bypass_guards_active()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('batchd.bypass_guards', true) = 'on';
$$;

CREATE OR REPLACE FUNCTION public.batchd_my_active_org_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organisation_id FROM public.organisation_members
  WHERE user_id = auth.uid() AND COALESCE(active, true) = true;
$$;

CREATE OR REPLACE FUNCTION public.batchd_is_corp_admin_of(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organisation_members
    WHERE user_id = auth.uid() AND organisation_id = p_org
      AND role = 'corp_admin' AND COALESCE(active, true) = true);
$$;

CREATE OR REPLACE FUNCTION public.batchd_is_manager_of(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organisation_members
    WHERE user_id = auth.uid() AND organisation_id = p_org
      AND role IN ('corp_admin','store_manager') AND COALESCE(active, true) = true);
$$;

CREATE OR REPLACE FUNCTION public.batchd_is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organisation_members
    WHERE user_id = auth.uid() AND is_batched_admin = true AND COALESCE(active, true) = true);
$$;

CREATE OR REPLACE FUNCTION public.batchd_my_source_event_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id FROM public.recall_events e
  WHERE e.source_org_id IN (SELECT public.batchd_my_active_org_ids());
$$;

CREATE OR REPLACE FUNCTION public.batchd_my_partner_source_org_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT e.source_org_id
  FROM public.recall_events e
  JOIN public.recall_distributions d ON d.recall_event_id = e.id
  WHERE d.retailer_org_id IN (SELECT public.batchd_my_active_org_ids())
    AND e.source_org_id IS NOT NULL;
$$;

-- The commercial flag. AI (Anthropic) features require plan IN ('pov','active').
CREATE OR REPLACE FUNCTION public.batchd_org_ai_enabled(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organisations WHERE id = p_org AND plan IN ('pov','active'));
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.batchd_my_active_org_ids()', 'public.batchd_is_corp_admin_of(uuid)',
    'public.batchd_is_manager_of(uuid)', 'public.batchd_is_platform_admin()',
    'public.batchd_my_source_event_ids()', 'public.batchd_my_partner_source_org_ids()',
    'public.batchd_org_ai_enabled(uuid)', 'public.batchd_bypass_guards_active()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- Pin search_path on older functions where they exist (skip silently otherwise).
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.products_normalize_barcode_trigger()', 'public.promote_product_trust_tier_on_scan()',
    'public.batchd_user_primary_store_id()', 'public.batchd_user_manages_store(uuid)',
    'public.batchd_user_org_id()', 'public.batchd_user_is_corp_admin()',
    'public.batchd_user_is_store_manager()', 'public.batchd_user_role()']
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', f);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip search_path pin, not found: %', f;
    END;
  END LOOP;
END $$;

-- ── 2. Migration-004 writer functions: no longer callable by clients (H16) ─
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.bootstrap_products_pending()', 'public.promote_pending_to_products(uuid)', 'public.reject_pending(uuid, text)']
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', f);
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', f);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip, not found: %', f;
    END;
  END LOOP;
END $$;
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_org_member_emails(uuid) FROM anon;
EXCEPTION WHEN undefined_function THEN RAISE NOTICE 'get_org_member_emails not found'; END $$;

-- ── 3. organisation_members guards (C1, H15) ─────────────────────────────
-- Any end-user session: rows cannot change user or organisation; is_batched_admin is
-- Batch'd-only. Own row: role and active are admin-controlled.
CREATE OR REPLACE FUNCTION public.batchd_guard_member_self_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.batchd_bypass_guards_active() THEN RETURN NEW; END IF;
  o := to_jsonb(OLD); n := to_jsonb(NEW);
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'A membership cannot be reassigned to another user.';
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
    RAISE EXCEPTION 'A membership cannot be moved to another organisation.';
  END IF;
  IF (n->>'is_batched_admin') IS DISTINCT FROM (o->>'is_batched_admin') THEN
    RAISE EXCEPTION 'Platform admin status can only be changed by Batch''d support.';
  END IF;
  IF NEW.user_id = auth.uid() THEN
    IF NEW.role   IS DISTINCT FROM OLD.role   THEN RAISE EXCEPTION 'You cannot change your own role.'; END IF;
    IF NEW.active IS DISTINCT FROM OLD.active THEN RAISE EXCEPTION 'You cannot change your own active status.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS batchd_guard_member_self_update ON public.organisation_members;
CREATE TRIGGER batchd_guard_member_self_update
  BEFORE UPDATE ON public.organisation_members
  FOR EACH ROW EXECUTE FUNCTION public.batchd_guard_member_self_update();

CREATE OR REPLACE FUNCTION public.batchd_guard_member_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.batchd_bypass_guards_active()
     AND COALESCE((to_jsonb(NEW)->>'is_batched_admin')::boolean, false) THEN
    RAISE EXCEPTION 'Platform admin status can only be granted by Batch''d support.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS batchd_guard_member_insert ON public.organisation_members;
CREATE TRIGGER batchd_guard_member_insert
  BEFORE INSERT ON public.organisation_members
  FOR EACH ROW EXECUTE FUNCTION public.batchd_guard_member_insert();

-- Membership policies re-expressed with org-parameterised helpers (H17).
DROP POLICY IF EXISTS organisation_members_corp_admin_update ON public.organisation_members;
CREATE POLICY organisation_members_corp_admin_update ON public.organisation_members FOR UPDATE
  USING      (public.batchd_is_corp_admin_of(organisation_id))
  WITH CHECK (public.batchd_is_corp_admin_of(organisation_id));

DROP POLICY IF EXISTS organisation_members_manager_update ON public.organisation_members;
CREATE POLICY organisation_members_manager_update ON public.organisation_members FOR UPDATE
  USING (
    public.batchd_is_manager_of(organisation_id)
    AND role IN ('store_manager','staff')
    AND (primary_store_id IS NULL OR EXISTS (
          SELECT 1 FROM public.store_manager_stores s
          WHERE s.user_id = auth.uid() AND s.store_id = organisation_members.primary_store_id)))
  WITH CHECK (public.batchd_is_manager_of(organisation_id) AND role IN ('store_manager','staff'));

DROP POLICY IF EXISTS b20_members_platform_admin ON public.organisation_members;
CREATE POLICY b20_members_platform_admin ON public.organisation_members FOR ALL
  USING (public.batchd_is_platform_admin()) WITH CHECK (public.batchd_is_platform_admin());

-- Constraints: applied only when existing data already conforms; otherwise NOTICE.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT coalesce(role,'<null>'), ', ') INTO bad
  FROM public.organisation_members WHERE role IS NULL OR role NOT IN ('corp_admin','store_manager','staff','mfr_admin','mfr_qa');
  IF bad IS NOT NULL THEN
    RAISE NOTICE 'SKIPPED organisation_members_role_check: unexpected roles present: %', bad;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisation_members_role_check') THEN
    ALTER TABLE public.organisation_members ADD CONSTRAINT organisation_members_role_check
      CHECK (role IN ('corp_admin','store_manager','staff','mfr_admin','mfr_qa'));
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.organisation_members GROUP BY user_id, organisation_id HAVING count(*) > 1) THEN
    RAISE NOTICE 'SKIPPED organisation_members_user_org_unique: duplicate (user_id, organisation_id) rows exist. Dedupe, then: CREATE UNIQUE INDEX organisation_members_user_org_unique ON public.organisation_members (user_id, organisation_id);';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS organisation_members_user_org_unique
      ON public.organisation_members (user_id, organisation_id);
  END IF;
END $$;

-- ── 4. invitations: only corp_admins of the org (or platform admin) touch them (C2) ─
DROP POLICY IF EXISTS b20_inv_admin_select ON public.invitations;
CREATE POLICY b20_inv_admin_select ON public.invitations FOR SELECT
  USING (public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_platform_admin());
DROP POLICY IF EXISTS b20_inv_admin_insert ON public.invitations;
CREATE POLICY b20_inv_admin_insert ON public.invitations FOR INSERT
  WITH CHECK ((public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_platform_admin())
              AND role IN ('staff','store_manager','corp_admin')
              AND COALESCE(accepted, false) = false
              AND token IS NOT NULL);
DROP POLICY IF EXISTS b20_inv_admin_update ON public.invitations;
CREATE POLICY b20_inv_admin_update ON public.invitations FOR UPDATE
  USING      ((public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_platform_admin()) AND COALESCE(accepted,false) = false)
  WITH CHECK ((public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_platform_admin()) AND role IN ('staff','store_manager','corp_admin'));
DROP POLICY IF EXISTS b20_inv_admin_delete ON public.invitations;
CREATE POLICY b20_inv_admin_delete ON public.invitations FOR DELETE
  USING (public.batchd_is_corp_admin_of(organisation_id) OR public.batchd_is_platform_admin());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invitations GROUP BY token HAVING count(*) > 1) THEN
    RAISE NOTICE 'SKIPPED invitations_token_unique: duplicate tokens exist.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_unique ON public.invitations (token);
  END IF;
END $$;
-- 30 days: admin-created founding-admin invites are sometimes accepted slowly.
ALTER TABLE public.invitations ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');

-- ── 5. Plan flag: values, and who may change commercial columns ──────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT plan, ', ') INTO bad
  FROM public.organisations WHERE plan IS NOT NULL AND plan NOT IN ('trial','pov','active','churned');
  IF bad IS NOT NULL THEN
    RAISE NOTICE 'SKIPPED organisations_plan_check: unexpected plan values: %', bad;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_plan_check') THEN
    ALTER TABLE public.organisations ADD CONSTRAINT organisations_plan_check
      CHECK (plan IS NULL OR plan IN ('trial','pov','active','churned'));
  END IF;
END $$;
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT coalesce(type,'<null>'), ', ') INTO bad
  FROM public.organisations WHERE type IS NULL OR type NOT IN ('retailer','manufacturer');
  IF bad IS NOT NULL THEN
    RAISE NOTICE 'SKIPPED organisations_type_check: unexpected types: %', bad;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_type_check') THEN
    ALTER TABLE public.organisations ADD CONSTRAINT organisations_type_check CHECK (type IN ('retailer','manufacturer'));
  END IF;
END $$;
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT region, ', ') INTO bad
  FROM public.organisations WHERE region IS NOT NULL AND region NOT IN ('us','no');
  IF bad IS NOT NULL THEN
    RAISE NOTICE 'SKIPPED organisations_region_check: unexpected regions: %', bad;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_region_check') THEN
    ALTER TABLE public.organisations ADD CONSTRAINT organisations_region_check CHECK (region IS NULL OR region IN ('us','no'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.batchd_guard_org_commercial_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.batchd_bypass_guards_active() OR public.batchd_is_platform_admin() THEN RETURN NEW; END IF;
  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.billing_status IS DISTINCT FROM OLD.billing_status
     OR NEW.trial_expires_at IS DISTINCT FROM OLD.trial_expires_at
     OR NEW.is_internal IS DISTINCT FROM OLD.is_internal THEN
    RAISE EXCEPTION 'Plan and billing fields are managed by Batch''d.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS batchd_guard_org_commercial_columns ON public.organisations;
CREATE TRIGGER batchd_guard_org_commercial_columns
  BEFORE UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION public.batchd_guard_org_commercial_columns();

-- ── 6. Onboarding RPCs: same signatures as 018, hardened bodies (H19, C2) ─
-- VERIFIED 2026-09-20 against 018: argument lists and RETURNS clauses match.
CREATE OR REPLACE FUNCTION public.create_organisation_with_admin(
  p_name text, p_type text, p_contact_email text, p_region text, p_store_names text[] DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_org uuid; v_nm text; v_i int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'You must be signed in to create an organisation.'; END IF;
  IF EXISTS (SELECT 1 FROM public.organisation_members WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'This account already belongs to an organisation.';
  END IF;
  IF p_type = 'manufacturer' THEN
    RAISE EXCEPTION 'Manufacturer sign-up is no longer available.';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Organisation name must be 2 to 120 characters.';
  END IF;
  IF p_region IS NULL OR p_region NOT IN ('us','no') THEN
    RAISE EXCEPTION 'Region must be us or no.';
  END IF;
  IF p_store_names IS NOT NULL AND array_length(p_store_names, 1) > 100 THEN
    RAISE EXCEPTION 'Add at most 100 stores at sign-up.';
  END IF;
  PERFORM set_config('batchd.bypass_guards', 'on', true);
  INSERT INTO public.organisations (name, type, contact_email, region, plan)
  VALUES (trim(p_name), 'retailer', p_contact_email, p_region, 'trial') RETURNING id INTO v_org;
  INSERT INTO public.organisation_members (user_id, organisation_id, role, active)
  VALUES (v_uid, v_org, 'corp_admin', true);
  IF p_store_names IS NOT NULL THEN
    FOREACH v_nm IN ARRAY p_store_names LOOP
      CONTINUE WHEN v_nm IS NULL OR length(trim(v_nm)) = 0;
      v_i := v_i + 1;
      INSERT INTO public.stores (name, organisation_id, store_code, active)
      VALUES (left(trim(v_nm), 120), v_org, 'STORE-' || lpad(v_i::text, 3, '0'), true);
    END LOOP;
  END IF;
  RETURN v_org;
END $$;

CREATE OR REPLACE FUNCTION public.accept_invitation(
  p_token text, p_full_name text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_hire_date text DEFAULT NULL, p_store_role text DEFAULT NULL, p_employee_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_email text := lower(coalesce(auth.jwt() ->> 'email',''));
        v_inv public.invitations%ROWTYPE; v_region text; v_store uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'You must be signed in to accept an invitation.'; END IF;
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'Invitation not found.'; END IF;
  SELECT * INTO v_inv FROM public.invitations WHERE token = p_token LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found.'; END IF;
  IF COALESCE(v_inv.accepted,false) THEN RAISE EXCEPTION 'This invitation has already been used.'; END IF;
  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN RAISE EXCEPTION 'This invitation has expired.'; END IF;
  IF lower(coalesce(v_inv.email,'')) <> v_email OR v_email = '' THEN
    RAISE EXCEPTION 'This invitation was issued to a different email address.';
  END IF;
  IF v_inv.role NOT IN ('staff','store_manager','corp_admin') THEN
    RAISE EXCEPTION 'This invitation has an unsupported role.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organisation_members WHERE user_id = v_uid AND organisation_id = v_inv.organisation_id) THEN
    RAISE EXCEPTION 'You are already a member of this organisation.';
  END IF;
  PERFORM set_config('batchd.bypass_guards', 'on', true);
  IF v_inv.role = 'store_manager' AND v_inv.manager_store_ids IS NOT NULL
     AND array_length(v_inv.manager_store_ids,1) > 0 THEN v_store := NULL; ELSE v_store := v_inv.store_id; END IF;
  INSERT INTO public.organisation_members
    (organisation_id, user_id, role, store_id, full_name, phone_number, hire_date, store_role, employee_id, joined_at, active)
  VALUES (v_inv.organisation_id, v_uid, v_inv.role, v_store,
          COALESCE(NULLIF(p_full_name,''), v_inv.full_name),
          COALESCE(NULLIF(p_phone,''), v_inv.phone_number),
          COALESCE(NULLIF(p_hire_date,'')::date, v_inv.hire_date),
          COALESCE(NULLIF(p_store_role,''), v_inv.store_role),
          COALESCE(NULLIF(p_employee_id,''), v_inv.employee_id),
          now(), true);
  IF v_inv.role = 'store_manager' THEN
    INSERT INTO public.user_profiles (id, is_manager) VALUES (v_uid, true)
    ON CONFLICT (id) DO UPDATE SET is_manager = true;
    IF v_inv.manager_store_ids IS NOT NULL THEN
      INSERT INTO public.store_manager_stores (user_id, store_id, organisation_id, assigned_by)
      SELECT v_uid, s.id, v_inv.organisation_id, v_inv.invited_by
      FROM unnest(v_inv.manager_store_ids) AS x(store_id)
      JOIN public.stores s ON s.id = x.store_id AND s.organisation_id = v_inv.organisation_id
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  v_region := v_inv.region;
  IF v_region IS NULL THEN SELECT region INTO v_region FROM public.organisations WHERE id = v_inv.organisation_id; END IF;
  v_region := COALESCE(v_region, 'no');
  INSERT INTO public.user_settings (user_id, region, recall_lookback_days, onboarding_done)
  VALUES (v_uid, v_region, 180, true)
  ON CONFLICT (user_id) DO UPDATE SET region = EXCLUDED.region,
    recall_lookback_days = EXCLUDED.recall_lookback_days, onboarding_done = true;
  UPDATE public.invitations SET accepted = true, user_id = v_uid WHERE id = v_inv.id;
  RETURN jsonb_build_object('organisation_id', v_inv.organisation_id, 'role', v_inv.role, 'region', v_region);
END $$;

-- Same RETURNS TABLE as 018. Hides HR/PII once the token is spent or expired.
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token text)
RETURNS TABLE (email text, role text, organisation_id uuid, organisation_name text,
               store_name text, manager_store_ids uuid[], accepted boolean, expired boolean,
               full_name text, phone_number text, store_role text, employee_id text,
               hire_date date, region text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH inv AS (
    SELECT i.*, COALESCE(i.accepted,false) AS acc,
           (i.expires_at IS NOT NULL AND i.expires_at < now()) AS exp
    FROM public.invitations i
    WHERE p_token IS NOT NULL AND length(p_token) >= 16 AND i.token = p_token
    LIMIT 1)
  SELECT CASE WHEN acc OR exp THEN NULL ELSE inv.email END,
         inv.role, inv.organisation_id, o.name, s.name,
         CASE WHEN acc OR exp THEN NULL ELSE inv.manager_store_ids END,
         acc, exp,
         CASE WHEN acc OR exp THEN NULL ELSE inv.full_name END,
         CASE WHEN acc OR exp THEN NULL ELSE inv.phone_number END,
         CASE WHEN acc OR exp THEN NULL ELSE inv.store_role END,
         CASE WHEN acc OR exp THEN NULL ELSE inv.employee_id END,
         CASE WHEN acc OR exp THEN NULL ELSE inv.hire_date END,
         inv.region
  FROM inv
  LEFT JOIN public.organisations o ON o.id = inv.organisation_id
  LEFT JOIN public.stores        s ON s.id = inv.store_id;
$$;

-- New: replaces join.html's anonymous read of stores (needed once 021 locks stores).
CREATE OR REPLACE FUNCTION public.get_invitation_store_names(p_token text)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(s.name ORDER BY s.name), '{}')
  FROM public.invitations i
  JOIN public.stores s ON s.id = ANY(i.manager_store_ids) AND s.organisation_id = i.organisation_id
  WHERE p_token IS NOT NULL AND length(p_token) >= 16 AND i.token = p_token
    AND COALESCE(i.accepted,false) = false
    AND (i.expires_at IS NULL OR i.expires_at >= now());
$$;
REVOKE ALL ON FUNCTION public.get_invitation_store_names(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_invitation_store_names(text) TO anon, authenticated;

-- ── 6b. Addendum: triage-complaint.js stores a salted IP hash for rate limiting ─
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS ip_hash text;
CREATE INDEX IF NOT EXISTS complaints_ip_hash_created_idx ON public.complaints (ip_hash, created_at);

-- ── 6c. send_invitation: add the missing authorisation check ─────────────
-- Found 2026-09-21 by the pre-flight diagnostic. The live function is
-- SECURITY DEFINER, has no search_path pinned, and takes p_organisation_id
-- and p_role straight from the caller with NO check that the caller has
-- anything to do with that organisation. Any signed-in user could call
--   send_invitation('<any org id>', '<their own address>', 'corp_admin', NULL)
-- and redeem the returned token at /join to become a corporate admin of any
-- organisation on the platform.
--
-- The rest of 020 does NOT close this on its own: section 4's policies govern
-- direct writes to invitations, and SECURITY DEFINER bypasses RLS; and
-- accept_invitation deliberately trusts the invitation row, which is exactly
-- what this function creates.
--
-- Signature and the four returned keys (token, org_name, inviter_email,
-- invitation_id) are unchanged — dashboard.html and admin.html read them.
-- DROP first because the original's return type was not captured and
-- CREATE OR REPLACE cannot change a return type.
--
-- Token: two gen_random_uuid()s, hyphens stripped = 64 hex chars. Uses core
-- PG13+ functions so this does not depend on the pgcrypto extension.

DROP FUNCTION IF EXISTS public.send_invitation(uuid, text, text, uuid);

CREATE FUNCTION public.send_invitation(
  p_organisation_id uuid,
  p_email           text,
  p_role            text,
  p_store_id        uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation_id uuid;
  v_token         text;
  v_org_name      text;
  v_inviter_email text;
  v_email         text := lower(trim(coalesce(p_email, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to send an invitation.';
  END IF;

  -- The check that was missing.
  IF NOT (public.batchd_is_corp_admin_of(p_organisation_id)
          OR public.batchd_is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorised to invite into this organisation.';
  END IF;

  -- Matches accept_invitation and section 4's INSERT policy. mfr_admin and
  -- mfr_qa are deliberately absent: accept_invitation refuses them, so such
  -- an invitation could be created but never redeemed.
  IF p_role IS NULL OR p_role NOT IN ('staff','store_manager','corp_admin') THEN
    RAISE EXCEPTION 'Role must be staff, store_manager or corp_admin.';
  END IF;

  IF v_email = '' OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A valid email address is required.';
  END IF;

  -- A named store must belong to the same organisation.
  IF p_store_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.stores
        WHERE id = p_store_id AND organisation_id = p_organisation_id) THEN
    RAISE EXCEPTION 'That store does not belong to this organisation.';
  END IF;

  SELECT name  INTO v_org_name      FROM public.organisations WHERE id = p_organisation_id;
  SELECT email INTO v_inviter_email FROM auth.users          WHERE id = auth.uid();

  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.invitations
    (organisation_id, invited_by, email, role, store_id, token, expires_at, accepted)
  VALUES
    (p_organisation_id, auth.uid(), v_email, p_role, p_store_id, v_token,
     now() + interval '30 days', false)
  RETURNING id INTO v_invitation_id;

  RETURN json_build_object(
    'token',         v_token,
    'org_name',      v_org_name,
    'inviter_email', v_inviter_email,
    'invitation_id', v_invitation_id
  );
END $$;

REVOKE ALL ON FUNCTION public.send_invitation(uuid, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_invitation(uuid, text, text, uuid) TO authenticated;

-- ── 7. Post-check ────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND policyname IN
    ('Anyone can read invitation by token','Insert own membership','Admins can update org memberships','Delete own memberships');
  IF n > 0 THEN RAISE WARNING '019 policies still present: %', n;
  ELSE RAISE NOTICE 'OK: 019 policies gone; 020 helpers, guards, invitation policies, hardened send_invitation and plan flag in place.'; END IF;
END $$;

COMMIT;

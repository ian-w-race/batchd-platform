-- 009_three_tier_roles_and_staff_invites.sql
--
-- Phase 1 of the three-tier-role rollout (2026-05):
--   corp_admin    → all stores in an org
--   store_manager → assigned stores only, can invite staff (+ other managers)
--   staff         → single primary store, can scan; can switch store mid-shift
--                   via the scanner-app session picker
--
-- Scope of this migration:
--   1. Helper SQL functions for RLS role checks
--   2. Extend organisation_members with HR fields + primary_store_id + soft-deactivate
--   3. New table: store_manager_stores (many-to-many manager → stores)
--   4. New table: staff_invitations (magic-link invite flow, expires in 7d)
--   5. Add audit columns to scans for the manager scan-correction tool
--   6. RLS policies for the new role model
--
-- Out of scope (intentionally):
--   - UI changes (those land in dashboard.html / index.html in Phase 2+)
--   - Login routing (Phase 2)
--   - Deprecating the manager_escalated column on scans (kept for backward
--     compat; UI no longer reads or writes it)
--   - The Netlify staff-invite.js / staff-invite-accept.js functions
--     (separate files, this migration only adds the schema they target)
--
-- Idempotency: every CREATE uses IF NOT EXISTS / OR REPLACE; every ALTER
-- TABLE uses IF NOT EXISTS on columns. Safe to re-run.

-- Section order note: tables first, then helper functions. SQL functions
-- have eager binding — column and table references are validated at
-- function-creation time, so the columns/tables they reference must
-- exist before the CREATE FUNCTION runs. Helpers therefore live in §3,
-- AFTER §1 (organisation_members extension) and §2 (store_manager_stores
-- creation).

-- ════════════════════════════════════════════════════════════════════
-- §1  Extend organisation_members
-- ════════════════════════════════════════════════════════════════════
-- New columns capture HR data (full_name, phone, hire_date, store_role,
-- employee_id), single-store assignment for floor staff (primary_store_id),
-- and soft-deactivation for offboarded employees. Manager → stores is a
-- separate join table (§3) because managers can cover multiple stores.

-- Note: organisation_members already has an `active` boolean column from
-- an earlier migration; we reuse it (don't re-add) and key off that name
-- throughout this migration's helper functions and policies. The other
-- columns below are net-new.
ALTER TABLE public.organisation_members
  ADD COLUMN IF NOT EXISTS primary_store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS full_name       text,
  ADD COLUMN IF NOT EXISTS phone_number    text,
  ADD COLUMN IF NOT EXISTS hire_date       date,
  ADD COLUMN IF NOT EXISTS store_role      text,
  ADD COLUMN IF NOT EXISTS employee_id     text,
  ADD COLUMN IF NOT EXISTS deactivated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organisation_members_primary_store_idx
  ON public.organisation_members (primary_store_id)
  WHERE primary_store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS organisation_members_active_role_idx
  ON public.organisation_members (organisation_id, role, active);

COMMENT ON COLUMN public.organisation_members.primary_store_id IS
  'Store the user is normally assigned to. For store_staff this is their home store; they can still scan at a different store via the session picker. For store_manager this is informational only — see store_manager_stores for the authoritative many-to-many list. For corp_admin this is typically NULL.';
COMMENT ON COLUMN public.organisation_members.store_role IS
  'Free-text on-the-floor role: cashier, stocker, front-end, produce, deli, bakery, etc. Distinct from organisation_members.role which is the platform role (corp_admin/store_manager/store_staff).';
COMMENT ON COLUMN public.organisation_members.employee_id IS
  'Internal employee/badge number used by the retailer. Optional. Useful when integrating with POS systems later.';
-- Note: the `active` column already had this purpose in the existing
-- schema; we just reuse it. Setting active=false when a manager
-- offboards a staff member preserves scan history while preventing
-- the user from logging in (login flow checks active).

-- ════════════════════════════════════════════════════════════════════
-- §2  store_manager_stores — many-to-many manager assignment
-- ════════════════════════════════════════════════════════════════════
-- One row per (manager, store) pair. A manager covering 3 stores has
-- 3 rows. RLS scoping for scans/recalls/etc. joins through this table.

CREATE TABLE IF NOT EXISTS public.store_manager_stores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id         uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  assigned_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (user_id, store_id)
);

CREATE INDEX IF NOT EXISTS store_manager_stores_user_idx
  ON public.store_manager_stores (user_id);
CREATE INDEX IF NOT EXISTS store_manager_stores_store_idx
  ON public.store_manager_stores (store_id);

COMMENT ON TABLE public.store_manager_stores IS
  'Many-to-many mapping of store_manager users → stores they oversee. A manager may have multiple rows for multiple stores. Authoritative source for "which stores does this manager see"; RLS policies on scans/recalls/complaints/etc. join through here.';

-- ════════════════════════════════════════════════════════════════════
-- §3  Helper functions for role checks
-- ════════════════════════════════════════════════════════════════════
-- Used by RLS policies to keep them readable. Each one is STABLE so
-- Postgres can cache the result within a single query, and SECURITY
-- INVOKER so they respect the caller's permissions on the underlying
-- tables (organisation_members has its own RLS).
--
-- These come AFTER §1 (column additions) and §2 (table creation) because
-- SQL functions have eager binding — their bodies are validated against
-- the schema at CREATE time, so every column/table referenced below
-- must exist by this point.

CREATE OR REPLACE FUNCTION public.batchd_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT role FROM public.organisation_members
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.batchd_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT organisation_id FROM public.organisation_members
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.batchd_user_is_corp_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organisation_members
    WHERE user_id = auth.uid()
      AND role = 'corp_admin'
      AND COALESCE(active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.batchd_user_is_store_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organisation_members
    WHERE user_id = auth.uid()
      AND role = 'store_manager'
      AND COALESCE(active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.batchd_user_primary_store_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT primary_store_id FROM public.organisation_members
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- "Does the calling user manage store X?" — true for corp_admins on any
-- store in their org, and true for store_managers if they have a row in
-- store_manager_stores for that store. Used by RLS on scans, recalls,
-- recall_acknowledgements, complaints, etc.
CREATE OR REPLACE FUNCTION public.batchd_user_manages_store(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    -- corp_admin in the same org as the store
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      JOIN public.stores s ON s.organisation_id = m.organisation_id
      WHERE m.user_id = auth.uid()
        AND m.role = 'corp_admin'
        AND COALESCE(m.active, true) = true
        AND s.id = p_store_id
    )
    OR
    -- store_manager with an explicit assignment to this store
    EXISTS (
      SELECT 1 FROM public.store_manager_stores
      WHERE user_id = auth.uid()
        AND store_id = p_store_id
    );
$$;

-- ════════════════════════════════════════════════════════════════════
-- §4  staff_invitations — magic-link invite flow
-- ════════════════════════════════════════════════════════════════════
-- When a corp_admin or store_manager invites someone, a row goes in
-- here with a secure random token. Resend emails a link
-- (https://app.batchdapp.com/accept-invite.html?token=<token>); when
-- the invitee clicks, the accept-invite Netlify function validates,
-- creates the auth.users row, links organisation_members, links
-- store_manager_stores if applicable, and marks the row accepted.
--
-- Tokens expire after 7 days. Expired tokens cannot be accepted.

CREATE TABLE IF NOT EXISTS public.staff_invitations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token                       text NOT NULL UNIQUE,
  email                       text NOT NULL,
  organisation_id             uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  invited_by                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,

  -- What the invitee will become on acceptance:
  intended_role               text NOT NULL CHECK (intended_role IN ('corp_admin','store_manager','staff')),
  intended_primary_store_id   uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  intended_manager_store_ids  uuid[] DEFAULT NULL,  -- only meaningful when intended_role = 'store_manager'

  -- Pre-filled HR data — invitee can edit on acceptance:
  intended_full_name          text,
  intended_phone_number       text,
  intended_hire_date          date,
  intended_store_role         text,
  intended_employee_id        text,

  -- Lifecycle:
  expires_at                  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at                 timestamptz,
  accepted_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at                timestamptz,
  cancelled_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_invitations_org_idx
  ON public.staff_invitations (organisation_id);
CREATE INDEX IF NOT EXISTS staff_invitations_email_idx
  ON public.staff_invitations (lower(email));
CREATE INDEX IF NOT EXISTS staff_invitations_token_idx
  ON public.staff_invitations (token);
CREATE INDEX IF NOT EXISTS staff_invitations_pending_idx
  ON public.staff_invitations (organisation_id, expires_at)
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;

COMMENT ON TABLE public.staff_invitations IS
  'Pending invites from a manager/admin to a prospective user. Token is a secure random string used as the URL parameter on the accept-invite landing page. Rows are never deleted — preserves audit trail of who invited whom; cancelled invites get cancelled_at stamped.';
COMMENT ON COLUMN public.staff_invitations.intended_manager_store_ids IS
  'When intended_role=store_manager, the array of store IDs the new manager will be assigned to. NULL for store_staff and corp_admin.';

-- ════════════════════════════════════════════════════════════════════
-- §5  scans_audit_log + trigger — full per-field change history
-- ════════════════════════════════════════════════════════════════════
-- Managers have broad UPDATE power on scans in their stores (correcting
-- store_id is the canonical case, but also product_name typos, lot
-- corrections, etc.). Every column change must be auditable: what
-- field, old value, new value, who, when.
--
-- Design:
--   - New scans_audit_log table — one row per (scan, field) change.
--     A single edit event that changes 3 fields produces 3 audit rows.
--     This shape makes "show me all changes to this scan" trivial as
--     an ORDER BY changed_at query, and renders cleanly in a timeline.
--   - AFTER UPDATE trigger on scans diffs OLD vs NEW, inserts audit
--     rows for every column that changed (except id, created_at).
--   - INSERTs are not audited (creation event is implicit in the row).
--   - DELETEs are not audited in v1 (scans are rarely deleted; if they
--     are, that's a corp_admin-only operation by policy).
--   - Audit rows are immutable: SELECT-only RLS, no UPDATE/DELETE
--     policies. Service role can technically still write but UI does
--     not surface that capability.

CREATE TABLE IF NOT EXISTS public.scans_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id      uuid NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
  changed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  field_name   text NOT NULL,
  old_value    text,
  new_value    text
);

CREATE INDEX IF NOT EXISTS scans_audit_log_scan_idx
  ON public.scans_audit_log (scan_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS scans_audit_log_changed_by_idx
  ON public.scans_audit_log (changed_by, changed_at DESC)
  WHERE changed_by IS NOT NULL;

COMMENT ON TABLE public.scans_audit_log IS
  'Immutable append-only log of every change to a scan row. One row per (scan, field) change — a single UPDATE that touches 3 columns produces 3 audit rows. Surfaces in the scan-history UI as a timeline. INSERTs are not logged (creation is implicit); DELETEs are not logged in v1.';

-- Trigger function: compare OLD vs NEW for every column except the
-- ignore-list, insert an audit row per differing column. Uses to_jsonb
-- to iterate columns generically — survives future schema additions
-- without code changes. SECURITY DEFINER so the insert succeeds even
-- if the caller's RLS would block writing to the audit table.
CREATE OR REPLACE FUNCTION public.log_scan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  col_key  text;
  ignore_cols text[] := ARRAY['id', 'created_at'];
BEGIN
  old_data := to_jsonb(OLD);
  new_data := to_jsonb(NEW);

  FOR col_key IN SELECT jsonb_object_keys(new_data) LOOP
    CONTINUE WHEN col_key = ANY(ignore_cols);
    IF (old_data->>col_key) IS DISTINCT FROM (new_data->>col_key) THEN
      INSERT INTO public.scans_audit_log
        (scan_id, changed_by, changed_at, field_name, old_value, new_value)
      VALUES
        (NEW.id, auth.uid(), now(), col_key, old_data->>col_key, new_data->>col_key);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scans_audit_trg ON public.scans;
CREATE TRIGGER scans_audit_trg
  AFTER UPDATE ON public.scans
  FOR EACH ROW
  EXECUTE FUNCTION public.log_scan_change();

-- ════════════════════════════════════════════════════════════════════
-- §6  RLS policies for the three-tier role model
-- ════════════════════════════════════════════════════════════════════
-- We drop-then-create every policy so this migration is idempotent.
-- Policies are intentionally written as one-policy-per-role for
-- readability; performance is fine because the helper functions are
-- STABLE and cached per query.

-- ── store_manager_stores ────────────────────────────────────────────
ALTER TABLE public.store_manager_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_manager_stores_corp_admin_all   ON public.store_manager_stores;
DROP POLICY IF EXISTS store_manager_stores_self_select      ON public.store_manager_stores;

CREATE POLICY store_manager_stores_corp_admin_all
  ON public.store_manager_stores FOR ALL
  USING (organisation_id = public.batchd_user_org_id() AND public.batchd_user_is_corp_admin())
  WITH CHECK (organisation_id = public.batchd_user_org_id() AND public.batchd_user_is_corp_admin());

CREATE POLICY store_manager_stores_self_select
  ON public.store_manager_stores FOR SELECT
  USING (user_id = auth.uid());

-- ── staff_invitations ───────────────────────────────────────────────
-- Reads:
--   corp_admin → all invites in their org
--   store_manager → invites they created OR invites scoped to their stores
-- Writes:
--   corp_admin → can create invites for any role/store in their org
--   store_manager → can create invites for store_manager or store_staff
--                   in their own assigned stores (not corp_admin)
-- Updates:
--   The accept flow runs through the service-role Netlify function;
--   normal users cannot UPDATE invitation rows directly. corp_admin
--   can cancel (set cancelled_at) via UPDATE.

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_invitations_corp_admin_select  ON public.staff_invitations;
DROP POLICY IF EXISTS staff_invitations_manager_select     ON public.staff_invitations;
DROP POLICY IF EXISTS staff_invitations_corp_admin_insert  ON public.staff_invitations;
DROP POLICY IF EXISTS staff_invitations_manager_insert     ON public.staff_invitations;
DROP POLICY IF EXISTS staff_invitations_corp_admin_update  ON public.staff_invitations;

CREATE POLICY staff_invitations_corp_admin_select
  ON public.staff_invitations FOR SELECT
  USING (
    public.batchd_user_is_corp_admin()
    AND organisation_id = public.batchd_user_org_id()
  );

CREATE POLICY staff_invitations_manager_select
  ON public.staff_invitations FOR SELECT
  USING (
    public.batchd_user_is_store_manager()
    AND organisation_id = public.batchd_user_org_id()
    AND (
      invited_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.store_manager_stores
        WHERE user_id = auth.uid()
          AND store_id = staff_invitations.intended_primary_store_id
      )
    )
  );

CREATE POLICY staff_invitations_corp_admin_insert
  ON public.staff_invitations FOR INSERT
  WITH CHECK (
    public.batchd_user_is_corp_admin()
    AND organisation_id = public.batchd_user_org_id()
  );

-- Managers can invite store_manager or store_staff, but only for
-- stores they actually manage. They CANNOT invite corp_admins.
CREATE POLICY staff_invitations_manager_insert
  ON public.staff_invitations FOR INSERT
  WITH CHECK (
    public.batchd_user_is_store_manager()
    AND organisation_id = public.batchd_user_org_id()
    AND intended_role IN ('store_manager', 'staff')
    AND (
      intended_primary_store_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.store_manager_stores
        WHERE user_id = auth.uid()
          AND store_id = staff_invitations.intended_primary_store_id
      )
    )
    AND invited_by = auth.uid()
  );

CREATE POLICY staff_invitations_corp_admin_update
  ON public.staff_invitations FOR UPDATE
  USING (
    public.batchd_user_is_corp_admin()
    AND organisation_id = public.batchd_user_org_id()
  )
  WITH CHECK (
    public.batchd_user_is_corp_admin()
    AND organisation_id = public.batchd_user_org_id()
  );

-- ── organisation_members updates ────────────────────────────────────
-- Existing SELECT policies (from earlier migrations) likely already
-- handle the basic "see your own org" rule. We add UPDATE policies for
-- the new HR fields. Skipping INSERT because the staff-invite-accept
-- service-role function is the only path that creates new member rows.

DROP POLICY IF EXISTS organisation_members_corp_admin_update   ON public.organisation_members;
DROP POLICY IF EXISTS organisation_members_manager_update      ON public.organisation_members;
DROP POLICY IF EXISTS organisation_members_self_update         ON public.organisation_members;

CREATE POLICY organisation_members_corp_admin_update
  ON public.organisation_members FOR UPDATE
  USING (
    public.batchd_user_is_corp_admin()
    AND organisation_id = public.batchd_user_org_id()
  )
  WITH CHECK (
    public.batchd_user_is_corp_admin()
    AND organisation_id = public.batchd_user_org_id()
  );

-- Managers can update HR fields on staff in their stores, including
-- soft-deactivation. The CHECK constraint ensures they can't promote
-- a staff member to corp_admin.
CREATE POLICY organisation_members_manager_update
  ON public.organisation_members FOR UPDATE
  USING (
    public.batchd_user_is_store_manager()
    AND organisation_id = public.batchd_user_org_id()
    AND role IN ('store_manager', 'staff')
    AND (
      primary_store_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.store_manager_stores
        WHERE user_id = auth.uid()
          AND store_id = organisation_members.primary_store_id
      )
    )
  )
  WITH CHECK (
    role IN ('store_manager', 'staff')
  );

-- Users can always update their own basic profile fields.
CREATE POLICY organisation_members_self_update
  ON public.organisation_members FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND role = (SELECT role FROM public.organisation_members WHERE user_id = auth.uid() LIMIT 1));

-- ── scans_audit_log ─────────────────────────────────────────────────
-- Read access mirrors the scan SELECT rules: if you can see the
-- underlying scan, you can see its audit history. No UPDATE/DELETE
-- policies — audit rows are immutable. INSERT happens via the trigger
-- (security definer) so doesn't need a user-facing INSERT policy.

ALTER TABLE public.scans_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scans_audit_log_select ON public.scans_audit_log;

CREATE POLICY scans_audit_log_select
  ON public.scans_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.scans s
      WHERE s.id = scans_audit_log.scan_id
        AND s.organisation_id = public.batchd_user_org_id()
        AND (
          public.batchd_user_is_corp_admin()
          OR public.batchd_user_manages_store(s.store_id)
        )
    )
  );

-- ── scans: manager can SELECT + UPDATE scans in their stores ────────
-- Note: existing scan policies from earlier migrations probably allow
-- SELECT across the org for corp_admins; we add a narrower UPDATE
-- policy specifically for store managers correcting misrouted scans.
-- The corp_admin UPDATE policy is added too (broader scope).

DROP POLICY IF EXISTS scans_corp_admin_update         ON public.scans;
DROP POLICY IF EXISTS scans_manager_correct_store     ON public.scans;

CREATE POLICY scans_corp_admin_update
  ON public.scans FOR UPDATE
  USING (
    public.batchd_user_is_corp_admin()
    AND organisation_id = public.batchd_user_org_id()
  )
  WITH CHECK (
    public.batchd_user_is_corp_admin()
    AND organisation_id = public.batchd_user_org_id()
  );

-- Store-manager scan-correction: a manager can UPDATE a scan ONLY if
-- the scan is currently at one of their managed stores. They can move
-- it to any store in the same org (e.g. correcting "this should have
-- been logged at Trondheim").
CREATE POLICY scans_manager_correct_store
  ON public.scans FOR UPDATE
  USING (
    public.batchd_user_is_store_manager()
    AND organisation_id = public.batchd_user_org_id()
    AND public.batchd_user_manages_store(store_id)
  )
  WITH CHECK (
    public.batchd_user_is_store_manager()
    AND organisation_id = public.batchd_user_org_id()
  );

-- Done.
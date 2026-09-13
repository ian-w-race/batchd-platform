-- 018_secure_onboarding_rpcs.sql
--
-- SECURITY FIX (part 1 of 2) — found by the 2026-09-09 audit and CONFIRMED
-- against the live policy dump.
--
-- THIS MIGRATION IS ADDITIVE AND SAFE TO RUN NOW. It only creates
-- functions. It removes nothing and changes no existing policy, so the
-- current signup/join pages keep working exactly as they do today.
-- Migration 019 does the lock-down and must ONLY run after the updated
-- join.html and signup.html are deployed and verified.
--
-- ── What the live policies actually allow today ────────────────────────
--
--   invitations / "Anyone can read invitation by token"
--     SELECT, roles {anon,authenticated}, USING (true)
--   → `true` means every row. The .eq('token', …) in join.html is a
--     client-side filter, not a boundary. Anyone holding the public anon
--     key (embedded in every HTML file) can dump the whole invitations
--     table: tokens, emails, roles, organisation_ids. With a stolen token
--     they open /join?token=… and claim that invitation, including the
--     corp_admin invites minted by admin.html.
--
--   organisation_members / "Insert own membership"
--     INSERT, roles {authenticated}, WITH CHECK (user_id = auth.uid())
--   → The ONLY constraint is that the row is about yourself.
--     organisation_id and role are entirely unconstrained. Any signed-in
--     user can run, from the browser console:
--       sb.from('organisation_members').insert({
--         user_id: <self>, organisation_id: '<any org uuid>', role: 'corp_admin' })
--     and become a corporate admin of any organisation on the platform.
--     signup.html is public, so "any signed-in user" means anyone.
--
--   organisation_members / "Admins can update org memberships"
--     UPDATE, USING + WITH CHECK (organisation_id IN get_my_organisation_ids())
--   → Despite the name there is NO role condition. Any member of an org
--     can update any membership row in that org — including their own —
--     so a floor staff account can set its own role to corp_admin.
--     RLS policies are OR'd, so this defeats the stricter
--     organisation_members_self_update policy sitting beside it.
--
-- ── The fix ───────────────────────────────────────────────────────────
-- Move the two legitimate write flows into SECURITY DEFINER functions
-- that take their authority from the invitation row / the caller's own
-- identity rather than from client-supplied JSON. Then (019) revoke the
-- blanket client privileges those flows currently rely on.

-- ══════════════════════════════════════════════════════════════════════
-- 1. get_invitation_by_token — safe display lookup for the join page
-- ══════════════════════════════════════════════════════════════════════
-- Returns ONLY what the join screen renders. No token echo, no
-- invited_by, no sibling rows. Callable by anon because the join page
-- runs before sign-in.
--
-- 2026-09-13: the first version returned eight columns and left out the
-- five HR prefill fields the inviter types on the dashboard (migration
-- 010: full_name, phone_number, store_role, employee_id, hire_date) and
-- the per-invitee region. The join page therefore rendered empty boxes
-- and, because accept_invitation wrote whatever the browser sent, the
-- inviter's details were lost unless the invitee retyped them. Both are
-- fixed here. Postgres cannot change a function's return type with
-- CREATE OR REPLACE, so the old signature is dropped first. This makes
-- the Supabase editor show its "destructive operations" warning; the
-- function is recreated on the next line.

DROP FUNCTION IF EXISTS public.get_invitation_by_token(text);

CREATE FUNCTION public.get_invitation_by_token(p_token text)
RETURNS TABLE (
  email             text,
  role              text,
  organisation_id   uuid,
  organisation_name text,
  store_name        text,
  manager_store_ids uuid[],
  accepted          boolean,
  expired           boolean,
  full_name         text,
  phone_number      text,
  store_role        text,
  employee_id       text,
  hire_date         date,
  region            text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.email,
    i.role,
    i.organisation_id,
    o.name,
    s.name,
    i.manager_store_ids,
    COALESCE(i.accepted, false),
    (i.expires_at IS NOT NULL AND i.expires_at < now()),
    i.full_name,
    i.phone_number,
    i.store_role,
    i.employee_id,
    i.hire_date,
    i.region
  FROM public.invitations i
  LEFT JOIN public.organisations o ON o.id = i.organisation_id
  LEFT JOIN public.stores        s ON s.id = i.store_id
  WHERE i.token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_invitation_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 2. accept_invitation — the whole join flow, server side
-- ══════════════════════════════════════════════════════════════════════
-- role and organisation_id come from the INVITATION ROW, never from the
-- client. The caller must already be signed in as the invited email.

CREATE OR REPLACE FUNCTION public.accept_invitation(
  p_token       text,
  p_full_name   text DEFAULT NULL,
  p_phone       text DEFAULT NULL,
  p_hire_date   text DEFAULT NULL,
  p_store_role  text DEFAULT NULL,
  p_employee_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inv     public.invitations%ROWTYPE;
  v_region  text;
  v_store   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to accept an invitation.';
  END IF;

  SELECT * INTO v_inv FROM public.invitations WHERE token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found.';
  END IF;
  IF COALESCE(v_inv.accepted, false) THEN
    RAISE EXCEPTION 'This invitation has already been used.';
  END IF;
  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
    RAISE EXCEPTION 'This invitation has expired.';
  END IF;

  -- The signed-in account must be the invited address. Without this a
  -- leaked token could be redeemed by any account.
  IF lower(coalesce(v_inv.email, '')) <> v_email OR v_email = '' THEN
    RAISE EXCEPTION 'This invitation was issued to a different email address.';
  END IF;

  -- Membership. role + organisation_id are taken from the invitation.
  -- Managers keep store_id NULL; store_manager_stores is canonical.
  IF v_inv.role = 'store_manager'
     AND v_inv.manager_store_ids IS NOT NULL
     AND array_length(v_inv.manager_store_ids, 1) > 0 THEN
    v_store := NULL;
  ELSE
    v_store := v_inv.store_id;
  END IF;

  -- HR fields: what the invitee typed wins, the inviter's values on the
  -- invitation row are the fallback. Before 2026-09-13 only the browser
  -- values were used, so an untouched form wiped the inviter's details.
  INSERT INTO public.organisation_members
    (organisation_id, user_id, role, store_id, full_name, phone_number,
     hire_date, store_role, employee_id, joined_at, active)
  VALUES
    (v_inv.organisation_id, v_uid, v_inv.role, v_store,
     COALESCE(NULLIF(p_full_name, ''),   v_inv.full_name),
     COALESCE(NULLIF(p_phone, ''),       v_inv.phone_number),
     COALESCE(NULLIF(p_hire_date, '')::date, v_inv.hire_date),
     COALESCE(NULLIF(p_store_role, ''),  v_inv.store_role),
     COALESCE(NULLIF(p_employee_id, ''), v_inv.employee_id),
     now(), true)
  ON CONFLICT DO NOTHING;

  -- Manager extras
  IF v_inv.role = 'store_manager' THEN
    INSERT INTO public.user_profiles (id, is_manager)
    VALUES (v_uid, true)
    ON CONFLICT (id) DO UPDATE SET is_manager = true;

    -- Store assignments are best-effort: an invite that names a store which
    -- has since been deleted must NOT abort the whole acceptance (the old
    -- FOREACH + bare INSERT would raise foreign_key_violation and roll the
    -- entire transaction back, leaving the invitee with no membership at
    -- all). Joining through stores skips ids that no longer resolve, and
    -- also refuses a store belonging to a different organisation.
    -- A corp_admin can fix assignments afterwards. (2026-09-11)
    IF v_inv.manager_store_ids IS NOT NULL THEN
      INSERT INTO public.store_manager_stores
        (user_id, store_id, organisation_id, assigned_by)
      SELECT v_uid, s.id, v_inv.organisation_id, v_inv.invited_by
        FROM unnest(v_inv.manager_store_ids) AS x(store_id)
        JOIN public.stores s
          ON s.id = x.store_id
         AND s.organisation_id = v_inv.organisation_id
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Region precedence (migration 012): invitation → org default → 'no'
  v_region := v_inv.region;
  IF v_region IS NULL THEN
    SELECT region INTO v_region FROM public.organisations WHERE id = v_inv.organisation_id;
  END IF;
  v_region := COALESCE(v_region, 'no');

  INSERT INTO public.user_settings (user_id, region, recall_lookback_days, onboarding_done)
  VALUES (v_uid, v_region, 180, true)
  ON CONFLICT (user_id) DO UPDATE
    SET region = EXCLUDED.region,
        recall_lookback_days = EXCLUDED.recall_lookback_days,
        onboarding_done = true;

  UPDATE public.invitations
     SET accepted = true, user_id = v_uid
   WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'organisation_id', v_inv.organisation_id,
    'role',            v_inv.role,
    'region',          v_region
  );
END $$;

REVOKE ALL ON FUNCTION public.accept_invitation(text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text, text, text, text, text, text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 3. create_organisation_with_admin — the signup flow, server side
-- ══════════════════════════════════════════════════════════════════════
-- Creates the org, the founding admin membership and the initial stores
-- in one transaction. Refuses if the caller already belongs to an org, so
-- it cannot be replayed to join or manufacture extra organisations.

CREATE OR REPLACE FUNCTION public.create_organisation_with_admin(
  p_name          text,
  p_type          text,
  p_contact_email text,
  p_region        text,
  p_store_names   text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_role text;
  v_nm   text;
  v_i    int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to create an organisation.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organisation_members WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'This account already belongs to an organisation.';
  END IF;

  IF p_type = 'manufacturer' THEN
    v_role := 'mfr_admin';
  ELSE
    v_role := 'corp_admin';
  END IF;

  INSERT INTO public.organisations (name, type, contact_email, region)
  VALUES (p_name,
          CASE WHEN p_type = 'manufacturer' THEN 'manufacturer' ELSE 'retailer' END,
          p_contact_email,
          p_region)
  RETURNING id INTO v_org;

  INSERT INTO public.organisation_members (user_id, organisation_id, role, active)
  VALUES (v_uid, v_org, v_role, true);

  IF p_type <> 'manufacturer' AND p_store_names IS NOT NULL THEN
    FOREACH v_nm IN ARRAY p_store_names LOOP
      v_i := v_i + 1;
      INSERT INTO public.stores (name, organisation_id, store_code, active)
      VALUES (v_nm, v_org, 'STORE-' || lpad(v_i::text, 3, '0'), true);
    END LOOP;
  END IF;

  RETURN v_org;
END $$;

REVOKE ALL ON FUNCTION public.create_organisation_with_admin(text, text, text, text, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.create_organisation_with_admin(text, text, text, text, text[]) TO authenticated;

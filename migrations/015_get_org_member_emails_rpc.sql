-- 015_get_org_member_emails_rpc.sql
--
-- Active-members list in the Staff Activity panel was rendering user_id
-- shortcuts ("cfc19cc8…", "1bc553ca…") instead of actual emails / names,
-- because the existing email lookup relied on the accepted-invitation row
-- carrying user_id. For members invited before that column was tracked
-- (or where the join.html update silently failed under RLS), there's no
-- way for the client to resolve user_id → email — auth.users is not
-- queryable from the authenticated role.
--
-- This RPC fills the gap: a SECURITY DEFINER function that reads
-- auth.users (which the function owner can do) and returns user_id +
-- email + full_name for every member of the supplied org. Gated to
-- corp_admin callers so a store_manager can't enumerate every email
-- in the org via this RPC.
--
-- full_name is derived from user_metadata in priority order:
--   1. full_name (set by signup / join flow)
--   2. first_name + last_name concatenated
--   3. NULL (falls through to email-only display on the client)
--
-- Hardening: search_path pinned to public,auth so a malicious session
-- can't redefine those schemas to hijack the SECURITY DEFINER context.
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.get_org_member_emails(p_org_id uuid)
RETURNS TABLE (
  user_id   uuid,
  email     text,
  full_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    om.user_id,
    au.email::text AS email,
    NULLIF(
      COALESCE(
        au.raw_user_meta_data->>'full_name',
        TRIM(BOTH ' ' FROM
          COALESCE(au.raw_user_meta_data->>'first_name', '') || ' ' ||
          COALESCE(au.raw_user_meta_data->>'last_name',  '')
        )
      ),
      ''
    )::text AS full_name
  FROM public.organisation_members om
  LEFT JOIN auth.users au ON au.id = om.user_id
  WHERE om.organisation_id = p_org_id
    AND EXISTS (
      SELECT 1 FROM public.organisation_members caller
      WHERE caller.user_id        = auth.uid()
        AND caller.organisation_id = p_org_id
        AND caller.role            = 'corp_admin'
        AND COALESCE(caller.active, true) = true
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_org_member_emails(uuid) TO authenticated;

-- Done.

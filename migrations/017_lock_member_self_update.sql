-- 017_lock_member_self_update.sql
--
-- SECURITY FIX — found by the 2026-09-09 audit.
--
-- REVIEW BEFORE RUNNING. This changes an authorization boundary.
-- John should read it first.
--
-- The problem
-- -----------
-- Migration 016 rewrote organisation_members_self_update as:
--
--   USING      (user_id = auth.uid())
--   WITH CHECK (user_id = auth.uid() AND role = public.batchd_user_role())
--
-- That constrains exactly two things: the row is yours, and `role` is
-- unchanged. EVERY OTHER COLUMN is freely writable by the row's owner,
-- including organisation_id. Any signed-in staff member can open devtools
-- on the scanner (the supabase client is a global, the session is live)
-- and run:
--
--   sb.from('organisation_members')
--     .update({ organisation_id: '<some other org uuid>' })
--     .eq('user_id', '<their own id>')
--
-- batchd_user_role() is STABLE and reads the pre-statement snapshot, so it
-- still returns their old role and WITH CHECK passes. From the next
-- request onward they are a member of the target organisation and every
-- org-scoped query returns that org's data.
--
-- Postgres RLS cannot compare NEW to OLD inside a policy, so the fix is a
-- BEFORE UPDATE trigger. A trigger also avoids enumerating profile columns
-- in a GRANT, which would break the next time a column is added.
--
-- What stays allowed: a member editing their own profile fields (name,
-- phone, store role, employee id, hire date, notification prefs, etc).
-- What is blocked: a member changing their OWN organisation_id, role, or
-- active flag.
-- What is unaffected: admins editing OTHER members' rows (NEW.user_id is
-- not auth.uid()), and anything running as service_role or through a
-- SECURITY DEFINER RPC (auth.uid() is NULL there).

CREATE OR REPLACE FUNCTION public.batchd_guard_member_self_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only guard genuine self-service edits from an end-user session.
  IF auth.uid() IS NOT NULL AND NEW.user_id = auth.uid() THEN
    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
      RAISE EXCEPTION 'You cannot move your own membership to another organisation.';
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'You cannot change your own role.';
    END IF;
    IF NEW.active IS DISTINCT FROM OLD.active THEN
      RAISE EXCEPTION 'You cannot change your own active status.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS batchd_guard_member_self_update ON public.organisation_members;

CREATE TRIGGER batchd_guard_member_self_update
  BEFORE UPDATE ON public.organisation_members
  FOR EACH ROW
  EXECUTE FUNCTION public.batchd_guard_member_self_update();

COMMENT ON FUNCTION public.batchd_guard_member_self_update() IS
  'Blocks a member from changing their own organisation_id, role or active flag. Added 2026-09-09 after an audit found organisation_members_self_update left every column except role writable by the row owner, allowing self-transfer into any organisation.';

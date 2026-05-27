-- 016_fix_self_update_recursion.sql
--
-- "Infinite recursion detected in policy for relation
-- organisation_members" persisted even after migration 014 flipped the
-- four RLS helpers to SECURITY DEFINER. The remaining recursion path:
--
--   organisation_members_self_update.WITH_CHECK had an INLINE subquery
--   on organisation_members, NOT wrapped in a SECURITY DEFINER helper:
--
--     ((user_id = auth.uid())
--      AND (role = ( SELECT organisation_members_1.role
--                    FROM organisation_members organisation_members_1
--                    WHERE organisation_members_1.user_id = auth.uid()
--                    LIMIT 1 )))
--
--   That subquery is subject to RLS on the same table. The SELECT policy
--   fires, and Postgres's policy evaluator winds up looping on
--   organisation_members until the recursion limit blows the query.
--   Migration 014's SECURITY DEFINER fix only protected the helper
--   function bodies — it didn't touch policies with inline subqueries.
--
-- Fix:
--   1. Add a SECURITY DEFINER helper batchd_user_role() that returns the
--      caller's role. Same shape as the other batchd_user_* helpers from
--      014 — runs as postgres (BYPASSRLS), no recursion possible.
--   2. Drop and recreate organisation_members_self_update so its
--      WITH_CHECK uses the helper instead of the inline subquery.
--
-- After 016: every policy on organisation_members either uses only pure
-- expressions or invokes a SECURITY DEFINER helper. No inline subqueries
-- on this table remain in any policy.
--
-- Safe to re-run.

-- ════════════════════════════════════════════════════════════════════
-- §1  Helper: caller's role
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.batchd_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.organisation_members
  WHERE user_id = auth.uid()
    AND COALESCE(active, true) = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.batchd_user_role() TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- §2  Rewrite organisation_members_self_update
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "organisation_members_self_update"
  ON public.organisation_members;

CREATE POLICY "organisation_members_self_update"
  ON public.organisation_members
  FOR UPDATE
  TO public
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND role = public.batchd_user_role()
  );

-- Done.

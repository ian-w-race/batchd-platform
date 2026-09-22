-- 020a_set_existing_orgs_pov.sql
--
-- ONE-TIME DATA CHANGE. Run once, between migration 020 and the Phase 2
-- deploy. Decision of 2026-09-20: rather than naming individual orgs, every
-- organisation that exists today is put on 'pov' so that nothing breaks for
-- anyone on deploy day. Tighten later from admin.html's plan dropdown.
--
-- ⚠ DO NOT RE-RUN BLINDLY. If you downgrade an org to 'trial' or 'churned'
-- later and then re-run this file, it would silently put it back on 'pov'.
-- The guard below refuses to run a second time for exactly that reason.
--
-- Why this matters: after migration 020, AI features (ocr.js product
-- recognition and the dashboard's NL query) require plan IN ('pov','active').
-- An org left on 'trial' loses them. Orgs already marked 'active' (paying)
-- and 'churned' are left alone.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_already int; v_changed int;
BEGIN
  SELECT count(*) INTO v_already FROM public.organisations WHERE plan = 'pov';
  IF v_already > 0 THEN
    RAISE NOTICE 'SKIPPED: % organisation(s) are already on pov, so this one-time backfill has run before. Change plans from admin.html instead.', v_already;
    RETURN;
  END IF;

  UPDATE public.organisations
     SET plan = 'pov'
   WHERE plan IS DISTINCT FROM 'active'
     AND plan IS DISTINCT FROM 'churned';

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RAISE NOTICE 'OK: % organisation(s) set to pov. Paying orgs on active and churned orgs were left alone.', v_changed;
END $$;

COMMIT;

-- Check the result:
--   SELECT id, name, plan FROM public.organisations ORDER BY plan, name;

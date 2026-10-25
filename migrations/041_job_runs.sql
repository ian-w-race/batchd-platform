-- 041_job_runs.sql (2026-10-25)
--
-- Improvement plan A4 (monitoring). Every scheduled job writes one row per
-- run: which job, which Netlify site ran it, when it started and finished,
-- whether it worked, and a short summary. The daily health-check function
-- reads these rows and emails the platform admins when a job has not run,
-- has failed, or when supplier notices are stuck. Only the service role
-- writes; platform admins may read. Rows older than 90 days are deleted by
-- the health check.
--
-- Re-runnable. One transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job          text NOT NULL CHECK (length(job) BETWEEN 1 AND 60),
  site         text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  ok           boolean,
  status_code  integer,
  detail       jsonb
);

CREATE INDEX IF NOT EXISTS job_runs_job_started_idx ON public.job_runs (job, started_at DESC);

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_runs FROM anon, authenticated;
GRANT SELECT ON public.job_runs TO authenticated;
GRANT ALL ON public.job_runs TO service_role;

DROP POLICY IF EXISTS b41_job_runs_platform_admin ON public.job_runs;
CREATE POLICY b41_job_runs_platform_admin ON public.job_runs FOR SELECT TO authenticated
  USING (public.batchd_is_platform_admin());

COMMIT;

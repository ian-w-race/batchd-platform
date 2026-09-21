-- Batch'd pre-flight diagnostic 3 of 3. READ-ONLY: changes nothing.
-- code_patterns HAS an organisation_id column (confirmed 2026-09-21). This
-- asks whether existing rows actually have it filled in. If most are NULL,
-- scoping the scanner's pattern writes by organisation would orphan them:
-- the update would silently match zero rows and lot-code learning would stop
-- improving for those products, with no visible error.
SELECT CASE WHEN organisation_id IS NULL THEN 'organisation_id is NULL'
            ELSE 'organisation_id is set' END AS state,
       count(*) AS rows
FROM public.code_patterns
GROUP BY 1
ORDER BY 1;

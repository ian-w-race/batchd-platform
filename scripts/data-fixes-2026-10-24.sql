-- scripts/data-fixes-2026-10-24.sql
-- FOR IAN TO REVIEW AND RUN in the Supabase SQL editor (production,
-- lurxucdmrugikdlvvebc). Found by the 2026-10-24 data audit. Claude's
-- attempt to run it was blocked by the auto-mode safety check because it
-- changes other people's settings. Nothing here deletes data.
--
-- 1. Two accounts in the US org "Batch'd Admin" still have their personal
--    region set to 'no', so they see Norwegian regulatory copy (the US-only
--    rule in CLAUDE.md, "Decision 2026-09-29"). One is an active corp_admin
--    last seen 2026-09-22, the other a deactivated staff account.
-- 2. Two US test orgs ("Test Food Store USA", "Test Pilot 1") still have
--    recall_source 'both'; new orgs get 'fda'.
--
-- Preview first (read-only):
select o.name as org, m.role, coalesce(m.active, true) as active, us.region
from user_settings us
join organisation_members m on m.user_id = us.user_id
join organisations o on o.id = m.organisation_id
where o.region = 'us' and us.region = 'no';

select name, recall_source from organisations
where region = 'us' and type = 'retailer' and recall_source <> 'fda';

-- Then apply (one transaction):
begin;
update user_settings us
   set region = 'us', date_format = null, updated_at = now()
  from organisation_members m join organisations o on o.id = m.organisation_id
 where m.user_id = us.user_id and o.region = 'us' and us.region = 'no';
update organisations set recall_source = 'fda'
 where region = 'us' and type = 'retailer' and recall_source <> 'fda';
commit;

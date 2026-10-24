-- scripts/schema-reference.sql
-- Produces docs/SCHEMA-REFERENCE.md as one markdown text value. Run it in
-- the Supabase SQL editor (or through the Supabase connector) against the
-- project you want to document, then paste the single result cell into
-- docs/SCHEMA-REFERENCE.md. Read-only.
with t as (
  select c.oid, c.relname, c.relrowsecurity rls,
         obj_description(c.oid) cmt,
         (select reltuples::bigint from pg_class x where x.oid = c.oid) est_rows
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
cols as (
  select a.attrelid oid, string_agg(
    '| `' || a.attname || '` | ' || format_type(a.atttypid, a.atttypmod) || ' | '
    || case when a.attnotnull then 'not null' else '' end || ' | '
    || coalesce(replace(pg_get_expr(d.adbin, d.adrelid), '|', '\|'), '')
    || case when a.attgenerated = 's' then ' (generated)' else '' end || ' |',
    E'\n' order by a.attnum) txt
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped and a.attrelid in (select oid from t)
  group by a.attrelid
),
cons as (
  select conrelid oid, string_agg('- ' || case contype when 'p' then 'Primary key' when 'u' then 'Unique' when 'f' then 'Links' when 'c' then 'Check' else contype::text end
    || ': `' || replace(pg_get_constraintdef(oid), '|', '\|') || '`', E'\n' order by contype, conname) txt
  from pg_constraint where conrelid in (select oid from t) group by conrelid
),
idx as (
  select x.indrelid oid, string_agg('- `' || pg_get_indexdef(x.indexrelid) || '`', E'\n' order by 1) txt
  from pg_index x where x.indrelid in (select oid from t)
    and not exists (select 1 from pg_constraint k where k.conindid = x.indexrelid)
  group by x.indrelid
),
trg as (
  select tgrelid oid, string_agg('- `' || tgname || '`: ' || regexp_replace(pg_get_triggerdef(oid, true), '^CREATE TRIGGER \S+ ', ''), E'\n' order by tgname) txt
  from pg_trigger where not tgisinternal and tgrelid in (select oid from t) group by tgrelid
),
pol as (
  select c.oid, string_agg('- `' || p.policyname || '` ' || p.cmd || ' to ' || array_to_string(p.roles, ', ')
    || coalesce(' using `' || replace(p.qual, '|', '\|') || '`', '')
    || coalesce(' check `' || replace(p.with_check, '|', '\|') || '`', ''), E'\n' order by p.cmd, p.policyname) txt
  from pg_policies p join t c on c.relname = p.tablename where p.schemaname = 'public' group by c.oid
),
grants as (
  select c.oid, string_agg(g.grantee || ': ' || g.privs, '; ' order by g.grantee) txt
  from t c cross join lateral (
    select grantee, string_agg(lower(privilege_type), ', ' order by privilege_type) privs
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = c.relname and grantee in ('anon', 'authenticated', 'service_role')
    group by grantee) g
  group by c.oid
),
tables_md as (
  select string_agg(
    '## ' || t.relname || E'\n\n'
    || 'Row security: ' || case when t.rls then 'on' else 'OFF' end
    || ' · Approximate rows: ' || greatest(t.est_rows, 0) || E'\n'
    || 'Table access: ' || coalesce(grants.txt, 'none') || E'\n\n'
    || E'| Column | Type | Null | Default |\n|---|---|---|---|\n' || cols.txt || E'\n\n'
    || coalesce(E'**Constraints**\n\n' || cons.txt || E'\n\n', '')
    || coalesce(E'**Other indexes**\n\n' || idx.txt || E'\n\n', '')
    || coalesce(E'**Triggers**\n\n' || trg.txt || E'\n\n', '')
    || coalesce(E'**Policies**\n\n' || pol.txt || E'\n\n', E'**Policies**\n\nnone\n\n'),
    '' order by t.relname) txt
  from t left join cols using (oid) left join cons using (oid) left join idx using (oid)
         left join trg using (oid) left join pol using (oid) left join grants using (oid)
),
views_md as (
  select string_agg('## View ' || c.relname || E'\n\n'
    || 'Options: ' || coalesce(array_to_string(c.reloptions, ', '), 'none (runs with owner rights)') || E'\n\n'
    || E'```sql\n' || pg_get_viewdef(c.oid, true) || E'\n```\n\n', '' order by c.relname) txt
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'
),
funcs_md as (
  select E'| Function | Returns | Security | Callable by |\n|---|---|---|---|\n' || string_agg(
    '| `' || p.oid::regprocedure::text || '` | ' || replace(pg_get_function_result(p.oid), '|', '\|') || ' | '
    || case when p.prosecdef then 'definer' else 'invoker' end || ' | '
    || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end, ', ' order by 1)
                 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))), 'owner only')
    || ' |', E'\n' order by p.proname) txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
),
storage_md as (
  select coalesce(string_agg('- Bucket `' || b.id || '` (' || case when b.public then 'public links' else 'private' end || ')', E'\n'), 'none') || E'\n\n'
    || coalesce((select string_agg('- `' || policyname || '` ' || cmd || ' to ' || array_to_string(roles, ', ')
        || coalesce(' using `' || qual || '`', '') || coalesce(' check `' || with_check || '`', ''), E'\n' order by policyname)
        from pg_policies where schemaname = 'storage' and tablename = 'objects'), 'No storage policies') txt
  from storage.buckets b
)
select '# Batch''d database reference' || E'\n\n'
  || 'Generated ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC from the production project '
  || '(lurxucdmrugikdlvvebc) by scripts/schema-reference.sql. '
  || 'Do not edit by hand; regenerate after every migration.' || E'\n\n'
  || (select count(*) from t) || ' tables, '
  || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v') || ' views, '
  || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') || ' functions, '
  || (select count(*) from pg_policies where schemaname = 'public') || ' policies.' || E'\n\n'
  || '# Tables' || E'\n\n' || (select txt from tables_md)
  || '# Views' || E'\n\n' || (select txt from views_md)
  || '# Functions' || E'\n\n' || (select txt from funcs_md) || E'\n\n'
  || '# Storage' || E'\n\n' || (select txt from storage_md) || E'\n' as markdown;

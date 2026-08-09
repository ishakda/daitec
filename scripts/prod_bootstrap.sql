-- ============================================================
-- PRODUCTION bootstrap for Supabase (run ONCE before migrations).
-- Creates/updates the RLS-enforced application role.
-- Usage:
--   psql "$SUPABASE_DB_URL" -v app_password="'STRONG_PASSWORD'" -f scripts/prod_bootstrap.sql
-- ============================================================

select case
  when exists (select 1 from pg_roles where rolname = 'sahla_app')
    then format('alter role sahla_app with login password %L', :'app_password')
  else format('create role sahla_app login password %L', :'app_password')
end as sql \gexec

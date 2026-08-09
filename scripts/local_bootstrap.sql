-- ============================================================
-- LOCAL-ONLY bootstrap (do NOT run on Supabase).
-- Creates the auth schema shim that Supabase provides natively,
-- plus the application roles used by RLS.
-- The app sets `request.jwt.claim.sub` per transaction; auth.uid()
-- reads it — the same mechanism Supabase uses under the hood.
-- ============================================================

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Role the application connects with (RLS enforced — not a superuser).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'sahla_app') then
    create role sahla_app login password 'sahla_app_local_dev';
  end if;
end $$;

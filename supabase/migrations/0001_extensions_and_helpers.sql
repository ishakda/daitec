-- ============================================================
-- 0001 — Extensions & helper functions
-- Portable across local PostgreSQL and Supabase.
-- On local Postgres, run scripts/local_bootstrap.sql FIRST
-- (it creates the auth.uid() shim that Supabase provides natively).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- updated_at maintenance
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Immutability guard for append-only tables (ledgers, audit)
-- ------------------------------------------------------------
create or replace function public.forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are immutable (append-only table)', tg_table_name
    using errcode = 'raise_exception';
end;
$$;

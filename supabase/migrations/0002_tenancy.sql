-- ============================================================
-- 0002 — Users, companies, membership, RBAC, branches, warehouses
-- ============================================================

-- ------------------------------------------------------------
-- users — application profile table.
-- Locally: the authoritative user record (credentials live in
-- auth_credentials). On Supabase: mirrors auth.users via trigger;
-- id always equals auth.uid().
-- ------------------------------------------------------------
create table public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  full_name     text not null,
  phone         text,
  avatar_url    text,
  locale        text not null default 'fr',
  is_active     boolean not null default true,
  email_verified_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_users_updated before update on public.users
  for each row execute function public.set_updated_at();

-- Local auth only (unused on Supabase — Supabase Auth replaces it).
create table public.auth_credentials (
  user_id       uuid primary key references public.users(id) on delete cascade,
  password_hash text not null,
  updated_at    timestamptz not null default now()
);

create table public.auth_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  token_hash    text not null unique,
  user_agent    text,
  ip            text,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index idx_auth_sessions_user on public.auth_sessions(user_id);

create table public.password_reset_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  token_hash    text not null unique,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- companies (tenants)
-- ------------------------------------------------------------
create table public.companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  legal_name          text,
  activity            text,
  -- Algerian business identifiers
  nif                 text,   -- Numéro d'Identification Fiscale
  nis                 text,   -- Numéro d'Identification Statistique
  rc                  text,   -- Registre de Commerce
  ai                  text,   -- Article d'Imposition
  address             text,
  city                text,
  wilaya              text,
  phone               text,
  email               text,
  logo_url            text,
  currency            text not null default 'DZD',
  default_tax_rate    numeric(5,2) not null default 19.00,
  costing_method      text not null default 'weighted_average'
                        check (costing_method in ('weighted_average','fifo')),
  allow_negative_stock boolean not null default false,
  invoice_footer      text,
  settings            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- RBAC
-- ------------------------------------------------------------
create table public.permissions (
  code        text primary key,           -- e.g. 'sales.create'
  module      text not null,              -- e.g. 'sales'
  description text not null
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade, -- null = system template
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name)
);
create trigger trg_roles_updated before update on public.roles
  for each row execute function public.set_updated_at();
create index idx_roles_company on public.roles(company_id);

create table public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table public.company_members (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  role_id     uuid not null references public.roles(id),
  is_owner    boolean not null default false,
  status      text not null default 'active' check (status in ('active','invited','suspended')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, user_id)
);
create trigger trg_company_members_updated before update on public.company_members
  for each row execute function public.set_updated_at();
create index idx_company_members_user on public.company_members(user_id);
create index idx_company_members_company on public.company_members(company_id);

-- ------------------------------------------------------------
-- RLS helper functions (security definer to avoid recursive RLS)
-- ------------------------------------------------------------
create or replace function public.auth_company_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select company_id from public.company_members
  where user_id = auth.uid() and status = 'active';
$$;

create or replace function public.is_company_member(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = cid and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.has_permission(cid uuid, perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.company_members m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.company_id = cid
      and m.user_id = auth.uid()
      and m.status = 'active'
      and rp.permission_code = perm
  ) or exists (
    select 1 from public.company_members m
    where m.company_id = cid and m.user_id = auth.uid()
      and m.status = 'active' and m.is_owner
  );
$$;

-- ------------------------------------------------------------
-- branches & warehouses
-- ------------------------------------------------------------
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  address     text,
  city        text,
  phone       text,
  is_main     boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger trg_branches_updated before update on public.branches
  for each row execute function public.set_updated_at();
create index idx_branches_company on public.branches(company_id);

create table public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  name        text not null,
  address     text,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger trg_warehouses_updated before update on public.warehouses
  for each row execute function public.set_updated_at();
create index idx_warehouses_company on public.warehouses(company_id);

-- ------------------------------------------------------------
-- employees (lightweight — full HR is a future module)
-- ------------------------------------------------------------
create table public.employees (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  branch_id   uuid references public.branches(id) on delete set null,
  full_name   text not null,
  phone       text,
  job_title   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger trg_employees_updated before update on public.employees
  for each row execute function public.set_updated_at();
create index idx_employees_company on public.employees(company_id);

-- ------------------------------------------------------------
-- Seed the permission catalog
-- ------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('dashboard.view',        'dashboard', 'View dashboard'),
  ('sales.view',            'sales', 'View sales'),
  ('sales.create',          'sales', 'Create sales'),
  ('sales.edit',            'sales', 'Edit sales'),
  ('sales.delete',          'sales', 'Delete/cancel sales'),
  ('sales.refund',          'sales', 'Refund sales'),
  ('sales.view_cost',       'sales', 'See cost on sales'),
  ('sales.view_profit',     'sales', 'See profit on sales'),
  ('sales.discount',        'sales', 'Apply discounts'),
  ('pos.use',               'pos', 'Use the POS'),
  ('pos.open_register',     'pos', 'Open cash register session'),
  ('pos.close_register',    'pos', 'Close cash register session'),
  ('products.view',         'products', 'View products'),
  ('products.create',       'products', 'Create products'),
  ('products.edit',         'products', 'Edit products'),
  ('products.delete',       'products', 'Delete products'),
  ('products.view_cost',    'products', 'See purchase cost'),
  ('inventory.view',        'inventory', 'View inventory'),
  ('inventory.adjust',      'inventory', 'Adjust stock'),
  ('inventory.transfer',    'inventory', 'Transfer stock'),
  ('inventory.view_cost',   'inventory', 'See stock valuation'),
  ('purchases.view',        'purchases', 'View purchases'),
  ('purchases.create',      'purchases', 'Create purchases'),
  ('purchases.edit',        'purchases', 'Edit purchases'),
  ('purchases.delete',      'purchases', 'Delete purchases'),
  ('purchases.receive',     'purchases', 'Receive goods'),
  ('customers.view',        'customers', 'View customers'),
  ('customers.create',      'customers', 'Create customers'),
  ('customers.edit',        'customers', 'Edit customers'),
  ('customers.delete',      'customers', 'Delete customers'),
  ('customers.view_debt',   'customers', 'See customer debt'),
  ('suppliers.view',        'suppliers', 'View suppliers'),
  ('suppliers.create',      'suppliers', 'Create suppliers'),
  ('suppliers.edit',        'suppliers', 'Edit suppliers'),
  ('suppliers.delete',      'suppliers', 'Delete suppliers'),
  ('suppliers.view_debt',   'suppliers', 'See supplier debt'),
  ('payments.view',         'payments', 'View payments'),
  ('payments.create',       'payments', 'Record payments'),
  ('payments.delete',       'payments', 'Cancel payments'),
  ('expenses.view',         'expenses', 'View expenses'),
  ('expenses.create',       'expenses', 'Record expenses'),
  ('expenses.edit',         'expenses', 'Edit expenses'),
  ('expenses.delete',       'expenses', 'Delete expenses'),
  ('invoices.view',         'invoices', 'View invoices'),
  ('invoices.create',       'invoices', 'Create invoices'),
  ('reports.view',          'reports', 'View reports'),
  ('reports.export',        'reports', 'Export reports'),
  ('audit.view',            'audit', 'View audit log'),
  ('settings.manage',       'settings', 'Manage company settings'),
  ('users.manage',          'settings', 'Manage users and roles');

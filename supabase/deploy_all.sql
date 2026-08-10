-- ============================================================================
-- Daitec — consolidated production deploy for Supabase (SQL Editor path).
-- Paste this whole file into the Supabase SQL Editor and Run, ONCE.
-- It creates the RLS-enforced application role, then applies all 14 migrations
-- (schema, triggers, RLS policies) in order. Supabase provides auth.uid()
-- natively, so DO NOT run scripts/local_bootstrap.sql here.
--
-- STEP 0 — set the application role password. Replace the placeholder below
-- with a strong secret (this becomes the 'sahla_app' user in DATABASE_URL_APP).
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sahla_app') then
    alter role sahla_app with login password 'REPLACE_WITH_STRONG_APP_PASSWORD';
  else
    create role sahla_app login password 'REPLACE_WITH_STRONG_APP_PASSWORD';
  end if;
end
$$;


-- ============================================================================
-- 0001_extensions_and_helpers.sql
-- ============================================================================
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


-- ============================================================================
-- 0002_tenancy.sql
-- ============================================================================
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


-- ============================================================================
-- 0003_catalog.sql
-- ============================================================================
-- ============================================================
-- 0003 — Product catalog: categories, brands, units, products,
--        variants, barcodes
-- ============================================================

create table public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  parent_id   uuid references public.product_categories(id) on delete set null,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (company_id, name)
);
create trigger trg_product_categories_updated before update on public.product_categories
  for each row execute function public.set_updated_at();
create index idx_product_categories_company on public.product_categories(company_id);

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (company_id, name)
);
create trigger trg_brands_updated before update on public.brands
  for each row execute function public.set_updated_at();
create index idx_brands_company on public.brands(company_id);

create table public.units (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,          -- e.g. Pièce, Kg, Litre
  abbreviation  text not null,          -- e.g. pc, kg, L
  allow_decimal boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (company_id, name)
);
create index idx_units_company on public.units(company_id);

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  sku                 text not null,
  name                text not null,
  description         text,
  category_id         uuid references public.product_categories(id) on delete set null,
  brand_id            uuid references public.brands(id) on delete set null,
  unit_id             uuid references public.units(id) on delete set null,
  purchase_price      numeric(14,2) not null default 0,   -- last known purchase price
  selling_price       numeric(14,2) not null default 0,
  wholesale_price     numeric(14,2),
  tax_rate            numeric(5,2) not null default 19.00,
  minimum_stock       numeric(14,3) not null default 0,
  maximum_stock       numeric(14,3),
  reorder_quantity    numeric(14,3),
  default_supplier_id uuid,          -- FK added in 0004 after suppliers exists
  images              jsonb not null default '[]'::jsonb,
  has_variants        boolean not null default false,
  track_serial        boolean not null default false,
  track_batch         boolean not null default false,
  track_expiry        boolean not null default false,
  status              text not null default 'active' check (status in ('active','archived','draft')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (company_id, sku)
);
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();
create index idx_products_company on public.products(company_id);
create index idx_products_category on public.products(category_id);
create index idx_products_name_trgm on public.products using gin (to_tsvector('simple', name));
create index idx_products_name_lower on public.products (company_id, lower(name) text_pattern_ops);

create table public.product_variants (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  name            text not null,               -- e.g. "Rouge / XL"
  sku             text,
  attributes      jsonb not null default '{}'::jsonb,  -- {"couleur":"Rouge","taille":"XL"}
  purchase_price  numeric(14,2),
  selling_price   numeric(14,2),
  wholesale_price numeric(14,2),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (company_id, sku)
);
create trigger trg_product_variants_updated before update on public.product_variants
  for each row execute function public.set_updated_at();
create index idx_product_variants_product on public.product_variants(product_id);

create table public.barcodes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  variant_id  uuid references public.product_variants(id) on delete cascade,
  barcode     text not null,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (company_id, barcode)
);
create index idx_barcodes_product on public.barcodes(product_id);
create index idx_barcodes_lookup on public.barcodes(company_id, barcode);


-- ============================================================================
-- 0004_partners.sql
-- ============================================================================
-- ============================================================
-- 0004 — Customers & suppliers
-- ============================================================

create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  code          text,
  name          text not null,
  company_name  text,
  phone         text,
  email         text,
  address       text,
  city          text,
  wilaya        text,
  nif           text,
  nis           text,
  rc            text,
  ai            text,
  credit_limit  numeric(14,2),
  payment_terms_days integer,
  balance       numeric(14,2) not null default 0,  -- >0 = customer owes us (receivable)
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger trg_customers_updated before update on public.customers
  for each row execute function public.set_updated_at();
create index idx_customers_company on public.customers(company_id);
create index idx_customers_phone on public.customers(company_id, phone);
create index idx_customers_name_lower on public.customers (company_id, lower(name) text_pattern_ops);

create table public.customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  label       text not null default 'Adresse',
  address     text not null,
  city        text,
  wilaya      text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index idx_customer_addresses_customer on public.customer_addresses(customer_id);

create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  code          text,
  name          text not null,
  company_name  text,
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  city          text,
  wilaya        text,
  nif           text,
  nis           text,
  rc            text,
  ai            text,
  credit_limit  numeric(14,2),
  payment_terms_days integer,
  balance       numeric(14,2) not null default 0,  -- >0 = we owe the supplier (payable)
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger trg_suppliers_updated before update on public.suppliers
  for each row execute function public.set_updated_at();
create index idx_suppliers_company on public.suppliers(company_id);
create index idx_suppliers_name_lower on public.suppliers (company_id, lower(name) text_pattern_ops);

-- Now that suppliers exists, wire the products default supplier FK.
alter table public.products
  add constraint fk_products_default_supplier
  foreign key (default_supplier_id) references public.suppliers(id) on delete set null;


-- ============================================================================
-- 0005_inventory.sql
-- ============================================================================
-- ============================================================
-- 0005 — Inventory engine
--  * stock_movements: immutable, append-only ledger (single
--    source of truth — stock is NEVER edited directly)
--  * inventory_balances: materialized per-warehouse balances,
--    maintained transactionally by trigger on the ledger
--  * weighted-average cost maintained on inbound movements
--  * stock_transfers between warehouses
-- ============================================================

create table public.stock_movements (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  warehouse_id   uuid not null references public.warehouses(id),
  product_id     uuid not null references public.products(id),
  variant_id     uuid references public.product_variants(id),
  movement_type  text not null check (movement_type in (
                   'purchase_receipt','purchase_return',
                   'sale','sale_return',
                   'adjustment_in','adjustment_out',
                   'transfer_in','transfer_out',
                   'damage','loss','initial','count'
                 )),
  quantity       numeric(14,3) not null check (quantity <> 0), -- signed: + in, - out
  unit_cost      numeric(14,4) not null default 0,             -- cost per unit at movement time
  reference_type text,          -- 'sale' | 'goods_receipt' | 'stock_transfer' | 'adjustment' ...
  reference_id   uuid,
  notes          text,
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now()
);
create index idx_stock_movements_company on public.stock_movements(company_id, created_at desc);
create index idx_stock_movements_product on public.stock_movements(company_id, product_id, warehouse_id);
create index idx_stock_movements_ref on public.stock_movements(reference_type, reference_id);

-- Ledger is append-only.
create trigger trg_stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.forbid_change();

create table public.inventory_balances (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  variant_id   uuid references public.product_variants(id) on delete cascade,
  quantity     numeric(14,3) not null default 0,
  avg_cost     numeric(14,4) not null default 0,
  updated_at   timestamptz not null default now()
);
-- One balance row per (warehouse, product, variant) — variant nullable needs
-- a coalesce-based unique index.
create unique index uq_inventory_balance
  on public.inventory_balances (warehouse_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index idx_inventory_balances_company on public.inventory_balances(company_id);
create index idx_inventory_balances_product on public.inventory_balances(company_id, product_id);

-- ------------------------------------------------------------
-- Balance maintenance + weighted-average cost.
-- Runs inside the same transaction as the ledger insert:
-- balances can never diverge from the ledger.
-- Negative-stock rule enforced here (server-side, not just UI).
-- ------------------------------------------------------------
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
  bal public.inventory_balances%rowtype;
  allow_negative boolean;
  new_qty numeric(14,3);
  new_avg numeric(14,4);
begin
  select c.allow_negative_stock into allow_negative
  from public.companies c where c.id = new.company_id;

  -- Lock (or create) the balance row.
  select * into bal
  from public.inventory_balances
  where warehouse_id = new.warehouse_id
    and product_id = new.product_id
    and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(new.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  for update;

  if not found then
    insert into public.inventory_balances (company_id, warehouse_id, product_id, variant_id, quantity, avg_cost)
    values (new.company_id, new.warehouse_id, new.product_id, new.variant_id, 0, 0)
    returning * into bal;
  end if;

  new_qty := bal.quantity + new.quantity;

  if new_qty < 0 and not coalesce(allow_negative, false) then
    raise exception 'INSUFFICIENT_STOCK: product % in warehouse % (available %, requested %)',
      new.product_id, new.warehouse_id, bal.quantity, abs(new.quantity)
      using errcode = 'check_violation';
  end if;

  -- Weighted-average cost: recalculated on inbound quantity only.
  if new.quantity > 0 and new.unit_cost > 0 then
    if bal.quantity <= 0 then
      new_avg := new.unit_cost;
    else
      new_avg := round(
        ((bal.quantity * bal.avg_cost) + (new.quantity * new.unit_cost))
        / nullif(bal.quantity + new.quantity, 0), 4);
    end if;
  else
    new_avg := bal.avg_cost;
  end if;

  update public.inventory_balances
  set quantity = new_qty, avg_cost = new_avg, updated_at = now()
  where id = bal.id;

  return new;
end;
$$;

create trigger trg_apply_stock_movement
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- ------------------------------------------------------------
-- Stock transfers
-- ------------------------------------------------------------
create table public.stock_transfers (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  number             text not null,
  from_warehouse_id  uuid not null references public.warehouses(id),
  to_warehouse_id    uuid not null references public.warehouses(id),
  status             text not null default 'draft'
                       check (status in ('draft','in_transit','received','cancelled')),
  notes              text,
  created_by         uuid references public.users(id),
  sent_at            timestamptz,
  received_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, number),
  check (from_warehouse_id <> to_warehouse_id)
);
create trigger trg_stock_transfers_updated before update on public.stock_transfers
  for each row execute function public.set_updated_at();
create index idx_stock_transfers_company on public.stock_transfers(company_id);

create table public.stock_transfer_items (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  transfer_id  uuid not null references public.stock_transfers(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  variant_id   uuid references public.product_variants(id),
  quantity     numeric(14,3) not null check (quantity > 0),
  created_at   timestamptz not null default now()
);
create index idx_stock_transfer_items_transfer on public.stock_transfer_items(transfer_id);


-- ============================================================================
-- 0006_sales.sql
-- ============================================================================
-- ============================================================
-- 0006 — Sales pipeline: document numbering, quotations,
--        sales orders, delivery notes, sales (invoices/POS
--        tickets/returns) and their items
-- ============================================================

-- ------------------------------------------------------------
-- Per-company, per-document-type numbering (no duplicates,
-- concurrency-safe via row lock).
-- ------------------------------------------------------------
create table public.document_sequences (
  company_id  uuid not null references public.companies(id) on delete cascade,
  doc_type    text not null,   -- 'invoice' | 'pos' | 'quotation' | 'sales_order' | 'delivery_note' | 'credit_note' | 'purchase_order' | 'goods_receipt' | 'supplier_invoice' | 'payment' | 'transfer' | 'expense'
  prefix      text not null default '',
  next_number bigint not null default 1,
  padding     integer not null default 5,
  primary key (company_id, doc_type)
);

create or replace function public.next_document_number(p_company uuid, p_doc_type text)
returns text
language plpgsql
as $$
declare
  seq public.document_sequences%rowtype;
  result text;
begin
  update public.document_sequences
  set next_number = next_number + 1
  where company_id = p_company and doc_type = p_doc_type
  returning * into seq;

  if not found then
    insert into public.document_sequences (company_id, doc_type, next_number)
    values (p_company, p_doc_type, 2)
    on conflict (company_id, doc_type) do update set next_number = document_sequences.next_number + 1
    returning * into seq;
    if seq.next_number = 2 then
      seq.next_number := 2; -- first issued number is 1
    end if;
  end if;

  result := seq.prefix || to_char(extract(year from now()), 'FM0000') || '-' ||
            lpad((seq.next_number - 1)::text, seq.padding, '0');
  return result;
end;
$$;

-- ------------------------------------------------------------
-- Quotations
-- ------------------------------------------------------------
create table public.quotations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        text not null,
  customer_id   uuid references public.customers(id),
  branch_id     uuid references public.branches(id),
  status        text not null default 'draft'
                  check (status in ('draft','sent','accepted','rejected','expired','converted')),
  valid_until   date,
  subtotal      numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  tax_amount    numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  notes         text,
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (company_id, number)
);
create trigger trg_quotations_updated before update on public.quotations
  for each row execute function public.set_updated_at();
create index idx_quotations_company on public.quotations(company_id, created_at desc);

create table public.quotation_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  quotation_id  uuid not null references public.quotations(id) on delete cascade,
  product_id    uuid references public.products(id),
  variant_id    uuid references public.product_variants(id),
  description   text not null,
  quantity      numeric(14,3) not null check (quantity > 0),
  unit_price    numeric(14,2) not null,
  discount_pct  numeric(5,2) not null default 0,
  tax_rate      numeric(5,2) not null default 0,
  line_total    numeric(14,2) not null,
  position      integer not null default 0
);
create index idx_quotation_items_quotation on public.quotation_items(quotation_id);

-- ------------------------------------------------------------
-- Sales orders
-- ------------------------------------------------------------
create table public.sales_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        text not null,
  quotation_id  uuid references public.quotations(id),
  customer_id   uuid references public.customers(id),
  branch_id     uuid references public.branches(id),
  status        text not null default 'pending'
                  check (status in ('pending','confirmed','partially_delivered','delivered','invoiced','cancelled')),
  subtotal      numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  tax_amount    numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  notes         text,
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (company_id, number)
);
create trigger trg_sales_orders_updated before update on public.sales_orders
  for each row execute function public.set_updated_at();
create index idx_sales_orders_company on public.sales_orders(company_id, created_at desc);

create table public.sales_order_items (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  sales_order_id  uuid not null references public.sales_orders(id) on delete cascade,
  product_id      uuid references public.products(id),
  variant_id      uuid references public.product_variants(id),
  description     text not null,
  quantity        numeric(14,3) not null check (quantity > 0),
  delivered_qty   numeric(14,3) not null default 0,
  unit_price      numeric(14,2) not null,
  discount_pct    numeric(5,2) not null default 0,
  tax_rate        numeric(5,2) not null default 0,
  line_total      numeric(14,2) not null,
  position        integer not null default 0
);
create index idx_sales_order_items_order on public.sales_order_items(sales_order_id);

-- ------------------------------------------------------------
-- Delivery notes
-- ------------------------------------------------------------
create table public.delivery_notes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  number          text not null,
  sales_order_id  uuid references public.sales_orders(id),
  customer_id     uuid references public.customers(id),
  warehouse_id    uuid references public.warehouses(id),
  status          text not null default 'pending'
                    check (status in ('pending','delivered','invoiced','cancelled')),
  notes           text,
  created_by      uuid references public.users(id),
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (company_id, number)
);
create trigger trg_delivery_notes_updated before update on public.delivery_notes
  for each row execute function public.set_updated_at();
create index idx_delivery_notes_company on public.delivery_notes(company_id, created_at desc);

create table public.delivery_note_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  delivery_note_id  uuid not null references public.delivery_notes(id) on delete cascade,
  product_id        uuid references public.products(id),
  variant_id        uuid references public.product_variants(id),
  description       text not null,
  quantity          numeric(14,3) not null check (quantity > 0),
  position          integer not null default 0
);
create index idx_delivery_note_items_note on public.delivery_note_items(delivery_note_id);

-- ------------------------------------------------------------
-- Sales — the financial transaction (invoice, POS ticket,
-- proforma or credit note/return).
-- ------------------------------------------------------------
create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  number          text not null,
  sale_type       text not null default 'invoice'
                    check (sale_type in ('invoice','pos','proforma','return')),
  parent_sale_id  uuid references public.sales(id),  -- for returns/credit notes
  customer_id     uuid references public.customers(id),  -- null = walk-in POS client
  branch_id       uuid references public.branches(id),
  warehouse_id    uuid not null references public.warehouses(id),
  sales_order_id  uuid references public.sales_orders(id),
  delivery_note_id uuid references public.delivery_notes(id),
  register_session_id uuid,     -- FK added in 0008
  status          text not null default 'completed'
                    check (status in ('draft','completed','cancelled')),
  payment_status  text not null default 'unpaid'
                    check (payment_status in ('unpaid','partial','paid','refunded')),
  sale_date       date not null default current_date,
  due_date        date,
  subtotal        numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  tax_amount      numeric(14,2) not null default 0,
  shipping_amount numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  paid_amount     numeric(14,2) not null default 0,
  total_cost      numeric(14,2) not null default 0,  -- COGS snapshot (weighted avg at sale time)
  notes           text,
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (company_id, number)
);
create trigger trg_sales_updated before update on public.sales
  for each row execute function public.set_updated_at();
create index idx_sales_company_date on public.sales(company_id, sale_date desc);
create index idx_sales_customer on public.sales(customer_id);
create index idx_sales_payment_status on public.sales(company_id, payment_status);

create table public.sale_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  sale_id       uuid not null references public.sales(id) on delete cascade,
  product_id    uuid references public.products(id),
  variant_id    uuid references public.product_variants(id),
  description   text not null,
  quantity      numeric(14,3) not null check (quantity > 0),
  unit_price    numeric(14,2) not null,
  discount_pct  numeric(5,2) not null default 0,
  tax_rate      numeric(5,2) not null default 0,
  unit_cost     numeric(14,4) not null default 0,   -- cost captured at sale time
  line_total    numeric(14,2) not null,             -- after discount, incl. tax
  position      integer not null default 0
);
create index idx_sale_items_sale on public.sale_items(sale_id);
create index idx_sale_items_product on public.sale_items(company_id, product_id);


-- ============================================================================
-- 0007_purchases.sql
-- ============================================================================
-- ============================================================
-- 0007 — Purchases: purchase orders, goods receipts (partial
--        reception), supplier invoices
-- ============================================================

create table public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        text not null,
  supplier_id   uuid not null references public.suppliers(id),
  warehouse_id  uuid references public.warehouses(id),
  status        text not null default 'pending'
                  check (status in ('draft','pending','confirmed','partially_received','received','cancelled')),
  order_date    date not null default current_date,
  expected_date date,
  subtotal      numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  tax_amount    numeric(14,2) not null default 0,
  shipping_amount numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  notes         text,
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (company_id, number)
);
create trigger trg_purchase_orders_updated before update on public.purchase_orders
  for each row execute function public.set_updated_at();
create index idx_purchase_orders_company on public.purchase_orders(company_id, created_at desc);
create index idx_purchase_orders_supplier on public.purchase_orders(supplier_id);

create table public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id        uuid references public.products(id),
  variant_id        uuid references public.product_variants(id),
  description       text not null,
  quantity          numeric(14,3) not null check (quantity > 0),
  received_qty      numeric(14,3) not null default 0,
  unit_price        numeric(14,2) not null,
  discount_pct      numeric(5,2) not null default 0,
  tax_rate          numeric(5,2) not null default 0,
  line_total        numeric(14,2) not null,
  position          integer not null default 0
);
create index idx_purchase_order_items_po on public.purchase_order_items(purchase_order_id);

create table public.goods_receipts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  number            text not null,
  purchase_order_id uuid references public.purchase_orders(id),
  supplier_id       uuid not null references public.suppliers(id),
  warehouse_id      uuid not null references public.warehouses(id),
  status            text not null default 'received'
                      check (status in ('received','cancelled')),
  receipt_date      date not null default current_date,
  notes             text,
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (company_id, number)
);
create trigger trg_goods_receipts_updated before update on public.goods_receipts
  for each row execute function public.set_updated_at();
create index idx_goods_receipts_company on public.goods_receipts(company_id, created_at desc);

create table public.goods_receipt_items (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  purchase_order_item_id uuid references public.purchase_order_items(id),
  product_id       uuid references public.products(id),
  variant_id       uuid references public.product_variants(id),
  description      text not null,
  quantity         numeric(14,3) not null check (quantity > 0),
  unit_cost        numeric(14,4) not null default 0,
  position         integer not null default 0
);
create index idx_goods_receipt_items_gr on public.goods_receipt_items(goods_receipt_id);

create table public.supplier_invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  number            text not null,           -- our internal number
  supplier_ref      text,                    -- supplier's own invoice number
  purchase_order_id uuid references public.purchase_orders(id),
  goods_receipt_id  uuid references public.goods_receipts(id),
  supplier_id       uuid not null references public.suppliers(id),
  status            text not null default 'confirmed'
                      check (status in ('draft','confirmed','cancelled')),
  payment_status    text not null default 'unpaid'
                      check (payment_status in ('unpaid','partial','paid')),
  invoice_date      date not null default current_date,
  due_date          date,
  subtotal          numeric(14,2) not null default 0,
  discount_amount   numeric(14,2) not null default 0,
  tax_amount        numeric(14,2) not null default 0,
  shipping_amount   numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  paid_amount       numeric(14,2) not null default 0,
  notes             text,
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (company_id, number)
);
create trigger trg_supplier_invoices_updated before update on public.supplier_invoices
  for each row execute function public.set_updated_at();
create index idx_supplier_invoices_company on public.supplier_invoices(company_id, created_at desc);
create index idx_supplier_invoices_supplier on public.supplier_invoices(supplier_id);
create index idx_supplier_invoices_payment_status on public.supplier_invoices(company_id, payment_status);

create table public.supplier_invoice_items (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  supplier_invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  product_id          uuid references public.products(id),
  variant_id          uuid references public.product_variants(id),
  description         text not null,
  quantity            numeric(14,3) not null check (quantity > 0),
  unit_price          numeric(14,2) not null,
  discount_pct        numeric(5,2) not null default 0,
  tax_rate            numeric(5,2) not null default 0,
  line_total          numeric(14,2) not null,
  position            integer not null default 0
);
create index idx_supplier_invoice_items_si on public.supplier_invoice_items(supplier_invoice_id);


-- ============================================================================
-- 0008_payments_expenses_register.sql
-- ============================================================================
-- ============================================================
-- 0008 — Payment methods, payments & allocations, expenses,
--        cash register sessions
-- ============================================================

-- Extensible payment methods (never hardcode providers).
create table public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,             -- Espèces, CIB, Edahabia, Virement, Chèque, Crédit…
  code        text not null,             -- cash, cib, edahabia, transfer, cheque, credit, other
  kind        text not null default 'other'
                check (kind in ('cash','card','bank','cheque','credit','other')),
  is_active   boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (company_id, code)
);
create index idx_payment_methods_company on public.payment_methods(company_id);

-- ------------------------------------------------------------
-- Cash register sessions
-- ------------------------------------------------------------
create table public.register_sessions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  branch_id       uuid references public.branches(id),
  status          text not null default 'open' check (status in ('open','closed')),
  opened_by       uuid not null references public.users(id),
  opening_cash    numeric(14,2) not null default 0,
  closed_by       uuid references public.users(id),
  expected_cash   numeric(14,2),
  actual_cash     numeric(14,2),
  difference      numeric(14,2),
  notes           text,
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_register_sessions_updated before update on public.register_sessions
  for each row execute function public.set_updated_at();
create index idx_register_sessions_company on public.register_sessions(company_id, opened_at desc);

-- Manual cash in/out during a session (deposits, withdrawals…).
create table public.register_movements (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  register_session_id uuid not null references public.register_sessions(id) on delete cascade,
  direction           text not null check (direction in ('in','out')),
  amount              numeric(14,2) not null check (amount > 0),
  reason              text not null,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now()
);
create index idx_register_movements_session on public.register_movements(register_session_id);

-- Wire the sales → register session FK deferred from 0006.
alter table public.sales
  add constraint fk_sales_register_session
  foreign key (register_session_id) references public.register_sessions(id);

-- ------------------------------------------------------------
-- Payments (in = from customers, out = to suppliers) and their
-- allocation against documents.
-- ------------------------------------------------------------
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  number              text not null,
  direction           text not null check (direction in ('in','out')),
  partner_type        text not null check (partner_type in ('customer','supplier')),
  customer_id         uuid references public.customers(id),
  supplier_id         uuid references public.suppliers(id),
  payment_method_id   uuid not null references public.payment_methods(id),
  register_session_id uuid references public.register_sessions(id),
  amount              numeric(14,2) not null check (amount > 0),
  payment_date        date not null default current_date,
  reference           text,           -- cheque number, transfer ref…
  notes               text,
  status              text not null default 'completed'
                        check (status in ('completed','cancelled')),
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (company_id, number),
  -- customer_id may be null for walk-in POS payments
  check (
    (partner_type = 'customer' and supplier_id is null) or
    (partner_type = 'supplier' and supplier_id is not null and customer_id is null)
  )
);
create trigger trg_payments_updated before update on public.payments
  for each row execute function public.set_updated_at();
create index idx_payments_company on public.payments(company_id, payment_date desc);
create index idx_payments_customer on public.payments(customer_id);
create index idx_payments_supplier on public.payments(supplier_id);

create table public.payment_allocations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  payment_id   uuid not null references public.payments(id) on delete cascade,
  target_type  text not null check (target_type in ('sale','supplier_invoice')),
  target_id    uuid not null,
  amount       numeric(14,2) not null check (amount > 0),
  created_at   timestamptz not null default now()
);
create index idx_payment_allocations_payment on public.payment_allocations(payment_id);
create index idx_payment_allocations_target on public.payment_allocations(target_type, target_id);

-- ------------------------------------------------------------
-- Expenses
-- ------------------------------------------------------------
create table public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (company_id, name)
);
create index idx_expense_categories_company on public.expense_categories(company_id);

create table public.expenses (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  number              text not null,
  category_id         uuid references public.expense_categories(id),
  branch_id           uuid references public.branches(id),
  payment_method_id   uuid references public.payment_methods(id),
  register_session_id uuid references public.register_sessions(id),
  employee_id         uuid references public.employees(id),
  amount              numeric(14,2) not null check (amount > 0),
  expense_date        date not null default current_date,
  description         text not null,
  attachment_url      text,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (company_id, number)
);
create trigger trg_expenses_updated before update on public.expenses
  for each row execute function public.set_updated_at();
create index idx_expenses_company on public.expenses(company_id, expense_date desc);


-- ============================================================================
-- 0009_audit_notifications_settings.sql
-- ============================================================================
-- ============================================================
-- 0009 — Audit logs (immutable), notifications, settings,
--        sync queue (Phase 2 offline POS groundwork)
-- ============================================================

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid references public.users(id),
  action      text not null,        -- 'create' | 'update' | 'delete' | 'refund' | 'approve' | 'login' …
  entity_type text not null,        -- 'product' | 'sale' | 'payment' …
  entity_id   uuid,
  entity_label text,                -- human-readable: "FAC2026-00042", "Samsung A15"
  old_values  jsonb,
  new_values  jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index idx_audit_logs_company on public.audit_logs(company_id, created_at desc);
create index idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);

-- Audit log is append-only for everyone (including owners).
create trigger trg_audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.forbid_change();

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid references public.users(id),  -- null = company-wide
  severity    text not null default 'info'
                check (severity in ('critical','warning','info','success')),
  kind        text not null,        -- 'low_stock' | 'overdue_customer' | 'supplier_due' | …
  title       text not null,
  body        text,
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_notifications_company on public.notifications(company_id, created_at desc);
create index idx_notifications_user_unread on public.notifications(user_id) where read_at is null;

create table public.settings (
  company_id  uuid not null references public.companies(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, key)
);

-- Groundwork for Phase 2 offline POS synchronization.
create table public.sync_queue (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  device_id       text not null,
  idempotency_key text not null,
  operation       text not null,
  payload         jsonb not null,
  status          text not null default 'pending'
                    check (status in ('pending','applied','conflict','failed')),
  error           text,
  client_created_at timestamptz,
  applied_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (company_id, device_id, idempotency_key)
);
create index idx_sync_queue_company on public.sync_queue(company_id, status);


-- ============================================================================
-- 0010_rls.sql
-- ============================================================================
-- ============================================================
-- 0010 — Row Level Security
--
-- Model:
--  * Tenant isolation is enforced in the DATABASE: every
--    business table carries company_id and every policy requires
--    active membership via is_company_member().
--  * Fine-grained permissions (sales.create, inventory.adjust…)
--    are enforced in the API layer on top of this; RLS is the
--    hard isolation boundary that survives any application bug.
--  * Local: the app connects as `sahla_app` (never table owner)
--    and sets request.jwt.claim.sub per transaction.
--    Supabase: `authenticated` role + native auth.uid().
--  * Auth tables (credentials, sessions, reset tokens) have RLS
--    enabled with NO policies → invisible to the app role; they
--    are only reachable through the privileged auth pool
--    (equivalent of the Supabase service role).
-- ============================================================

-- ------------------------------------------------------------
-- Generic tenant tables: full CRUD for active company members.
-- ------------------------------------------------------------
do $$
declare
  t text;
  tenant_tables text[] := array[
    'branches','warehouses','employees',
    'product_categories','brands','units','products','product_variants','barcodes',
    'customers','customer_addresses','suppliers',
    'inventory_balances','stock_transfers','stock_transfer_items','document_sequences',
    'quotations','quotation_items','sales_orders','sales_order_items',
    'delivery_notes','delivery_note_items','sales','sale_items',
    'purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items',
    'supplier_invoices','supplier_invoice_items',
    'payment_methods','register_sessions','register_movements',
    'payments','payment_allocations','expense_categories','expenses',
    'notifications','settings','sync_queue'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_company_member(company_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert with check (public.is_company_member(company_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update using (public.is_company_member(company_id)) with check (public.is_company_member(company_id))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete using (public.is_company_member(company_id))',
      t || '_delete', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Append-only ledgers: SELECT + INSERT only. No UPDATE/DELETE
-- policies (deny) — and immutability triggers back this up.
-- ------------------------------------------------------------
alter table public.stock_movements enable row level security;
create policy stock_movements_select on public.stock_movements
  for select using (public.is_company_member(company_id));
create policy stock_movements_insert on public.stock_movements
  for insert with check (public.is_company_member(company_id));

alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs
  for select using (public.is_company_member(company_id));
create policy audit_logs_insert on public.audit_logs
  for insert with check (public.is_company_member(company_id));

-- ------------------------------------------------------------
-- companies: members can read; updates require membership
-- (owner/permission check enforced in API). Creation happens
-- through the privileged pool during signup/onboarding.
-- ------------------------------------------------------------
alter table public.companies enable row level security;
create policy companies_select on public.companies
  for select using (public.is_company_member(id));
create policy companies_update on public.companies
  for update using (public.is_company_member(id))
  with check (public.is_company_member(id));

-- ------------------------------------------------------------
-- users: a user sees their own row + colleagues (same company).
-- ------------------------------------------------------------
alter table public.users enable row level security;
create policy users_select_self on public.users
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.company_members m1
      join public.company_members m2 on m1.company_id = m2.company_id
      where m1.user_id = auth.uid() and m1.status = 'active'
        and m2.user_id = public.users.id
    )
  );
create policy users_update_self on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ------------------------------------------------------------
-- RBAC tables
-- ------------------------------------------------------------
alter table public.permissions enable row level security;
create policy permissions_select on public.permissions
  for select using (auth.uid() is not null);

alter table public.roles enable row level security;
create policy roles_select on public.roles
  for select using (company_id is null or public.is_company_member(company_id));
create policy roles_write on public.roles
  for all using (company_id is not null and public.has_permission(company_id, 'users.manage'))
  with check (company_id is not null and public.has_permission(company_id, 'users.manage'));

alter table public.role_permissions enable row level security;
create policy role_permissions_select on public.role_permissions
  for select using (exists (
    select 1 from public.roles r
    where r.id = role_id
      and (r.company_id is null or public.is_company_member(r.company_id))
  ));
create policy role_permissions_write on public.role_permissions
  for all using (exists (
    select 1 from public.roles r
    where r.id = role_id and r.company_id is not null
      and public.has_permission(r.company_id, 'users.manage')
  ))
  with check (exists (
    select 1 from public.roles r
    where r.id = role_id and r.company_id is not null
      and public.has_permission(r.company_id, 'users.manage')
  ));

alter table public.company_members enable row level security;
create policy company_members_select on public.company_members
  for select using (public.is_company_member(company_id));
create policy company_members_write on public.company_members
  for all using (public.has_permission(company_id, 'users.manage'))
  with check (public.has_permission(company_id, 'users.manage'));

-- ------------------------------------------------------------
-- Auth tables: RLS on, zero policies → only the privileged
-- auth pool (bypasses RLS) can touch them.
-- ------------------------------------------------------------
alter table public.auth_credentials enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.password_reset_tokens enable row level security;

-- ------------------------------------------------------------
-- Grants for the local application role (Supabase grants its
-- own `authenticated` role automatically).
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sahla_app') then
    grant usage on schema public to sahla_app;
    grant select, insert, update, delete on all tables in schema public to sahla_app;
    grant execute on all functions in schema public to sahla_app;
    alter default privileges in schema public grant select, insert, update, delete on tables to sahla_app;
    alter default privileges in schema public grant execute on functions to sahla_app;
  end if;
end $$;


-- ============================================================================
-- 0011_delivery_and_geo.sql
-- ============================================================================
-- ============================================================
-- 0011 — Geolocation & delivery module (Daitec)
--  * lat/lng on customers, branches, warehouses
--  * deliveries: sale → courier assignment → status flow → COD
--  * courier_positions: live livreur tracking pings
--  * Livreur permissions + system role template
-- ============================================================

alter table public.customers  add column if not exists latitude  numeric(9,6);
alter table public.customers  add column if not exists longitude numeric(9,6);
alter table public.branches   add column if not exists latitude  numeric(9,6);
alter table public.branches   add column if not exists longitude numeric(9,6);
alter table public.warehouses add column if not exists latitude  numeric(9,6);
alter table public.warehouses add column if not exists longitude numeric(9,6);

-- ------------------------------------------------------------
-- Deliveries
-- ------------------------------------------------------------
create table public.deliveries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        text not null,
  sale_id       uuid references public.sales(id),
  customer_id   uuid references public.customers(id),
  branch_id     uuid references public.branches(id),
  courier_id    uuid references public.users(id),        -- the livreur
  status        text not null default 'pending'
                  check (status in ('pending','assigned','picked_up','out_for_delivery','delivered','failed','cancelled')),
  -- destination snapshot (kept even if the customer record changes later)
  address       text,
  city          text,
  phone         text,
  latitude      numeric(9,6),
  longitude     numeric(9,6),
  cod_amount    numeric(14,2) not null default 0,        -- cash to collect on delivery
  cod_payment_id uuid references public.payments(id),    -- set when settled
  notes         text,
  failure_reason text,
  assigned_at   timestamptz,
  picked_up_at  timestamptz,
  out_at        timestamptz,
  delivered_at  timestamptz,
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (company_id, number)
);
create trigger trg_deliveries_updated before update on public.deliveries
  for each row execute function public.set_updated_at();
create index idx_deliveries_company on public.deliveries(company_id, created_at desc);
create index idx_deliveries_courier on public.deliveries(courier_id) where status not in ('delivered','failed','cancelled');
create index idx_deliveries_status on public.deliveries(company_id, status);

-- ------------------------------------------------------------
-- Courier position pings (lightweight time series)
-- ------------------------------------------------------------
create table public.courier_positions (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  courier_id  uuid not null references public.users(id) on delete cascade,
  latitude    numeric(9,6) not null,
  longitude   numeric(9,6) not null,
  accuracy_m  numeric(8,1),
  heading     numeric(5,1),
  recorded_at timestamptz not null default now()
);
create index idx_courier_positions_latest
  on public.courier_positions(company_id, courier_id, recorded_at desc);

-- Latest position per courier (used by the dispatch map)
create or replace view public.courier_latest_positions
with (security_invoker = true) as
select distinct on (company_id, courier_id)
  company_id, courier_id, latitude, longitude, accuracy_m, heading, recorded_at
from public.courier_positions
order by company_id, courier_id, recorded_at desc;

-- ------------------------------------------------------------
-- Permissions + Livreur role for existing tenants
-- ------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('deliveries.view',          'deliveries', 'View deliveries'),
  ('deliveries.create',        'deliveries', 'Create deliveries'),
  ('deliveries.assign',        'deliveries', 'Assign couriers'),
  ('deliveries.update_status', 'deliveries', 'Update delivery status'),
  ('deliveries.track',         'deliveries', 'View live courier positions'),
  ('map.view',                 'deliveries', 'View the dispatch map')
on conflict (code) do nothing;

-- Grant the new delivery permissions to existing Owner/Administrator/Manager roles.
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
cross join (values ('deliveries.view'),('deliveries.create'),('deliveries.assign'),
                   ('deliveries.update_status'),('deliveries.track'),('map.view')) as p(code)
where r.company_id is not null and r.name in ('Administrator','Manager')
on conflict do nothing;

-- Create the Livreur role in every existing company.
insert into public.roles (company_id, name, description, is_system)
select c.id, 'Livreur', 'Courier — sees and updates own deliveries', true
from public.companies c
where not exists (select 1 from public.roles r where r.company_id = c.id and r.name = 'Livreur');

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
cross join (values ('deliveries.view'),('deliveries.update_status')) as p(code)
where r.name = 'Livreur'
on conflict do nothing;

-- Delivery numbering for existing tenants (LIV prefix).
insert into public.document_sequences (company_id, doc_type, prefix)
select id, 'delivery', 'LIV' from public.companies
on conflict do nothing;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.deliveries enable row level security;
create policy deliveries_select on public.deliveries
  for select using (public.is_company_member(company_id));
create policy deliveries_insert on public.deliveries
  for insert with check (public.is_company_member(company_id));
create policy deliveries_update on public.deliveries
  for update using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
create policy deliveries_delete on public.deliveries
  for delete using (public.is_company_member(company_id));

alter table public.courier_positions enable row level security;
create policy courier_positions_select on public.courier_positions
  for select using (public.is_company_member(company_id));
-- A courier may only insert their own positions.
create policy courier_positions_insert on public.courier_positions
  for insert with check (public.is_company_member(company_id) and courier_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sahla_app') then
    grant select, insert, update, delete on public.deliveries to sahla_app;
    grant select, insert on public.courier_positions to sahla_app;
    grant select on public.courier_latest_positions to sahla_app;
  end if;
end $$;


-- ============================================================================
-- 0012_delivery_proofs.sql
-- ============================================================================
-- ============================================================
-- 0012 — Proof of delivery: photo + customer signature captured
-- by the livreur, immutably attached to the delivery.
-- Stored as compressed base64 data-URLs (portable: moves to
-- Supabase Storage without schema change by swapping `data`
-- for a storage path).
-- ============================================================

create table public.delivery_proofs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  kind        text not null check (kind in ('photo','signature')),
  data        text not null,          -- data:image/jpeg;base64,… (≤ ~700KB each)
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now()
);
create index idx_delivery_proofs_delivery on public.delivery_proofs(delivery_id);

-- Proofs are evidence: append-only.
create trigger trg_delivery_proofs_immutable
  before update or delete on public.delivery_proofs
  for each row execute function public.forbid_change();

alter table public.delivery_proofs enable row level security;
create policy delivery_proofs_select on public.delivery_proofs
  for select using (public.is_company_member(company_id));
create policy delivery_proofs_insert on public.delivery_proofs
  for insert with check (public.is_company_member(company_id));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sahla_app') then
    grant select, insert on public.delivery_proofs to sahla_app;
  end if;
end $$;


-- ============================================================================
-- 0013_customer_qr.sql
-- ============================================================================
-- ============================================================
-- 0013 — Customer QR codes for delivery verification.
-- Each customer carries an opaque QR token (no PII in the code).
-- Scanning it at the door proves the livreur reached the right
-- client; the verification instant is stamped on the delivery.
-- ============================================================

alter table public.customers
  add column if not exists qr_token uuid not null default gen_random_uuid();
create unique index if not exists uq_customers_qr_token on public.customers(qr_token);

alter table public.deliveries
  add column if not exists qr_verified_at timestamptz;


-- ============================================================================
-- 0014_platform_admin.sql
-- ============================================================================
-- ============================================================
-- 0014 — Platform Super Admin (SaaS operator back-office)
--  * platform_admins: who may operate the /admin console
--  * companies.suspended_at: platform-level suspension
--  * platform_audit_logs: append-only operator action trail
--
-- Security model: these tables have RLS enabled with NO policies —
-- they are invisible to the tenant application role and reachable
-- only through the privileged pool (Supabase service role). Tenant
-- RLS is untouched: admin reads go through the privileged pool,
-- never by weakening tenant policies.
-- ============================================================

create table public.platform_admins (
  user_id     uuid primary key references public.users(id) on delete cascade,
  note        text,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now()
);
alter table public.platform_admins enable row level security;  -- no policies: deny app role

alter table public.companies add column if not exists suspended_at timestamptz;
alter table public.companies add column if not exists suspension_reason text;

create table public.platform_audit_logs (
  id             bigint generated always as identity primary key,
  admin_user_id  uuid not null references public.users(id),
  action         text not null,      -- 'suspend_company' | 'activate_company' | 'grant_admin' | …
  company_id     uuid,
  details        jsonb,
  ip             text,
  created_at     timestamptz not null default now()
);
create index idx_platform_audit_created on public.platform_audit_logs(created_at desc);
alter table public.platform_audit_logs enable row level security;  -- no policies

create trigger trg_platform_audit_immutable
  before update or delete on public.platform_audit_logs
  for each row execute function public.forbid_change();


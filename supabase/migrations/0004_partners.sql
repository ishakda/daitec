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

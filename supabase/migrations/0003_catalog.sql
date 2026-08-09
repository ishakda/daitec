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

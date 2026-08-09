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

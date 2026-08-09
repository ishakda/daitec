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

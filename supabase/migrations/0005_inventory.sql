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

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

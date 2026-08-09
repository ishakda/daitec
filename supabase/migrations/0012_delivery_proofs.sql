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

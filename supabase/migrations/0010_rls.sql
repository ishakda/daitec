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

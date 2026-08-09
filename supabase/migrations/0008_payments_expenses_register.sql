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

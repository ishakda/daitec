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

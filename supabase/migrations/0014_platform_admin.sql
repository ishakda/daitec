-- ============================================================
-- 0014 — Platform Super Admin (SaaS operator back-office)
--  * platform_admins: who may operate the /admin console
--  * companies.suspended_at: platform-level suspension
--  * platform_audit_logs: append-only operator action trail
--
-- Security model: these tables have RLS enabled with NO policies —
-- they are invisible to the tenant application role and reachable
-- only through the privileged pool (Supabase service role). Tenant
-- RLS is untouched: admin reads go through the privileged pool,
-- never by weakening tenant policies.
-- ============================================================

create table public.platform_admins (
  user_id     uuid primary key references public.users(id) on delete cascade,
  note        text,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now()
);
alter table public.platform_admins enable row level security;  -- no policies: deny app role

alter table public.companies add column if not exists suspended_at timestamptz;
alter table public.companies add column if not exists suspension_reason text;

create table public.platform_audit_logs (
  id             bigint generated always as identity primary key,
  admin_user_id  uuid not null references public.users(id),
  action         text not null,      -- 'suspend_company' | 'activate_company' | 'grant_admin' | …
  company_id     uuid,
  details        jsonb,
  ip             text,
  created_at     timestamptz not null default now()
);
create index idx_platform_audit_created on public.platform_audit_logs(created_at desc);
alter table public.platform_audit_logs enable row level security;  -- no policies

create trigger trg_platform_audit_immutable
  before update or delete on public.platform_audit_logs
  for each row execute function public.forbid_change();

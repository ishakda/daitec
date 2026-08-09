-- ============================================================
-- 0013 — Customer QR codes for delivery verification.
-- Each customer carries an opaque QR token (no PII in the code).
-- Scanning it at the door proves the livreur reached the right
-- client; the verification instant is stamped on the delivery.
-- ============================================================

alter table public.customers
  add column if not exists qr_token uuid not null default gen_random_uuid();
create unique index if not exists uq_customers_qr_token on public.customers(qr_token);

alter table public.deliveries
  add column if not exists qr_verified_at timestamptz;

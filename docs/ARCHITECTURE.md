# Architecture

## Overview

```
Browser (Next.js React UI, fr/ar/en, RTL)
   │  fetch /api/v1/*  (session cookie)
   ▼
Next.js route handlers  ──  withApi() wrapper
   │   session → active company → membership check →
   │   ONE transaction per request → permission checks → audit
   ▼
PostgreSQL 16
   ├── RLS on every tenant table (hard isolation boundary)
   ├── stock_movements: immutable ledger + balance trigger
   └── document_sequences: concurrency-safe numbering
```

## Multi-tenancy & security model

**Two connection pools** (mirrors Supabase's service-role/authenticated split):

| Pool | Role | RLS | Used for |
|---|---|---|---|
| `adminPool` | superuser / service role | bypassed | auth (credentials, sessions), signup, company provisioning |
| `appPool` | `sahla_app` | **enforced** | every business query |

Every business request runs inside `withTenant(userId, fn)`:
a transaction that first executes
`set_config('request.jwt.claim.sub', userId, true)` — the same GUC Supabase
uses — so `auth.uid()` resolves inside RLS policies. A user who is not an
active member of a company simply *cannot see or write* its rows, regardless
of any application bug.

Fine-grained permissions (`sales.create`, `inventory.adjust`,
`sales.view_cost`, …) are enforced in the API layer via
`has_permission(company_id, code)` (owner short-circuits to true). Cost and
profit columns are stripped from responses when the member lacks
`*.view_cost` / `*.view_profit`.

**Auth:** local email/password (bcrypt) with DB-backed revocable sessions and
a signed JWT cookie. On Supabase, Supabase Auth replaces
`auth_credentials`/`auth_sessions`; `public.users` mirrors `auth.users`.

## Inventory engine

Stock is **never** written directly. Every operation inserts into
`stock_movements` (append-only; UPDATE/DELETE raise an exception via trigger
*and* are denied by RLS). An `AFTER INSERT` trigger:

1. locks the `(warehouse, product, variant)` balance row,
2. rejects the movement if it would drive stock negative
   (unless `companies.allow_negative_stock`), raising `INSUFFICIENT_STOCK`,
3. maintains **weighted-average cost** on inbound quantities:
   `new_avg = (qty·avg + in_qty·in_cost) / (qty + in_qty)`.

Because the trigger runs in the caller's transaction, the ledger and balances
can never diverge, and a failed sale rolls back its movements atomically.

`companies.costing_method` is configurable (`weighted_average` now; the ledger
carries per-movement `unit_cost`, so FIFO can be added without schema change).

## Money & documents

- Unit prices are **HT** (tax-exclusive); tax is computed per line from
  `tax_rate`. All math in `lib/money.ts`, rounded to 2 decimals (4 for costs).
- Each sale item snapshots `unit_cost` at sale time → COGS and profit are
  historical facts, not `price - current_cost` guesses.
- Document numbers come from `next_document_number(company, doc_type)` —
  a row-locked counter per company/type (`FAC2026-00042`, `TCK…`, `BL…`,
  `AV…`, `CMD…`, `BR…`, `FF…`, `PAY…`), duplicates impossible.

## Transactional business flows

`withApi` wraps each request in one transaction, so e.g. **create sale** =
sale + items + stock movements + payment + allocation + customer balance +
audit row — all-or-nothing. Same for goods receipts (PO progress + stock +
supplier invoice + payable) and payments (allocations + document status +
partner balance, with `OVERPAYMENT` rejection).

Customer/supplier `balance` is a maintained running balance
(receivable/payable); statements derive from documents and payments.

## Audit

`audit_logs` is append-only (trigger + RLS): user, action, entity, label,
old/new values (JSONB), IP, user-agent — written in the same transaction as
the mutation it records.

## i18n & RTL

Cookie-based locale (`fr` default). The server layout sets `<html lang dir>`;
`ar` renders fully right-to-left with Noto Sans Arabic. All 338 UI strings ×
3 languages live in `src/i18n/*.json` (key parity enforced). Numbers stay
Latin/tabular via the `.num` utility. Money formatting uses `Intl.NumberFormat`
with DZD.

## Maps & delivery module

- **Geo data:** `latitude/longitude` on customers, branches, warehouses —
  captured with a Leaflet pin-drop picker + free Nominatim address search
  (DZ-biased, debounced). Tiles come from OpenStreetMap; no API key.
- **`deliveries`:** destination snapshot (address/phone/coords copied at
  creation), courier assignment, validated status machine
  `pending → assigned → picked_up → out_for_delivery → delivered/failed`
  (server-side transition matrix, 409 `INVALID_TRANSITION` otherwise), COD
  amount defaulting to the sale's remaining due.
- **COD settlement:** on `delivered`, the COD is recorded through the same
  payments engine (cash method, allocation to the sale, customer balance
  update) in one transaction — the livreur closing a delivery IS the payment.
- **Tracking:** couriers ping `courier_positions` (~20 s throttle from the
  browser Geolocation API while "on duty"); RLS restricts inserts to the
  courier's own `auth.uid()`. The dispatch map polls latest positions every
  10 s. A `courier_latest_positions` view serves the map.
- **QR delivery verification:** every customer carries an opaque
  `qr_token` (uuid — no PII in the code) printed as a `DAITEC:CUST:<token>`
  QR card. The courier page scans it with getUserMedia + jsQR; the server
  verifies it against the delivery's customer (`verify-qr` for instant
  feedback, re-verified on the delivered call) and stamps `qr_verified_at`.
- **Proof of delivery:** on `delivered`/`failed` the courier attaches a
  package photo (client-side compressed JPEG) and a customer signature
  (canvas pad) — stored in `delivery_proofs`, append-only via trigger + RLS
  (evidence cannot be altered), viewable from the deliveries list.
- **Roles:** a `Livreur` system role sees and updates only its own deliveries
  (enforced in the API on top of tenant RLS).

## Platform Super Admin (operator back-office)

`/admin` is a separate console for the SaaS operator, guarded by the
`platform_admins` table — which has RLS enabled with **zero policies**, so
the tenant application role cannot even see who the admins are. Admin
endpoints run on the privileged pool (`withPlatformAdmin`); tenant RLS is
never weakened or bypassed on the tenant path. Capabilities: platform
metrics, per-company operational stats, suspend/activate (suspension is
enforced in `withApi` — members get 403 `COMPANY_SUSPENDED`, no data is
touched), and an append-only `platform_audit_logs` trail (immutable even
for the DB superuser).

## Offline POS & sync (Phase 2 groundwork)

`sync_queue` (device_id + idempotency_key unique, status machine
pending→applied/conflict) is in place. The POS already keeps held sales in
localStorage; the Phase 2 offline engine will queue completed sales locally
(UUIDs + idempotency keys) and replay them through the same domain services.

## Supabase migration path

See [DEPLOYMENT.md](DEPLOYMENT.md). In short: migrations run unmodified;
`auth.uid()` is native; RLS policies apply to the `authenticated` role;
`adminPool` maps to the service-role connection; local auth tables are
replaced by Supabase Auth + a `users` mirror trigger.

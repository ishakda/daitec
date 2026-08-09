# Daitec — Gestion commerciale moderne 🇩🇿

A modern, multi-tenant commercial-management platform for Algerian businesses:
sales, purchases, inventory, POS with cash-register sessions, customers &
suppliers with debt tracking, payments, invoicing, thermal receipts, expenses,
reports, granular RBAC, an immutable audit trail — plus a **maps & delivery
module**: client/store geolocation (Leaflet + OpenStreetMap, no API key),
courier (livreur) live GPS tracking, and cash-on-delivery settled straight
into the payments engine. In French, Arabic (full RTL) and English.

**Stack:** Next.js 16 (App Router, TypeScript) · PostgreSQL 16 · Tailwind CSS 4
Runs against plain PostgreSQL locally; every migration and RLS policy is
**Supabase-compatible** for cloud deployment.

---

## Quick start (local)

Requirements: Node 20+, PostgreSQL 16 (with `postgresql16-contrib`).

```bash
# 1. Create the database and the auth shim (auth.uid() — Supabase provides it natively)
createdb sahla        # or: psql -c "CREATE DATABASE sahla;"
psql -d sahla -f scripts/local_bootstrap.sql

# 2. Apply migrations (tracked in schema_migrations, idempotent)
DATABASE_URL=postgresql://postgres@localhost/sahla ./scripts/migrate.sh

# 3. Configure and start the app
cd web
cp .env.example .env.local          # then set AUTH_SECRET (openssl rand -hex 32)
npm install
npm run dev                          # http://localhost:3000
```

Create your account at `/signup` — the onboarding wizard provisions the
company (default roles, warehouse, Algerian payment methods, expense
categories, document numbering) in one transaction.

### Demo data

```bash
node scripts/seed_demo.mjs   # dev server must be running
# → login: demo@sahla.dz / demo12345 (isolated tenant "Daitec Demo Store")
node scripts/seed_geo_demo.mjs   # map positions + livreur demo (livreur@sahla.dz / livreur123)
```

Demo data lives in its **own company (tenant)** — RLS guarantees it can never
mix with production companies.

## Tests

```bash
cd web && npm test               # unit tests (money, cost, debt math)
./scripts/smoke_test.sql         # DB-level: RLS isolation, ledger immutability, weighted-avg cost
./scripts/e2e_api_test.sh        # full business flow against the live server
./scripts/e2e_delivery_test.sh   # delivery + COD + courier tracking flow
./scripts/reset_dev_db.sh        # rebuild dev DB + dev user (karim@demo.dz / password123)
```

## Production build

```bash
cd web && npm run build && npm start
```

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, tenancy & RLS model, inventory ledger, money math |
| [docs/API.md](docs/API.md) | REST API reference (`/api/v1`) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment, incl. the Supabase migration path |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | End-user guide (owner, cashier, manager) |

## Project layout

```
sahla/
├── supabase/migrations/   10 SQL migrations (schema + triggers + RLS) — Supabase-compatible
├── scripts/                migrate.sh, local_bootstrap.sql, smoke/e2e tests, demo seed
├── docs/                   architecture, API, deployment, user guide
└── web/                    Next.js app
    └── src/
        ├── app/(auth)/     login, signup, onboarding
        ├── app/(app)/      dashboard, POS, products, inventory, sales, purchases,
        │                   customers, suppliers, payments, expenses, quotations,
        │                   reports, audit, settings
        ├── app/api/v1/     ~45 REST endpoints (route handlers)
        ├── lib/            db pools (RLS-scoped), auth, api wrapper, money math
        ├── lib/domain/     sales, purchases, payments, inventory services
        ├── components/     design system, data table, command palette, i18n
        └── i18n/           fr.json · ar.json · en.json (338 keys each)
```

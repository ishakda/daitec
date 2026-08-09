# Deployment

## Option A — VPS / self-hosted (plain PostgreSQL)

1. **PostgreSQL 16** (+ contrib for `pgcrypto`):
   ```bash
   createdb sahla
   psql -d sahla -f scripts/local_bootstrap.sql       # auth.uid() shim + sahla_app role
   DATABASE_URL=postgresql://postgres@localhost/sahla ./scripts/migrate.sh
   ```
   ⚠️ Change the `sahla_app` password in `local_bootstrap.sql` for production,
   and reflect it in `DATABASE_URL_APP`.

2. **App** (Node 20+):
   ```bash
   cd web && npm ci && npm run build
   # .env.local (or real env vars):
   #   DATABASE_URL_ADMIN=postgresql://postgres:***@localhost/sahla
   #   DATABASE_URL_APP=postgresql://sahla_app:***@localhost/sahla
   #   AUTH_SECRET=$(openssl rand -hex 32)
   npm start          # behind nginx/caddy with HTTPS (secure cookies need it)
   ```

3. **Backups** — schedule `pg_dump`:
   ```bash
   pg_dump -Fc sahla > /backups/sahla-$(date +%F).dump   # restore: pg_restore -d sahla
   ```
   Per-tenant export can use the same reports/CSV endpoints or a filtered dump.

## Option B — Supabase + Vercel (recommended production path)

**TL;DR — three steps:**

1. **Supabase**: create a project (region `eu-west` / closest to Algeria),
   note the database password. Then from this repo:
   ```bash
   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<db-pass>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres'
   export APP_DB_PASSWORD="$(openssl rand -hex 24)"   # keep it!
   ./scripts/deploy_supabase.sh
   ```
   This bootstraps the `sahla_app` role, applies all 14 migrations + RLS,
   and verifies `auth.uid()` compatibility (the app sets
   `request.jwt.claim.sub` per transaction — Supabase's native `auth.uid()`
   reads it first, so tenant RLS works unchanged).

2. **Vercel**: import the repo, set **Root Directory = `web`**, add env vars:
   | Var | Value |
   |---|---|
   | `DATABASE_URL_ADMIN` | the postgres connection string (server-only!) |
   | `DATABASE_URL_APP` | same host, user `sahla_app` + `APP_DB_PASSWORD`, port **6543** (transaction pooler) |
   | `AUTH_SECRET` | `openssl rand -hex 32` |
   Deploy. (The `pg` driver works with the Supavisor transaction pooler —
   every request runs as a single transaction.)

3. **First run**: sign up at `/signup` (first real company), then grant
   yourself the platform console:
   ```bash
   psql "$SUPABASE_DB_URL" -c "insert into platform_admins (user_id, note)
     select id, 'founder' from users where email='you@domain.com';"
   ```

Notes: local auth (bcrypt + DB sessions) runs against Supabase's Postgres
as-is — migrating to Supabase Auth is optional (see below). Never expose
`DATABASE_URL_ADMIN` or a service-role key to the client.

## Option B bis — full Supabase Auth migration (optional)

The SQL in `supabase/migrations/` is written for Supabase:

1. `supabase link` your project, then `supabase db push` (or run each
   migration in the SQL editor, in order). **Do not** run
   `scripts/local_bootstrap.sql` — Supabase provides `auth` natively.
2. RLS policies apply as-is: `auth.uid()` is native, and Supabase's
   `authenticated` role passes through the same policies as `sahla_app`
   locally (grant it table access like the migration's `sahla_app` block).
3. Replace local auth with Supabase Auth:
   - `auth_credentials`, `auth_sessions`, `password_reset_tokens` become unused
     (they ship with RLS-deny so they are inert).
   - Add the standard mirror trigger so `public.users` follows `auth.users`
     (id = auth.uid, email, full_name from metadata).
   - Point `lib/auth.ts` at `@supabase/ssr` session handling — the rest of the
     app only depends on `getSession()`/`withTenant()`, which maps to a
     Supabase client with the user's JWT.
4. Connections: `DATABASE_URL_ADMIN` → the service-role/direct connection
   (server-only, never exposed); tenant queries can keep using the RLS path.
5. Host the Next.js app on Vercel or any Node host; set the same env vars.

## Production checklist

- [ ] Strong `AUTH_SECRET`; HTTPS everywhere (cookies are `secure` in production)
- [ ] Change `sahla_app` DB password / use managed credentials
- [ ] Never expose `DATABASE_URL_ADMIN` or a service-role key to the client
- [ ] Automated daily backups + tested restore
- [ ] `npm run build` passes; `npm test` passes; `scripts/e2e_api_test.sh` passes against staging
- [ ] Rate limiting at the proxy (login/signup endpoints especially)
- [ ] Log aggregation for `[api] unhandled error` entries

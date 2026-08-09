#!/usr/bin/env bash
# Deploy the Daitec schema to a Supabase project.
#
# Required env:
#   SUPABASE_DB_URL   direct/session connection string (postgres role), e.g.
#                     postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
#   APP_DB_PASSWORD   strong password to set for the sahla_app application role
#
# Idempotent: migrations are tracked in schema_migrations.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

echo "== bootstrap application role"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q \
  -v app_password="'$APP_DB_PASSWORD'" -f scripts/prod_bootstrap.sql

echo "== apply migrations"
DATABASE_URL="$SUPABASE_DB_URL" PSQL=psql ./scripts/migrate.sh

echo "== smoke: auth.uid() compatibility"
psql "$SUPABASE_DB_URL" -tAc "select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true), auth.uid();" | grep -q 00000000-0000-0000-0000-000000000001 \
  && echo "auth.uid() OK" || { echo "auth.uid() incompatible — check Supabase auth schema"; exit 1; }

echo
echo "DONE. Set these on Vercel (project root directory = web):"
echo "  DATABASE_URL_ADMIN = <the SUPABASE_DB_URL you used> (server-only, service role)"
echo "  DATABASE_URL_APP   = same host/port, user sahla_app, password \$APP_DB_PASSWORD"
echo "  AUTH_SECRET        = \$(openssl rand -hex 32)"

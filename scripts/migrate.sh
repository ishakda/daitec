#!/usr/bin/env bash
# Applies pending SQL migrations in order, tracked in schema_migrations.
# Usage: DATABASE_URL=postgres://... ./scripts/migrate.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${PSQL:=psql}"
: "${DATABASE_URL:=postgresql://postgres@/sahla?host=/tmp}"

$PSQL "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now());"

for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  applied=$($PSQL "$DATABASE_URL" -tAq -c "select 1 from public.schema_migrations where name='$name'")
  if [ "$applied" = "1" ]; then
    echo "skip   $name"
  else
    echo "apply  $name"
    $PSQL "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$f"
    $PSQL "$DATABASE_URL" -q -c "insert into public.schema_migrations(name) values ('$name');"
  fi
done
echo "migrations up to date."

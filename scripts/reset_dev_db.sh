#!/usr/bin/env bash
# Rebuild the dev database from migrations + create the dev user/company.
set -euo pipefail
cd "$(dirname "$0")/.."
psql -h /tmp -U postgres -c "DROP DATABASE IF EXISTS sahla WITH (FORCE);" -q
psql -h /tmp -U postgres -c "CREATE DATABASE sahla;" -q
psql -h /tmp -U postgres -d sahla -v ON_ERROR_STOP=1 -q -f scripts/local_bootstrap.sql
./scripts/migrate.sh > /dev/null
echo "db reset."
B=http://localhost:3000/api/v1
rm -f /tmp/seed_cookies.txt
curl -sf -c /tmp/seed_cookies.txt -X POST $B/auth/signup -H 'content-type: application/json' \
  -d '{"email":"karim@demo.dz","password":"password123","fullName":"Karim Benali"}' > /dev/null
curl -sf -b /tmp/seed_cookies.txt -c /tmp/seed_cookies.txt -X POST $B/companies -H 'content-type: application/json' \
  -d '{"name":"Électro Dar","city":"Alger","wilaya":"Alger","nif":"099916000123456","rc":"16/00-1234567"}' > /dev/null
echo "dev user karim@demo.dz / password123 + company ready."

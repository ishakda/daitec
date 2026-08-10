#!/usr/bin/env bash
# Map lifecycle guard runner: ensures Postgres + a dev server + geolocated demo
# data are available, then runs the Playwright map-lifecycle guard. Exits
# non-zero if any map surface can throw a Leaflet lifecycle error.
#
#   scripts/test_maps.sh              # against a running/auto-started dev server
#   BASE_URL=https://... scripts/test_maps.sh   # against an already-running target
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/web"
BASE_URL="${BASE_URL:-http://localhost:3000}"
PGDATA="${PGDATA:-/agent/pgdata}"
STARTED_DEV=0

log() { echo "[test_maps] $*"; }

# 1. Postgres (only when targeting a local dev server we manage)
if [[ "$BASE_URL" == "http://localhost:3000" ]]; then
  if command -v pg_ctl >/dev/null 2>&1; then
    pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || \
      pg_ctl -D "$PGDATA" -l "$PGDATA/pg.log" -o "-p 5432 -k /tmp" start >/dev/null 2>&1 || true
  fi

  # 2. Dev server
  if ! curl -sf -o /dev/null "$BASE_URL/login" 2>/dev/null; then
    log "starting dev server…"
    ( cd "$WEB" && nohup npm run dev -- --port 3000 >/tmp/daitec-dev.log 2>&1 & )
    STARTED_DEV=1
    for i in $(seq 1 60); do
      sleep 2
      curl -sf -o /dev/null "$BASE_URL/login" 2>/dev/null && break
    done
  fi
  curl -sf -o /dev/null "$BASE_URL/login" 2>/dev/null || { log "dev server did not come up"; exit 2; }

  # 3. Seed geolocated demo data (idempotent-ish; non-fatal if already seeded)
  log "seeding geo demo data…"
  ( cd "$ROOT" && node scripts/seed_geo_demo.mjs >/tmp/daitec-seed.log 2>&1 ) || \
    log "seed step reported issues (continuing — data may already exist)"
fi

# 4. Run the guard
log "running map lifecycle guard against $BASE_URL"
set +e
( cd "$WEB" && BASE_URL="$BASE_URL" node e2e/map-lifecycle.mjs )
RC=$?
set -e

if [[ "$STARTED_DEV" == "1" ]]; then
  log "(dev server left running for reuse; kill with: pkill -f 'next dev')"
fi

exit $RC

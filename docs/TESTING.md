# Testing — Daitec

## Quality gates (run on every push / PR via `.github/workflows/ci.yml`)

| Gate | Command | What it protects |
|------|---------|------------------|
| Typecheck | `cd web && npx tsc --noEmit` | Type safety, strict mode |
| Unit | `cd web && npm test` | Money math, weighted-average cost, totals |
| Build | `cd web && npm run build` | Production bundle compiles (all routes) |
| Map lifecycle guard | `cd web && npm run test:maps` | No Leaflet lifecycle crashes on any map surface |

## Map lifecycle guard

Leaflet throws a `_leaflet_pos` / `getSize` / `_mapPane` class of runtime error
whenever a map operation runs against a map that is **unmounting**, **hidden**,
or **zero-size**. These are timing-dependent and easy to reintroduce, so they
are covered by an automated guard rather than left to manual testing.

**What it does** — `web/e2e/map-lifecycle.mjs` drives a real browser
(Playwright/Chromium) through **every** map surface and the exact interactions
that have historically triggered these crashes:

- **Dispatch map** (`/map`): mount, survive a 10s courier-position poll, toggle
  the revenue heatmap and switch periods, pan/zoom with the heat layer active,
  unmount **mid-pan**, and rapid remount ×4.
- **Delivery picker** (`/deliveries?new=1`): drop a pin, address search + select
  (a large re-center jump), and close via **every** path (Escape / Cancel /
  backdrop), reopened repeatedly.
- **Sale → delivery** (`/sales/[id]`): open the same picker from a sale.
- **Customer picker** (`/customers`): asserts the map is **not** mounted while
  its `<details>` is collapsed (the hidden 0×0 init hazard), then expands, drops
  a pin, collapses, re-expands, and drops another pin; also exercises the edit
  path for a geolocated customer.

**Pass/fail** — any uncaught page error, or any console error matching the
Leaflet-lifecycle signature, fails the run with a non-zero exit code and prints
the offending scenario + stack. The guard is proven to fail on regressions
(e.g. mounting a map inside a collapsed `<details>` trips the lazy-mount
invariant), so a green run is meaningful.

### Running locally

```bash
# One-shot: ensures Postgres + dev server + geolocated demo data, then runs the guard
scripts/test_maps.sh

# Against an already-running server (e.g. a preview deploy)
BASE_URL=https://your-preview.example node web/e2e/map-lifecycle.mjs
```

### The map safety model it enforces

All map surfaces funnel through `web/src/components/MapKit.tsx`:

- **`BaseMap`** disables zoom/fade/marker animations and mounts an
  **`AutoResize`** helper (`ResizeObserver` → `invalidateSize`) so a map that
  mounts hidden or 0×0 self-heals when shown.
- **`safeView`** guards every programmatic `setView`/`fitBounds`: it checks the
  map is alive and DOM-attached, cancels in-flight animations, and swallows
  teardown races.
- **`FitBounds`** fits once per mount (never re-yanks the viewport on polls).
- **`HeatLayer`** is created once and updated in place, and cancels its pending
  `requestAnimationFrame` before removal.
- Pickers inside collapsible sections are **lazy-mounted** — the map is only
  rendered while the section is open, so Leaflet never initializes hidden.

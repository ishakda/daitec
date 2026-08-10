/**
 * Map lifecycle guard — fails the build if ANY map surface can throw a Leaflet
 * lifecycle error (the "_leaflet_pos" / getSize / _mapPane class of crash that
 * happens when Leaflet operations run against an unmounting, hidden, or
 * zero-size map).
 *
 * Strategy: drive every map surface through the exact interactions that have
 * historically triggered these crashes — mount, pan, zoom, layer toggles,
 * poll cycles, address search, pin drops, collapse/expand, modal close via
 * every path, and unmount MID-interaction (the unmount race). Any uncaught
 * page error, or any console error matching the Leaflet-lifecycle signature,
 * fails the run with a non-zero exit code.
 *
 * Usage:  BASE_URL=http://localhost:3000 node e2e/map-lifecycle.mjs
 * Env:    E2E_EMAIL / E2E_PASSWORD (default demo account)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL || "demo@sahla.dz";
const PASSWORD = process.env.E2E_PASSWORD || "demo12345";

// Signatures of Leaflet lifecycle crashes we must never allow to reach a user.
const LIFECYCLE_RE =
  /_leaflet_pos|_leaflet_id|_mapPane|getSize|leaflet|containerPointToLayerPoint|latLngToLayerPoint|Cannot read properties of (?:undefined|null)/i;

const failures = [];
let currentScenario = "startup";

function record(kind, text, stack) {
  failures.push({ scenario: currentScenario, kind, text, stack });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 850 } });
const page = await ctx.newPage();

// Any uncaught exception anywhere is a hard failure.
page.on("pageerror", (e) => record("pageerror", e.message, String(e.stack || "").split("\n").slice(0, 8).join("\n")));
// Console errors only fail when they match the Leaflet lifecycle signature
// (avoids flaking on unrelated warnings / network noise).
page.on("console", (m) => {
  if (m.type() === "error" && LIFECYCLE_RE.test(m.text())) record("console", m.text());
});

const log = (...a) => console.log("[map-guard]", ...a);
const sleep = (ms) => page.waitForTimeout(ms);

async function scenario(name, fn) {
  currentScenario = name;
  const before = failures.length;
  log("▶", name);
  try {
    await fn();
  } catch (err) {
    record("harness", `scenario threw: ${err.message}`);
  }
  await sleep(300); // let any deferred rAF/timeouts fire so late crashes are caught
  const added = failures.length - before;
  log(added === 0 ? "  ✓ clean" : `  ✗ ${added} error(s)`);
}

async function panAndZoom() {
  const mapEl = page.locator(".leaflet-container").first();
  const box = await mapEl.boundingBox();
  if (!box) return;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 130, cy - 80, { steps: 8 });
  await page.mouse.up();
  await sleep(200);
  for (const sel of [".leaflet-control-zoom-in", ".leaflet-control-zoom-in", ".leaflet-control-zoom-out"]) {
    const c = page.locator(sel);
    if (await c.count()) { await c.first().click().catch(() => {}); await sleep(200); }
  }
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -240); await sleep(150);
  await page.mouse.wheel(0, 240); await sleep(150);
}

async function login() {
  await page.goto(BASE + "/login");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 20000 });
}

await scenario("login", login);

// ── A. Dispatch map (/map): poll, heat toggle+periods, pan/zoom, unmount races ──
await scenario("dispatch: mount + courier poll cycle", async () => {
  await page.goto(BASE + "/map");
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await sleep(11000); // survive at least one 10s courier-position poll
});

await scenario("dispatch: revenue heat toggle + periods", async () => {
  const heat = page.getByText(/Carte de chaleur|Revenue heatmap|خريطة حرارية/i).first();
  if (await heat.count()) {
    await heat.click();
    await sleep(1500);
    const period = page.locator("select").filter({ has: page.locator('option[value="365"]') });
    if (await period.count()) {
      for (const v of ["30", "180", "365", "90"]) { await period.selectOption(v).catch(() => {}); await sleep(1200); }
    }
    // toggle off/on repeatedly (create/destroy heat layer)
    for (let i = 0; i < 3; i++) { await heat.click(); await sleep(400); await heat.click(); await sleep(700); }
  }
});

await scenario("dispatch: pan + zoom with heat active", panAndZoom);

await scenario("dispatch: unmount mid-pan (unmount race)", async () => {
  const mapEl = page.locator(".leaflet-container").first();
  const box = await mapEl.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 120, { steps: 4 });
    await page.mouse.up();
  }
  await page.goto(BASE + "/dashboard"); // leave immediately after moveend fires
  await sleep(600);
});

await scenario("dispatch: rapid remount x4", async () => {
  for (let i = 0; i < 4; i++) {
    await page.goto(BASE + "/map");
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await sleep(250 + i * 150);
    await page.goto(BASE + "/dashboard");
    await sleep(200);
  }
});

// ── B. Delivery modal LocationPicker (/deliveries?new=1) ──
await scenario("delivery picker: pin + search + close-every-way", async () => {
  const closers = ["escape", "cancel", "backdrop"];
  for (let i = 0; i < 3; i++) {
    await page.goto(BASE + "/deliveries?new=1");
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await sleep(500);
    const map = page.locator(".leaflet-container").first();
    await map.click({ position: { x: 170, y: 100 } }).catch(() => {}); // drop pin -> Recenter
    await sleep(300);
    const search = page.getByPlaceholder(/adresse|address|عنوان/i).first();
    if (await search.count()) {
      await search.fill("Oran");
      await sleep(1300); // debounce + nominatim
      const hit = page.locator("button", { hasText: /Oran|Alg/i }).first();
      if (await hit.count()) { await hit.click().catch(() => {}); await sleep(700); } // big Recenter jump
    }
    const how = closers[i % closers.length];
    if (how === "escape") await page.keyboard.press("Escape");
    else if (how === "cancel") {
      const c = page.locator("button", { hasText: /Annuler|Cancel|إلغاء/i }).first();
      if (await c.count()) await c.click(); else await page.keyboard.press("Escape");
    } else { await page.mouse.click(6, 6); }
    await sleep(400);
  }
});

// ── C. Sale → delivery modal (/sales/[id]) ──
await scenario("sale→delivery picker", async () => {
  const saleId = await page.evaluate(async () => {
    const r = await fetch("/api/v1/sales?limit=1", { credentials: "include" });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data?.[0]?.id ?? null;
  });
  if (!saleId) { log("  (no sales to test — skipped)"); return; }
  await page.goto(BASE + `/sales/${saleId}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const newBtn = page.locator("button", { hasText: /livraison|delivery|توصيل/i }).first();
  if (await newBtn.count()) {
    await newBtn.click().catch(() => {});
    const picker = page.locator(".leaflet-container").first();
    if (await picker.count().then((n) => n > 0).catch(() => false)) {
      await page.waitForSelector(".leaflet-container", { timeout: 8000 }).catch(() => {});
      await picker.click({ position: { x: 150, y: 90 } }).catch(() => {});
      await sleep(300);
    }
    await page.keyboard.press("Escape");
    await sleep(400);
  } else {
    log("  (no create-delivery action on this sale — skipped)");
  }
});

// ── D. Customer picker: lazy-mount invariant + collapse/expand + edit path ──
await scenario("customer picker: lazy-mount invariant (must be 0 before expand)", async () => {
  await page.goto(BASE + "/customers?new=1");
  await page.waitForSelector("summary", { timeout: 20000 });
  await sleep(500);
  const mounted = await page.locator(".leaflet-container").count();
  if (mounted !== 0) {
    record("invariant", `map mounted (${mounted}) inside a collapsed <details> — hidden 0×0 init hazard`);
  }
});

await scenario("customer picker: expand → pin → collapse → re-expand → pin", async () => {
  const summary = page.getByText(/Position|الموقع/i).first();
  if (!(await summary.count())) return;
  await summary.click();
  await page.waitForSelector(".leaflet-container", { timeout: 10000 });
  await sleep(600);
  const map = page.locator(".leaflet-container").first();
  await map.click({ position: { x: 170, y: 100 } }).catch(() => {});
  await sleep(400);
  await summary.click(); await sleep(300);   // collapse (unmount map)
  await summary.click(); await sleep(600);   // re-expand (remount map)
  await page.locator(".leaflet-container").first().click({ position: { x: 240, y: 130 } }).catch(() => {});
  await sleep(300);
  await page.keyboard.press("Escape");
  await sleep(400);
});

await scenario("customer picker: edit existing geolocated customer (auto-open)", async () => {
  const cust = await page.evaluate(async () => {
    const r = await fetch("/api/v1/map?withDebt=false", { credentials: "include" });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.customers || []).find((c) => c.latitude != null && c.longitude != null) || null;
  });
  if (!cust) { log("  (no geolocated customer — skipped)"); return; }
  await page.goto(BASE + `/customers?edit=${cust.id}`);
  await sleep(1200);
  // If the edit query param isn't wired, open via the row; either way just
  // ensure any auto-opened map behaves. Look for a leaflet container.
  const hasMap = await page.locator(".leaflet-container").count();
  if (hasMap) {
    await panAndZoom();
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(400);
  } else {
    log("  (edit deep-link not available — non-fatal)");
  }
});

// ── Report ──
log("──────────────────────────────────────────");
if (failures.length === 0) {
  log("PASS — no Leaflet lifecycle errors across all map surfaces");
  await browser.close();
  process.exit(0);
} else {
  log(`FAIL — ${failures.length} error(s):`);
  for (const f of failures) {
    console.error(`\n  ✗ [${f.scenario}] (${f.kind}) ${f.text}`);
    if (f.stack) console.error(f.stack.split("\n").map((l) => "      " + l).join("\n"));
  }
  await browser.close();
  process.exit(1);
}

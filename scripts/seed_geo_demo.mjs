/**
 * Geo/delivery demo seed for Daitec Demo Store:
 * store + customer coordinates around Algiers, a livreur account,
 * deliveries in several statuses, courier position pings.
 * Run with the dev server up. Idempotent-ish (skips existing livreur).
 */
const BASE = "http://localhost:3000/api/v1";
let cookie = "";

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", cookie, ...opts.headers },
    body: opts.json ? JSON.stringify(opts.json) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    const jar = new Map(cookie.split("; ").filter(Boolean).map((c) => c.split("=")));
    for (const c of setCookie) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar.set(k, v); }
    cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

let seedState = 7;
const rnd = () => (seedState = (seedState * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

console.log("== login owner (demo)");
await api("/auth/login", { method: "POST", json: { email: "demo@sahla.dz", password: "demo12345" } });

// Store position: central Algiers
const branches = await api("/branches");
if (branches.data.length) {
  await api(`/branches/${branches.data[0].id}`, {
    method: "PATCH", json: { latitude: 36.7647, longitude: 3.0538 },
  });
  console.log("   store positioned (Alger centre)");
}

// Spread customer coordinates across greater Algiers
const customers = (await api("/customers?limit=100")).data;
const HUBS = [
  [36.7538, 3.0588], [36.7269, 3.0875], [36.7764, 3.0587], [36.7112, 3.1526],
  [36.7397, 2.9663], [36.7031, 3.0397], [36.7616, 3.0217], [36.6910, 3.2160],
];
let placed = 0;
for (const c of customers) {
  const [hlat, hlng] = HUBS[placed % HUBS.length];
  await api(`/customers/${c.id}`, {
    method: "PATCH",
    json: {
      latitude: Math.round((hlat + (rnd() - 0.5) * 0.02) * 1e6) / 1e6,
      longitude: Math.round((hlng + (rnd() - 0.5) * 0.03) * 1e6) / 1e6,
    },
  });
  placed++;
}
console.log(`   ${placed} customers positioned`);

// Livreur account
const roles = await api("/roles");
const livreurRole = roles.data.find((r) => r.name === "Livreur");
const members = await api("/members");
let livreur = members.data.find((m) => m.email === "livreur@sahla.dz");
if (!livreur) {
  await api("/members", {
    method: "POST",
    json: { email: "livreur@sahla.dz", fullName: "Sofiane Livreur", password: "livreur123", roleId: livreurRole.id },
  });
  livreur = (await api("/members")).data.find((m) => m.email === "livreur@sahla.dz");
  console.log("   livreur account created (livreur@sahla.dz / livreur123)");
}

// Deliveries from recent unpaid/partial invoices + a couple of POS sales
const sales = (await api("/sales?limit=40")).data
  .filter((s) => ["invoice", "pos"].includes(s.sale_type));
const targets = sales.slice(0, 8);
const created = [];
for (const s of targets) {
  try {
    const d = await api("/deliveries", {
      method: "POST",
      json: { saleId: s.id, courierId: created.length < 5 ? livreur.user_id : null },
    });
    created.push(d);
  } catch { /* sale may lack customer/address — fine */ }
}
console.log(`   ${created.length} deliveries created`);

// Advance statuses: 1 delivered (COD), 2 out_for_delivery, 1 picked_up
const statusesPlan = [
  ["picked_up", "out_for_delivery", "delivered"],
  ["picked_up", "out_for_delivery"],
  ["out_for_delivery"],
  ["picked_up"],
];
// Livreur session for status updates + pings
let ownerCookie = cookie;
cookie = "";
await api("/auth/login", { method: "POST", json: { email: "livreur@sahla.dz", password: "livreur123" } });

for (let i = 0; i < Math.min(statusesPlan.length, created.length); i++) {
  for (const st of statusesPlan[i]) {
    try {
      await api(`/deliveries/${created[i].id}/status`, { method: "POST", json: { status: st } });
    } catch (e) { console.log("   status skip:", String(e).slice(0, 90)); }
  }
}
// Position pings along a route into the city
const route = [
  [36.7031, 3.0397], [36.7145, 3.0450], [36.7269, 3.0512], [36.7398, 3.0549], [36.7521, 3.0570],
];
for (const [lat, lng] of route) {
  await api("/courier/ping", { method: "POST", json: { latitude: lat, longitude: lng, accuracy: 8 } });
}
console.log("   courier pings sent");

cookie = ownerCookie;
const map = await api("/map");
console.log(`MAP: ${map.branches.length} store(s), ${map.customers.length} customers, ${map.deliveries.length} active deliveries`);
const pos = await api("/courier/positions");
console.log(`POSITIONS: ${pos.data.length} courier(s) online — ${pos.data[0]?.courier_name ?? ""}`);
console.log("GEO SEED COMPLETE");

/**
 * Seed a self-contained DEMO company (Daitec Demo Store) with realistic
 * Algerian data: catalog, partners, purchases, 100+ sales, expenses.
 * Runs through the real API (so every business rule applies), then
 * backdates documents over the past 60 days for meaningful charts.
 *
 * Demo login: demo@sahla.dz / demo12345 — data is isolated in its own
 * company (tenant), never mixed with production companies.
 *
 * Usage: node scripts/seed_demo.mjs   (dev server must be running)
 */
import { execSync } from "child_process";

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

// deterministic RNG
let seedState = 42;
const rnd = () => (seedState = (seedState * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

console.log("== demo user + company");
try {
  await api("/auth/signup", { method: "POST", json: { email: "demo@sahla.dz", password: "demo12345", fullName: "Yacine Demo" } });
} catch {
  await api("/auth/login", { method: "POST", json: { email: "demo@sahla.dz", password: "demo12345" } });
}
const me = await api("/me");
let companyId = me.companies.find((c) => c.name === "Daitec Demo Store")?.id;
if (!companyId) {
  ({ companyId } = await api("/companies", {
    method: "POST",
    json: { name: "Daitec Demo Store", activity: "Électroménager & High-Tech", city: "Alger", wilaya: "Alger",
      nif: "099916001111111", rc: "16/00-9999999", ai: "16019999999" },
  }));
} else {
  await api("/me/active-company", { method: "POST", json: { companyId } });
}

const warehouses = (await api("/warehouses")).data;
const WH = warehouses.find((w) => w.is_default)?.id ?? warehouses[0].id;
const methods = (await api("/payment-methods")).data;
const CASH = methods.find((m) => m.code === "cash").id;
const methodIds = methods.filter((m) => m.kind !== "credit").map((m) => m.id);

console.log("== categories & products");
const CATALOG = {
  "Téléphones": [
    ["Samsung Galaxy A15 128Go", 28500, 33500, "6193001000011"],
    ["Samsung Galaxy A25 256Go", 39000, 45500, "6193001000028"],
    ["Redmi Note 13 128Go", 26000, 30500, "6193001000035"],
    ["Redmi 13C 256Go", 21500, 25500, "6193001000042"],
    ["iPhone 13 128Go", 118000, 132000, "6193001000059"],
    ["Oppo A38 128Go", 23500, 27500, "6193001000066"],
    ["Coque silicone universelle", 250, 600, "6193001000073"],
    ["Protecteur écran verre trempé", 180, 500, "6193001000080"],
  ],
  "Électroménager": [
    ["Réfrigérateur Condor 400L", 68000, 79500, "6193002000010"],
    ["Machine à laver LG 8kg", 62000, 74000, "6193002000027"],
    ["Climatiseur Condor 12000 BTU", 54000, 65000, "6193002000034"],
    ["Cuisinière ENIEM 4 feux", 38000, 46500, "6193002000041"],
    ["Micro-ondes Brandt 25L", 14500, 18500, "6193002000058"],
    ["Chauffe-eau naftal 10L", 9800, 12900, "6193002000065"],
  ],
  "Informatique": [
    ["PC Portable HP 15 i5/8Go/512", 92000, 105000, "6193003000019"],
    ["PC Portable Lenovo i3/8Go/256", 68000, 78500, "6193003000026"],
    ["Imprimante Epson EcoTank", 32500, 39900, "6193003000033"],
    ["Clavier + souris sans fil", 2200, 3800, "6193003000040"],
    ["Disque SSD 512Go", 5400, 7900, "6193003000057"],
    ["Câble HDMI 2m", 350, 900, "6193003000064"],
  ],
  "TV & Audio": [
    ["TV Condor 43'' Smart", 42000, 52000, "6193004000018"],
    ["TV IRIS 55'' 4K", 68000, 82000, "6193004000025"],
    ["Barre de son Samsung", 18500, 24500, "6193004000032"],
    ["Écouteurs Bluetooth", 1400, 2900, "6193004000049"],
    ["Récepteur satellite HD", 3800, 5900, "6193004000056"],
  ],
  "Petit électro": [
    ["Mixeur Moulinex 700W", 5200, 7500, "6193005000017"],
    ["Cafetière expresso", 11500, 15900, "6193005000024"],
    ["Fer à repasser vapeur", 2900, 4500, "6193005000031"],
    ["Sèche-cheveux 2200W", 2100, 3600, "6193005000048"],
    ["Bouilloire électrique 1.7L", 1800, 3200, "6193005000055"],
    ["Friteuse sans huile 5L", 12500, 16900, "6193005000062"],
  ],
};

const products = [];
for (const [catName, items] of Object.entries(CATALOG)) {
  const cat = await api("/categories", { method: "POST", json: { name: catName } }).catch(() => null);
  for (const [name, cost, price, barcode] of items) {
    const p = await api("/products", {
      method: "POST",
      json: {
        name, categoryId: cat?.id, sellingPrice: price, purchasePrice: cost, taxRate: 19,
        minimumStock: between(3, 10), barcodes: [barcode],
      },
    });
    products.push({ id: p.id, name, cost, price });
  }
}
console.log(`   ${products.length} products`);

console.log("== suppliers + purchase receipts (stock in)");
const SUPPLIERS = [
  "SARL Import Electro Alger", "EURL TechDis Oran", "SARL Condor Distribution",
  "ETS Benhamou Électroménager", "SARL SmartPhone DZ", "EURL InfoPlus Constantine",
  "SARL MegaSon Audio", "ETS Khelifi & Fils", "SARL Maghreb Digital", "EURL ElectroSud Ouargla",
];
const supplierIds = [];
for (let i = 0; i < SUPPLIERS.length; i++) {
  const s = await api("/suppliers", {
    method: "POST",
    json: { name: SUPPLIERS[i], city: pick(["Alger", "Oran", "Constantine", "Sétif", "Ouargla"]),
      nif: `0999161112223${String(i).padStart(2, "0")}`, creditLimit: 2000000 },
  });
  supplierIds.push(s.id);
}
let receipts = 0;
for (let batch = 0; batch < 50; batch++) {
  const supplierId = pick(supplierIds);
  const nItems = between(1, 4);
  const items = Array.from({ length: nItems }, () => {
    const p = pick(products);
    return { productId: p.id, quantity: between(5, 30), unitCost: p.cost };
  });
  await api("/purchases/receipts", {
    method: "POST",
    json: { supplierId, warehouseId: WH, items, createSupplierInvoice: true,
      dueDate: new Date(Date.now() + between(10, 45) * 864e5).toISOString().slice(0, 10) },
  });
  receipts++;
}
console.log(`   ${receipts} goods receipts`);

console.log("== customers");
const FIRST = ["Mohamed", "Amine", "Yacine", "Karim", "Sofiane", "Nassim", "Farid", "Walid", "Samir", "Lotfi"];
const LAST = ["Benali", "Haddad", "Bouzid", "Cherif", "Mansouri", "Ziani", "Belkacem", "Hamidi", "Saadi", "Meziane"];
const customerIds = [];
for (let i = 0; i < 20; i++) {
  const isCompany = i < 6;
  const c = await api("/customers", {
    method: "POST",
    json: {
      name: isCompany ? `SARL ${pick(LAST)} Commerce` : `${pick(FIRST)} ${pick(LAST)}`,
      phone: `05${between(50, 99)}${String(between(100000, 999999))}`,
      city: pick(["Alger", "Oran", "Blida", "Tizi Ouzou", "Sétif", "Constantine"]),
      creditLimit: isCompany ? 1500000 : 200000,
    },
  });
  customerIds.push(c.id);
}
console.log(`   ${customerIds.length} customers`);

console.log("== register session + 110 sales");
const reg = await api("/registers", { method: "POST", json: { openingCash: 20000 } })
  .catch(async () => ({ sessionId: (await api("/registers")).current.id }));
let sales = 0, credit = 0;
for (let i = 0; i < 110; i++) {
  const nItems = between(1, 4);
  const items = [];
  for (let k = 0; k < nItems; k++) {
    const p = pick(products);
    items.push({ productId: p.id, quantity: between(1, 3), unitPrice: p.price, taxRate: 19,
      discountPct: rnd() < 0.15 ? pick([5, 10]) : 0 });
  }
  const isCredit = rnd() < 0.22;
  const total = items.reduce((s, it) =>
    s + it.quantity * it.unitPrice * (1 - it.discountPct / 100) * 1.19, 0);
  try {
    if (isCredit) {
      await api("/sales", {
        method: "POST",
        json: {
          saleType: "invoice", customerId: pick(customerIds), warehouseId: WH,
          dueDate: new Date(Date.now() + between(5, 40) * 864e5).toISOString().slice(0, 10),
          items,
          payments: rnd() < 0.6 ? [{ paymentMethodId: CASH, amount: Math.round(total * pick([0.3, 0.5, 0.7]) * 100) / 100 }] : [],
        },
      });
      credit++;
    } else {
      await api("/sales", {
        method: "POST",
        json: {
          saleType: "pos", customerId: rnd() < 0.3 ? pick(customerIds) : null,
          warehouseId: WH, registerSessionId: reg.sessionId, items,
          payments: [{ paymentMethodId: rnd() < 0.8 ? CASH : pick(methodIds), amount: Math.round(total * 100) / 100 }],
        },
      });
    }
    sales++;
  } catch (e) {
    // business rules firing on random data is expected — skip those sales
    if (!/INSUFFICIENT_STOCK|CREDIT_LIMIT_EXCEEDED/.test(String(e))) throw e;
  }
}
console.log(`   ${sales} sales (${credit} on credit)`);

console.log("== expenses");
const cats = (await api("/expense-categories")).data;
const EXP = [["Loyer", 45000], ["Électricité", 6500], ["Internet", 2800], ["Transport", 4000],
  ["Salaires", 120000], ["Fournitures", 3500], ["Marketing", 8000]];
for (const [catName, amount] of EXP) {
  const cat = cats.find((c) => c.name === catName);
  await api("/expenses", {
    method: "POST",
    json: { description: `${catName} — mois courant`, amount, categoryId: cat?.id ?? null, paymentMethodId: CASH },
  });
}
console.log(`   ${EXP.length} expenses`);

console.log("== backdating documents over the past 60 days (demo realism)");
const SQL = `
with docs as (
  select id, row_number() over (order by created_at) as rn, count(*) over () as n
  from sales where company_id = '${companyId}'
)
update sales s set
  created_at = now() - ((d.n - d.rn) * interval '13 hours'),
  sale_date = (now() - ((d.n - d.rn) * interval '13 hours'))::date,
  updated_at = now()
from docs d where s.id = d.id;
update expenses set expense_date = (now() - (random() * interval '28 days'))::date
  where company_id = '${companyId}';
`;
execSync(`psql -h /tmp -U postgres -d sahla -v ON_ERROR_STOP=1 -q`, { input: SQL });

console.log("\nDEMO SEED COMPLETE — login: demo@sahla.dz / demo12345");

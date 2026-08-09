// Visual verification: log in and capture key screens.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const shots = process.argv.slice(2);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// login
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', "karim@demo.dz");
await page.fill('input[type="password"]', "password123");
await page.click('button[type="submit"]');
await page.waitForURL("**/dashboard", { timeout: 15000 });

const targets = shots.length
  ? shots
  : ["dashboard", "products", "pos", "sales", "customers", "reports", "settings", "inventory"];

for (const t of targets) {
  const [path, ...opts] = t.split(":");
  await page.goto(`${BASE}/${path}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  if (opts.includes("rtl")) { /* handled by locale cookie below */ }
  await page.screenshot({ path: `/tmp/shot-${path.replaceAll("/", "_")}.png` });
  console.log(`shot-${path.replaceAll("/", "_")}.png`);
}

await browser.close();

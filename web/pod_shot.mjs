import { chromium } from "playwright";
import fs from "fs";

// generate a small test "package photo" (JPEG) via canvas in the page later; here make a simple file
const browser = await chromium.launch();

// --- livreur drives POD modal
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const m = await mctx.newPage();
await m.goto("http://localhost:3000/login");
await m.fill('input[type="email"]', "livreur@sahla.dz");
await m.fill('input[type="password"]', "livreur123");
await m.click('button[type="submit"]');
await m.waitForTimeout(1500);
await m.goto("http://localhost:3000/courier");
await m.waitForLoadState("networkidle");
await m.waitForTimeout(800);

// open POD modal on the first delivery that has a "Livrée ✓" button
const btn = m.getByRole("button", { name: /Livrée ✓/ }).first();
if (await btn.count()) {
  await btn.click();
  await m.waitForTimeout(500);
  // attach a generated photo
  const jpeg = await m.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800; c.height = 500;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#d9c9a3"; ctx.fillRect(0, 0, 800, 500);
    ctx.fillStyle = "#8a6f3c"; ctx.fillRect(180, 120, 440, 280);
    ctx.strokeStyle = "#5c4a26"; ctx.lineWidth = 8;
    ctx.strokeRect(180, 120, 440, 280);
    ctx.beginPath(); ctx.moveTo(400, 120); ctx.lineTo(400, 400); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "bold 34px sans-serif";
    ctx.fillText("COLIS DAITEC", 300, 90);
    return c.toDataURL("image/jpeg", 0.8);
  });
  const buf = Buffer.from(jpeg.split(",")[1], "base64");
  fs.writeFileSync("/tmp/package.jpg", buf);
  await m.setInputFiles('input[type="file"]', "/tmp/package.jpg");
  await m.waitForTimeout(600);
  // draw a signature on the canvas
  const canvas = m.locator("canvas");
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await m.mouse.move(cx - 90, cy);
  await m.mouse.down();
  for (let i = 0; i <= 30; i++) {
    const x = cx - 90 + i * 6;
    const y = cy + Math.sin(i / 3) * 26 * (1 - i / 40);
    await m.mouse.move(x, y);
  }
  await m.mouse.up();
  await m.waitForTimeout(300);
  await m.screenshot({ path: "/tmp/pod-capture.png", fullPage: false });
  // confirm
  await m.getByRole("button", { name: /Confirmer la livraison/ }).click();
  await m.waitForTimeout(1500);
  console.log("POD submitted via UI");
} else {
  console.log("no delivered-able card found");
}
await mctx.close();

// --- dispatcher views the proof
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/login");
await p.fill('input[type="email"]', "demo@sahla.dz");
await p.fill('input[type="password"]', "demo12345");
await p.click('button[type="submit"]');
await p.waitForURL("**/dashboard");
await p.goto("http://localhost:3000/deliveries?");
await p.waitForLoadState("networkidle");
// show delivered ones
await p.locator("select").first().selectOption("delivered");
await p.waitForTimeout(900);
const cam = p.locator('button[title*="preuve"], button[title*="proof"], button[title*="Voir"]').first();
if (await cam.count()) {
  await cam.click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: "/tmp/pod-view.png" });
  console.log("proof viewer shot");
} else {
  console.log("no camera button visible");
}
await browser.close();

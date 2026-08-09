// Generates icon.png/icon.ico before packaging (CI-friendly, no binary in git).
const { execSync } = require("child_process");
try { require.resolve("png-to-ico"); } catch { execSync("npm i --no-save png-to-ico pngjs", { stdio: "inherit" }); }
const { PNG } = require("pngjs");
const fs = require("fs");
const size = 512, png = new PNG({ width: size, height: size });
const navy = [20, 38, 63], teal = [24, 177, 158];
function inRounded(x, y, r) {
  const pad = 8, right = size - pad, bottom = size - pad;
  if (x < pad || y < pad || x >= right || y >= bottom) return false;
  const cs = [[pad + r, pad + r], [right - r, pad + r], [pad + r, bottom - r], [right - r, bottom - r]];
  if ((x < pad + r || x >= right - r) && (y < pad + r || y >= bottom - r)) {
    return cs.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
  }
  return true;
}
// simple bold "D" using rectangles+arc
function inD(x, y) {
  const cx = 200, top = 120, bot = 392, w = 58;
  if (x >= cx - 60 && x < cx - 60 + w && y >= top && y < bot) return true; // stem
  const midY = (top + bot) / 2, R = (bot - top) / 2;
  const dx = x - (cx - 10), dy = y - midY;
  const d = Math.sqrt(dx * dx + dy * dy);
  return dx >= 0 && d <= R && d >= R - w;
}
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = (size * y + x) << 2;
  if (inRounded(x, y, 110)) {
    const c = inD(x, y) ? teal : navy;
    png.data[i] = c[0]; png.data[i+1] = c[1]; png.data[i+2] = c[2]; png.data[i+3] = 255;
  } else png.data[i+3] = 0;
}
fs.writeFileSync("icon.png", PNG.sync.write(png));
require("png-to-ico")("icon.png").then((buf) => { fs.writeFileSync("icon.ico", buf); console.log("icons generated"); });

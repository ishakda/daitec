/**
 * Daitec desktop shell — wraps the Daitec web application.
 *
 * Modes:
 *  - Normal: full app window pointed at the configured server URL.
 *  - Kiosk (caisse): fullscreen, frameless, always-on-top POS-only shell
 *    that boots straight into /pos. Exiting kiosk requires the PIN
 *    (Ctrl+Alt+Q). The PIN is stored as a SHA-256 hash.
 *
 * Ctrl+Shift+S opens the settings screen (PIN-gated while in kiosk).
 */
const { app, BrowserWindow, ipcMain, globalShortcut, session } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const configPath = () => path.join(app.getPath("userData"), "config.json");
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { return {}; }
}
function writeConfig(patch) {
  writeFileAtomic(configPath(), JSON.stringify({ ...readConfig(), ...patch }, null, 2));
}
function writeFileAtomic(p, data) {
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, p);
}

let win = null;

function applyKioskChrome(kiosk) {
  if (!win) return;
  win.setKiosk(kiosk);
  win.setAlwaysOnTop(kiosk, "screen-saver");
  win.setClosable(!kiosk);
  win.setMinimizable(!kiosk);
  win.setFullScreenable(true);
}

function loadApp() {
  const cfg = readConfig();
  if (!cfg.serverUrl) { win.loadFile("setup.html"); applyKioskChrome(false); return; }
  const kiosk = !!cfg.kioskMode;
  applyKioskChrome(kiosk);
  win.loadURL(kiosk ? new URL("/pos", cfg.serverUrl).toString() : cfg.serverUrl);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#f7f8fa",
    title: "Daitec",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Full page loads may only target the configured server (or local shell pages).
  win.webContents.on("will-navigate", (e, url) => {
    const cfg = readConfig();
    const okOrigin = cfg.serverUrl && url.startsWith(new URL(cfg.serverUrl).origin);
    if (!okOrigin && !url.startsWith("file:")) e.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const cfg = readConfig();
    if (cfg.serverUrl && url.startsWith(new URL(cfg.serverUrl).origin)) {
      return { action: "allow" }; // receipt/print popups stay in-app
    }
    if (!readConfig().kioskMode) require("electron").shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => { win = null; });
  loadApp();
}

/* ------------------------- IPC ------------------------- */
ipcMain.handle("daitec:getConfig", () => {
  const c = readConfig();
  return { serverUrl: c.serverUrl ?? "", kioskMode: !!c.kioskMode, hasPin: !!c.kioskPinHash };
});

ipcMain.handle("daitec:save", (_e, payload) => {
  try {
    const u = new URL(payload.serverUrl);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad protocol");
    const patch = { serverUrl: u.origin, kioskMode: !!payload.kioskMode };
    if (payload.kioskMode) {
      const existing = readConfig().kioskPinHash;
      if (payload.pin) {
        if (!/^\d{4,8}$/.test(payload.pin)) {
          return { ok: false, error: "PIN invalide : 4 à 8 chiffres." };
        }
        patch.kioskPinHash = sha256(payload.pin);
      } else if (!existing) {
        return { ok: false, error: "Un PIN (4 à 8 chiffres) est requis pour le mode kiosque." };
      }
    }
    writeConfig(patch);
    loadApp();
    return { ok: true };
  } catch {
    return { ok: false, error: "URL invalide. Exemple : https://daitec.vercel.app" };
  }
});

ipcMain.handle("daitec:exitKiosk", (_e, pin) => {
  const cfg = readConfig();
  if (!cfg.kioskPinHash || sha256(pin) !== cfg.kioskPinHash) {
    return { ok: false, error: "PIN incorrect." };
  }
  writeConfig({ kioskMode: false });
  win?.loadFile("setup.html");
  applyKioskChrome(false);
  return { ok: true };
});

/* ------------------------ lifecycle ------------------------ */
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(["media", "geolocation", "clipboard-read", "notifications"].includes(permission));
  });
  createWindow();

  // Settings (normal mode) / PIN-gated exit (kiosk mode)
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    if (readConfig().kioskMode) win?.loadFile("pin.html");
    else win?.loadFile("setup.html");
  });
  // Dedicated kiosk exit shortcut
  globalShortcut.register("CommandOrControl+Alt+Q", () => {
    if (readConfig().kioskMode) win?.loadFile("pin.html");
  });

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

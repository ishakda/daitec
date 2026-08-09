/**
 * Daitec desktop shell — wraps the Daitec web application.
 * On first launch it asks for the server URL (your Vercel deployment
 * or a local/LAN server), stores it, then always opens the app there.
 * Ctrl+Shift+S re-opens the server settings.
 */
const { app, BrowserWindow, ipcMain, globalShortcut, session } = require("electron");
const fs = require("fs");
const path = require("path");

const configPath = () => path.join(app.getPath("userData"), "config.json");

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
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

  const { serverUrl } = readConfig();
  if (serverUrl) {
    win.loadURL(serverUrl);
  } else {
    win.loadFile("setup.html");
  }

  // External links (navigation help, OSM attribution…) → default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    const cfg = readConfig();
    if (cfg.serverUrl && url.startsWith(new URL(cfg.serverUrl).origin)) {
      return { action: "allow" }; // receipts/print windows stay in-app
    }
    require("electron").shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => { win = null; });
}

ipcMain.handle("daitec:getServerUrl", () => readConfig().serverUrl ?? "");
ipcMain.handle("daitec:setServerUrl", (_e, url) => {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad protocol");
    writeConfig({ ...readConfig(), serverUrl: u.origin });
    win?.loadURL(u.origin);
    return { ok: true };
  } catch {
    return { ok: false, error: "URL invalide. Exemple: https://daitec.vercel.app" };
  }
});

app.whenReady().then(() => {
  // Geolocation for the courier page works out of the box; camera/mic prompts allowed for QR scan.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(["media", "geolocation", "clipboard-read", "notifications"].includes(permission));
  });
  createWindow();
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    win?.loadFile("setup.html");
  });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

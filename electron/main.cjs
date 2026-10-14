// Electron shell for canvast: opens the single-file build from disk. No network, no preload, no Node in the page.
const { app, BrowserWindow, Menu, session } = require("electron");
const { join } = require("node:path");

// The packaged app carries dist/canvast.html; in development the repo's dist/ is used.
const page = join(__dirname, "..", "dist", "canvast.html");

function open() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // CANVAST_DEBUG=1: the #debug panel and hook (as in the tests), plus DevTools.
  const debug = process.env.CANVAST_DEBUG === "1";
  win.loadFile(page, debug ? { hash: "debug" } : undefined);
  if (debug) win.webContents.openDevTools({ mode: "detach" });
  // Offline-first: the page never navigates away or opens windows.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // No menu, so no menu shortcut: F12 and Ctrl+Shift+I toggle DevTools.
  win.webContents.on("before-input-event", (e, i) => {
    if (i.type === "keyDown" && (i.key === "F12" || (i.control && i.shift && i.key.toLowerCase() === "i"))) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, done) => done(false));
  // Same rule the tests enforce in the browser: nothing but file:, data: and blob: is requested.
  session.defaultSession.webRequest.onBeforeRequest((d, done) => done({ cancel: !/^(file|data|blob|devtools):/.test(d.url) }));
  open();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && open());
});

app.on("window-all-closed", () => app.quit());

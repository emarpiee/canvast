/**
 * The desktop build's main process (ADR 0177): one window running the same single-file app, on a workspace folder.
 *
 * The page is served from `app://canvast/` (not file://) and is sandboxed: no Node, context isolation, no navigation, no
 * new windows, no network (the page's CSP already refuses it). Each workspace folder gets its own storage partition, so
 * two workspaces never share boards or a library. The folder is the one passed with `--workspace=<path>`, else the last
 * one opened, else the one picked in a folder dialog.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCHEME = "app";
const ORIGIN = `${SCHEME}://canvast`;
/** The built app: `CANVAST_HTML` (the tests point it at their snapshot), else the copy beside this file. */
const HTML = process.env["CANVAST_HTML"] ?? join(__dirname, "canvast.html");
const RECENT_MAX = 10;

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

interface Recent {
  workspaces: Array<{ path: string; openedAt: number }>;
}

const recentFile = (): string => join(app.getPath("userData"), "workspaces.json");

function readRecent(): Recent {
  try {
    const r = JSON.parse(readFileSync(recentFile(), "utf8")) as Recent;
    return Array.isArray(r.workspaces) ? r : { workspaces: [] };
  } catch {
    return { workspaces: [] };
  }
}

function remember(path: string): void {
  const rest = readRecent().workspaces.filter((w) => w.path !== path);
  const next: Recent = { workspaces: [{ path, openedAt: Date.now() }, ...rest].slice(0, RECENT_MAX) };
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(recentFile(), JSON.stringify(next, null, 2));
}

const isFolder = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

async function pickFolder(): Promise<string | null> {
  const r = await dialog.showOpenDialog({ title: "Open a workspace folder", buttonLabel: "Open workspace", properties: ["openDirectory", "createDirectory"] });
  return r.canceled || !r.filePaths[0] ? null : resolve(r.filePaths[0]);
}

/** The workspace folder to open, or null when none was chosen. */
async function chooseWorkspace(): Promise<string | null> {
  const arg = process.argv.find((a) => a.startsWith("--workspace="))?.slice("--workspace=".length);
  if (arg) {
    const p = resolve(arg);
    mkdirSync(p, { recursive: true });
    return p;
  }
  const last = readRecent().workspaces.find((w) => isFolder(w.path));
  return last ? last.path : pickFolder();
}

/** Open another folder: the app starts again on it (one workspace per window, each with its own storage). */
async function openOther(): Promise<void> {
  const p = await pickFolder();
  if (!p) return;
  remember(p);
  app.relaunch({ args: process.argv.slice(1).filter((a) => !a.startsWith("--workspace=")).concat(`--workspace=${p}`) });
  app.exit(0);
}

function partitionOf(workspace: string): string {
  return `persist:ws-${createHash("sha256").update(workspace).digest("hex").slice(0, 24)}`;
}

async function openWindow(workspace: string): Promise<void> {
  const partition = partitionOf(workspace);
  const ses = session.fromPartition(partition);
  // Only the app itself is served; any other path of the scheme is not found.
  ses.protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url);
    if (url.host !== "canvast" || (url.pathname !== "/" && url.pathname !== "/canvast.html")) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(HTML).toString());
  });
  // What the page may ask for: the clipboard (copy and paste) and to keep its storage. Nothing else.
  const allowed = new Set(["clipboard-read", "clipboard-sanitized-write", "persistent-storage"]);
  ses.setPermissionRequestHandler((_wc, permission, done) => done(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  ses.webRequest.onBeforeRequest((details, done) => {
    const ok = /^(app|data|blob|devtools|chrome-extension):/.test(details.url);
    done({ cancel: !ok });
  });

  const hidden = process.env["CANVAST_HIDDEN"] === "1"; // (tests: no window on the screen)
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: !hidden,
    title: `${basename(workspace)} — canvast`,
    backgroundColor: "#1f1f1f",
    webPreferences: {
      partition,
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: !hidden,
    },
  });
  // The page asks which workspace it is in; only this window's own page is answered.
  ipcMain.handle("canvast:workspace", (e) => (e.sender === win.webContents ? { path: workspace, name: basename(workspace) } : null));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("page-title-updated", (e) => e.preventDefault()); // (the title names the workspace folder)
  await win.loadURL(`${ORIGIN}/${process.env["CANVAST_HASH"] ?? ""}`);
}

function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "File", submenu: [{ label: "Open workspace folder…", accelerator: "CmdOrCtrl+Shift+O", click: () => void openOther() }, { type: "separator" }, { role: "quit" }] },
      { role: "editMenu" },
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] },
    ]),
  );
}

app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (e) => e.preventDefault());
});

app.on("window-all-closed", () => app.quit());

void app.whenReady().then(async () => {
  if (!existsSync(HTML)) {
    dialog.showErrorBox("canvast", `The app file is missing: ${HTML}`);
    return app.exit(1);
  }
  installMenu();
  const workspace = await chooseWorkspace();
  if (!workspace) return app.quit();
  remember(workspace);
  await openWindow(workspace);
});

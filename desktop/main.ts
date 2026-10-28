/**
 * The desktop build's main process (ADR 0177): one window running the same single-file app, on a workspace folder.
 *
 * The page is served from `app://canvast/` (not file://) and is sandboxed: no Node, context isolation, no navigation, no
 * new windows, no network (the page's CSP already refuses it). Each workspace folder gets its own storage partition, so
 * two workspaces never share boards or a library. The folder is the one passed with `--workspace=<path>`, else the last
 * one opened, else the one chosen in the start dialog (recent ones, open a folder, a new workspace).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { BOARDS_DIR, isSafeRelativePath } from "../src/storage/workspace-names";
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

function forget(path: string): void {
  const next: Recent = { workspaces: readRecent().workspaces.filter((w) => w.path !== path) };
  writeFileSync(recentFile(), JSON.stringify(next, null, 2));
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

/** A new workspace: a folder named in a save dialog, made empty (an existing folder that has files is refused). Its path, or null. */
async function newWorkspaceFolder(near: string | null): Promise<string | null> {
  const r = await dialog.showSaveDialog({
    title: "New workspace",
    buttonLabel: "Create workspace",
    nameFieldLabel: "Workspace name:",
    defaultPath: join(near ? dirname(near) : app.getPath("documents"), "New workspace"),
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (r.canceled || !r.filePath) return null;
  const p = resolve(r.filePath);
  if (existsSync(p) && (!isFolder(p) || readdirSync(p).length > 0)) {
    await dialog.showMessageBox({ type: "info", message: "That folder is not empty", detail: `${p}\n\nA new workspace starts in an empty folder. To use this one as it is, choose Open a folder… instead.`, buttons: ["OK"] });
    return null;
  }
  mkdirSync(p, { recursive: true });
  return p;
}

/**
 * The start dialog, when there is no workspace to open: the recent ones that are still there, open a folder, a new workspace.
 * `missing`: the last workspace, whose folder is not there any more (moved or deleted). The folder chosen, or null to quit.
 */
async function startDialog(missing: string | null): Promise<string | null> {
  for (;;) {
    const others = readRecent().workspaces.filter((w) => isFolder(w.path)).slice(0, 3);
    const buttons = [...others.map((w) => `Open “${basename(w.path)}”`), "Open a folder…", "New workspace…", "Quit"];
    const { response } = await dialog.showMessageBox({
      type: missing ? "warning" : "question",
      title: "canvast",
      message: missing ? `The workspace folder “${basename(missing)}” is not there any more` : "Choose a workspace",
      detail: [
        missing ? `It was at ${missing}. It may have been moved or deleted (a deleted folder may still be in the system trash).` : "A workspace is a folder: your boards, canvases and library are files in it.",
        others.length ? `Recent workspaces:\n${others.map((w) => w.path).join("\n")}` : "",
      ].filter(Boolean).join("\n\n"),
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    });
    if (response < others.length) return others[response]!.path;
    const k = response - others.length;
    if (k === 2) return null;
    const p = k === 0 ? await pickFolder() : await newWorkspaceFolder(missing);
    if (p) return p;
  }
}

/** The workspace folder to open, or null when none was chosen. */
async function chooseWorkspace(): Promise<string | null> {
  const arg = process.argv.find((a) => a.startsWith("--workspace="))?.slice("--workspace=".length);
  if (arg) {
    const p = resolve(arg);
    mkdirSync(p, { recursive: true });
    return p;
  }
  const last = readRecent().workspaces[0];
  if (last && isFolder(last.path)) return last.path;
  return startDialog(last?.path ?? null);
}

/** The workspace the window switches to once it has closed (saved first, and asked when files are still being written). */
let switchTo: string | null = null;

/** Switch to another workspace: the window closes as always (its work written first), then the app starts again on that folder. */
function switchWorkspace(win: BrowserWindow, to: string): void {
  switchTo = to;
  win.close();
}

/** The app starts again on the folder it switches to (one workspace per window, each with its own storage). */
function relaunchOn(p: string): void {
  remember(p);
  if (process.env["CANVAST_NO_RELAUNCH"] === "1") return app.exit(0); // (tests: the switch is checked, no second app left running)
  app.relaunch({ args: process.argv.slice(1).filter((a) => !a.startsWith("--workspace=")).concat(`--workspace=${p}`) });
  app.exit(0);
}

/** The full path of `rel` inside the workspace, or an error when it is not a safe path that stays inside it (no `..`, no link out). */
async function inside(root: string, rel: string): Promise<string> {
  if (typeof rel !== "string" || !isSafeRelativePath(rel)) throw new Error("not a path inside the workspace");
  const full = resolve(root, ...rel.split("/"));
  if (!full.startsWith(root + sep)) throw new Error("not a path inside the workspace");
  // The deepest folder that exists must really be inside (a link must not lead out).
  const realRoot = await realpath(root);
  let probe = dirname(full);
  for (;;) {
    try {
      const real = await realpath(probe);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error("not a path inside the workspace");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || probe === root) throw e;
      probe = dirname(probe);
    }
  }
  return full;
}

/** Write a file safely: a temporary file beside it, flushed to the disk, then renamed over it (never half a file). */
async function writeAtomic(full: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(full), { recursive: true });
  const tmp = `${full}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, full);
}

/** Move a file into the workspace's `.trash/` at the same relative path (numbered when one is there already). */
async function toTrash(root: string, rel: string, full: string): Promise<void> {
  let target = resolve(root, ".trash", ...rel.split("/"));
  for (let n = 2; existsSync(target); n++) target = resolve(root, ".trash", ...rel.split("/")).replace(/(\.[^./\\]+)?$/, `-${n}$1`);
  await mkdir(dirname(target), { recursive: true });
  await rename(full, target);
}

/** The file calls of the bridge, each answering only this window's page and only inside its workspace folder. */
function installFileCalls(win: BrowserWindow, root: string): void {
  const own = (e: Electron.IpcMainInvokeEvent): void => {
    if (e.sender !== win.webContents) throw new Error("not this window");
  };
  ipcMain.handle("canvast:read", async (e, rel: string) => {
    own(e);
    try {
      return new Uint8Array(await readFile(await inside(root, rel)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "EISDIR") return null;
      throw err;
    }
  });
  ipcMain.handle("canvast:head", async (e, rel: string) => {
    own(e);
    try {
      const fh = await open(await inside(root, rel), "r");
      try {
        const buf = Buffer.alloc(1024);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        return buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        await fh.close();
      }
    } catch {
      return null;
    }
  });
  ipcMain.handle("canvast:exists", async (e, rel: string) => {
    own(e);
    try {
      return (await stat(await inside(root, rel))).isFile();
    } catch {
      return false;
    }
  });
  ipcMain.handle("canvast:write", async (e, rel: string, bytes: Uint8Array) => {
    own(e);
    if (!(bytes instanceof Uint8Array)) throw new Error("bytes expected");
    await writeAtomic(await inside(root, rel), bytes);
  });
  ipcMain.handle("canvast:remove", async (e, rel: string, how: unknown = "trash") => {
    own(e);
    const full = await inside(root, rel);
    if (!existsSync(full)) return;
    if (how === "erase") return rm(full, { recursive: true, force: true });
    if (how === "system") return shell.trashItem(full);
    if (rel === ".trash" || rel.startsWith(".trash/")) throw new Error("already in the trash");
    await toTrash(root, rel, full);
  });
  ipcMain.handle("canvast:rename", async (e, from: string, to: string) => {
    own(e);
    const a = await inside(root, from);
    const b = await inside(root, to);
    if (existsSync(b) && a.toLowerCase() !== b.toLowerCase()) throw new Error(`${to} is already there`);
    await mkdir(dirname(b), { recursive: true });
    await rename(a, b);
  });
  ipcMain.handle("canvast:erase", async (e, rel: string) => {
    own(e);
    try {
      if ((await stat(await inside(root, rel))).isFile()) await unlink(await inside(root, rel));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  });
  ipcMain.handle("canvast:makeFolder", async (e, rel: string) => {
    own(e);
    await mkdir(await inside(root, rel), { recursive: true });
  });
  ipcMain.handle("canvast:removeEmptyFolder", async (e, rel: string) => {
    own(e);
    try {
      await rmdir(await inside(root, rel)); // (refused by the system unless the folder is empty)
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle("canvast:tree", async (e, rel: string) => {
    own(e);
    const out: Array<{ path: string; size: number }> = [];
    const walk = async (dir: string, at: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of entries) {
        if (d.name.startsWith(".") || out.length >= 200_000) continue;
        const full = join(dir, d.name);
        if (d.isDirectory()) await walk(full, `${at}/${d.name}`);
        else if (d.isFile()) out.push({ path: `${at}/${d.name}`, size: (await stat(full)).size });
      }
    };
    await walk(await inside(root, rel), rel);
    return out;
  });
  ipcMain.handle("canvast:canvasFiles", async (e) => {
    own(e);
    const out: string[] = [];
    const boards = join(root, ...BOARDS_DIR.split("/"));
    for (const d of await readdir(boards, { withFileTypes: true }).catch(() => [])) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      for (const f of await readdir(join(boards, d.name), { withFileTypes: true }).catch(() => [])) if (f.isFile() && f.name.endsWith(".cvst")) out.push(`${BOARDS_DIR}/${d.name}/${f.name}`);
    }
    return out;
  });
  ipcMain.handle("canvast:hash", async (e, rel: string) => {
    own(e);
    try {
      const h = createHash("sha256");
      for await (const chunk of createReadStream(await inside(root, rel))) h.update(chunk as Buffer);
      return h.digest("hex");
    } catch {
      return null;
    }
  });
  ipcMain.handle("canvast:list", async (e, rel: string) => {
    own(e);
    try {
      return (await readdir(await inside(root, rel), { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
    } catch {
      return [];
    }
  });
}

/**
 * Tell the page which paths of the workspace folder changed (ADR 0177, "Changes from outside the app"), a second after the
 * last change, in one message. The app's own temporary files and the trash are left out.
 */
function watchFolder(win: BrowserWindow, root: string): void {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: ReturnType<typeof watch>;
  try {
    watcher = watch(root, { recursive: true }, (_event, name) => {
      if (!name) return;
      const rel = name.toString().split(sep).join("/");
      if (/^\.trash(\/|$)|^\.canvast\/moving(\/|$)|\.tmp-/.test(rel)) return;
      pending.add(rel);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.send("canvast:changed", [...pending]);
        pending.clear();
      }, 1000);
    });
  } catch {
    return; // (no watching on this system: changes are still read at the next start)
  }
  win.on("closed", () => watcher.close());
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
  installFileCalls(win, await realpath(workspace));
  watchFolder(win, await realpath(workspace));
  // Closing waits (up to 15 s) for the page to write what is not in the folder yet (ADR 0177: files follow edits by a moment).
  // While files are still being written the page may hold the close to ask first, and keep the window open.
  let closing = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  win.on("close", (e) => {
    if (closing || win.webContents.isDestroyed()) return;
    e.preventDefault();
    closing = true;
    win.webContents.send("canvast:closing");
    closeTimer = setTimeout(() => win.destroy(), 15_000);
  });
  ipcMain.handle("canvast:closed", (e) => {
    if (e.sender === win.webContents) setImmediate(() => win.destroy());
  });
  ipcMain.handle("canvast:holdClose", (e) => {
    if (e.sender === win.webContents) clearTimeout(closeTimer);
  });
  ipcMain.handle("canvast:keepOpen", (e) => {
    if (e.sender !== win.webContents) return;
    clearTimeout(closeTimer);
    closing = false;
    switchTo = null;
  });
  win.on("closed", () => {
    if (switchTo) relaunchOn(switchTo);
  });
  // Switching workspaces from the page: the recent ones (and whether each is still there), another folder, a new one.
  ipcMain.handle("canvast:workspaces", (e) => {
    if (e.sender !== win.webContents) return null;
    return { current: workspace, recent: readRecent().workspaces.map((w) => ({ path: w.path, name: basename(w.path), exists: isFolder(w.path) })) };
  });
  ipcMain.handle("canvast:switchWorkspace", async (e, to: string) => {
    if (e.sender !== win.webContents) return false;
    const p = to === "open" ? await pickFolder() : to === "new" ? await newWorkspaceFolder(workspace) : readRecent().workspaces.find((w) => w.path === to && isFolder(w.path))?.path ?? null;
    if (!p || p === workspace) return false;
    switchWorkspace(win, p);
    return true;
  });
  ipcMain.handle("canvast:forgetWorkspace", (e, path: string) => {
    if (e.sender === win.webContents && path !== workspace) forget(path);
  });
  // Nothing else is ever loaded; a reload of the app itself is allowed (Delete all data, Settings' Reload button).
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("page-title-updated", (e) => e.preventDefault()); // (the title names the workspace folder)
  await win.loadURL(`${ORIGIN}/${process.env["CANVAST_HASH"] ?? ""}`);
}

/** A switch from the File menu: the folder chosen, then the same way as from the page (saved first). */
async function menuSwitch(choose: () => Promise<string | null>): Promise<void> {
  const p = await choose();
  const win = BrowserWindow.getAllWindows()[0];
  if (p && win) switchWorkspace(win, p);
}

function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          { label: "Open workspace folder…", accelerator: "CmdOrCtrl+Shift+O", click: () => void menuSwitch(pickFolder) },
          { label: "New workspace…", click: () => void menuSwitch(() => newWorkspaceFolder(null)) },
          { type: "separator" },
          { role: "quit" },
        ],
      },
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

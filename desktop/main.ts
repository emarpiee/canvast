/**
 * The desktop build's main process (ADR 0177): one window running the same single-file app, on a workspace folder.
 *
 * The page is served from `app://canvast/` (not file://) and is sandboxed: no Node, context isolation, no navigation, no
 * new windows, no network (the page's CSP already refuses it). Each workspace folder gets its own storage partition, so
 * two workspaces never share boards or a library. The folder is the one passed with `--workspace=<path>`, else the last
 * one opened, else the one chosen in the start dialog (recent ones, open a folder, a new workspace).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from "electron";
import { execFile } from "node:child_process";
import { createHash, randomBytes, scrypt } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, stat, unlink, utimes } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { BOARDS_DIR, isSafeRelativePath } from "../src/storage/workspace-names";
import { readItem } from "../src/storage/library-mirror";
import { SEAL_OVERHEAD, isHiddenFile } from "../src/storage/hidden-vault";
import type { LibraryItem } from "../src/storage/library-mirror";
import { Library, openLibraryDb } from "./library-db";
import { LibraryIndex } from "./library-index";
import type { LibraryQuery } from "./library-index";
import type { LibraryOp } from "../src/storage/desktop-bridge";
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

/** Where the process that has a workspace open notes its pid (the workspace's storage can be open in one process only). */
const holderFile = (workspace: string): string => join(app.getPath("userData"), "open", `${createHash("sha256").update(workspace).digest("hex").slice(0, 24)}.pid`);

/** Whether `pid` is a canvast process that is still running (a pid the system gave to another program after a restart is not). */
function runningCanvast(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  if (process.platform !== "linux") return true;
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(basename(process.execPath));
  } catch {
    return false;
  }
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * Take the workspace for this process. Another canvast that has it open (or is still closing: the window is gone while it
 * finishes writing to the storage) is waited for, quietly for up to 20 s, then with a question, never opened beside it: the
 * second would find the storage taken and open with nothing. False when the person chose to quit.
 */
async function holdWorkspace(workspace: string): Promise<boolean> {
  const file = holderFile(workspace);
  const other = (): boolean => {
    try {
      return runningCanvast(Number(readFileSync(file, "utf8")));
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 40 && other(); i++) await pause(500);
  while (other()) {
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "canvast",
      message: `“${basename(workspace)}” is open in another canvast window`,
      detail: "A workspace can be open in one window at a time. If you have just closed it, it is still finishing its writes: wait a moment.",
      buttons: ["Wait", "Quit"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 1) return false;
    for (let i = 0; i < 20 && other(); i++) await pause(500);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, String(process.pid));
  return true;
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

/**
 * Write a file safely: a temporary file beside it, flushed to the disk, then renamed over it (never half a file). Not `durable`:
 * not waited for on the disk (`canvast:syncFiles` does it for many at once; the app keeps its own copy until then).
 */
/**
 * Every file under a folder, at any depth (names starting with a dot, and what is in such folders, left out), with its size and
 * modification time: folders are read and files looked at many at a time (a big library on a spinning disk), with no limit on how many.
 */
/**
 * Temporary files of writes a crash or a kill cut off (`writeAtomic`): removed at start-up once old enough to be no write in progress,
 * another device's included (the stress run shortens the wait).
 */
const STALE_TMP_MS = Number(process.env["CANVAST_STALE_TMP_MS"] ?? 10 * 60_000);
const TMP_RE = /\.tmp-\d+-[0-9a-z]+$/;
const staleTmp = (name: string, mtimeMs: number): boolean => TMP_RE.test(name) && Date.now() - mtimeMs >= STALE_TMP_MS;
async function sweepTemps(dir: string): Promise<void> {
  for (const ent of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await sweepTemps(full);
    else if (TMP_RE.test(ent.name) && staleTmp(ent.name, (await stat(full).catch(() => null))?.mtimeMs ?? Date.now())) await unlink(full).catch(() => undefined);
  }
}

async function walkFiles(dir: string, at: string): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
  const out: Array<{ path: string; size: number; mtimeMs: number }> = [];
  let folders: Array<[string, string]> = [[dir, at]];
  while (folders.length) {
    const next: Array<[string, string]> = [];
    const files: Array<[string, string]> = [];
    await Promise.all(
      folders.map(async ([d, rel]) => {
        for (const ent of await readdir(d, { withFileTypes: true }).catch(() => [])) {
          if (ent.name.startsWith(".")) continue;
          if (ent.isDirectory()) next.push([join(d, ent.name), `${rel}/${ent.name}`]);
          else if (ent.isFile()) files.push([join(d, ent.name), `${rel}/${ent.name}`]);
        }
      }),
    );
    for (let i = 0; i < files.length; i += 256) {
      await Promise.all(
        files.slice(i, i + 256).map(async ([full, rel]) => {
          const s = await stat(full).catch(() => null);
          if (s?.isFile() && staleTmp(rel, s.mtimeMs)) await unlink(full).catch(() => undefined);
          else if (s?.isFile()) out.push({ path: rel, size: s.size, mtimeMs: s.mtimeMs });
        }),
      );
    }
    folders = next;
  }
  return out;
}

async function writeAtomic(full: string, bytes: Uint8Array, durable = true): Promise<void> {
  await mkdir(dirname(full), { recursive: true });
  const tmp = `${full}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(bytes);
    if (durable) await fh.sync();
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
  // Dated when it went into the trash (a move keeps a file's own date), so emptying old ones (Settings > Storage) counts from then.
  const now = new Date();
  const touch = async (p: string): Promise<void> => {
    const s = await lstat(p).catch(() => null);
    if (s?.isDirectory()) for (const n of await readdir(p).catch(() => [])) await touch(join(p, n));
    if (s) await utimes(p, now, now).catch(() => undefined);
  };
  await touch(target);
}

/** Erase what has been in the workspace's `.trash/` longer than `days` (by its date there), then the folders it emptied. How many files. */
async function emptyOldTrash(root: string, days: number): Promise<number> {
  const cutoff = Date.now() - days * 86_400_000;
  let n = 0;
  const sweep = async (dir: string): Promise<boolean> => {
    let empty = true;
    for (const ent of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (await sweep(p)) await rmdir(p).catch(() => undefined);
        else empty = false;
      } else if (((await lstat(p).catch(() => null))?.mtimeMs ?? Infinity) < cutoff) {
        await unlink(p).catch(() => undefined);
        n++;
      } else empty = false;
    }
    return empty;
  };
  await sweep(join(root, ".trash"));
  return n;
}

/**
 * Sizes of `library/`'s files as the start-up walk found them (path → size), until the folder says one changed: a library of a million
 * files is not looked at twice to show which are there. One window, one workspace, per process.
 */
const walkedSizes = new Map<string, number>();
/** Told when a file of the workspace changed (what was known of which files are there is made again). */
const walkedListeners: Array<() => void> = [];
function forgetWalked(rel: string): void {
  for (const fn of walkedListeners) fn();
  if (!walkedSizes.size) return;
  walkedSizes.delete(rel);
  if (!/\.[^/]+$/.test(rel)) for (const p of walkedSizes.keys()) if (p.startsWith(`${rel}/`)) walkedSizes.delete(p); // (a folder)
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
  ipcMain.handle("canvast:write", async (e, rel: string, bytes: Uint8Array, durable: unknown = true) => {
    own(e);
    forgetWalked(String(rel));
    if (!(bytes instanceof Uint8Array)) throw new Error("bytes expected");
    await writeAtomic(await inside(root, rel), bytes, durable !== false);
  });
  // Many files' sizes at once (whether the library's files are still there), without reading them. A link is not followed (lstat), so a
  // path can only ever say something about the workspace folder itself.
  ipcMain.handle("canvast:sizes", async (e, rels: unknown) => {
    own(e);
    if (!Array.isArray(rels)) throw new Error("paths expected");
    return Promise.all(
      rels.map(async (r) => {
        if (typeof r !== "string" || !isSafeRelativePath(r)) return null;
        const walked = walkedSizes.get(r);
        if (walked !== undefined) return walked;
        const full = resolve(root, ...r.split("/"));
        if (!full.startsWith(root + sep)) return null;
        try {
          const s = await lstat(full);
          return s.isFile() ? s.size : null;
        } catch {
          return null;
        }
      }),
    );
  });
  // A file of the workspace opened in the system's default app for its kind (one canvast cannot show, or to edit it elsewhere).
  ipcMain.handle("canvast:openFile", async (e, rel: string) => {
    own(e);
    return shell.openPath(await inside(root, rel));
  });
  // A file of the workspace shown in the system's file manager: its folder opened with the file selected.
  ipcMain.handle("canvast:showFile", async (e, rel: string) => {
    own(e);
    shell.showItemInFolder(await inside(root, rel));
  });
  // Files written without waiting for the disk, now on it: on Linux one request for the whole file system (one wait for the
  // disk instead of one per file), else each file in turn.
  ipcMain.handle("canvast:syncFiles", async (e, rels: unknown) => {
    own(e);
    if (!Array.isArray(rels)) throw new Error("paths expected");
    const fulls = await Promise.all(rels.map((r) => inside(root, String(r))));
    if (process.platform === "linux") {
      const ok = await new Promise<boolean>((done) => execFile("sync", ["-f", root], (err) => done(!err)));
      if (ok) return;
    }
    for (const full of fulls) {
      const fh = await open(full, "r+").catch(() => null);
      if (!fh) continue;
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
    }
  });
  ipcMain.handle("canvast:remove", async (e, rel: string, how: unknown = "trash") => {
    own(e);
    forgetWalked(String(rel));
    const full = await inside(root, rel);
    if (!existsSync(full)) return;
    if (how === "erase") return rm(full, { recursive: true, force: true });
    if (how === "system") return shell.trashItem(full);
    if (rel === ".trash" || rel.startsWith(".trash/")) throw new Error("already in the trash");
    await toTrash(root, rel, full);
  });
  ipcMain.handle("canvast:emptyOldTrash", async (e, days: unknown) => {
    own(e);
    if (!Number.isInteger(days) || (days as number) < 1) return 0;
    return emptyOldTrash(root, days as number);
  });
  ipcMain.handle("canvast:rename", async (e, from: string, to: string) => {
    own(e);
    forgetWalked(String(from));
    forgetWalked(String(to));
    const a = await inside(root, from);
    const b = await inside(root, to);
    if (existsSync(b) && a.toLowerCase() !== b.toLowerCase()) throw new Error(`${to} is already there`);
    await mkdir(dirname(b), { recursive: true });
    await rename(a, b);
  });
  ipcMain.handle("canvast:erase", async (e, rel: string) => {
    own(e);
    forgetWalked(String(rel));
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
    return (await walkFiles(await inside(root, rel), rel)).map(({ path, size }) => ({ path, size }));
  });
  // Start-up: what changed in library/ since the last look (each file's size and modification time against the look kept for this
  // workspace in the app's own folder), so a big library is not looked through file by file in the page. Null the first time (the
  // page then looks at everything). The look is kept only once the page says it has taken what changed (`libraryLookDone`).
  let look: Map<string, string> | null = null;
  const lookFile = join(app.getPath("userData"), "library-looks", `${createHash("sha256").update(root).digest("hex").slice(0, 24)}.json`);
  ipcMain.handle("canvast:libraryChanges", async (e) => {
    own(e);
    await Promise.all([sweepTemps(join(root, ".canvast")), sweepTemps(join(root, ".hidden"))]);
    const walked = await walkFiles(join(root, "library"), "library");
    walkedSizes.clear();
    for (const f of walked) walkedSizes.set(f.path, f.size);
    for (const fn of walkedListeners) fn();
    look = new Map(walked.map((f) => [f.path, `${f.size}:${Math.round(f.mtimeMs)}`]));
    let before: Record<string, string> | null = null;
    try {
      before = JSON.parse(await readFile(lookFile, "utf8")) as Record<string, string>;
    } catch {
      before = null;
    }
    if (!before) return null;
    const changed = [...look].filter(([p, v]) => before![p] !== v).map(([p]) => p);
    for (const p of Object.keys(before)) if (!look.has(p)) changed.push(p);
    return changed;
  });
  ipcMain.handle("canvast:libraryLookDone", async (e) => {
    own(e);
    if (!look) return;
    mkdirSync(dirname(lookFile), { recursive: true });
    await writeAtomic(lookFile, Buffer.from(JSON.stringify(Object.fromEntries(look))), true);
    look = null;
  });
  // The library (desktop/library-db.ts): this workspace's SQLite file in the app's own data, opened on first use.
  let lib: Library | null = null;
  let index: LibraryIndex | null = null;
  const library = (): Library => {
    if (lib) return lib;
    const dir = join(app.getPath("userData"), "library-db");
    mkdirSync(dir, { recursive: true });
    lib = new Library(openLibraryDb(join(dir, `${createHash("sha256").update(root).digest("hex").slice(0, 24)}.sqlite`)));
    index = new LibraryIndex(lib);
    lib.listeners.push((op) => void ((op.t === "rec" || op.t === "entry") && (absentCache = null)));
    return lib;
  };
  // The active items whose file is not there, kept until a file or a record changes.
  let absentCache: Set<string> | null = null;
  walkedListeners.push(() => (absentCache = null));
  /** Whether each of these items' file is there (and of its size): looked at for them alone. */
  const presentOf = async (rows: Array<[string, string | null, number | null]>): Promise<Set<string>> => {
    const out = new Set<string>();
    await Promise.all(rows.map(async ([hash, file, size]) => {
      if (!file || size === null || !isSafeRelativePath(file) || !(file.startsWith("library/") || /^\.hidden\/[^/]+$/.test(file))) return;
      let got = walkedSizes.get(file);
      if (got === undefined) got = await lstat(join(root, ...file.split("/"))).then((st) => (st.isFile() ? st.size : -1), () => -1);
      if (isHiddenFile(file) ? got >= size + SEAL_OVERHEAD : got === size) out.add(hash);
    }));
    return out;
  };
  const absentNow = async (l: Library): Promise<Set<string>> => {
    if (absentCache) return absentCache;
    const rows = l.db.prepare("SELECT e.hash, r.file, json_extract(r.json, '$.size') FROM entries e LEFT JOIN recs r ON r.hash = e.hash WHERE e.state = 'active'").raw().all() as Array<[string, string | null, number | null]>;
    const out = new Set<string>();
    for (let i = 0; i < rows.length; i += 2000) {
      await Promise.all(rows.slice(i, i + 2000).map(async ([hash, file, size]) => {
        if (!file || size === null || !isSafeRelativePath(file) || !(file.startsWith("library/") || /^\.hidden\/[^/]+$/.test(file))) return void out.add(hash);
        let got = walkedSizes.get(file);
        if (got === undefined) got = await lstat(join(root, ...file.split("/"))).then((st) => (st.isFile() ? st.size : -1), () => -1);
        if (isHiddenFile(file) ? got < size + SEAL_OVERHEAD : got !== size) out.add(hash);
      }));
    }
    return (absentCache = out);
  };
  const HASH = /^[0-9a-f]{64}$/;
  const hashes = (a: unknown): string[] => (Array.isArray(a) ? a.filter((h): h is string => typeof h === "string" && HASH.test(h)) : []);
  // (what the page sends is checked: kinds, hashes and values; no SQL from the page)
  const opOf = (o: unknown): LibraryOp | null => {
    if (!o || typeof o !== "object") return null;
    const { t, hash, k, v } = o as { t?: unknown; hash?: unknown; k?: unknown; v?: unknown };
    if (t === "meta") return typeof k === "string" && k.length < 200 ? { t, k, v } : null;
    if (t === "part") return typeof k === "string" && /^[0-9a-f]{1,2}$/.test(k) && (v === null || (typeof v === "string" && /^[0-9a-f]{64}$/.test(v))) ? { t, k, v } : null;
    if (typeof hash !== "string" || !HASH.test(hash)) return null;
    if (t === "seen") return v === null || typeof v === "string" ? { t, hash, v } : null;
    if (t !== "entry" && t !== "rec") return null;
    if (v !== null && (!v || typeof v !== "object" || (v as { hash?: unknown }).hash !== hash)) return null;
    return { t, hash, v } as LibraryOp;
  };
  const WHERE = { all: "1", active: "state = 'active'", deleted: "state = 'deleted'", hidden: "hidden = 1" } as const;
  ipcMain.handle("canvast:lib", async (e, op: unknown, ...args: unknown[]) => {
    own(e);
    const l = library();
    switch (op) {
      case "get":
        return l.get(hashes(args[0]));
      case "entries":
        return l.entriesText(WHERE[args[0] as keyof typeof WHERE] ?? WHERE.all);
      case "recs":
        return l.recsText(args[0] === "sealed");
      case "byFile":
        return typeof args[0] === "string" ? (l.byFile(args[0]) ?? null) : null;
      case "meta":
        return typeof args[0] === "string" ? (l.meta(args[0]) ?? null) : null;
      case "apply": {
        const ops = Array.isArray(args[0]) ? args[0].map(opOf) : [];
        if (ops.some((o) => !o)) throw new Error("a library change the app does not know");
        return void l.apply(ops as LibraryOp[]);
      }
      case "sync": {
        const keys = Array.isArray(args[0]) ? args[0].filter((k): k is string => typeof k === "string" && /^[0-9a-f]{1,2}$/.test(k)) : [];
        const extra = Array.isArray(args[1]) ? args[1].map(readItem).filter((i): i is LibraryItem => i !== null) : [];
        const read = (key: string): Buffer | null => {
          try {
            return readFileSync(join(root, ".canvast", "library", `items-${key}.json`));
          } catch {
            return null;
          }
        };
        return l.sync(keys, read, extra, args[2] === true, (done, total) => !win.webContents.isDestroyed() && win.webContents.send("canvast:libProgress", done, total), args[3] === true);
      }
      case "write": {
        const only = args[0] === null ? null : hashes(args[0]);
        const at = (rel: string): string => join(root, ...rel.split("/"));
        return l.writeParts(only, typeof args[1] === "number" ? args[1] : 10_000, {
          read: (rel) => {
            try {
              return readFileSync(at(rel));
            } catch {
              return null;
            }
          },
          write: (rel, text) => writeAtomic(at(rel), Buffer.from(text)),
          remove: (rel) => unlink(at(rel)).catch(() => undefined),
        });
      }
      case "unnamed": {
        // (library/ walked here: the files no record names, with their sizes; a million known files never cross to the page)
        const walked = await walkFiles(join(root, "library"), "library");
        return l.unnamed(walked).map(({ path, size }) => ({ path, size }));
      }
      case "holds":
        return typeof args[0] === "string" && l.holds(args[0]);
      case "absent":
        // Which active items' files are not there (or not of their size), looked at here: the sizes of the start-up walk, else each file.
        return [...(await absentNow(l))];
      case "query": {
        // (which files are missing is looked at over the whole library only for a search that asks for them)
        const q = args[0] as LibraryQuery;
        return index!.query(q, /missing/i.test(q.text) ? await absentNow(l) : new Set());
      }
      case "counts":
        return index!.counts(args[0] === true);
      case "fieldKeys":
        return index!.fieldKeys();
      case "listed": {
        // Some items for the view to draw: their entries, and whether each one's file is there (looked at for them alone).
        const rows = l.get(hashes(args[0]));
        const here = await presentOf(rows.map(([h, , r]) => [h, r?.ext && r.file ? r.file : null, r?.size ?? null]));
        return rows.flatMap(([h, e]) => (e ? [{ ...e, present: here.has(h) }] : []));
      }
      case "orphans":
        return l.orphansText();
      case "pending":
        return l.pending();
      case "parts": {
        return l.parts();
      }
      case "reset":
        index?.reset();
        absentCache = null;
        return void l.db.exec("DELETE FROM entries; DELETE FROM recs; DELETE FROM seen; DELETE FROM parts; DELETE FROM meta; DELETE FROM changed;");
      default:
        throw new Error("not a library call");
    }
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
  // The Hidden password stretched with scrypt (RFC 7914), natively: the page's WebCrypto has no memory-hard function (and Electron's
  // crypto has no Argon2). Only the ranges a vault may name are done (a page cannot ask for gigabytes); nothing is kept.
  ipcMain.handle("canvast:scrypt", async (e, password: string, salt: Uint8Array, N: number, r: number, p: number) => {
    own(e);
    if (typeof password !== "string" || !(salt instanceof Uint8Array) || salt.length < 16 || salt.length > 64) throw new Error("bad scrypt input");
    if (!Number.isInteger(Math.log2(N)) || N < 2 ** 14 || N > 2 ** 20 || !Number.isInteger(r) || r < 8 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) throw new Error("bad scrypt parameters");
    const key = await new Promise<Buffer>((done, fail) => scrypt(Buffer.from(password, "utf8"), Buffer.from(salt), 32, { N, r, p, maxmem: 256 * N * r + 2 ** 24 }, (err, k) => (err ? fail(err) : done(k))));
    return new Uint8Array(key);
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
  const skipped = (rel: string): boolean => /^\.trash(\/|$)|^\.canvast\/moving(\/|$)|\.tmp-/.test(rel);
  let close: () => void;
  try {
    close = watchTree(root, skipped, (rel) => {
      if (skipped(rel)) return;
      forgetWalked(rel);
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
  win.on("closed", () => close());
}

/**
 * Watch a folder and every folder in it; `onChange` gets each changed path, relative, with `/`. Linux has no recursive watch
 * of its own, and Node's stand-in watches every file and reads a folder again, synchronously, on each change in it: an
 * import writing thousands of files into one folder then held this process for minutes (the window stayed blank). Here each
 * folder is watched once (a folder's watch reports its files) and a new folder is added when it appears, never blocking.
 */
function watchTree(root: string, skip: (rel: string) => boolean, onChange: (rel: string) => void): () => void {
  if (process.platform !== "linux") {
    const w = watch(root, { recursive: true }, (_event, name) => name && onChange(name.toString().split(sep).join("/")));
    return () => w.close();
  }
  const watchers = new Map<string, ReturnType<typeof watch>>(); // (by folder, relative; "" is the root)
  let closed = false;
  const drop = (rel: string): void => {
    for (const [d, w] of watchers) {
      if (d !== rel && !d.startsWith(`${rel}/`)) continue;
      w.close();
      watchers.delete(d);
    }
  };
  const add = async (rel: string): Promise<void> => {
    if (closed || watchers.has(rel) || (rel && skip(rel))) return;
    const full = rel ? join(root, ...rel.split("/")) : root;
    let w: ReturnType<typeof watch>;
    try {
      w = watch(full, (event, name) => {
        if (!name) return;
        const child = rel ? `${rel}/${name.toString()}` : name.toString();
        if (skip(child)) return;
        onChange(child);
        // A name that came or went: a folder made (or moved in) is watched too, one removed is let go.
        if (event === "rename") void stat(join(full, name.toString())).then((s) => (s.isDirectory() ? add(child) : undefined), () => drop(child));
      });
    } catch {
      return; // (gone already, or not readable)
    }
    w.on("error", () => drop(rel));
    watchers.set(rel, w);
    for (const d of await readdir(full, { withFileTypes: true }).catch(() => [])) if (d.isDirectory()) await add(rel ? `${rel}/${d.name}` : d.name);
  };
  void add("");
  return () => {
    closed = true;
    for (const w of watchers.values()) w.close();
    watchers.clear();
  };
}

/** The folder's own id, in the folder (`.canvast/folder.json`): a new folder at the path of a deleted one is another workspace. */
const FOLDER_FILE = join(".canvast", "folder.json");
const FOLDER_ID_RE = /^[0-9a-f]{32}$/;
const partitionsFile = (): string => join(app.getPath("userData"), "partitions.json");
/** Which storage partition each workspace folder uses on this device: by path, with the folder's id. */
type Partitions = Record<string, { id: string; partition: string }>;

function readPartitions(): Partitions {
  try {
    const p = JSON.parse(readFileSync(partitionsFile(), "utf8")) as Partitions;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function readFolderId(workspace: string): string | null {
  try {
    const id = (JSON.parse(readFileSync(join(workspace, FOLDER_FILE), "utf8")) as { id?: unknown }).id;
    return typeof id === "string" && FOLDER_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

const hashed = (text: string): string => `persist:ws-${createHash("sha256").update(text).digest("hex").slice(0, 24)}`;

/**
 * The storage partition of a workspace folder (its cache on this device): one per folder, not per path, so a folder made
 * where a deleted one was never opens the deleted one's boards, library or passwords. A folder that has no id yet gets one;
 * one made before folders had ids keeps the partition it had (named by its path). A partition left behind by a folder that
 * is gone from that path is cleared: what it held was a cache of that folder.
 */
async function partitionOf(workspace: string): Promise<string> {
  const known = readPartitions();
  const legacy = hashed(workspace);
  let id = readFolderId(workspace);
  let partition: string;
  if (id && known[workspace]?.id === id) partition = known[workspace].partition;
  else if (id) partition = hashed(`${workspace}\n${id}`);
  else {
    id = randomBytes(16).toString("hex");
    const before = existsSync(join(workspace, ".canvast", "workspace.json")) && !known[workspace];
    partition = before ? legacy : hashed(`${workspace}\n${id}`);
    mkdirSync(join(workspace, ".canvast"), { recursive: true });
    writeFileSync(join(workspace, FOLDER_FILE), JSON.stringify({ format: "canvast-folder", version: 1, id }, null, 1));
  }
  const onDisk = (p: string): boolean => existsSync(join(app.getPath("userData"), "Partitions", p.slice("persist:".length)));
  const inUse = (p: string): boolean => Object.entries(known).some(([path, k]) => path !== workspace && k.partition === p);
  for (const p of new Set([known[workspace]?.partition, legacy])) {
    if (p && p !== partition && onDisk(p) && !inUse(p)) await session.fromPartition(p).clearStorageData().catch(() => undefined);
  }
  known[workspace] = { id, partition };
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(partitionsFile(), JSON.stringify(known, null, 2));
  return partition;
}

async function openWindow(workspace: string): Promise<void> {
  const partition = await partitionOf(workspace);
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
    title: `${basename(workspace)} — canvast ${app.getVersion()}`, // (the version, as the browser tab shows it)
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
  if (!(await holdWorkspace(workspace))) return app.quit();
  remember(workspace);
  await openWindow(workspace);
});

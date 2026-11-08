import { _electron as electron, chromium, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { appendFileSync, cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { createHash, scryptSync } from "node:crypto";
import { buildDir } from "./build-dir";
import { makeFakeMp4 } from "./mp4";
import { makePng } from "./png";
import { importMode, settingsRowProblems } from "./harness";
import { makeLock } from "../../src/assets/hidden-lock";
import { readZip, writeZip } from "../../src/storage/zip";

// The desktop build (ADR 0177): the snapshot's own desktop shell (test-snap builds it into <snapshot>/desktop), on a
// fresh workspace folder, with a hidden window.

/** The app on `workspace`; `device` names the app's own data folder (another one is another device with its own cache). */
async function launch(workspace: string, device = "userdata", /** Most of these tests read the tidy names on disk; the default keeps files as they are. */ keepFiles = false): Promise<{ app: ElectronApplication; page: Page; requests: string[] }> {
  const app = await electron.launch({
    args: [join(buildDir(), "desktop"), `--workspace=${workspace}`, `--user-data-dir=${workspace}-${device}`],
    // (an export outside the workspace goes to `<workspace>-exports`, standing for the folder chosen in the system's dialog)
    env: { ...process.env, CANVAST_HIDDEN: "1", CANVAST_HASH: "#debug", CANVAST_EXPORT_DIR: `${workspace}-exports`, CANVAST_NO_OPEN: "1" },
  });
  const page = await app.firstWindow();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000 });
  if (!keepFiles) await page.evaluate(() => (window.__canvastDebug.setSetting("library.keepFileNames", false), window.__canvastDebug.setSetting("library.sortFiles", true)));
  return { app, page, requests };
}

/** A hidden item's file: in its encrypted folders, named by its encrypted name (or a random `.bin` one of before, until it is placed). */
const SEALED_FILE = /^\.hidden\/(?:0?[a-z2-7]{26,}\/)*(?:0?[a-z2-7]{26,}|[0-9a-f]{32}\.bin)$/;
/** Temporary folders of these tests (`tempDir`), removed with everything named after them (`<dir>-userdata`, `<dir>-out`…) when the file ends. */
const made: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
test.afterAll(() => {
  for (const dir of made) {
    for (const n of readdirSync(tmpdir())) if (n === basename(dir) || n.startsWith(`${basename(dir)}-`)) rmSync(join(tmpdir(), n), { recursive: true, force: true });
  }
});
/** Where the boards are, inside the app's own folder. */
const B = ".canvast/boards/";
/** The workspace's files without the app's own bookkeeping (its boards included). */
const visible = (root: string): string[] => files(root).filter((f) => !f.startsWith(".canvast/") || f.startsWith(B));
const files = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(root, join(dir, e.name)) : [relative(root, join(dir, e.name))])).sort();

/** Settings > Storage > Export backup, as a person would: Electron hands the download over (to a save dialog; here, to `to`). */
async function exportBackup(app: ElectronApplication, page: Page, to: string, asked?: () => Promise<void>): Promise<Buffer> {
  await app.evaluate(({ BrowserWindow }, to) => {
    const g = globalThis as { saved?: Promise<string> };
    g.saved = new Promise((done) => BrowserWindow.getAllWindows()[0]!.webContents.session.once("will-download", (_e, item) => {
      item.setSavePath(to);
      item.once("done", (_d, state) => done(state));
    }));
  }, to);
  await page.getByTestId("save-status").click();
  await page.getByTestId("set-export-full").click();
  await asked?.(); // (what the export asks first, answered)
  expect(await app.evaluate(() => (globalThis as { saved?: Promise<string> }).saved)).toBe("completed");
  return readFileSync(to);
}

test("the desktop page is sandboxed: no Node, no path outside the workspace folder, nothing from the network", async () => {
  const ws = tempDir("canvast-ws-");
  const outside = tempDir("canvast-out-");
  symlinkSync(outside, join(ws, "link-out")); // a link inside the workspace that leads out of it
  const { app, page, requests } = await launch(ws);
  try {
    expect(page.url()).toBe("app://canvast/#debug");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle())).toMatch(new RegExp(`^${ws.split("/").pop()} — canvast \\d+\\.\\d+\\.\\d+$`));
    expect(await page.evaluate(() => [typeof (globalThis as { require?: unknown }).require, typeof (globalThis as { process?: unknown }).process])).toEqual(["undefined", "undefined"]);
    expect(await page.evaluate(() => window.canvastDesktop!.workspace())).toEqual({ path: ws, name: ws.split("/").pop() });
    const refused = await page.evaluate(async () => {
      const b = window.canvastDesktop!;
      const bytes = new Uint8Array([1, 2, 3]);
      const tries: Array<[string, () => Promise<unknown>]> = [
        ["../escape.txt", () => b.write("../escape.txt", bytes)],
        ["/abs", () => b.write("/tmp/canvast-abs.txt", bytes)],
        ["dots", () => b.write("library/../../escape.txt", bytes)],
        ["link", () => b.write("link-out/escape.txt", bytes)],
        ["read link", () => b.read("link-out/x")],
      ];
      const out: string[] = [];
      for (const [name, f] of tries) await f().then(() => out.push(`${name}: allowed`), () => out.push(`${name}: refused`));
      return out;
    });
    expect(refused).toEqual(["../escape.txt: refused", "/abs: refused", "dots: refused", "link: refused", "read link: refused"]);
    // Many writes of one file at once (hidden.json while hidden files move) all land: each has its own temporary file.
    expect(await page.evaluate(() => Promise.allSettled(Array.from({ length: 40 }, (_, i) => window.canvastDesktop!.write("burst.json", new Uint8Array([i])))).then((r) => r.filter((x) => x.status === "rejected").length))).toBe(0);
    expect(readdirSync(ws).filter((n) => n.startsWith("burst.json"))).toEqual(["burst.json"]);
    expect(readdirSync(outside)).toEqual([]);
    expect(await page.evaluate(() => fetch("https://example.com/").then(() => "fetched", () => "blocked"))).toBe("blocked");
    expect(requests.filter((u) => !/^(app|data|blob):/.test(u))).toEqual([]);
  } finally {
    await app.close();
  }
});

test("library files are readable files under library/: the same bytes once, -2 on a name clash, read back after a restart", async () => {
  const ws = tempDir("canvast-ws-");
  const red = makePng(3, 2, () => [220, 30, 30, 255]);
  const blue = makePng(3, 2, () => [30, 30, 220, 255]);
  let { app, page } = await launch(ws);
  try {
    for (const buffer of [red, red, blue]) {
      const before = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.reduce((n, e) => n + e.instances, 0)));
      await page.getByTestId("import-input").setInputFiles({ name: "Hand Study (Loomis).PNG", mimeType: "image/png", buffer });
      await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.reduce((n, e) => n + e.instances, 0)))).toBe(before + 1);
    }
    expect(files(ws).filter((f) => f.startsWith("library/"))).toEqual(["library/images/hand_study-loomis-2.png", "library/images/hand_study-loomis.png"]);
    expect(readFileSync(join(ws, "library/images/hand_study-loomis.png")).equals(red)).toBe(true);
    expect(readFileSync(join(ws, "library/images/hand_study-loomis-2.png")).equals(blue)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.saveStatus()), { timeout: 5000 }).toBe("verified"); // (the placed pictures are saved before closing)
  } finally {
    await app.close();
  }
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.instances, e.present]).sort())), { timeout: 10_000 }).toEqual([[1, true], [2, true]]);
    expect(await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.missing.length))).toBe(0);
    expect(existsSync(join(ws, ".trash"))).toBe(false);
    // Deleted everywhere: the file stays while undo on the open canvas could bring its picture back...
    const hashOf = (n: number) => page.evaluate((k) => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.instances === k)!.hash), n);
    const blueHash = await hashOf(1);
    expect(await page.evaluate((h) => window.__canvastDebug.deleteEverywhere([h]), blueHash)).toBe(1);
    expect(files(ws).filter((f) => f.startsWith("library/"))).toContain("library/images/hand_study-loomis-2.png");
    // ...unless Settings > Storage says "Delete library files at once": then it goes to .trash with the next delete.
    const redHash = await hashOf(2);
    await page.evaluate(() => window.__canvastDebug.setSetting("storage.deleteAtOnce", true));
    expect(await page.evaluate((h) => window.__canvastDebug.deleteEverywhere([h]), redHash)).toBe(1);
    await expect.poll(() => files(ws).filter((f) => f.startsWith("library/") || f.startsWith(".trash/")).sort()).toEqual([".trash/library/images/hand_study-loomis-2.png", ".trash/library/images/hand_study-loomis.png"]);
  } finally {
    await app.close();
  }
});

test("boards are folders of .canvast/boards/ and canvases .cvst files: safe names, -2 on a clash, renames move them, a deleted canvas goes to .trash, closing writes the last change", async () => {
  const ws = tempDir("canvast-ws-");
  let { app, page } = await launch(ws);
  const tree = () => page.evaluate(() => window.__canvastDebug.session().tree!);
  const op = (...a: Parameters<typeof window.__canvastDebug.workspaceOp>) => page.evaluate((a) => window.__canvastDebug.workspaceOp(...a), a);
  try {
    await expect.poll(async () => (await tree()).length).toBe(1);
    let t = await tree();
    await op("renameBoard", t[0]!.id, "Sketches");
    await op("renameCanvas", t[0]!.canvases[0]!.id, "Characters");
    await op("newCanvas", t[0]!.id);
    t = await tree();
    await op("renameCanvas", t[0]!.canvases[1]!.id, "characters");
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(visible(ws)).toEqual([`${B}sketches/characters-2.cvst`, `${B}sketches/characters.cvst`]);
    const wsFile = JSON.parse(readFileSync(join(ws, ".canvast/workspace.json"), "utf8"));
    expect(wsFile.boards.map((b: { name: string; folder: string }) => [b.name, b.folder])).toEqual([["Sketches", `${B}sketches`]]);
    await op("renameBoard", t[0]!.id, "Drawings");
    await op("deleteCanvas", t[0]!.canvases[1]!.id);
    // the last change, not flushed: closing the window writes it
    await page.getByTestId("import-input").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: makePng(2, 2, () => [0, 0, 0, 255]) });
    // (stored, not only "verified": right after an import the save status can still be the one from before)
    await expect.poll(() => page.evaluate((id) => window.__canvastDebug.storedObjectIds(id).then((ids) => ids.length), t[0]!.canvases[0]!.id)).toBe(1);
  } finally {
    await app.close();
  }
  expect(visible(ws)).toEqual([`${B}drawings/characters.cvst`, `.trash/${B}drawings/characters-2.cvst`, "library/images/dot.png"]);
  const canvas = JSON.parse(readFileSync(join(ws, `${B}drawings/characters.cvst`), "utf8"));
  expect([canvas.format, canvas.objects.length, canvas.objects[0].kind]).toEqual(["canvast-canvas", 1, "image"]);
  // Dated when it went into .trash (a move keeps a file's own date): Empty .trash after counts from then.
  const trashed = join(ws, `.trash/${B}drawings/characters-2.cvst`);
  expect(Date.now() - statSync(trashed).mtimeMs).toBeLessThan(120_000);
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(async () => (await tree()).map((b) => [b.name, b.canvases.map((c) => [c.name, c.objectCount])])).toEqual([["Drawings", [["Characters", 1]]]]);
    // Settings > Storage, "Delete it permanently": the next deleted canvas leaves nothing, in .trash or anywhere.
    await page.evaluate(() => window.__canvastDebug.setSetting("storage.deleteTo", "erase"));
    const b = (await tree())[0]!.id;
    await op("newCanvas", b);
    await op("renameCanvas", (await tree())[0]!.canvases[1]!.id, "Scrap");
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(existsSync(join(ws, `${B}drawings/scrap.cvst`))).toBe(true);
    await op("deleteCanvas", (await tree())[0]!.canvases[1]!.id);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(visible(ws)).toEqual([`${B}drawings/characters.cvst`, `.trash/${B}drawings/characters-2.cvst`, "library/images/dot.png"]);
    // Settings > Storage, "Empty .trash after" 30 days: at the next start, what went there 40 days ago is gone.
    await page.evaluate(() => window.__canvastDebug.setSetting("storage.trashDays", "30"));
  } finally {
    await app.close();
  }
  const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000);
  utimesSync(trashed, fortyDaysAgo, fortyDaysAgo);
  // A workspace written before the boards moved into .canvast/boards/ (at the top): they are moved in, and open as before.
  renameSync(join(ws, `${B}drawings`), join(ws, "drawings"));
  const wsFile = join(ws, ".canvast/workspace.json");
  writeFileSync(wsFile, readFileSync(wsFile, "utf8").replaceAll(B, ""));
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(async () => (await tree()).map((b) => [b.name, b.canvases.map((c) => [c.name, c.objectCount])])).toEqual([["Drawings", [["Characters", 1]]]]);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(visible(ws).filter((f) => f.endsWith(".cvst") && !f.startsWith(".trash/"))).toEqual([`${B}drawings/characters.cvst`]);
    expect(existsSync(join(ws, "drawings"))).toBe(false);
    await expect.poll(() => existsSync(trashed), { timeout: 10_000 }).toBe(false);
  } finally {
    await app.close();
  }
});

test("the folder is the truth: a new device opens the whole workspace, another device's change is read at start-up, edits on both sides keep both", async () => {
  const ws = tempDir("canvast-ws-");
  // What each canvas holds in the app's storage (the stored objects, not the tree's cached counts).
  const counts = (p: Page) =>
    p.evaluate(async () => {
      const d = window.__canvastDebug;
      const rows = d.session().tree!.flatMap((b) => b.canvases.map((c) => ({ board: b.name, name: c.name, id: c.id })));
      return (await Promise.all(rows.map(async (r) => [r.board, r.name, (await d.storedObjectIds(r.id)).length] as [string, string, number]))).sort();
    });
  let shade = 0;
  // Each picture is a new object (a new id), so a count says whose edits a canvas holds.
  const total = async (p: Page): Promise<number> => (await counts(p)).reduce((n, r) => n + r[2], 0);
  const add = async (p: Page, n: number): Promise<void> => {
    const before = await total(p);
    for (let i = 0; i < n; i++) {
      const v = 10 + 20 * shade++;
      await p.getByTestId("import-input").setInputFiles({ name: `p${v}.png`, mimeType: "image/png", buffer: makePng(2, 2, () => [v, v, v, 255]) });
    }
    await expect.poll(() => total(p)).toBe(before + n); // (stored: a save status alone may still be the one from before)
  };
  const ready = async (p: Page): Promise<void> => void (await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.session().tree?.length ?? 0))).toBeGreaterThan(0));

  let a = await launch(ws, "device-a");
  await ready(a.page);
  const t = await a.page.evaluate(() => window.__canvastDebug.session().tree!);
  await a.page.evaluate(([b, c]) => window.__canvastDebug.workspaceOp("renameBoard", b, "Sketches").then(() => window.__canvastDebug.workspaceOp("renameCanvas", c, "Characters")), [t[0]!.id, t[0]!.canvases[0]!.id] as [string, string]);
  await add(a.page, 3);
  // Settings: the workspace's go with the folder (in workspace.json), a device's stay on it.
  const setting = (p: Page, k: string) => p.evaluate((key) => window.__canvastDebug.getSetting(key), k);
  await a.page.evaluate(() => (window.__canvastDebug.setSetting("notes.folder", "Journal"), window.__canvastDebug.setSetting("pen.widthPx", 9)));
  await a.page.evaluate(() => window.__canvastDebug.flushStorage());
  const filed = () => (JSON.parse(readFileSync(join(ws, ".canvast/workspace.json"), "utf8")) as { settings?: Record<string, unknown> }).settings?.["notes.folder"];
  await expect.poll(filed, { timeout: 20_000 }).toBe("Journal");
  await a.app.close();

  // A new device (its own empty cache) on the same folder: the whole workspace, as the folder has it.
  let b = await launch(ws, "device-b");
  await ready(b.page);
  await expect.poll(() => counts(b.page)).toEqual([["Sketches", "Characters", 3]]);
  await expect.poll(() => setting(b.page, "notes.folder")).toBe("Journal");
  expect(await setting(b.page, "pen.widthPx")).toBe(3);
  await b.page.evaluate(() => window.__canvastDebug.setSetting("notes.folder", "Diary"));
  await add(b.page, 2);
  await b.page.evaluate(() => window.__canvastDebug.flushStorage());
  await expect.poll(filed, { timeout: 20_000 }).toBe("Diary");
  await b.app.close();

  // The first device reads the other one's change at start-up.
  a = await launch(ws, "device-a");
  await ready(a.page);
  await expect.poll(() => counts(a.page)).toEqual([["Sketches", "Characters", 5]]);
  await expect.poll(() => setting(a.page, "notes.folder")).toBe("Diary");
  expect(await setting(a.page, "pen.widthPx")).toBe(9);
  await add(a.page, 1);
  await a.app.process().kill("SIGKILL"); // its edit is in its cache, not yet in the folder

  b = await launch(ws, "device-b");
  await ready(b.page);
  await add(b.page, 2);
  await b.app.close();

  // Both changed the canvas: the folder's version is kept, and this device's beside it as a conflict copy.
  a = await launch(ws, "device-a");
  await ready(a.page);
  await expect.poll(async () => (await counts(a.page)).map(([bn, cn, n]) => [bn, cn.replace(/\(conflict [^)]*\)/, "(conflict)"), n])).toEqual([
    ["Sketches", "Characters (conflict)", 6],
    ["Sketches", "Characters", 7],
  ]);
  await a.page.evaluate(() => window.__canvastDebug.flushStorage());
  await a.app.close();
  expect(files(ws).filter((f) => f.endsWith(".cvst")).map((f) => f.replace(/conflict_[0-9_-]+/, "conflict"))).toEqual([`${B}sketches/characters-conflict.cvst`, `${B}sketches/characters.cvst`]);

  // Device B adds a canvas and a library item while this device changes the boards and the library too: the sync tool keeps this
  // device's workspace.json and library files, and puts B's beside them (`workspace (1).json`, `items-x (1).json`). At start-up the
  // canvas and the item B added are taken from the copies, which then go to .trash/.
  const lib = (): Map<string, Buffer> => new Map(files(ws).filter((f) => f.startsWith(".canvast/library/") || f === ".canvast/workspace.json").map((f) => [f, readFileSync(join(ws, f))]));
  const kept = lib();
  b = await launch(ws, "device-b");
  await ready(b.page);
  await b.page.evaluate((bid) => window.__canvastDebug.workspaceOp("newCanvas", bid), t[0]!.id);
  const poses = await b.page.evaluate(() => window.__canvastDebug.session().tree![0]!.canvases.find((c) => !c.name.startsWith("Characters"))!.id);
  await b.page.evaluate((c) => window.__canvastDebug.workspaceOp("renameCanvas", c, "Poses"), poses);
  await add(b.page, 1);
  await b.page.evaluate(() => window.__canvastDebug.flushStorage());
  await b.app.close();
  for (const [f, was] of lib()) {
    if (kept.get(f)?.equals(was)) continue;
    renameSync(join(ws, f), join(ws, f.replace(/\.json$/, " (1).json")));
    if (kept.has(f)) writeFileSync(join(ws, f), kept.get(f)!);
  }
  expect(files(ws).filter((f) => f.includes(" (1).json")).length).toBeGreaterThanOrEqual(2); // (workspace.json and a part, at least)
  a = await launch(ws, "device-a");
  await ready(a.page);
  await expect.poll(async () => (await counts(a.page)).map(([bn, cn, n]) => [bn, cn.replace(/\(conflict [^)]*\)/, "(conflict)"), n])).toEqual([
    ["Sketches", "Characters (conflict)", 6],
    ["Sketches", "Characters", 7],
    ["Sketches", "Poses", 1],
  ]);
  await expect.poll(() => a.page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length)), { timeout: 15_000 }).toBe(shade); // (taken from the copy after start-up)
  await a.page.evaluate(() => window.__canvastDebug.flushStorage());
  await a.app.close();
  expect(files(ws).filter((f) => f.startsWith(".canvast/") && f.includes(" (1).json"))).toEqual([]);
  expect(files(ws).filter((f) => f.startsWith(".trash/") && f.endsWith(" (1).json")).length).toBeGreaterThanOrEqual(2);
  expect(JSON.parse(readFileSync(join(ws, ".canvast/workspace.json"), "utf8")).boards[0].canvases.map((c: { name: string }) => c.name)).toContain("Poses");

  // A canvas file that does not read whole (a newer header, the rest cut off: damaged, or still arriving): the workspace still opens,
  // this device's copy of the canvas stays, and the file is not written over.
  const poseFile = join(ws, `${B}sketches/poses.cvst`);
  const cut = readFileSync(poseFile, "utf8").replace(/"revision":(\d+)/, (_m, r) => `"revision":${Number(r) + 5}`).slice(0, 400);
  writeFileSync(poseFile, cut);
  a = await launch(ws, "device-a");
  await ready(a.page);
  await expect.poll(() => counts(a.page).then((c) => c.find((r) => r[1] === "Poses"))).toEqual(["Sketches", "Poses", 1]);
  await a.page.evaluate(() => window.__canvastDebug.flushStorage());
  await a.app.close();
  expect(readFileSync(poseFile, "utf8")).toBe(cut);

  // Last written by a newer canvast on another device: this one says to update (once).
  const wsJson = JSON.parse(readFileSync(join(ws, ".canvast/workspace.json"), "utf8")) as { app?: string };
  expect(wsJson.app).toMatch(/^\d+\.\d+\.\d+$/); // (the version that wrote it)
  writeFileSync(join(ws, ".canvast/workspace.json"), JSON.stringify({ ...wsJson, app: "99.0.0" }));
  a = await launch(ws, "device-a");
  await ready(a.page);
  await expect(a.page.getByTestId("toast")).toContainText("newer than this one", { timeout: 15_000 });
  await a.app.close();

  // The folder deleted and a new, empty one made at the same path: a new workspace, nothing of the old one's cache.
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws);
  a = await launch(ws, "device-a");
  await ready(a.page);
  expect(await counts(a.page)).toEqual([[expect.any(String), expect.any(String), 0]]);
  await a.app.close();
});

test("library folders are real folders: filing or renaming an item moves its file, undo moves it back, library.json brings the library to a new device", async () => {
  const ws = tempDir("canvast-ws-");
  const red = makePng(3, 2, () => [220, 30, 30, 255]);
  const blue = makePng(3, 2, () => [30, 30, 220, 255]);
  let { app, page } = await launch(ws);
  const lib = (...a: Parameters<typeof window.__canvastDebug.libraryOp>) => page.evaluate((a) => window.__canvastDebug.libraryOp(...a), a);
  const flush = () => page.evaluate(() => window.__canvastDebug.flushStorage());
  const libraryFiles = () => files(ws).filter((f) => f.startsWith("library/"));
  try {
    for (const [name, buffer] of [["Hand Study.png", red], ["Pose.png", blue]] as const) {
      await page.getByTestId("import-input").setInputFiles({ name, mimeType: "image/png", buffer });
      await expect.poll(() => page.evaluate((n) => window.__canvastDebug.assetListing().then((l) => l.entries.some((e) => e.name === n)), name)).toBe(true);
    }
    const hashOf = (name: string) => page.evaluate((n) => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.name === n)!.hash), name);
    const [r, b] = [await hashOf("Hand Study.png"), await hashOf("Pose.png")];
    await lib("createFolder", "f1", "Refs: Hands?");
    await lib("createFolder", "f2", "Sub", "f1");
    await flush();
    expect(libraryFiles()).toEqual(["library/images/hand_study.png", "library/images/pose.png"]);
    expect(existsSync(join(ws, "library/refs-hands/sub"))).toBe(true); // (an empty library folder is a folder too)

    // Filed: the file moves into the folder's path; renamed onto the name it left: the other file takes that name.
    await lib("file", r, "f2");
    await lib("rename", b, "Hand Study.png");
    await flush();
    expect(libraryFiles()).toEqual(["library/images/hand_study.png", "library/refs-hands/sub/hand_study.png"]);
    expect(readFileSync(join(ws, "library/refs-hands/sub/hand_study.png")).equals(red)).toBe(true);
    expect(readFileSync(join(ws, "library/images/hand_study.png")).equals(blue)).toBe(true);

    // The library's undo puts both back, and so the files.
    await lib("undo");
    await lib("undo");
    await flush();
    expect(libraryFiles()).toEqual(["library/images/hand_study.png", "library/images/pose.png"]);
    expect(readFileSync(join(ws, "library/images/hand_study.png")).equals(red)).toBe(true);

    // A renamed folder is renamed on disk; the old one, emptied, goes.
    await lib("redo");
    await lib("renameFolder", "f1", "Anatomy");
    await flush();
    expect(libraryFiles()).toEqual(["library/anatomy/sub/hand_study.png", "library/images/pose.png"]);
    expect(existsSync(join(ws, "library/refs-hands"))).toBe(false);
    expect(await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.every((e) => e.present)))).toBe(true);
    // The library is kept in parts (by the first two hex digits of each hash: 256 at most), with an index naming them (version 3);
    // library.json stays as a copy for older apps.
    const index = JSON.parse(readFileSync(join(ws, ".canvast/library/index.json"), "utf8")) as { version: number; parts: string[]; folders: unknown[] };
    expect(index.folders.length).toBe(2);
    expect([index.version, index.parts.every((k) => /^[0-9a-f]{2}$/.test(k))]).toEqual([3, true]);
    const inParts = index.parts.flatMap((k) => (JSON.parse(readFileSync(join(ws, `.canvast/library/items-${k}.json`), "utf8")) as { items: { name: string }[] }).items.map((i) => i.name));
    expect(inParts.sort()).toEqual(["Hand Study.png", "Pose.png"]);
    const json = readFileSync(join(ws, ".canvast/library.json"), "utf8");
    expect(JSON.parse(json).copyOf).toBe(".canvast/library");
    expect(JSON.parse(json).items.map((i: { name: string; file: string; folderId: string | null }) => [i.name, i.file, i.folderId]).sort()).toEqual([
      ["Hand Study.png", "library/anatomy/sub/hand_study.png", "f2"],
      ["Pose.png", "library/images/pose.png", null],
    ]);
    // Show in file manager (the details, and the item's right-click menu): the system is asked to show that very file in its folder.
    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { shown: string[] };
      g.shown = [];
      shell.showItemInFolder = (path: string) => void g.shown.push(path);
    });
    const shown = () => app.evaluate(() => (globalThis as unknown as { shown: string[] }).shown);
    await page.getByTestId("view-assets").click();
    await page.locator('[data-testid="asset-card"][aria-label^="Hand Study.png"]').click();
    await page.getByTestId("asset-show-file").click();
    await expect.poll(shown).toEqual([join(ws, "library/anatomy/sub/hand_study.png")]);
    await page.locator('[data-testid="asset-card"][aria-label^="Pose.png"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: "Show in file manager" }).click();
    await expect.poll(shown).toEqual([join(ws, "library/anatomy/sub/hand_study.png"), join(ws, "library/images/pose.png")]);
  } finally {
    await app.close();
  }
  // Another device (its own empty cache), on a workspace of an earlier version (library.json only): the library as the folder has it,
  // names, folders and files; then the parts are written.
  rmSync(join(ws, ".canvast/library"), { recursive: true });
  const unmarked = JSON.parse(readFileSync(join(ws, ".canvast/library.json"), "utf8")) as { copyOf?: string; items: { name: string }[] };
  delete unmarked.copyOf;
  writeFileSync(join(ws, ".canvast/library.json"), JSON.stringify(unmarked));
  ({ app, page } = await launch(ws, "device-b"));
  try {
    const listing = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => [l.folders.map((f) => f.name).sort(), l.entries.map((e) => [e.name, e.folderIds?.[0] ?? null, e.present]).sort()]));
    await expect.poll(listing, { timeout: 10_000 }).toEqual([
      ["Anatomy", "Sub"],
      [["Hand Study.png", "f2", true], ["Pose.png", null, true]],
    ]);
    await expect.poll(async () => (await page.evaluate(() => window.__canvastDebug.flushStorage()), existsSync(join(ws, ".canvast/library/index.json"))), { timeout: 10_000 }).toBe(true);
    // An older app on a third device renames an item in library.json (it knows no parts): taken here, while the app runs.
    const old = JSON.parse(readFileSync(join(ws, ".canvast/library.json"), "utf8")) as { copyOf?: string; items: { name: string }[] };
    delete old.copyOf;
    old.items.find((i) => i.name === "Pose.png")!.name = "Pose (renamed).png";
    writeFileSync(join(ws, ".canvast/library.json"), JSON.stringify(old));
    await expect.poll(listing, { timeout: 10_000 }).toEqual([
      ["Anatomy", "Sub"],
      [["Hand Study.png", "f2", true], ["Pose (renamed).png", null, true]],
    ]);
  } finally {
    await app.close();
  }
});

test("a big library (past the size library.json is kept for) writes only what changed: a rename rewrites its item's part, nothing else", async () => {
  const ws = tempDir("canvast-ws-");
  let { app, page } = await launch(ws);
  const parts = () => new Map(files(ws).filter((f) => /^\.canvast\/library\/items-[0-9a-f]{2}\.json$/.test(f)).map((f) => [f, readFileSync(join(ws, f), "utf8")]));
  const listing = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, e.present]).sort()));
  const pics = [1, 2, 3, 4, 5, 6].map((k) => makePng(k, 3, () => [k * 30, 200 - k * 20, 90, 255]));
  try {
    await page.evaluate(() => window.__canvastDebug.libraryTesting({ compatMax: 0 })); // (as if past 10,000 items)
    await page.getByTestId("import-input").setInputFiles(pics.map((buffer, k) => ({ name: `Pic ${k}.png`, mimeType: "image/png", buffer })));
    await expect.poll(() => listing().then((l) => l.length)).toBe(6);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(existsSync(join(ws, ".canvast/library.json"))).toBe(false); // (not kept past the limit)
    const before = parts();
    const hash = createHash("sha256").update(pics[2]!).digest("hex");
    await page.evaluate((h) => window.__canvastDebug.libraryOp("rename", h, "Renamed One.png"), hash);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    const after = parts();
    const changed = [...after.keys()].filter((f) => after.get(f) !== before.get(f));
    expect(changed).toEqual([`.canvast/library/items-${hash.slice(0, 2)}.json`]);
    expect(after.get(changed[0]!)).toContain("Renamed One.png");
    expect(existsSync(join(ws, "library/images/renamed_one.png"))).toBe(true);
    // Check library files (command palette): every file read and compared with its item; one damaged, one gone, both named.
    writeFileSync(join(ws, "library/images/pic_0.png"), Buffer.from("not the picture any more"));
    rmSync(join(ws, "library/images/pic_1.png"));
    await page.keyboard.press("Control+k");
    await page.locator(".palette-input").fill("check library files");
    await expect(page.locator(".palette-title").first()).toHaveText("Check library files");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toast")).toContainText("Checked 6 library files: 1 changed or damaged (“Pic 0.png”); 1 missing (“Pic 1.png”)", { timeout: 15_000 });
    // The quick check looks at sizes only: the same two are found without reading anything.
    await page.keyboard.press("Control+k");
    await page.locator(".palette-input").fill("check library files quick");
    await expect(page.locator(".palette-title").first()).toHaveText("Check library files (quick)");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toast")).toContainText("Quick check of 6 library files: 1 changed or damaged (“Pic 0.png”); 1 missing (“Pic 1.png”)", { timeout: 15_000 });
  } finally {
    await app.close();
  }
  // Another device reads the whole library from the parts: the file saved again above is followed (its item is the new version, as an
  // item's file changed outside the app always is), the one removed is missing.
  ({ app, page } = await launch(ws, "device-b"));
  try {
    await expect.poll(listing, { timeout: 15_000 }).toEqual([["Pic 0.png", true], ["Pic 1.png", false], ...["Renamed One.png", "Pic 3.png", "Pic 4.png", "Pic 5.png"].map((n) => [n, true])].sort());
    // Listed a page at a time (as if past 20,000 items: the library never comes to the page whole): the same cards, missing ones marked,
    // the same search, and an item picked shows its details; a rename shows on its card.
    await page.evaluate(() => window.__canvastDebug.libraryPaging(1));
    await page.getByTestId("view-assets").click();
    await expect(page.getByTestId("assets-count")).toHaveText("6 items");
    const names = () => page.locator('[data-testid="asset-card"] .asset-name').allTextContents().then((n) => n.sort());
    await expect.poll(names).toEqual(["Pic 0.png", "Pic 1.png", "Pic 3.png", "Pic 4.png", "Pic 5.png", "Renamed One.png"]);
    await expect(page.locator('[data-testid="asset-card"].is-missing')).toHaveCount(1);
    await page.getByTestId("assets-search").fill("renamed");
    await expect(page.getByTestId("assets-count")).toHaveText("1 of 6 items");
    await page.getByTestId("asset-card").first().click();
    await expect(page.getByTestId("asset-inspector")).toContainText("Renamed One.png");
    await page.evaluate((h) => window.__canvastDebug.libraryOp("rename", h, "Again.png"), createHash("sha256").update(pics[2]!).digest("hex"));
    await page.getByTestId("assets-search").fill("");
    await expect.poll(names).toEqual(["Again.png", "Pic 0.png", "Pic 1.png", "Pic 3.png", "Pic 4.png", "Pic 5.png"]);
    // A property: suggested and sorted by where the library is, too.
    const setProp = async (name: string, key: string, value: string): Promise<void> => {
      await page.locator(`[data-testid="asset-card"][title="${name}"]`).click();
      await page.getByTestId("asset-field-add").click();
      await page.locator(".field-key").last().fill(key);
      await page.locator(".field-value").last().fill(value);
      await page.locator(".field-value").last().blur();
      await expect(page.locator(".field-value").last()).toHaveValue(value);
    };
    await setProp("Pic 3.png", "rank", "10");
    await setProp("Pic 4.png", "rank", "9");
    await page.locator('[data-testid="asset-card"][title="Pic 5.png"]').click();
    await page.getByTestId("asset-field-add").click();
    await page.locator(".field-key").last().fill("rank");
    await page.locator(".field-value").last().focus();
    await expect.poll(() => page.getByTestId("field-value-suggest").locator("option").evaluateAll((l) => l.map((o) => (o as HTMLOptionElement).value).sort())).toEqual(["10", "9"]);
    await page.getByTestId("assets-sort").selectOption("prop:rank");
    await expect.poll(() => page.locator('[data-testid="asset-card"] .asset-name').allTextContents().then((n) => n.slice(0, 2))).toEqual(["Pic 4.png", "Pic 3.png"]);
    // A list's items stay whole: in the library's files, and read again.
    await page.locator('[data-testid="asset-card"][title="Pic 3.png"]').click();
    await page.getByTestId("asset-field-add").click();
    await page.locator(".field-key").last().fill("aliases");
    await page.locator(".field-key").last().blur();
    await page.getByLabel("Add an item to aliases").fill("Smith, John");
    await page.keyboard.press("Enter");
    await expect.poll(() => readdirSync(join(ws, ".canvast", "library")).some((f) => readFileSync(join(ws, ".canvast", "library", f), "utf8").includes('"items":["Smith, John"]')), { timeout: 15000 }).toBe(true);
    await page.reload();
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
    await page.getByTestId("view-assets").click();
    await page.locator('[data-testid="asset-card"][title="Pic 3.png"]').click();
    await expect(page.locator(".field-item")).toHaveText(["Smith, John×"]);
  } finally {
    await app.close();
  }
});

/** A note long enough that the hidden items' index is past the 4 KiB a key file was once read up to (it was then skipped). */
const LONG_NOTE = "From the life class. ".repeat(300).trim();
/** A few dozen small pictures, each its own content. */
const MANY = Array.from({ length: 24 }, (_, k) => makePng(3, 2, () => [k * 9, 255 - k * 7, 100, 255]));
const MANY_HASHES = MANY.map((b) => createHash("sha256").update(b).digest("hex"));
/** A name whose encrypted form is near the 255 bytes a file name may have: a temporary name made from it went past them (ENAMETOOLONG). */
const LONG_NAME = `${"Secret Plan of the long study ".repeat(4).trim()}.png`;

test("away and back on the desktop: a backup updates another workspace folder and comes home: one set of boards, the changes made there, home's own change kept beside", async () => {
  const pic = makePng(4, 3, () => [20, 120, 220, 255]);
  const hash = createHash("sha256").update(pic).digest("hex");
  const shape = (page: Page) => page.evaluate(() => window.__canvastDebug.session().tree!.map((b) => [b.name, b.canvases.map((c) => c.name)]));
  const note = (page: Page) => page.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.hash === h)?.note ?? null), hash);
  const importAs = async (app: ElectronApplication, page: Page, buffer: Buffer): Promise<void> => {
    await page.getByTestId("save-status").click();
    await page.getByTestId("set-import-input").setInputFiles({ name: "backup.canvast", mimeType: "application/zip", buffer });
    await importMode(page, "update");
    await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), page.getByTestId("confirm-ok").click()]);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000 });
    await expect(page.getByTestId("toast")).toContainText(/Imported/);
  };
  const homeWs = tempDir("cv-home-");
  let { app, page } = await launch(homeWs);
  let homeBackup: Buffer;
  try {
    await page.getByTestId("import-input").setInputFiles({ name: "Ref.png", mimeType: "image/png", buffer: pic });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
    await page.evaluate((h) => window.__canvastDebug.libraryOp("note", h, "at home"), hash);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    homeBackup = await exportBackup(app, page, `${homeWs}-home.canvast`);
  } finally {
    await app.close();
  }
  const awayWs = tempDir("cv-away-");
  ({ app, page } = await launch(awayWs, "away-userdata"));
  let awayBackup: Buffer;
  try {
    await importAs(app, page, homeBackup);
    const id = await page.evaluate(() => window.__canvastDebug.session().tree![0]!.canvases[0]!.id);
    await page.evaluate((c) => window.__canvastDebug.workspaceOp("renameCanvas", c, "Studies"), id);
    await page.evaluate((h) => window.__canvastDebug.libraryOp("note", h, "changed away"), hash);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    awayBackup = await exportBackup(app, page, `${awayWs}-away.canvast`);
  } finally {
    await app.close();
  }
  ({ app, page } = await launch(homeWs));
  try {
    // Home, meanwhile: its canvas changed since its backup.
    await page.getByTestId("import-input").setInputFiles({ name: "Other.png", mimeType: "image/png", buffer: makePng(2, 2, () => [200, 200, 20, 255]) });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(2);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await importAs(app, page, awayBackup);
    await expect.poll(() => shape(page).then((t) => t.length)).toBe(1);
    expect((await shape(page))[0]![1]).toEqual(expect.arrayContaining(["Studies", expect.stringMatching(/\(conflict /)]));
    await expect.poll(() => note(page)).toBe("changed away");
  } finally {
    await app.close();
  }
});

test("hidden items, browser to desktop: a browser backup's hidden item (readable, marked hidden) comes in hidden, with its note and the date it came", async () => {
  const pic = makePng(5, 3, () => [200, 60, 120, 255]);
  const hash = createHash("sha256").update(pic).digest("hex");
  const at = 1_700_000_000_000;
  // A backup as the browser makes one: the item's file readable in it, with what the library says of it (hidden, its note and date).
  const src = tempDir("cv-browser-");
  let { app, page } = await launch(src);
  let made: Buffer;
  try {
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-import-input").setInputFiles({ name: LONG_NAME, mimeType: "image/png", buffer: pic });
    // (many more, as a real backup has: all encrypted in the import, none left for after the start, each with the date it came)
    await page.getByTestId("assets-import-input").setInputFiles(MANY.map((b, k) => ({ name: `many ${k}.png`, mimeType: "image/png", buffer: b })));
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length))).toBe(1 + MANY.length);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await page.getByTestId("view-canvas").click();
    const plain = await exportBackup(app, page, `${src}-plain.canvast`);
    const z = await readZip(new Blob([new Uint8Array(plain)]));
    const man = JSON.parse(await z.get("manifest.json")!.data.text()) as { assets: Array<Record<string, unknown>> };
    Object.assign(man.assets.find((a) => a["hash"] === hash)!, { hidden: true, note: LONG_NOTE, importedAt: at });
    for (const [k, h] of MANY_HASHES.entries()) Object.assign(man.assets.find((a) => a["hash"] === h)!, { hidden: true, importedAt: at - (k + 1) * 60_000 });
    made = Buffer.from(await (await writeZip([...z.values()].map((e) => ({ name: e.name, data: e.name === "manifest.json" ? new Blob([JSON.stringify(man)]) : e.data })))).arrayBuffer());
  } finally {
    await app.close();
  }
  const ws = tempDir("cv-from-browser-");
  ({ app, page } = await launch(ws));
  try {
    expect((await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"))).ok).toBe(true);
    await page.evaluate(() => window.__canvastDebug.setSetting("library.hiddenNamesOff", true)); // (blanked while locked: they must come back)
    await page.evaluate(() => window.__canvastDebug.hiddenOp("lock"));
    await page.getByTestId("save-status").click();
    await page.getByTestId("set-import-input").setInputFiles({ name: "browser.canvast", mimeType: "application/zip", buffer: made });
    await importMode(page);
    await page.getByTestId("confirm-ok").click();
    // Readable in the backup, locked here: its password is asked, and it is encrypted in the import, before the app starts again.
    await page.getByTestId("prompt-input").fill("pw");
    await Promise.all([page.waitForEvent("load", { timeout: 60_000 }), page.getByTestId("prompt-ok").click()]);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000 });
    expect(files(ws).filter((f) => f.startsWith(".hidden/") && !f.startsWith(".hidden/thumbnails/") && !f.endsWith(".name") && !f.endsWith("/"))).toHaveLength(1 + MANY.length);
    expect(files(ws).filter((f) => f.startsWith("library/") && f.endsWith(".png"))).toEqual([]);
    expect((await page.evaluate(() => window.__canvastDebug.hiddenOp("check", "pw"))).ok).toBe(true);
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.hash === h).map((e) => [!!e.hidden, e.note ?? "", e.importedAt])), hash), { timeout: 15_000 }).toEqual([[true, LONG_NOTE, at]]);
    expect(await page.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.hash === h)?.name), hash)).toBe(LONG_NAME);
  } finally {
    await app.close();
  }
  // Started again (locked: its details blanked here), then opened: all of them back from the sealed index.
  ({ app, page } = await launch(ws));
  try {
    expect((await page.evaluate(() => window.__canvastDebug.hiddenOp("check", "pw"))).ok).toBe(true);
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.hash === h).map((e) => [e.name, !!e.hidden, e.note ?? "", e.importedAt])), hash), { timeout: 15_000 }).toEqual([[LONG_NAME, true, LONG_NOTE, at]]);
    const dates = await page.evaluate((hs) => window.__canvastDebug.assetListing().then((l) => hs.map((h) => l.entries.find((e) => e.hash === h)?.importedAt)), MANY_HASHES);
    expect(dates).toEqual(MANY_HASHES.map((_, k) => at - (k + 1) * 60_000));
  } finally {
    await app.close();
  }
  // Into an empty workspace, with no Hidden password yet: one is set in the import (typed twice), and they are encrypted then, not when the
  // hidden list is first opened.
  const empty = tempDir("cv-empty-");
  ({ app, page } = await launch(empty));
  try {
    await page.getByTestId("save-status").click();
    await page.getByTestId("set-import-input").setInputFiles({ name: "browser.canvast", mimeType: "application/zip", buffer: made });
    await importMode(page);
    await page.getByTestId("confirm-ok").click();
    await page.getByTestId("prompt-input").fill("new pw");
    await page.getByTestId("prompt-ok").click();
    await page.getByTestId("prompt-input").fill("new pw");
    await Promise.all([page.waitForEvent("load", { timeout: 60_000 }), page.getByTestId("prompt-ok").click()]);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000 });
    expect(files(empty).filter((f) => f.startsWith(".hidden/") && !f.startsWith(".hidden/thumbnails/") && !f.endsWith(".name"))).toHaveLength(1 + MANY.length);
    expect((await page.evaluate(() => window.__canvastDebug.hiddenOp("check", "new pw"))).ok).toBe(true);
  } finally {
    await app.close();
  }
  // A backup that brings its Hidden password (the owner's): asked once and checked against it, it becomes this workspace's, and they are
  // encrypted with it in the import; the hidden list then opens with it, every date as it was.
  const z = await readZip(new Blob([new Uint8Array(made)]));
  const man = JSON.parse(await z.get("manifest.json")!.data.text()) as Record<string, unknown>;
  man["hiddenLock"] = await makeLock("from backup");
  const locked = Buffer.from(await (await writeZip([...z.values()].map((e) => ({ name: e.name, data: e.name === "manifest.json" ? new Blob([JSON.stringify(man)]) : e.data })))).arrayBuffer());
  const third = tempDir("cv-with-lock-");
  ({ app, page } = await launch(third));
  try {
    await page.getByTestId("save-status").click();
    await page.getByTestId("set-import-input").setInputFiles({ name: "browser.canvast", mimeType: "application/zip", buffer: locked });
    await importMode(page);
    await page.getByTestId("confirm-ok").click();
    await page.getByTestId("prompt-input").fill("not it");
    await page.getByTestId("prompt-ok").click();
    await expect(page.getByTestId("prompt-dialog")).toContainText("not the backup's Hidden password");
    await page.getByTestId("prompt-input").fill("from backup");
    await Promise.all([page.waitForEvent("load", { timeout: 60_000 }), page.getByTestId("prompt-ok").click()]);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000 });
    expect(files(third).filter((f) => f.startsWith(".hidden/") && !f.startsWith(".hidden/thumbnails/") && !f.endsWith(".name"))).toHaveLength(1 + MANY.length);
    expect((await page.evaluate(() => window.__canvastDebug.hiddenOp("check", "from backup"))).ok).toBe(true);
    const dates = await page.evaluate((hs) => window.__canvastDebug.assetListing().then((l) => hs.map((h) => l.entries.find((e) => e.hash === h)?.importedAt)), MANY_HASHES);
    expect(dates).toEqual(MANY_HASHES.map((_, k) => at - (k + 1) * 60_000));
  } finally {
    await app.close();
  }
});

test("a backup exported from Settings and imported into a workspace folder: written as folders and files; Rebuild from the folder reads it all again", async () => {
  let secretHash = "", secretAt = 0, greenAt = 0; // (kept to compare after the import: when each came into the library)
  const src = tempDir("canvast-ws-");
  const green = makePng(3, 2, () => [30, 200, 30, 255]);
  const secret = makePng(2, 5, () => [220, 20, 90, 255]);
  let { app, page } = await launch(src);
  let backup: string;
  let thumbFile = "";
  let thumbBytes = Buffer.alloc(0);
  try {
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.session().tree?.length ?? 0)).toBe(1);
    const t = await page.evaluate(() => window.__canvastDebug.session().tree!);
    await page.evaluate(([bid, cid]) => window.__canvastDebug.workspaceOp("renameBoard", bid, "Studies").then(() => window.__canvastDebug.workspaceOp("renameCanvas", cid, "Hands")), [t[0]!.id, t[0]!.canvases[0]!.id] as [string, string]);
    await page.getByTestId("import-input").setInputFiles({ name: "Green Leaf.png", mimeType: "image/png", buffer: green });
    await expect.poll(() => page.evaluate((id) => window.__canvastDebug.storedObjectIds(id).then((ids) => ids.length), t[0]!.canvases[0]!.id)).toBe(1);
    const hash = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries[0]!.hash));
    await page.evaluate((h) => window.__canvastDebug.libraryOp("createFolder", "f1", "Plants").then(() => window.__canvastDebug.libraryOp("file", h, "f1")), hash);
    // A hidden item (in the library only): included in the backup, it goes in still encrypted, with its key file, and nothing readable.
    expect(await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"))).toEqual({ ok: true, state: "open" });
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-import-input").setInputFiles({ name: "Secret Plan.png", mimeType: "image/png", buffer: secret });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length))).toBe(2);
    // Its note and the date it came: in the backup too (the hidden items' index, sealed, with their key).
    greenAt = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.name === "Green Leaf.png")!.importedAt));
    secretHash = createHash("sha256").update(secret).digest("hex");
    await page.evaluate(([h, n]) => window.__canvastDebug.libraryOp("note", h!, n!), [secretHash, LONG_NOTE]);
    secretAt = await page.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.hash === h)!.importedAt), secretHash);
    // With an uploaded custom thumbnail, hidden with it (sealed in .hidden/thumbnails/): it goes in the backup as it is sealed.
    await page.locator(`[data-testid="asset-card"][data-hash="${createHash("sha256").update(secret).digest("hex")}"]`).click();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      (async () => {
        await page.getByTestId("asset-thumb").click();
        await page.getByRole("radio", { name: /Upload a picture/ }).check();
        await page.getByTestId("choose-ok").click();
      })(),
    ]);
    await chooser.setFiles({ name: "cover.png", mimeType: "image/png", buffer: makePng(40, 30, () => [200, 40, 40, 255]) });
    await expect.poll(() => (existsSync(join(src, ".canvast/thumbnails")) ? readdirSync(join(src, ".canvast/thumbnails")).length : 0)).toBe(1);
    await page.getByTestId("asset-hide").click();
    const sealedThumb = () => (existsSync(join(src, ".hidden/thumbnails")) ? readdirSync(join(src, ".hidden/thumbnails")) : []);
    await expect.poll(sealedThumb).toHaveLength(1);
    thumbFile = sealedThumb()[0]!;
    thumbBytes = readFileSync(join(src, ".hidden/thumbnails", thumbFile));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await page.getByTestId("view-canvas").click();
    const zip = await exportBackup(app, page, `${src}-backup.canvast`, async () => {
      await page.getByTestId("choose-dialog").locator('input[value="include"]').check();
      await page.getByTestId("choose-ok").click();
      await page.getByTestId("prompt-input").fill("pw");
      await page.getByTestId("prompt-ok").click();
      await page.getByTestId("choose-ok").click(); // (the passwords and privacy settings: left out, the first choice)
    });
    expect([zip.includes("sealed/"), zip.includes("hidden-key.json"), /secret/i.test(zip.toString("latin1")), zip.includes(secret.subarray(0, 24))]).toEqual([true, true, false, false]);
    expect(zip.includes(`sealed-thumbnails/${thumbFile.replace(/\.bin$/, "")}.bin`)).toBe(true);
    backup = zip.toString("base64");
  } finally {
    await app.close();
  }

  const ws = tempDir("canvast-ws-");
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.session().tree?.length ?? 0)).toBe(1);
    await page.getByTestId("save-status").click();
    await page.getByTestId("set-import-input").setInputFiles({ name: "backup.canvast", mimeType: "application/zip", buffer: Buffer.from(backup, "base64") });
    await importMode(page);
    // Imported, its files written into the folder, then the app starts again on it and says the result.
    await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), page.getByTestId("confirm-ok").click()]);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000 });
    await expect(page.getByTestId("toast")).toContainText(/Imported/);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(visible(ws).filter((f) => !f.startsWith(".hidden/"))).toEqual([`${B}board_1/canvas_1.cvst`, `${B}studies/hands.cvst`, "library/plants/green_leaf.png"]);
    // The hidden item's file is in .hidden/ as it was sealed, with its key: the item shows once the Hidden items are opened (below).
    expect(files(ws).filter((f) => f.startsWith(".hidden/") && !f.startsWith(".hidden/thumbnails/"))).toHaveLength(1);
    expect(readFileSync(join(ws, ".hidden/thumbnails", thumbFile)).equals(thumbBytes)).toBe(true); // (its custom thumbnail, as it was sealed)
    expect(existsSync(join(ws, ".canvast/hidden.json"))).toBe(true);
    expect(readFileSync(join(ws, "library/plants/green_leaf.png")).equals(green)).toBe(true);
    const canvas = JSON.parse(readFileSync(join(ws, `${B}studies/hands.cvst`), "utf8"));
    expect(canvas.objects.map((o: { kind: string }) => o.kind)).toEqual(["image"]);
    // As if the app had stopped after writing the file but before its record was kept: the next write finds the file by its
    // content and takes it, never writing it a second time beside itself (green_leaf-2.png).
    // (the library's record of the file gone, its bytes held in the page's storage, as an import keeps them until written out)
    await page.evaluate(async (bytes) => {
      const hash = (await window.__canvastDebug.assetListing()).entries[0]!.hash;
      await window.__canvastDebug.removeAssetBytes(hash);
      const db = await new Promise<IDBDatabase>((ok, ko) => Object.assign(indexedDB.open("canvast"), { onsuccess(this: IDBRequest<IDBDatabase>) { ok(this.result); }, onerror: ko }));
      const tx = db.transaction("assets", "readwrite");
      tx.objectStore("assets").put({ hash, type: "image/png", size: bytes.length, name: "Green Leaf.png", pixelW: 3, pixelH: 2, importedAt: 1, blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }) }, hash);
      await new Promise((ok) => (tx.oncomplete = ok));
      db.close();
    }, Array.from(green));
    await page.evaluate(() => window.__canvastDebug.libraryOp("createFolder", "f9", "Later")); // (any change writes the library again)
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(visible(ws).filter((f) => f.startsWith("library/") && !f.endsWith("/"))).toEqual(["library/plants/green_leaf.png"]);
    expect(await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => e.present)))).toEqual([true]);
  } finally {
    await app.close();
  }
  // The original is the file now, not a copy in the app's storage: it is read from there after a restart.
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, e.present]))), { timeout: 10_000 }).toEqual([["Green Leaf.png", true]]);
    // The Hidden items opened with the password they were hidden with: the item comes back from its own file, hidden, with its name (after a restart too).
    expect((await page.evaluate(() => window.__canvastDebug.hiddenOp("check", "pw"))).ok).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, !!e.hidden, e.present]).sort())), { timeout: 15_000 }).toEqual([["Green Leaf.png", false, true], ["Secret Plan.png", true, true]]);
    expect(await page.evaluate((h) => window.__canvastDebug.originalBytes(h), createHash("sha256").update(secret).digest("hex"))).toEqual(Array.from(secret));
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.hash === h).map((e) => [e.note, e.importedAt])), secretHash), { timeout: 15_000 }).toEqual([[LONG_NOTE, secretAt]]);
    // (a shown item keeps when it came too: the library's Newest is the same as where the backup was made)
    expect(await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.name === "Green Leaf.png")!.importedAt))).toBe(greenAt);
    // Settings > Storage > Rebuild from the folder: the working copy goes, the app reloads, and reads it all again from the folder (settings kept).
    await page.evaluate(() => window.__canvastDebug.setSetting("ui.density", "dense"));
    await page.getByTestId("save-status").click();
    await page.getByTestId("reset-all").click();
    await Promise.all([page.waitForEvent("load"), page.getByTestId("confirm-ok").click()]);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000, polling: 100 });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, e.present]))), { timeout: 10_000 }).toEqual([["Green Leaf.png", true]]);
    expect(await page.evaluate(() => window.__canvastDebug.session().tree!.map((b) => b.name).sort())).toEqual(["Board 1", "Studies"]);
    expect(await page.evaluate(() => localStorage.getItem("canvast.settings")?.includes("dense") ?? null)).toBe(true);
  } finally {
    await app.close();
  }
});

test("a backup of many files: the busy screen shows how far its files are written into the folder, then the app starts again on them", async () => {
  const src = tempDir("canvast-ws-");
  let { app, page } = await launch(src);
  let backup: Buffer;
  try {
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-import-input").setInputFiles(Array.from({ length: 25 }, (_, i) => ({ name: `p${i}.png`, mimeType: "image/png", buffer: makePng(4, 3, () => [i * 9, 40, 200 - i, 255]) })));
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length))).toBe(25);
    await page.getByTestId("view-canvas").click();
    backup = await exportBackup(app, page, `${src}-backup.canvast`);
  } finally {
    await app.close();
  }
  const ws = tempDir("canvast-ws-");
  ({ app, page } = await launch(ws));
  try {
    // (this workspace has a password, given when it was opened)
    await page.getByTestId("view-settings").click();
    await page.getByRole("tab", { name: /Privacy/ }).click();
    await page.getByTestId("workspace-pw-set").click();
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("prompt-input").fill("open sesame");
      await page.getByTestId("prompt-ok").click();
    }
    await page.getByTestId("view-canvas").click();
    await page.getByTestId("save-status").click();
    await page.getByTestId("set-import-input").setInputFiles({ name: "backup.canvast", mimeType: "application/zip", buffer: backup });
    await importMode(page);
    // (on a fast disk the screen may come and go in a moment: what it said is collected as it changes, across the reload)
    const said: string[] = [];
    page.on("console", (m) => m.text().startsWith("busy: ") && said.push(m.text().slice(6)));
    await page.evaluate(() => new MutationObserver(() => {
      const d = document.querySelector("[data-testid=busy-detail]")?.textContent;
      if (d) console.log(`busy: ${d}`);
    }).observe(document.body, { subtree: true, childList: true, characterData: true }));
    const loaded = page.waitForEvent("load", { timeout: 60_000 });
    await page.getByTestId("confirm-ok").click();
    await loaded;
    expect(said.length).toBeGreaterThan(0);
    // (the files are written straight into the folder while the backup is saved: the screen shows how far)
    const files = said.filter((t) => t.startsWith("Writing the files"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((t) => /25 of 25/.test(t))).toBe(true);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000 });
    // (the app starts again without asking for the password: it was given before the import, in this window)
    await expect(page.getByTestId("toast")).toContainText(/Imported/);
    await expect(page.getByTestId("lock-screen")).toHaveCount(0);
    expect(visible(ws).filter((f) => f.startsWith("library/"))).toHaveLength(25);
  } finally {
    await app.close();
  }
});

test("switching workspace from the app: the recent ones (a gone one left out), the open one written before the switch, and clearing the list", async () => {
  const ws = tempDir("canvast-ws-");
  const other = tempDir("canvast-ws-");
  const gone = join(tmpdir(), "canvast-ws-gone-never-made");
  mkdirSync(`${ws}-userdata`, { recursive: true });
  const recent = join(`${ws}-userdata`, "workspaces.json");
  writeFileSync(recent, JSON.stringify({ workspaces: [{ path: other, openedAt: 2 }, { path: gone, openedAt: 1 }] }));
  process.env["CANVAST_NO_RELAUNCH"] = "1"; // (the switch is checked; no second app is left running)
  let { app, page } = await launch(ws);
  try {
    const items = () => page.locator(".pop-menu [data-i]").evaluateAll((els) => els.map((el) => `${el.getAttribute("data-id")}:${el.getAttribute("aria-label")}`));
    const openSwitcher = async () => {
      if (await page.getByTestId("workspace-menu").isHidden()) await page.getByTestId("workspace-chevron").click();
      await page.getByTestId("nav-switch-workspace").click();
      await expect(page.locator(".pop-menu")).toBeVisible();
    };
    await openSwitcher();
    expect(await items()).toEqual([`current:${ws.split("/").pop()}`, `recent:Switch to the workspace ${other.split("/").pop()}`, "open:Open a folder…", "new:New workspace…", "connect:Connect to a shared workspace…", "clear:Clear the recent list"]);
    // An edit made a moment ago is in the folder before the app leaves for the other workspace.
    await page.keyboard.press("Escape");
    const t = await page.evaluate(() => window.__canvastDebug.session().tree!);
    await page.evaluate((bid) => window.__canvastDebug.workspaceOp("renameBoard", bid, "Last Edit"), t[0]!.id);
    await openSwitcher();
    await Promise.all([app.waitForEvent("close", { timeout: 30_000 }), page.locator('.pop-menu [data-id="recent"]').click()]);
    expect(JSON.parse(readFileSync(recent, "utf8")).workspaces[0].path).toBe(other);
    expect(visible(ws)).toContain(`${B}last_edit/canvas_1.cvst`);
    // Back on the first one: clearing leaves only the open workspace on the list (no folder is touched).
    ({ app, page } = await launch(ws));
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.session().tree?.length ?? 0)).toBe(1);
    await openSwitcher();
    await page.locator('.pop-menu [data-id="clear"]').click();
    await expect.poll(() => JSON.parse(readFileSync(recent, "utf8")).workspaces.map((w: { path: string }) => w.path)).toEqual([ws]);
    expect(existsSync(other)).toBe(true);
  } finally {
    delete process.env["CANVAST_NO_RELAUNCH"];
    await app.close().catch(() => undefined);
  }
});

test("a workspace with a password, moved and renamed, still asks for it when opened from its new place", async () => {
  const ws = tempDir("canvast-ws-");
  let { app, page } = await launch(ws);
  try {
    await page.getByTestId("view-settings").click();
    await page.getByRole("tab", { name: /Privacy/ }).click();
    await page.getByTestId("workspace-pw-set").click();
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("prompt-input").fill("open sesame");
      await page.getByTestId("prompt-ok").click();
    }
    await expect(page.locator('[data-pw-card="workspace"] [data-pw-state]')).toContainText(/set/);
    // (the folder follows a moment later: its workspace.json carries the password's kept form)
    await expect.poll(() => (existsSync(join(ws, ".canvast/workspace.json")) ? JSON.parse(readFileSync(join(ws, ".canvast/workspace.json"), "utf8")).locks?.workspace : undefined), { timeout: 15_000 }).toMatch(/^pbkdf2\$/);
  } finally {
    await app.close();
  }
  const moved = `${ws}-moved`;
  renameSync(ws, moved);
  writeFileSync(`${ws}-userdata/window.json`, JSON.stringify({ frame: "off" })); // (and with no frame, the window's row in front of the lock screen)
  // (the same device: its data folder is named after the old place here)
  app = await electron.launch({ args: [join(buildDir(), "desktop"), `--workspace=${moved}`, `--user-data-dir=${ws}-userdata`], env: { ...process.env, CANVAST_HIDDEN: "1", CANVAST_HASH: "#debug" } });
  try {
    page = await app.firstWindow();
    await expect(page.getByTestId("lock-screen")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lock-open-folder")).toBeVisible(); // (another workspace can be reached from here)
    await expect(page.getByTestId("lock-new-workspace")).toBeVisible();
    await expect(page.getByTestId("win-row")).toContainText(basename(moved));
    await page.waitForTimeout(3_500); // (longer than it shows at a start: here it stays)
    await page.getByTestId("win-close").click({ trial: true }); // (seen, and not inert behind the modal)
    await expect(page.getByTestId("win-minimize")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("hidden items are encrypted: sealed into .hidden/ with nothing readable left, opened only with the password, shown back into library/, the same key under a new password", async () => {
  const ws = tempDir("canvast-ws-");
  const secret = makePng(3, 2, () => [200, 40, 160, 255]);
  // Every file of the workspace, as text: no trace of the hidden item's name or its picture may be in any of them.
  const traces = () => files(ws).filter((f) => { const b = readFileSync(join(ws, f)); return /secret/i.test(b.toString("latin1")) || b.includes(secret.subarray(0, 24)); });
  let { app, page } = await launch(ws);
  const lib = (...a: Parameters<typeof window.__canvastDebug.libraryOp>) => page.evaluate((a) => window.__canvastDebug.libraryOp(...a), a);
  const hid = (op: "set" | "check" | "lock", pw?: string, current?: string) => page.evaluate(([op, pw, current]) => window.__canvastDebug.hiddenOp(op as "set", pw, current), [op, pw, current] as const);
  const flush = () => page.evaluate(() => window.__canvastDebug.flushStorage());
  const listing = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, !!e.hidden, e.present])));
  let hash = "";
  let sealed0 = "";
  type Tool = { decryptHidden: (ws: string, out: string, pw: string, opts?: { flat?: boolean }) => Promise<number>; encryptHidden: (ws: string, files: string[], pw: string) => Promise<number> };
  const { decryptHidden, encryptHidden } = (await import(join(process.cwd(), "scripts/hidden-items.mjs"))) as Tool;
  try {
    await page.getByTestId("import-input").setInputFiles({ name: "Secret Plan.png", mimeType: "image/png", buffer: secret });
    await expect.poll(listing).toEqual([["Secret Plan.png", false, true]]);
    hash = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries[0]!.hash));
    expect(await hid("set", "pw1")).toEqual({ ok: true, state: "open" });
    // Filed in a library folder, then the folder hidden (Hide folder): the item is hidden with it, and the folder's name is in no
    // readable file (its real folder leaves library/; the name is only in hidden.json, sealed).
    await lib("createFolder", "sf1", "Secret Folder");
    await lib("file", hash, "sf1");
    await flush();
    expect(existsSync(join(ws, "library/secret_folder/secret_plan.png"))).toBe(true);
    await lib("hideFolder", "sf1");
    await flush();
    expect(existsSync(join(ws, "library/secret_folder"))).toBe(false);
    const sealed = files(ws).filter((f) => f.startsWith(".hidden/"));
    expect(sealed).toHaveLength(1);
    sealed0 = sealed[0]!;
    expect(sealed[0]).toMatch(/^\.hidden\/[a-z2-7]{26,}\/[a-z2-7]{26,}$/); // (in its folder, named by its name, both encrypted)
    // The password is stretched with scrypt (version 2 of the vault, 128 MiB), done natively in the main process.
    expect(JSON.parse(readFileSync(join(ws, ".canvast/hidden.json"), "utf8"))).toMatchObject({ version: 2, kdf: { name: "scrypt", N: 131072, r: 8, p: 1 } });
    // No cheaper form of the same password beside it in a synced file (the browser's PBKDF2 gate stays on this device).
    expect(JSON.parse(readFileSync(join(ws, ".canvast/workspace.json"), "utf8")).locks?.hidden).toBeUndefined();
    expect(files(ws).filter((f) => f.startsWith("library/") || f.startsWith(".trash/"))).toEqual([]);
    expect(traces()).toEqual([]);
    expect(await listing()).toEqual([["Secret Plan.png", true, true]]);
    expect(await hid("set", null as unknown as string)).toEqual({ ok: false, state: "open" }); // (not removed while an item is hidden)
    expect(await hid("set", "pw2")).toEqual({ ok: false, state: "open" }); // (the current password is needed: the key cannot be read out)
    expect(await hid("set", "pw2", "nope")).toEqual({ ok: false, state: "open" });
    expect(await hid("set", "pw2", "pw1")).toEqual({ ok: true, state: "open" }); // the same key under a new password
    // Outside the app, scripts/hidden-items.mjs opens the same files with the password alone (the README's documented format).
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect(decryptHidden(ws, `${ws}-out`, "pw1")).rejects.toThrow(/wrong password/);
    expect(await decryptHidden(ws, `${ws}-out`, "pw2")).toBe(1);
    // (in its library folder, which the file's own header names: the tree comes back from the files alone; --flat puts it at the top)
    expect(readFileSync(join(`${ws}-out`, "Secret Folder", "Secret Plan.png")).equals(secret)).toBe(true);
    expect(JSON.parse(readFileSync(join(`${ws}-out`, "hidden-items.json"), "utf8"))[0]).toMatchObject({ name: "Secret Plan.png", hidden: true, writtenAs: "Secret Folder/Secret Plan.png" });
    expect(await decryptHidden(ws, `${ws}-flat`, "pw2", { flat: true })).toBe(1);
    expect(readFileSync(join(`${ws}-flat`, "Secret Plan.png")).equals(secret)).toBe(true);
    // The simple way: the script, .hidden and a loose hidden.json in one folder, run with no arguments (the password piped in).
    const simple = `${ws}-simple`;
    mkdirSync(simple);
    cpSync(join(ws, ".hidden"), join(simple, ".hidden"), { recursive: true });
    cpSync(join(ws, ".canvast", "hidden.json"), join(simple, "hidden.json"));
    cpSync(join(process.cwd(), "scripts", "hidden-items.mjs"), join(simple, "hidden-items.mjs"));
    execFileSync(process.execPath, [join(simple, "hidden-items.mjs")], { input: "pw2\n", cwd: tmpdir() });
    expect(readFileSync(join(simple, "output", "Secret Folder", "Secret Plan.png")).equals(secret)).toBe(true);
    // Locked (from the command palette): the picture on the canvas leaves memory and is drawn with a padlock; the password opens it again.
    await page.keyboard.press("Control+k");
    await page.locator(".palette-input").fill("lock hidden");
    await expect(page.locator(".palette-title").first()).toHaveText("Lock hidden items");
    await page.keyboard.press("Enter");
    // (the key goes once what waits is written: the bytes stop opening a moment later)
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.originalBytes(h), hash)).toBeNull();
    expect(await page.evaluate((h) => window.__canvastDebug.pictureLocked(h), hash)).toBe(true);
    expect((await hid("check", "pw2")).ok).toBe(true);
    expect(await page.evaluate((h) => window.__canvastDebug.originalBytes(h), hash)).toEqual(Array.from(secret));
    expect(await page.evaluate((h) => window.__canvastDebug.pictureLocked(h), hash)).toBe(true); // (opened, but still hidden: a padlock)
  } finally {
    await app.close();
  }
  // With the app closed, the same tool seals a new picture into .hidden/ and the index (its size read from the file).
  const outside = makePng(5, 4, () => [90, 90, 250, 255]);
  writeFileSync(`${ws}-outside.png`, outside);
  await expect(encryptHidden(ws, [`${ws}-outside.png`], "pw1")).rejects.toThrow(/wrong password/);
  expect(await encryptHidden(ws, [`${ws}-outside.png`], "pw2")).toBe(1);
  const name = basename(`${ws}-outside.png`);
  const sealedNow = files(ws).filter((f) => f.startsWith(".hidden/"));
  expect(sealedNow).toHaveLength(2);
  expect(sealedNow.some((f) => readFileSync(join(ws, f)).includes(outside.subarray(0, 24)))).toBe(false);
  const outsideFile = sealedNow.find((f) => f !== sealed0)!;
  // Another device: it knows nothing of the hidden items until the password is given there.
  ({ app, page } = await launch(ws, "device-b"));
  try {
    await expect.poll(() => hid("check", "x").then((r) => r.state)).toBe("locked");
    expect(await listing()).toEqual([]);
    expect((await hid("check", "pw1")).ok).toBe(false);
    expect(await hid("check", "pw2")).toEqual({ ok: true, state: "open" });
    // (how long the list takes after the password is said, for a run that is slow: an empty list for good is a bug, a late one is not)
    const opened = Date.now();
    const onDisk = () => ({ sealed: files(ws).filter((f) => f.startsWith(".hidden/") && !f.endsWith(".name")), trashed: files(ws).filter((f) => f.startsWith(".trash/.hidden/")) });
    try {
      await expect.poll(() => listing().then((l) => l.sort()), { timeout: 45_000 }).toEqual([["Secret Plan.png", true, true], [name, true, true]].sort());
    } catch (e) {
      // (the list did not come: are the files still there, and where?)
      console.error(`hidden list empty after ${Date.now() - opened} ms; on disk: ${JSON.stringify(onDisk())}`);
      throw e;
    }
    console.log(`hidden list after the password: ${Date.now() - opened} ms`);
    // Whatever the list said: both files still sealed, none in the trash. (Opened, a file the outside tool named `<random>.bin` takes the encrypted name of its place, so the count says it, and their bytes below.)
    expect(onDisk().sealed.length, "still sealed on disk").toBeGreaterThanOrEqual(sealedNow.length);
    expect(onDisk().trashed, "none in the trash").toEqual([]);
    // (each file is opened from .hidden/ after the list shows it: wait for its bytes)
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.originalBytes(h), hash)).toEqual(Array.from(secret));
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.originalBytes(h), createHash("sha256").update(outside).digest("hex"))).toEqual(Array.from(outside));
    // Shown again: opened back into its place in library/, the sealed file erased, its picture drawn again.
    await lib("hide", hash, "");
    await flush();
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.pictureLocked(h), hash)).toBe(false);
    // (back into its folder, which this device knew only from the sealed list, and which shows again)
    // (the one sealed by the tool outside the app was renamed under its own encrypted name: it is the one file left in .hidden/)
    expect(files(ws).filter((f) => f.startsWith("library/"))).toEqual(["library/secret_folder/secret_plan.png"]);
    expect(files(ws).filter((f) => f.startsWith(".hidden/") && !f.startsWith(".hidden/thumbnails/"))).toHaveLength(1);
    void outsideFile;
    expect(readFileSync(join(ws, "library/secret_folder/secret_plan.png")).equals(secret)).toBe(true);
    expect(await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.folders.map((f) => f.name)))).toEqual(["Secret Folder"]);
    // Locked again: hiding (its folder, here) waits for the key (the readable file stays until the password is given).
    await hid("lock");
    // (by its name: opening can read the folder from the sealed files before the sealed list, and it then has another id)
    const folderNow = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.folders.find((f) => f.name === "Secret Folder")!.id));
    await lib("hideFolder", folderNow);
    await flush();
    expect(files(ws).filter((f) => f.startsWith("library/"))).toEqual(["library/secret_folder/secret_plan.png"]);
    page.on("console", (m) => void (m.text().startsWith("canvast: the library's files") && console.log(`HIDDEN WATCH: ${m.text()}`))); // (a write that had to be tried again: in the run's log)
    expect((await hid("check", "pw2")).ok).toBe(true);
    await flush();
    await expect.poll(() => files(ws).filter((f) => f.startsWith("library/")), { timeout: 20_000 }).toEqual([]); // (what waited for the key starts when the key is there, maybe after this flush)
    expect(traces()).toEqual([]);
    // A readable file put in .hidden/ from outside (a file manager) while the hidden items are open: it becomes a hidden item, sealed,
    // and nothing readable of it is left.
    const dropped = makePng(2, 3, () => [10, 220, 90, 255]);
    // While the hidden items are locked it cannot be encrypted: the app asks for their password at once, and encrypts it then.
    await hid("lock");
    writeFileSync(join(ws, ".hidden", "Dropped Secret.png"), dropped);
    await expect(page.getByTestId("prompt-dialog")).toContainText("Dropped Secret.png", { timeout: 15_000 });
    await page.getByTestId("prompt-input").fill("pw2");
    await page.getByTestId("prompt-ok").click();
    await expect.poll(() => files(ws).filter((f) => f.startsWith(".hidden/") && !SEALED_FILE.test(f)), { timeout: 15_000 }).toEqual([]);
    expect(files(ws).filter((f) => f.startsWith(".hidden/"))).toHaveLength(3);
    expect(files(ws).some((f) => readFileSync(join(ws, f)).includes(dropped.subarray(0, 24)))).toBe(false);
    await expect.poll(listing).toContainEqual(["Dropped Secret.png", true, true]);
    // A readable folder put there (with a folder inside): its files sealed, its folders hidden library folders of their names, no folder left.
    const nested = makePng(3, 3, () => [200, 20, 90, 255]);
    mkdirSync(join(ws, ".hidden", "Art Folder", "Items"), { recursive: true });
    writeFileSync(join(ws, ".hidden", "Art Folder", "Items", "Nested Secret.png"), nested);
    await expect.poll(listing, { timeout: 15_000 }).toContainEqual(["Nested Secret.png", true, true]);
    await flush();
    await expect.poll(() => existsSync(join(ws, ".hidden", "Art Folder")), { timeout: 15_000 }).toBe(false);
    expect(files(ws).some((f) => readFileSync(join(ws, f)).includes(nested.subarray(0, 24)))).toBe(false);
    expect(await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => (l.hiddenFolders ?? []).map((f) => f.name).sort()))).toEqual(expect.arrayContaining(["Art Folder", "Items"]));
    // Unhide folder: the folder and what is in it opened back into library/; a shown item filed into a hidden folder is sealed with it.
    // (by its name: this device gave the folder its own id when it opened the sealed list)
    await lib("showFolder", await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => (l.hiddenFolders ?? []).find((f) => f.name === "Secret Folder")!.id)));
    await flush();
    expect(files(ws).filter((f) => f.startsWith("library/"))).toEqual(["library/secret_folder/secret_plan.png"]);
    expect(readFileSync(join(ws, "library/secret_folder/secret_plan.png")).equals(secret)).toBe(true);
    await lib("createFolder", "sf2", "Other Secret");
    await lib("hideFolder", "sf2");
    await lib("file", hash, "sf2");
    await flush();
    expect(files(ws).filter((f) => f.startsWith("library/"))).toEqual([]);
    expect(files(ws).some((f) => readFileSync(join(ws, f)).includes(secret.subarray(0, 24)))).toBe(false); // (its folder is shown now: only the picture is checked)
  } finally {
    await app.close();
  }
});

test("hidden items and sync tools: a conflict copy of hidden.json is joined, a lost entry's file comes back, a copied sealed file is not sealed twice, no second key", async () => {
  const ws = tempDir("canvast-ws-");
  const alpha = makePng(3, 2, () => [200, 40, 160, 255]);
  const beta = makePng(2, 2, () => [20, 200, 60, 255]);
  const gamma = makePng(4, 1, () => [30, 30, 220, 255]);
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  type Tool = { decryptHidden: (ws: string, out: string, pw: string, opts?: { flat?: boolean }) => Promise<number>; encryptHidden: (ws: string, files: string[], pw: string) => Promise<number> };
  const { decryptHidden, encryptHidden } = (await import(join(process.cwd(), "scripts/hidden-items.mjs"))) as Tool;
  let { app, page } = await launch(ws);
  const hid = (op: "set" | "check", pw?: string) => page.evaluate(([op, pw]) => window.__canvastDebug.hiddenOp(op as "set", pw), [op, pw] as const);
  const listing = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, !!e.hidden, e.present]).sort()));
  const sealedNames = () => files(ws).filter((f) => f.startsWith(".hidden/"));
  try {
    await page.getByTestId("import-input").setInputFiles({ name: "Alpha.png", mimeType: "image/png", buffer: alpha });
    await expect.poll(listing).toEqual([["Alpha.png", false, true]]);
    expect(await hid("set", "pw")).toEqual({ ok: true, state: "open" });
    await page.evaluate((h) => window.__canvastDebug.libraryOp("hide", h, "1"), sha(alpha));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(sealedNames()).toHaveLength(1);
  } finally {
    await app.close();
  }
  const alphaFile = sealedNames()[0]!;
  const json = join(ws, ".canvast/hidden.json");
  const added = (had: string[]) => sealedNames().find((f) => !had.includes(f))!;
  // Another device hid Beta while this one's hidden.json changed too: the sync tool kept this one's and put the other beside it.
  const before = readFileSync(json);
  writeFileSync(`${ws}-beta.png`, beta);
  expect(await encryptHidden(ws, [`${ws}-beta.png`], "pw")).toBe(1);
  const betaFile = added([alphaFile]);
  renameSync(json, join(ws, ".canvast/hidden (1).json"));
  writeFileSync(json, before);
  // Gamma's entry was lost for good (no copy kept it), and the sync tool left its file under a copy's name; and a copy of Alpha's file.
  writeFileSync(`${ws}-gamma.png`, gamma);
  expect(await encryptHidden(ws, [`${ws}-gamma.png`], "pw")).toBe(1);
  const gammaFile = added([alphaFile, betaFile]);
  writeFileSync(json, before);
  renameSync(join(ws, gammaFile), join(ws, gammaFile.replace(".bin", " (1).bin")));
  writeFileSync(join(ws, alphaFile.replace(".bin", " (1).bin")), readFileSync(join(ws, alphaFile)));
  ({ app, page } = await launch(ws));
  try {
    // Locked at first, as on any start; the password opens the key, and with it what the sync tool left.
    await expect.poll(() => hid("check", "x").then((r) => r.state)).toBe("locked");
    expect(await hid("check", "pw")).toEqual({ ok: true, state: "open" });
    // Gamma's file stands on its own (version 2): it comes back under its own name, not a recovered one.
    const gammaName = basename(`${ws}-gamma.png`);
    await expect.poll(listing, { timeout: 15_000 }).toEqual([["Alpha.png", true, true], [basename(`${ws}-beta.png`), true, true], [gammaName, true, true]].sort());
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    // The copy of hidden.json was joined and erased; the copy of Alpha's file erased; Gamma's renamed back to a hidden file's name, not sealed again.
    await expect.poll(() => files(ws).filter((f) => f.startsWith(".canvast/hidden")), { timeout: 15_000 }).toEqual([".canvast/hidden.json"]);
    expect(sealedNames()).toHaveLength(3);
    for (const f of sealedNames()) expect(f).toMatch(SEALED_FILE);
    expect(sealedNames().filter((f) => f.endsWith(".bin"))).toEqual([]); // (each renamed under its own encrypted name, not sealed again)
    expect(await page.evaluate((h) => window.__canvastDebug.originalBytes(h), sha(gamma))).toEqual(Array.from(gamma));
  } finally {
    await app.close();
  }
  // The tool reads the joined index: all three come out under their names.
  expect(await decryptHidden(ws, `${ws}-out`, "pw")).toBe(3);
  expect(readFileSync(join(`${ws}-out`, basename(`${ws}-gamma.png`))).equals(gamma)).toBe(true);
  // A file sealed before 0.50.53 (version 1: the bytes only): Alpha's, sealed that way again with the same key. It still opens, and
  // stays as it is (below).
  const vault = JSON.parse(readFileSync(json, "utf8")) as { kdf: { N: number; r: number; p: number; salt: string }; key: string };
  const kek = await crypto.subtle.importKey("raw", new Uint8Array(scryptSync("pw", Buffer.from(vault.kdf.salt, "base64"), 32, { N: vault.kdf.N, r: vault.kdf.r, p: vault.kdf.p, maxmem: 2 ** 28 })), "AES-KW", false, ["unwrapKey"]);
  const dataKey = await crypto.subtle.unwrapKey("raw", new Uint8Array(Buffer.from(vault.key, "base64")), kek, "AES-KW", { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  writeFileSync(join(ws, alphaFile), Buffer.concat([iv, new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dataKey, new Uint8Array(alpha)))]));
  expect(readFileSync(join(ws, alphaFile)).subarray(0, 8).toString("latin1")).not.toBe("CVSTHID2");
  // The spare of the key: with hidden.json lost, the password still opens every file (each says its own name; one of version 1 is
  // named by its content), and the app
  // writes hidden.json again from what this device has, its hidden items kept (none taken as shown or erased elsewhere).
  expect(existsSync(join(ws, ".canvast/keys/hidden.json"))).toBe(true);
  rmSync(json);
  expect(await decryptHidden(ws, `${ws}-out2`, "pw")).toBe(3);
  // (version 1 holds no name, but its own file name, encrypted, says it: no "recovered-…" one)
  expect(readdirSync(`${ws}-out2`).sort()).toEqual([basename(`${ws}-beta.png`), basename(`${ws}-gamma.png`), "hidden-items.json", "Alpha.png"].sort());
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(() => hid("check", "x").then((r) => r.state)).toBe("locked");
    expect(await hid("check", "pw")).toEqual({ ok: true, state: "open" });
    await expect.poll(() => existsSync(json), { timeout: 15_000 }).toBe(true);
    expect(await listing()).toEqual([["Alpha.png", true, true], [basename(`${ws}-beta.png`), true, true], [basename(`${ws}-gamma.png`), true, true]].sort());
    // Alpha's version 1 file is left as it is (its content did not change: never encrypted again), and opens the same.
    expect(readFileSync(join(ws, alphaFile)).subarray(0, 8).toString("latin1")).not.toBe("CVSTHID2");
    expect(await page.evaluate((h) => window.__canvastDebug.originalBytes(h), sha(alpha))).toEqual(Array.from(alpha));
    // Hiding five at once: the busy screen says it is encrypting them, and how far it is.
    await page.evaluate(() => {
      const w = window as { seen?: string };
      w.seen = "";
      new MutationObserver(() => (w.seen += document.querySelector("[data-testid=busy-screen]")?.textContent ?? "")).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const five = [1, 2, 3, 4, 5].map((k) => makePng(k, 2, () => [k * 40, 90, 30, 255]));
    await page.getByTestId("import-input").setInputFiles(five.map((buffer, k) => ({ name: `Five ${k}.png`, mimeType: "image/png", buffer })));
    await expect.poll(() => listing().then((l) => l.length)).toBe(8);
    await page.evaluate(async (hs) => { for (const h of hs) await window.__canvastDebug.libraryOp("hide", h, "1"); }, five.map(sha));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(await page.evaluate(() => (window as { seen?: string }).seen)).toMatch(/Encrypting hidden items[\s\S]*Encrypting \d of 5 files/);
    expect(sealedNames()).toHaveLength(8);
    // Renamed here: only its file is renamed (its encrypted name), never encrypted again: the same bytes under one new name (the tool,
    // with no index, gives it the new name).
    const contents = () => sealedNames().map((f) => sha(readFileSync(join(ws, f)))).sort();
    const [namesBefore, contentsBefore] = [sealedNames(), contents()];
    await page.evaluate((h) => window.__canvastDebug.libraryOp("rename", h, "Beta Renamed.png"), sha(beta));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect.poll(() => sealedNames().filter((f) => !namesBefore.includes(f)).length, { timeout: 15_000 }).toBe(1);
    expect(contents()).toEqual(contentsBefore);
    expect(await page.evaluate((h) => window.__canvastDebug.originalBytes(h), sha(beta))).toEqual(Array.from(beta));
    // Settings > Privacy, hidden items' names off this device while locked: locking clears them from its cache (the files keep them);
    // opening brings them back from the sealed index.
    const names = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.hidden).map((e) => e.name).sort()));
    const before = await names();
    expect(before).toContain("Beta Renamed.png");
    await page.evaluate(() => window.__canvastDebug.setSetting("library.hiddenNamesOff", true));
    await page.evaluate(() => window.__canvastDebug.hiddenOp("lock"));
    await expect.poll(names, { timeout: 15_000 }).toEqual(before.map((n) => `Hidden item.${n.split(".").pop()}`).sort());
    // A write while blank, then opening: no sealed file is written again (new bytes a sync tool would upload again each start).
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    const bytes = () => sha(Buffer.concat(sealedNames().map((n) => readFileSync(join(ws, n)))));
    const sealedBefore = bytes();
    expect((await hid("check", "pw")).ok).toBe(true);
    await expect.poll(names, { timeout: 15_000 }).toEqual(before);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(bytes()).toBe(sealedBefore);
    // The same across a restart: started locked (names blank), then opened.
    await page.evaluate(() => window.__canvastDebug.hiddenOp("lock"));
    await expect.poll(names, { timeout: 15_000 }).not.toEqual(before);
    await app.close();
    ({ app, page } = await launch(ws));
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length))).toBe(8);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    // Opened from the Library's hidden mode: the cards show the real names without the Library being opened again.
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-search").fill("hidden:");
    await page.getByTestId("prompt-input").fill("pw");
    await page.getByTestId("prompt-ok").click();
    await expect.poll(names, { timeout: 15_000 }).toEqual(before);
    await expect.poll(() => page.locator("[data-testid=asset-card] .asset-name").allTextContents().then((t) => t.sort()), { timeout: 15_000 }).toEqual(before);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(bytes()).toBe(sealedBefore);
  } finally {
    await app.close();
  }
  rmSync(json);
  expect(await decryptHidden(ws, `${ws}-out3`, "pw")).toBe(8);
  expect(readFileSync(join(`${ws}-out3`, "Beta Renamed.png")).equals(beta)).toBe(true);
  // A workspace whose sealed files came before their hidden.json: no new key is made (it would be a second one).
  const ws2 = tempDir("canvast-ws-");
  mkdirSync(join(ws2, ".hidden"));
  writeFileSync(join(ws2, alphaFile), readFileSync(join(ws, sealedNames()[0]!))); // (any sealed file)
  ({ app, page } = await launch(ws2));
  try {
    expect(await hid("set", "other")).toEqual({ ok: false, state: "none" });
    expect(existsSync(join(ws2, ".canvast/hidden.json"))).toBe(false);
  } finally {
    await app.close();
  }
});

test("a library folder deleted outside the app stays deleted, while it runs and after a restart; one never seen on disk is made", async () => {
  const ws = tempDir("cv-folders-");
  let { app, page } = await launch(ws);
  const names = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.folders.map((f) => f.name).sort()));
  try {
    await page.evaluate(() => window.__canvastDebug.libraryOp("createFolder", "f1", "Going"));
    await page.evaluate(() => window.__canvastDebug.libraryOp("createFolder", "f2", "Staying"));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect.poll(() => existsSync(join(ws, "library/going")), { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    // (a save just before: the app made no folder in it, so the deletion is seen as someone else's)
    await page.evaluate(() => window.__canvastDebug.libraryOp("createFolder", "f9", "Another moment"));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    rmSync(join(ws, "library/going"), { recursive: true });
    try {
      await expect.poll(names, { timeout: 20_000 }).toEqual(["Another moment", "Staying"]);
    } catch (e) {
      // (what the app had kept, and what is on the disk, said with the failure)
      const state = await page.evaluate(() => window.__canvastDebug.libraryState());
      throw new Error(`${(e as Error).message}\nkept: ${JSON.stringify(state)}\nlibrary/: ${JSON.stringify(readdirSync(join(ws, "library")))}`);
    }
    await page.evaluate(() => window.__canvastDebug.libraryOp("createFolder", "f3", "Another"));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect.poll(() => existsSync(join(ws, "library/another")), { timeout: 20_000 }).toBe(true);
    expect(existsSync(join(ws, "library/going"))).toBe(false);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
  } finally {
    await app.close();
  }
  // While it is closed.
  rmSync(join(ws, "library/staying"), { recursive: true });
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(names, { timeout: 20_000 }).toEqual(["Another", "Another moment"]);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect([existsSync(join(ws, "library/going")), existsSync(join(ws, "library/staying"))]).toEqual([false, false]);
  } finally {
    await app.close();
  }
});

test("a hidden PDF opens in its view in hidden mode, with nothing of it readable on the disk", async () => {
  const ws = tempDir("canvast-ws-");
  const word = "HiddenWordInsideThePdf";
  const text = `BT /F1 20 Tf 10 50 Td (${word}) Tj ET`;
  const objs = ["", "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>", `<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    at[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 5\n0000000000 65535 f \n${[1, 2, 3, 4].map((n) => `${String(at[n]).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const { app, page } = await launch(ws);
  try {
    await page.getByTestId("import-input").setInputFiles({ name: "secret.pdf", mimeType: "application/pdf", buffer: Buffer.from(out, "latin1") });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length))).toBe(1);
    const hash = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries[0]!.hash));
    await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"));
    await page.evaluate((h) => window.__canvastDebug.libraryOp("hide", h, "1"), hash);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-search").fill("hidden:");
    await page.getByTestId("prompt-input").fill("pw");
    await page.getByTestId("prompt-ok").click();
    const card = page.locator(`[data-testid="asset-card"][data-hash="${hash}"]`);
    await expect(card).toHaveCount(1);
    await card.dblclick();
    await expect(page.locator('.pdf-page[data-page="1"] .textLayer')).toContainText(word);
    await page.getByTestId("view-mark").click();
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    // Nothing of it is plain on the disk: not its file, its words or its name.
    await expect.poll(() => files(ws).filter((f) => f.endsWith(".pdf"))).toEqual([]);
    expect(files(ws).filter((f) => readFileSync(join(ws, f)).includes(word))).toEqual([]);
    expect(files(ws).filter((f) => f === "library.json" || f.endsWith("/library.json")).filter((f) => readFileSync(join(ws, f)).includes("secret.pdf"))).toEqual([]);
  } finally {
    await app.close();
  }
});

test("a hidden item's picture is not read while locked, so after a restart its card shows in hidden mode; its thumbnail is kept encrypted", async () => {
  const ws = tempDir("canvast-ws-");
  const pic = (k: number) => makePng(600, 400, (x, y) => [(x * k) % 256, y % 256, 120, 255]); // (bigger than a thumbnail: one is made)
  let { app, page } = await launch(ws);
  const listing = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length));
  let hash = "";
  try {
    for (const k of [1, 2]) await page.getByTestId("import-input").setInputFiles({ name: `p${k}.png`, mimeType: "image/png", buffer: pic(k) });
    await expect.poll(listing).toBe(2);
    hash = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.name === "p1.png")!.hash));
    await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"));
    await page.evaluate((h) => window.__canvastDebug.libraryOp("hide", h, "1"), hash);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
  } finally {
    await app.close();
  }
  ({ app, page } = await launch(ws));
  try {
    // Locked: Similar images reads how every picture looks, but not the hidden one's.
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-side").getByRole("button", { name: /^Similar images/ }).click();
    await page.waitForTimeout(500);
    await page.getByTestId("assets-search").fill("hidden:");
    await page.getByTestId("prompt-input").fill("pw");
    await page.getByTestId("prompt-ok").click();
    const img = page.locator(`[data-testid="asset-card"][data-hash="${hash}"] img`);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
    // Its thumbnail is stored encrypted with the hidden items' key: nothing of the picture is readable in the app's storage.
    const stored = () =>
      page.evaluate((h) => new Promise<{ sealed: string | null; head: string } | null>((res) => {
        const r = indexedDB.open("canvast");
        r.onsuccess = () => {
          const g = r.result.transaction("thumbs").objectStore("thumbs").get(h);
          g.onsuccess = () => void (g.result ? (g.result.blob as Blob).slice(0, 12).text().then((head) => res({ sealed: g.result.sealed ?? null, head })) : res(null));
        };
      }), hash);
    await expect.poll(() => stored().then((t) => t?.sealed ?? null)).toMatch(/^image\//);
    expect((await stored())!.head).not.toMatch(/RIFF|PNG|JFIF|WEBP/);
    // Out of hidden mode and in again: the card is drawn from that thumbnail, opened with the key.
    await page.getByTestId("hidden-mode-exit").click();
    await expect(img).toHaveCount(0);
    await page.getByTestId("assets-search").fill("hidden:");
    await page.getByTestId("prompt-input").fill("pw");
    await page.getByTestId("prompt-ok").click();
    await expect(page.getByTestId("hidden-mode-bar")).toBeVisible();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
    // Export folder, from hidden mode: its hidden items written readable (after asking) into a folder outside the workspace, each checked.
    await page.evaluate(() => window.__canvastDebug.libraryOp("createFolder", "pf", "Private"));
    await page.evaluate(() => window.__canvastDebug.libraryOp("hideFolder", "pf"));
    await page.evaluate((h) => window.__canvastDebug.libraryOp("file", h, "pf"), hash);
    await page.waitForTimeout(1000);
    mkdirSync(`${ws}-exports`, { recursive: true });
    await page.getByRole("button", { name: "More actions for folder Private", exact: true }).click();
    await page.getByRole("menuitem", { name: "Export folder Private and what is in it", exact: true }).click();
    await expect(page.getByTestId("confirm-dialog")).toContainText("1 hidden item will be written readable");
    await page.getByTestId("confirm-ok").click();
    await page.getByTestId("choose-ok").click(); // (the first way: a folder, keeping its folders)
    await expect.poll(() => existsSync(join(`${ws}-exports`, "Private", "p1.png"))).toBe(true);
    expect(readFileSync(join(`${ws}-exports`, "Private", "p1.png")).equals(pic(1))).toBe(true);
    // Open in default app, for a hidden item: after asking (once), a readable copy in the app's own temporary folder; locked, it is gone.
    const tmp = await app.evaluate(({ app }) => app.getPath("temp"));
    const copies = () => readdirSync(tmp).filter((d) => d.startsWith("canvast-opened-")).flatMap((d) => readdirSync(join(tmp, d)).flatMap((x) => readdirSync(join(tmp, d, x)).map((f) => join(tmp, d, x, f))));
    await page.locator(`[data-testid="asset-card"][data-hash="${hash}"]`).click();
    await page.getByTestId("asset-open-app").click();
    await page.getByTestId("confirm-ok").click();
    await expect.poll(() => copies().filter((f) => f.endsWith("p1.png")).length).toBe(1);
    expect(readFileSync(copies().find((f) => f.endsWith("p1.png"))!).equals(pic(1))).toBe(true);
    await page.evaluate(() => window.__canvastDebug.hiddenOp("lock"));
    await expect.poll(() => copies().filter((f) => f.endsWith("p1.png")).length).toBe(0);
  } finally {
    await app.close();
  }
});

test("library files changed outside the app: a renamed or moved file is found by its content, a new one is imported where it lies, a deleted one shows as missing", async () => {
  const ws = tempDir("canvast-ws-");
  const red = makePng(3, 2, () => [220, 30, 30, 255]);
  const blue = makePng(3, 2, () => [30, 30, 220, 255]);
  let { app, page } = await launch(ws);
  const listing = () =>
    page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, l.folders.find((f) => f.id === e.folderIds?.[0])?.name ?? null, e.present, e.instances]).sort()));
  try {
    await page.getByTestId("import-input").setInputFiles({ name: "Hand Study.png", mimeType: "image/png", buffer: red });
    await expect.poll(listing).toEqual([["Hand Study.png", null, true, 1]]);
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.saveStatus())).toBe("verified");
  } finally {
    await app.close();
  }
  // In the file manager: the file renamed into a new folder, a new file dropped into another, a download not finished yet.
  mkdirSync(join(ws, "library/anatomy"));
  renameSync(join(ws, "library/images/hand_study.png"), join(ws, "library/anatomy/Loomis Hands.png"));
  mkdirSync(join(ws, "library/poses"));
  writeFileSync(join(ws, "library/poses/Pose One.png"), blue);
  writeFileSync(join(ws, "library/poses/half.png.part"), blue.subarray(0, 10));
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(listing, { timeout: 10_000 }).toEqual([
      ["Loomis Hands.png", "anatomy", true, 1], // (the placed picture still shows it)
      ["Pose One.png", "poses", true, 0],
    ]);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    // Their files then take their place in the naming convention, as any item's does.
    expect(files(ws).filter((f) => f.startsWith("library/"))).toEqual(["library/anatomy/loomis_hands.png", "library/poses/half.png.part", "library/poses/pose_one.png"]);
  } finally {
    await app.close();
  }
  const poseBytes = readFileSync(join(ws, "library/poses/pose_one.png"));
  rmSync(join(ws, "library/poses/pose_one.png"));
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(listing, { timeout: 10_000 }).toEqual([
      ["Loomis Hands.png", "anatomy", true, 1],
      ["Pose One.png", "poses", false, 0],
    ]);
    // Put back in its place while the app runs (from a trash, by hand): there again at once, no restart.
    writeFileSync(join(ws, "library/poses/pose_one.png"), poseBytes);
    await expect.poll(listing, { timeout: 10_000 }).toEqual([
      ["Loomis Hands.png", "anatomy", true, 1],
      ["Pose One.png", "poses", true, 0],
    ]);
    // A copy of a file the library has, put in another folder under another name: an item of its own, and never removed for it.
    writeFileSync(join(ws, "library/poses/Hand Copy.png"), red);
    await expect.poll(listing, { timeout: 10_000 }).toEqual([
      ["Hand Copy.png", "poses", true, 0],
      ["Loomis Hands.png", "anatomy", true, 1],
      ["Pose One.png", "poses", true, 0],
    ]);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect.poll(() => files(ws).filter((f) => f.startsWith("library/") && f.endsWith(".png")).sort(), { timeout: 10_000 }).toEqual(["library/anatomy/loomis_hands.png", "library/poses/hand_copy.png", "library/poses/pose_one.png"]);
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-search").fill("is:copy");
    await expect(page.locator('[data-testid="asset-card"]')).toHaveCount(2);
  } finally {
    await app.close();
  }
  // A file far past what can be read into the page (300 MiB, sparse: no disk used): taken in where it lies from its hash, as a card.
  ({ app, page } = await launch(ws));
  try {
    truncateSync((writeFileSync(join(ws, "library/poses/huge_scan.tif"), ""), join(ws, "library/poses/huge_scan.tif")), 300 * 2 ** 20);
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.name === "huge_scan.tif").map((e) => [e.present, e.size, !!e.card]))), { timeout: 30_000 }).toEqual([[true, 300 * 2 ** 20, true]]);
    // An art file that big keeps its picture: read a part at a time, and the card takes its shape.
    const png = makePng(30, 10, () => [240, 120, 0, 255]);
    const name = Buffer.from("preview.png");
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const entry = Buffer.alloc(46 + name.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt32LE(png.length, 20);
    entry.writeUInt32LE(png.length, 24);
    entry.writeUInt16LE(name.length, 28);
    name.copy(entry, 46);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt32LE(entry.length, 12);
    const dirAt = 300 * 2 ** 20;
    end.writeUInt32LE(dirAt, 16);
    const artPath = join(ws, "library/poses/huge_art.kra");
    writeFileSync(artPath, Buffer.concat([local, png]));
    truncateSync(artPath, dirAt); // (the rest of the file a hole: no disk used)
    appendFileSync(artPath, Buffer.concat([entry, end]));
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.name === "huge_art.kra").map((e) => [e.present, e.pixelW, e.pixelH]))), { timeout: 30_000 }).toEqual([[true, 800, 267]]);
  } finally {
    await app.close();
  }
  rmSync(join(ws, "library/poses/huge_scan.tif"));
  rmSync(join(ws, "library/poses/huge_art.kra"));
  // A file put in while the app is closed: at the next start only what changed since the last look is looked at (kept in the app's own
  // folder), and the new file is found that way too.
  writeFileSync(join(ws, "library/poses/while_closed.png"), makePng(3, 3, () => [240, 120, 0, 255]));
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(listing, { timeout: 15_000 }).toEqual([
      ["Hand Copy.png", "poses", true, 0], // (the copy stays an item of its own)
      ["Loomis Hands.png", "anatomy", true, 1],
      ["Pose One.png", "poses", true, 0],
      ["huge_art.kra", "poses", false, 0], // (their files removed above: missing)
      ["huge_scan.tif", "poses", false, 0],
      ["while_closed.png", "poses", true, 0],
    ]);
    expect(readdirSync(join(`${ws}-userdata`, "library-looks"))).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("a file past what the page can hold (300 MiB): imported by the button, hidden and shown again, kept in a backup and brought back, every time the same bytes", async () => {
  const ws = tempDir("canvast-ws-");
  const hugeAt = (path: string, seed: number): string => {
    // (mostly a hole: no disk used; its first and last bytes say which file it is)
    const mark = Buffer.alloc(4096, seed);
    writeFileSync(path, mark);
    truncateSync(path, 300 * 2 ** 20);
    appendFileSync(path, mark);
    return path;
  };
  const shaOf = (path: string): Promise<string> => new Promise((done, fail) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (c) => h.update(c)).on("end", () => done(h.digest("hex"))).on("error", fail);
  });
  const source = hugeAt(join(tempDir("canvast-src-"), "huge_scan.tif"), 7);
  const want = await shaOf(source);
  const size = statSync(source).size;
  let { app, page } = await launch(ws);
  const listing = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, !!e.hidden, e.present, e.size, e.hash])));
  const hid = (op: "set" | "check", pw: string) => page.evaluate(([o, p]) => window.__canvastDebug.hiddenOp(o as "set", p), [op, pw] as const);
  const hide = (v: string) => page.evaluate(([h, x]) => window.__canvastDebug.libraryOp("hide", h!, x!), [want, v] as const);
  const flush = () => page.evaluate(() => window.__canvastDebug.flushStorage());
  const inLibrary = () => files(ws).filter((f) => f.startsWith("library/") && !/\.tmp-/.test(f));
  const sealed = () => files(ws).filter((f) => f.startsWith(".hidden/"));
  const item = ["huge_scan.tif", false, true, size, want];
  try {
    // Imported by the button: copied into the folder, the first write's temporary file gone; the same content again adds nothing.
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-import-input").setInputFiles(source);
    await expect.poll(listing, { timeout: 60_000 }).toEqual([item]);
    await expect.poll(inLibrary).toHaveLength(1);
    const placed = inLibrary()[0]!;
    expect(await shaOf(join(ws, placed))).toBe(want);
    await page.getByTestId("assets-import-input").setInputFiles(source);
    await page.waitForTimeout(3000);
    // (the same content again: it is copied a part at a time to be proven, and that copy goes when the hash says it is not new)
    await expect.poll(() => files(ws).filter((f) => f.startsWith("library/")), { timeout: 60_000 }).toEqual([placed]);

    // Hidden: sealed where nothing readable is left, in the same format the outside tool opens, whole and a chunk at a time.
    expect(await hid("set", "pw")).toEqual({ ok: true, state: "open" });
    await hide("1");
    await flush();
    await expect.poll(() => [inLibrary().length, sealed().length], { timeout: 90_000 }).toEqual([0, 1]);
    const onDisk = join(ws, sealed()[0]!);
    expect(statSync(onDisk).size).toBeGreaterThan(size);
    expect(readFileSync(onDisk).subarray(0, 8).toString()).toBe("CVSTHID2");
    expect(readFileSync(onDisk).includes(Buffer.alloc(4096, 7))).toBe(false);
    const { decryptHidden } = (await import(join(process.cwd(), "scripts/hidden-items.mjs"))) as { decryptHidden: (ws: string, out: string, pw: string, o?: { flat?: boolean; largeFrom?: number }) => Promise<number> };
    for (const largeFrom of [2 ** 30, 2 ** 20]) {
      const out = tempDir("canvast-out-");
      await decryptHidden(ws, out, "pw", { flat: true, largeFrom });
      const got = readdirSync(out).filter((n) => n.endsWith(".tif"));
      expect(got).toHaveLength(1);
      expect(await shaOf(join(out, got[0]!))).toBe(want);
      expect(readdirSync(out).filter((n) => n.startsWith(".opening-"))).toEqual([]);
    }
  } finally {
    await app.close();
  }
  // After a restart, opened with the password: the sealed file holds it; the file back in the library is the same bytes, the sealed one gone.
  ({ app, page } = await launch(ws));
  try {
    expect(await hid("check", "pw")).toMatchObject({ ok: true });
    await expect.poll(listing, { timeout: 60_000 }).toEqual([["huge_scan.tif", true, true, size, want]]);
    await hide("");
    await flush();
    await expect.poll(() => [inLibrary().length, sealed().length], { timeout: 90_000 }).toEqual([1, 0]);
    expect(await shaOf(join(ws, inLibrary()[0]!))).toBe(want);
    // A backup holds it: written where the person chose (tests name the place), a ZIP past 300 MiB that comes back whole in another workspace.
    await page.getByTestId("view-canvas").click();
    await page.getByTestId("save-status").click();
    await page.getByTestId("set-export-full").click();
    await page.getByTestId("choose-ok").click(); // (the passwords and privacy settings: left out)
    await expect(page.getByTestId("toast")).toContainText(/Exported|Export failed/, { timeout: 150_000 });
    await expect(page.getByTestId("toast")).toContainText(/Exported/);
  } finally {
    await app.close();
  }
  const backup = join(`${ws}-exports`, readdirSync(`${ws}-exports`).find((n) => n.endsWith(".canvast"))!);
  expect(statSync(backup).size).toBeGreaterThan(size);
  const ws2 = tempDir("canvast-ws-");
  ({ app, page } = await launch(ws2));
  try {
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.session().tree?.length ?? 0)).toBe(1);
    await page.getByTestId("save-status").click();
    await page.getByTestId("set-import-input").setInputFiles(backup);
    await importMode(page);
    await Promise.all([page.waitForEvent("load", { timeout: 120_000 }), page.getByTestId("confirm-ok").click({ timeout: 120_000 })]);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000 });
    await expect.poll(listing, { timeout: 60_000 }).toEqual([item]);
    const back = files(ws2).filter((f) => f.startsWith("library/") && !/\.tmp-/.test(f));
    expect(back).toHaveLength(1);
    expect(await shaOf(join(ws2, back[0]!))).toBe(want);
  } finally {
    await app.close();
  }
});

test("an item's file saved again outside the app, of any kind (a painting in its own program): the item and its pictures on the canvas follow the new version, its note kept, nothing shown as missing", async () => {
  const ws = tempDir("canvast-ws-");
  const bytes = (n: number, seed: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed * 7) % 251));
  let { app, page } = await launch(ws);
  const listing = () =>
    page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => ({ name: e.name, hash: e.hash, present: e.present, instances: e.instances, note: e.note ?? "" }))));
  const placed = () => page.evaluate(() => (window.__canvastDebug.objects() as unknown as Array<{ assetId?: string }>).map((o) => o.assetId));
  let file = "";
  try {
    await page.getByTestId("import-input").setInputFiles({ name: "Study.kra", mimeType: "application/octet-stream", buffer: bytes(4000, 1) });
    await expect.poll(async () => (await listing()).length).toBe(1);
    const [first] = await listing();
    await page.evaluate((h) => window.__canvastDebug.libraryOp("note", h, "keep me"), first!.hash);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    file = files(ws).find((f) => f.startsWith("library/") && f.endsWith(".kra"))!;
    expect(file).toBeTruthy();
    // Saved again by its program while the app runs (a new size): the same item follows it, on the canvas too.
    await page.waitForTimeout(2000); // (a save a moment after the app's own writes, not in the same batch of the folder's changes)
    writeFileSync(join(ws, file), bytes(5200, 2));
    await expect.poll(async () => (await listing()).map((e) => [e.name, e.present, e.instances, e.note, e.hash !== first!.hash]), { timeout: 15_000 }).toEqual([["Study.kra", true, 1, "keep me", true]]);
    const [second] = await listing();
    expect(await placed()).toEqual([second!.hash]);
    // Saved again at the same size: told apart by its content.
    await page.waitForTimeout(2000);
    writeFileSync(join(ws, file), bytes(5200, 3));
    await expect.poll(async () => (await listing()).map((e) => [e.present, e.hash !== second!.hash]), { timeout: 15_000 }).toEqual([[true, true]]);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
  } finally {
    await app.close();
  }
  // Saved again while the app is closed: followed at the next start.
  writeFileSync(join(ws, file), bytes(6100, 4));
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(async () => (await listing()).map((e) => [e.name, e.present, e.instances, e.note]), { timeout: 15_000 }).toEqual([["Study.kra", true, 1, "keep me"]]);
    const [third] = await listing();
    expect(await placed()).toEqual([third!.hash]);
    expect(readFileSync(join(ws, file)).length, "the file is the one saved, untouched").toBe(6100);
  } finally {
    await app.close();
  }
});

test("a note saved in the notes editor is written over its own file (same name, same place) and its item follows it", async () => {
  const ws = tempDir("canvast-ws-");
  const { app, page } = await launch(ws);
  try {
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-import-input").setInputFiles({ name: "todo.md", mimeType: "text/markdown", buffer: Buffer.from("# Todo\n") });
    await expect(page.getByTestId("asset-card")).toHaveCount(1);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    const file = files(ws).find((f) => f.startsWith("library/") && f.endsWith(".md"))!;
    await page.getByTestId("asset-card").dblclick();
    await page.getByTestId("note-editor").locator(".sun-editor-editable h1").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" today");
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("assets-status")).toContainText("Saved “todo.md”");
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(readFileSync(join(ws, file), "utf8")).toContain("# Todo today");
    expect(files(ws).filter((f) => f.startsWith("library/"))).toEqual([file]);
    await expect(page.getByTestId("asset-card")).toHaveCount(1);
    // Its properties written in another app (as Obsidian does): read into its item, its tags and fields.
    await page.waitForTimeout(2000); // (a save a moment after the app's own writes)
    writeFileSync(join(ws, file), "---\ntags: [plans]\nowner: Ana\n---\n# Todo today\n\nAdded elsewhere.\n");
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, e.tags ?? [], e.fields ?? []]))), { timeout: 15_000 }).toEqual([["todo.md", ["plans"], [{ key: "owner", value: "Ana" }]]]);
    await page.getByTestId("note-editor").locator(".sun-editor-editable h1").first().click();
    await page.keyboard.press("End");
    // Closing the window with changes not saved asks first; Save them saves, then the window closes.
    await page.keyboard.type(" and tomorrow");
    const closed = app.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await expect(page.getByTestId("choose-dialog")).toContainText("has changes that are not saved");
    await page.getByTestId("choose-dialog").getByRole("button", { name: "Go on" }).click(); // (Save them is chosen first)
    // Its words were changed in the other app since it was opened here: replacing them is asked first.
    await expect(page.getByTestId("confirm-dialog")).toContainText("was changed outside canvast since you opened it");
    await page.getByTestId("confirm-ok").click();
    await closed;
    expect(readFileSync(join(ws, file), "utf8")).toMatch(/^---\ntags: \[plans\]\nowner: Ana\n---\n# Todo today and tomorrow/); // (its properties kept)
  } finally {
    await app.close().catch(() => undefined);
  }
});

test("while the app runs it follows the folder: a canvas file renamed by hand, a file dropped into library/, another device's edits (loaded again) and both sides' edits (a conflict copy)", async () => {
  const ws = tempDir("canvast-ws-");
  const a = await launch(ws, "device-a");
  let b: Awaited<ReturnType<typeof launch>> | null = null;
  let shade = 0;
  const add = async (p: Page, n: number): Promise<void> => {
    const before = (await p.evaluate(() => window.__canvastDebug.objects().length));
    for (let i = 0; i < n; i++) {
      const v = 10 + 20 * shade++;
      await p.getByTestId("import-input").setInputFiles({ name: `p${v}.png`, mimeType: "image/png", buffer: makePng(2, 2, () => [v, v, v, 255]) });
    }
    await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(before + n);
  };
  const tree = (p: Page) => p.evaluate(() => window.__canvastDebug.session().tree?.map((x) => [x.name, x.canvases.map((c) => c.name)]) ?? []);
  try {
    await expect.poll(async () => (await tree(a.page)).length).toBe(1);
    const t = await a.page.evaluate(() => window.__canvastDebug.session().tree!);
    await a.page.evaluate(([bid, cid]) => window.__canvastDebug.workspaceOp("renameBoard", bid, "Sketches").then(() => window.__canvastDebug.workspaceOp("renameCanvas", cid, "Characters")), [t[0]!.id, t[0]!.canvases[0]!.id] as [string, string]);
    await add(a.page, 1);
    await a.page.evaluate(() => window.__canvastDebug.flushStorage());

    // By hand, in the file manager (in the app's own folder, but someone may still): the canvas file renamed, a picture dropped into a new folder of library/.
    renameSync(join(ws, `${B}sketches/characters.cvst`), join(ws, `${B}sketches/Heroes.cvst`));
    mkdirSync(join(ws, "library/drops"));
    mkdirSync(join(ws, "library/.obsidian")); // (another app's own folder: never taken into the library)
    writeFileSync(join(ws, "library/.obsidian/app.json"), "{}");
    writeFileSync(join(ws, "library/drops/New One.png"), makePng(2, 2, () => [5, 200, 5, 255]));
    await expect.poll(() => tree(a.page), { timeout: 10_000 }).toEqual([["Sketches", ["Heroes"]]]);
    await expect.poll(() => a.page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.name === "New One.png").map((e) => l.folders.find((f) => f.id === e.folderIds?.[0])?.name))), { timeout: 10_000 }).toEqual(["drops"]);
    expect(await a.page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.name === "app.json").length))).toBe(0);
    await a.page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(files(ws).filter((f) => f.endsWith(".cvst"))).toEqual([`${B}sketches/heroes.cvst`]);

    // Another device on the same folder at the same time: its saved edits are loaded again on this one (no edits here).
    b = await launch(ws, "device-b");
    await expect.poll(() => b!.page.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
    await add(b.page, 2);
    await b.page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect.poll(() => a.page.evaluate(() => window.__canvastDebug.objects().length), { timeout: 10_000 }).toBe(3);
    const savedByB = readFileSync(join(ws, `${B}sketches/heroes.cvst`)); // (device B's version: kept for the sync tool's copy below)

    // Both edit before either file is written: this device keeps the folder's version, and its own as a conflict copy.
    await add(a.page, 1);
    await add(b.page, 1);
    await b.page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect.poll(async () => (await tree(a.page)).map(([n, cs]) => [n, (cs as string[]).map((c) => c.replace(/\(conflict [^)]*\)/, "(conflict)"))]), { timeout: 10_000 }).toEqual([["Sketches", ["Heroes", "Heroes (conflict)"]]]);
    await expect.poll(() => a.page.evaluate(() => window.__canvastDebug.objects().length)).toBe(4); // (the folder's version: 3 + device B's one)

    // A sync tool kept two versions of the canvas file: device B's beside the canvas's own. Device B (whose edits it holds) makes it a
    // canvas of its own at once; device A waits (so they do not both). A copy the same as the canvas's file only goes, into .trash/.
    await b.page.evaluate(() => window.__canvastDebug.flushStorage());
    await a.page.evaluate(() => window.__canvastDebug.flushStorage());
    writeFileSync(join(ws, `${B}sketches/heroes (1).cvst`), savedByB);
    writeFileSync(join(ws, `${B}sketches/heroes (2).cvst`), readFileSync(join(ws, `${B}sketches/heroes.cvst`)));
    const names = (p: Page) => tree(p).then((t) => t.flatMap(([, cs]) => (cs as string[]).map((c) => c.replace(/\(conflict from sync [^)]*\)/, "(sync)").replace(/\(conflict [^)]*\)/, "(conflict)"))));
    for (const p of [b.page, a.page]) await expect.poll(() => names(p), { timeout: 15_000 }).toEqual(["Heroes", "Heroes (conflict)", "Heroes (sync)"]);
    await expect.poll(() => files(ws).filter((f) => f.startsWith(`${B}sketches/heroes (`)), { timeout: 10_000 }).toEqual([]);
    expect(files(ws).filter((f) => f.startsWith(".trash/") && f.endsWith(".cvst"))).toHaveLength(2);
    const synced = files(ws).find((f) => /sketches\/heroes-conflict_from_sync.*\.cvst$/.test(f))!;
    expect((JSON.parse(readFileSync(join(ws, synced), "utf8")) as { objects: unknown[] }).objects).toHaveLength(3); // (device B's version: 3 objects)
  } finally {
    await b?.app.close();
    await a.app.close();
  }
});

test("custom thumbnails in the workspace folder: an uploaded one in .canvast/thumbnails/, sealed into .hidden/thumbnails/ when its item is hidden, readable again when it is shown", async () => {
  const ws = tempDir("canvast-ws-");
  const { app, page } = await launch(ws);
  try {
    await page.getByTestId("import-input").setInputFiles({ name: "notes.xyz", mimeType: "application/octet-stream", buffer: Buffer.from("not a picture") });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length))).toBe(1);
    const hash = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries[0]!.hash));
    expect((await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"))).ok).toBe(true);
    await page.getByTestId("view-assets").click();
    await page.locator(`[data-testid="asset-card"][data-hash="${hash}"]`).click();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      (async () => {
        await page.getByTestId("asset-thumb").click();
        await page.getByRole("radio", { name: /Upload a picture/ }).check();
        await page.getByTestId("choose-ok").click();
      })(),
    ]);
    await chooser.setFiles({ name: "cover.png", mimeType: "image/png", buffer: makePng(40, 30, () => [200, 40, 40, 255]) });
    const inDir = (d: string) => (existsSync(join(ws, d)) ? readdirSync(join(ws, d)).filter((f) => !f.includes(".tmp-")) : []); // (not one still being written)
    await expect.poll(() => inDir(".canvast/thumbnails").length).toBe(1);
    expect(inDir(".canvast/thumbnails")[0]).toMatch(/^[0-9a-f]{64}\.webp$/);
    const thumbName = inDir(".canvast/thumbnails")[0]!;
    const webp = readFileSync(join(ws, ".canvast/thumbnails", thumbName));
    // Hidden: the thumbnail goes with it, sealed; nothing readable of it is left.
    await page.getByTestId("asset-hide").click();
    await expect.poll(() => inDir(".hidden/thumbnails").length).toBe(1);
    expect(inDir(".canvast/thumbnails")).toEqual([]);
    expect(readFileSync(join(ws, ".hidden/thumbnails", inDir(".hidden/thumbnails")[0]!)).includes(webp.subarray(12, 40))).toBe(false);
    // Outside the app, the tool writes it out with the hidden items (thumbnails/<hash>.webp).
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    const { decryptHidden } = (await import(join(process.cwd(), "scripts/hidden-items.mjs"))) as { decryptHidden: (ws: string, out: string, pw: string) => Promise<number> };
    await decryptHidden(ws, `${ws}-out`, "pw");
    expect(readFileSync(join(`${ws}-out`, "thumbnails", thumbName)).equals(webp)).toBe(true);
    // Shown again (from hidden mode): readable again.
    await page.getByTestId("assets-search").fill("hidden:");
    await page.getByTestId("prompt-input").fill("pw");
    await page.getByTestId("prompt-ok").click();
    await page.locator(`[data-testid="asset-card"][data-hash="${hash}"]`).click();
    await page.getByTestId("asset-hide").click();
    await expect.poll(() => inDir(".canvast/thumbnails").length).toBe(1);
    expect(inDir(".hidden/thumbnails")).toEqual([]);
  } finally {
    await app.close();
  }
});

test("a workspace folder renamed onto the path of another opened before reads none of that one's cache: its own library, its hidden items, nothing of the other written", async () => {
  const base = tempDir("canvast-ren-");
  const [a, b] = [join(base, "main"), join(base, "other")];
  mkdirSync(a);
  mkdirSync(b);
  const mine = makePng(3, 2, () => [220, 30, 30, 255]);
  const secret = makePng(2, 2, () => [30, 220, 30, 255]);
  const theirs = makePng(2, 3, () => [30, 30, 220, 255]);
  const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");
  const names = (page: Page) => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, !!e.hidden]).sort()));
  // The other workspace, opened here once with an item of its own (this device's cache of it is kept by the app), then deleted.
  let { app, page } = await launch(b, "device");
  try {
    await page.getByTestId("import-input").setInputFiles({ name: "Theirs.png", mimeType: "image/png", buffer: theirs });
    await expect.poll(() => names(page)).toEqual([["Theirs.png", false]]);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
  } finally {
    await app.close();
  }
  rmSync(b, { recursive: true });
  ({ app, page } = await launch(a, "device-a"));
  try {
    await page.getByTestId("import-input").setInputFiles([{ name: "Mine.png", mimeType: "image/png", buffer: mine }, { name: "Secret.png", mimeType: "image/png", buffer: secret }]);
    await expect.poll(() => names(page)).toHaveLength(2);
    await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"));
    await page.evaluate((h) => window.__canvastDebug.libraryOp("hide", h, "1"), sha(secret));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
  } finally {
    await app.close();
  }
  // The main workspace renamed to the deleted one's name, and opened on the device that knew the other.
  renameSync(a, b);
  renameSync(`${a}-device-a`, `${b}-device-a`); // (not used: the device of the other is)
  ({ app, page } = await launch(b, "device"));
  try {
    // (read again from the folder, as on a new device: the hidden item comes from its sealed index once the password is given)
    await expect.poll(() => names(page), { timeout: 15_000 }).toEqual([["Mine.png", false]]);
    expect((await page.evaluate(() => window.__canvastDebug.hiddenOp("check", "pw"))).ok).toBe(true);
    await expect.poll(() => names(page), { timeout: 15_000 }).toEqual([["Mine.png", false], ["Secret.png", true]]);
    expect(await page.evaluate((h) => window.__canvastDebug.originalBytes(h), sha(secret))).toEqual(Array.from(secret));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    // Nothing of the other was written into it.
    expect(files(b).some((f) => readFileSync(join(b, f)).toString("latin1").includes(sha(theirs)))).toBe(false);
  } finally {
    await app.close();
  }
});

test("hidden items' files are kept in their library folders inside .hidden/, the folders' names encrypted: a rename or a move renames, never encrypts again", async () => {
  const ws = tempDir("canvast-ws-");
  const art = makePng(3, 3, () => [120, 30, 200, 255]);
  const hash = createHash("sha256").update(art).digest("hex");
  const { app, page } = await launch(ws);
  const lib = (...a: Parameters<typeof window.__canvastDebug.libraryOp>) => page.evaluate((a) => window.__canvastDebug.libraryOp(...a), a);
  const flush = () => page.evaluate(() => window.__canvastDebug.flushStorage());
  const sealed = () => files(ws).filter((f) => f.startsWith(".hidden/") && !f.startsWith(".hidden/thumbnails/"));
  type Tool = { decryptHidden: (ws: string, out: string, pw: string) => Promise<number> };
  const { decryptHidden } = (await import(join(process.cwd(), "scripts/hidden-items.mjs"))) as Tool;
  let studySeg = "";
  let studyAt = "";
  try {
    await page.getByTestId("import-input").setInputFiles({ name: "Study.png", mimeType: "image/png", buffer: art });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length))).toBe(1);
    expect((await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"))).ok).toBe(true);
    await lib("createFolder", "fa", "Hidden Art");
    await lib("createFolder", "fi", "Items", "fa");
    await lib("file", hash, "fi");
    await lib("hide", hash, "1");
    await flush();
    // In its folders, each name encrypted: nothing of "Hidden Art" or "Items" is readable in a path.
    const [first] = sealed();
    expect(sealed()).toHaveLength(1);
    expect(first).toMatch(/^\.hidden\/[a-z2-7]{26,}\/[a-z2-7]{26,}\/[a-z2-7]{26,}$/);
    expect(first).not.toMatch(/art|items|study/i);
    studySeg = first!.split("/").pop()!; // ("Study.png", encrypted)
    const bytes = readFileSync(join(ws, first!));
    // The folder renamed: only its folder is renamed; the file is the same bytes (a sync tool sees a rename).
    await lib("renameFolder", "fi", "Pieces");
    await flush();
    await expect.poll(() => sealed()[0]).not.toBe(first);
    const renamed = sealed()[0]!;
    expect(renamed.split("/")[1]).toBe(first!.split("/")[1]);
    expect(renamed.split("/").pop()).toBe(first!.split("/").pop());
    expect(readFileSync(join(ws, renamed)).equals(bytes)).toBe(true);
    expect(existsSync(join(ws, ...first!.split("/").slice(0, 3)))).toBe(false); // (the old folder is gone)
    // Outside the app, the tool writes the tree and the names the folders and files say (nothing but its hash is inside the file).
    expect(await decryptHidden(ws, `${ws}-out`, "pw")).toBe(1);
    expect(readFileSync(join(`${ws}-out`, "Hidden Art", "Pieces", "Study.png")).equals(art)).toBe(true);
    // Filed in the parent folder: the file moves up, the emptied folder goes.
    await lib("file", hash, "fa");
    await flush();
    await expect.poll(() => sealed()[0]).toMatch(/^\.hidden\/[a-z2-7]{26,}\/[a-z2-7]{26,}$/);
    expect(readFileSync(join(ws, sealed()[0]!)).equals(bytes)).toBe(true);
    expect(existsSync(join(ws, ...renamed.split("/").slice(0, 3)))).toBe(false);
    // Renamed: only its file is renamed. A note: only the sealed index changes, never the file (a sync tool uploads nothing big).
    const before = sealed()[0]!;
    await lib("rename", hash, "Study Final.png");
    await flush();
    await expect.poll(() => sealed()[0]).not.toBe(before);
    expect(readFileSync(join(ws, sealed()[0]!)).equals(bytes)).toBe(true);
    const at = sealed()[0]!;
    studyAt = at;
    const mtime = statSync(join(ws, at)).mtimeMs;
    await lib("note", hash, "a note about it");
    await flush();
    expect([sealed()[0], statSync(join(ws, at)).mtimeMs]).toEqual([at, mtime]);
    // A name too long to encrypt into a file name: a short one, with the name sealed in a `.name` beside it; the tool reads it back.
    const longName = `${"Long reference sheet ".repeat(9)}.png`;
    const other = makePng(2, 2, () => [10, 200, 200, 255]);
    await page.getByTestId("import-input").setInputFiles({ name: longName, mimeType: "image/png", buffer: other });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length))).toBe(2);
    await lib("hide", createHash("sha256").update(other).digest("hex"), "1");
    await flush();
    const longFile = sealed().find((f) => /\/0[a-z2-7]+$/.test(f));
    expect(longFile, "a short name for it").toBeTruthy();
    expect(existsSync(join(ws, `${longFile}.name`))).toBe(true);
    expect(await decryptHidden(ws, `${ws}-long`, "pw")).toBe(2);
    expect(readFileSync(join(`${ws}-long`, longName)).equals(other)).toBe(true);
  } finally {
    await app.close();
  }
  // Renamed and moved outside the app (a file manager, a sync tool): to the top, under another (encrypted) name it had before. Found
  // by the hash inside it; its name and folder are taken from its place.
  const elsewhere = `.hidden/${studySeg}`;
  renameSync(join(ws, studyAt), join(ws, elsewhere));
  const again = await launch(ws);
  try {
    expect((await again.page.evaluate(() => window.__canvastDebug.hiddenOp("check", "pw"))).ok).toBe(true);
    const item = () => again.page.evaluate((h) => window.__canvastDebug.assetListing().then((l) => { const e = l.entries.find((x) => x.hash === h); return e ? [e.name, e.folderIds?.length ?? 0, e.present] : null; }), hash);
    await expect.poll(item, { timeout: 40_000 }).toEqual(["Study.png", 0, true]);
    expect(await again.page.evaluate((h) => window.__canvastDebug.originalBytes(h), hash)).toEqual(Array.from(art));
  } finally {
    await again.app.close();
  }
});

test("the library's files in .canvast/library/ deleted by hand: nothing is taken as erased, and this device's copy writes them all back", async () => {
  const ws = tempDir("canvast-ws-");
  const pics = [1, 2, 3].map((k) => makePng(k + 1, 2, () => [k * 60, 40, 90, 255]));
  let { app, page } = await launch(ws);
  const parts = () => (existsSync(join(ws, ".canvast/library")) ? readdirSync(join(ws, ".canvast/library")).sort() : []);
  let before: string[] = [];
  try {
    await page.getByTestId("import-input").setInputFiles(pics.map((buffer, k) => ({ name: `Pic ${k}.png`, mimeType: "image/png", buffer })));
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length)), { timeout: 20_000 }).toBe(3);
    await page.evaluate((h) => window.__canvastDebug.libraryOp("note", h, "kept note"), createHash("sha256").update(pics[0]!).digest("hex"));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    before = parts();
    expect(before).toContain("index.json");
  } finally {
    await app.close();
  }
  rmSync(join(ws, ".canvast/library"), { recursive: true });
  rmSync(join(ws, ".canvast/library.json"), { force: true }); // (the copy a small library also has: gone too, the worst case)
  ({ app, page } = await launch(ws));
  try {
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect.poll(parts, { timeout: 15_000 }).toEqual(before);
    const listing = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, e.state, e.note ?? ""]).sort()));
    expect(listing).toEqual([["Pic 0.png", "active", "kept note"], ["Pic 1.png", "active", ""], ["Pic 2.png", "active", ""]]);
    expect(parts().filter((n) => n.startsWith("items-")).map((n) => readFileSync(join(ws, ".canvast/library", n), "utf8")).join("")).toContain("kept note");
  } finally {
    await app.close();
  }
});

test("the library's files split another way (Settings > Storage, Library files): 16 or 4,096 parts, read back the same, kept by the workspace", async () => {
  const ws = tempDir("canvast-ws-");
  const pics = [1, 2, 3, 4, 5].map((k) => makePng(k + 1, 3, () => [k * 40, 120, 60, 255]));
  let { app, page } = await launch(ws);
  const parts = () => readdirSync(join(ws, ".canvast/library")).filter((n) => n.startsWith("items-")).map((n) => n.slice(6, -5));
  const index = () => JSON.parse(readFileSync(join(ws, ".canvast/library/index.json"), "utf8")) as { version: number; split?: number; parts: string[] };
  const listing = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, e.state]).sort()));
  const choose = async (split: string): Promise<void> => {
    await page.getByTestId("view-settings").click();
    await page.getByRole("tab", { name: /Storage/ }).click();
    await page.getByTestId("set-library-split").selectOption(split);
    await page.getByTestId("confirm-ok").click();
    await page.evaluate(() => window.__canvastDebug.flushStorage());
  };
  let before: unknown;
  try {
    await page.getByTestId("import-input").setInputFiles(pics.map((buffer, k) => ({ name: `P${k}.png`, mimeType: "image/png", buffer })));
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length))).toBe(5);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    before = await listing();
    expect(parts().every((k) => k.length === 2)).toBe(true);
    await choose("1");
    await expect.poll(() => parts().every((k) => k.length === 1)).toBe(true);
    expect(index()).toMatchObject({ version: 4, split: 1 });
    expect(index().parts.sort()).toEqual(parts().sort());
    expect(await listing()).toEqual(before);
  } finally {
    await app.close();
  }
  // Started again: the workspace keeps its split, nothing is taken as erased; then 4,096.
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(listing).toEqual(before);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(parts().every((k) => k.length === 1)).toBe(true);
    await choose("3");
    await expect.poll(() => parts().every((k) => k.length === 3)).toBe(true);
    expect(index()).toMatchObject({ version: 4, split: 3 });
    expect(await listing()).toEqual(before);
  } finally {
    await app.close();
  }
});

test("working copies no workspace names any more, untouched for a month, are removed at start-up; the open one's are kept", async () => {
  const ws = tempDir("canvast-ws-");
  const data = `${ws}-userdata`;
  const old = new Date(Date.now() - 40 * 24 * 3600_000);
  mkdirSync(join(data, "Partitions", "ws-0123456789abcdef01234567"), { recursive: true });
  writeFileSync(join(data, "Partitions", "ws-0123456789abcdef01234567", "x"), "old");
  mkdirSync(join(data, "library-db"), { recursive: true });
  writeFileSync(join(data, "library-db", "0123456789abcdef01234567.sqlite"), "old");
  mkdirSync(join(data, "Partitions", "ws-fresh00000000000000000000"), { recursive: true }); // (recent: kept, it may be in use)
  utimesSync(join(data, "Partitions", "ws-0123456789abcdef01234567"), old, old);
  utimesSync(join(data, "library-db", "0123456789abcdef01234567.sqlite"), old, old);
  const { app, page } = await launch(ws);
  try {
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect.poll(() => existsSync(join(data, "Partitions", "ws-0123456789abcdef01234567")), { timeout: 15_000 }).toBe(false);
    expect(existsSync(join(data, "library-db", "0123456789abcdef01234567.sqlite"))).toBe(false);
    expect(existsSync(join(data, "Partitions", "ws-fresh00000000000000000000"))).toBe(true);
    const own = (JSON.parse(readFileSync(join(data, "partitions.json"), "utf8")) as Record<string, { partition: string }>)[ws]!.partition.slice("persist:".length);
    expect(existsSync(join(data, "Partitions", own))).toBe(true);
  } finally {
    await app.close();
  }
});

test("a note's pictures are found by their files: pasted ones (the disk's name not the item's), one added from outside, a copy; written from the library's root; a note made rich text is a .note.html file", async () => {
  const ws = tempDir("cv-note-pics-");
  const { app, page } = await launch(ws);
  const words = page.getByTestId("note-editor").locator(".sun-editor-editable").first();
  const shown = () => words.locator("img").evaluateAll((l) => l.map((i) => (i as HTMLImageElement).naturalWidth > 0));
  const entry = (name: string) => page.locator(`[data-testid="asset-card"][title="${name}"]`).first();
  const png = (seed: number): Buffer => makePng(6, 4, () => [seed, 90, 40, 255]);
  await page.getByTestId("view-assets").click();
  await page.getByTestId("assets-import-input").setInputFiles({ name: "note.md", mimeType: "text/markdown", buffer: Buffer.from("# Note\n\nWords.\n") });
  await entry("note.md").dblclick();
  await expect(words.locator("h1")).toHaveText("Note");
  // Pasted, as from another program: one picture each, named as the disk cannot name them.
  const names = ["image.png", "image.png", "photo (1).png", "my cat.png"];
  for (const [i, name] of names.entries()) {
    await words.locator("h1").click();
    await words.evaluate((el, [bytes, name]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes as number[])], name as string, { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [[...png(10 + i)], name] as const);
    await expect(words.locator("img")).toHaveCount(i + 1);
  }
  await expect(words.locator(".se-file-figure")).toHaveCount(0); // (not also a link to the file)
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("choose-dialog")).toHaveCount(0); // (a picture is no formatting to ask about)
  await expect.poll(() => readFileSync(join(ws, "library/notes/note.md"), "utf8")).toContain("![](images/my_cat.png)");
  expect(files(ws).filter((f) => f.startsWith("library/images/"))).toHaveLength(4); // (each stored once)
  await page.getByTestId("slide-view").locator('[data-act="close"]').click();
  await entry("note.md").waitFor();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="asset-card"][title="note.md"]').first().dblclick();
  await expect.poll(shown).toEqual([true, true, true, true]);
  await page.getByTestId("slide-view").locator('[data-act="close"]').click();
  // From outside the app: however the link is written, and a copy of a file the library has (an item of its own).
  mkdirSync(join(ws, "library/ext"), { recursive: true });
  writeFileSync(join(ws, "library/ext/orig (2).png"), png(90));
  writeFileSync(join(ws, "library/ext/copy.png"), png(90));
  writeFileSync(join(ws, "library/ext/out.md"), "# Out\n\n![a](orig%20(2).png)\n\n![b](<orig (2).png>)\n\n![c](copy.png)\n\n![d](ext/copy.png)\n\n![e](library/ext/copy.png)\n");
  await expect(entry("out.md")).toBeAttached({ timeout: 15_000 });
  // (its folder comes a moment after the item, and its links are read from there)
  await expect.poll(() => page.evaluate(async () => (await window.__canvastDebug.assetListing()).entries.find((e) => e.name === "out.md")?.folderIds?.length ?? 0), { timeout: 15_000 }).toBeGreaterThan(0);
  // (its picture may come in after it: an open note shows it when it does)
  await entry("out.md").dblclick();
  await expect.poll(shown, { timeout: 20_000 }).toEqual([true, true, true, true, true]);
  // Made rich text: a file of that kind, in its place.
  await words.locator("h1").click();
  await page.getByTestId("note-editor").locator('.se-toolbar button[data-command="align"]').first().click();
  await page.locator('.se-dropdown button[data-command="center"]').filter({ visible: true }).click();
  await page.keyboard.press("Control+s");
  await page.getByTestId("choose-dialog").getByRole("button", { name: "Save" }).click();
  await expect.poll(() => files(ws).filter((f) => /out\./.test(f)), { timeout: 15_000, message: "the note saved as rich text" }).toEqual(["library/ext/out.note.html"]).catch(async (e: Error) => {
    throw new Error(`${e.message}\nDialogs open: ${JSON.stringify(await page.locator("dialog[open]").allInnerTexts())}; bar says: ${await page.evaluate(() => document.querySelector(".hud-message, [role=status]")?.textContent ?? "")}`);
  });
  await app.close();
});

test("a file renamed outside the app keeps its place in notes: the links follow, while the app runs and when it was closed", async () => {
  const ws = tempDir("cv-note-rename-");
  let { app, page } = await launch(ws);
  const note = join(ws, "library/ext/n.md");
  mkdirSync(join(ws, "library/ext"), { recursive: true });
  writeFileSync(join(ws, "library/ext/pic_one.png"), makePng(6, 4, () => [70, 90, 40, 255]));
  writeFileSync(note, "# N\n\n![a](pic_one.png)\n\n![[pic_one.png]]\n");
  await page.getByTestId("view-assets").click();
  await expect(page.locator('[data-testid="asset-card"][title="n.md"]')).toBeAttached({ timeout: 15_000 });
  // While it runs (a name the disk writes its own way).
  renameSync(join(ws, "library/ext/pic_one.png"), join(ws, "library/ext/Second Name.png"));
  await expect.poll(() => readFileSync(note, "utf8"), { timeout: 15_000 }).toContain("![a](ext/second_name.png)");
  expect(readFileSync(note, "utf8")).toContain("![[Second Name.png]]");
  expect(existsSync(join(ws, "library/ext/second_name.png"))).toBe(true);
  await app.close();
  // While it is closed.
  renameSync(join(ws, "library/ext/second_name.png"), join(ws, "library/ext/third.png"));
  ({ app, page } = await launch(ws));
  await expect.poll(() => readFileSync(note, "utf8"), { timeout: 15_000 }).toContain("![a](ext/third.png)");
  expect(readFileSync(note, "utf8")).toContain("![[third.png]]");
  await page.getByTestId("view-assets").click();
  await page.locator('[data-testid="asset-card"][title="n.md"]').dblclick();
  const words = page.getByTestId("note-editor").locator(".sun-editor-editable").first();
  await expect.poll(() => words.locator("img").evaluateAll((l) => l.map((i) => (i as HTMLImageElement).naturalWidth > 0))).toEqual([true, true]);
  await app.close();
});

test("the Trash is a state of the library: this workspace's .trash for the mode, in the library's cards, with Restore and Delete for good in the details", async () => {
  const ws = tempDir("cv-trash-");
  let { app, page } = await launch(ws, "userdata", true);
  try {
    await page.getByTestId("view-assets").click();
    const png = (seed: number) => makePng(60, 40, () => [seed, 90, 40, 255]);
    await page.getByTestId("assets-import-input").setInputFiles([{ name: "keep.png", mimeType: "image/png", buffer: png(10) }, { name: "gone.png", mimeType: "image/png", buffer: png(60) }, { name: "also.png", mimeType: "image/png", buffer: png(90) }, { name: "secret.png", mimeType: "image/png", buffer: png(120) }]);
    await expect.poll(() => files(ws).filter((f) => f.startsWith("library/")).length, { timeout: 15_000 }).toBe(4);
    const hashOf = (n: string) => page.evaluate((n) => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.name === n)!.hash), n);
    const trash = page.locator('[data-scope="trash"]');
    const cards = page.getByTestId("trash-card");
    const libraryCards = page.getByTestId("asset-card");
    const search = page.getByTestId("assets-search");
    const trashedShown = () => files(ws).filter((f) => f.startsWith(".trash/library/")).length;
    const gone = await hashOf("gone.png");
    const also = await hashOf("also.png");
    await page.evaluate((h) => window.__canvastDebug.deleteEverywhere(h), [gone, also]);
    await expect.poll(trashedShown, { timeout: 15_000 }).toBe(2);
    // In place of the grid: only they, the library's cards gone, only Trash lit, its count and size below.
    await trash.click();
    await expect(search).toHaveValue("is:trash");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toBeInViewport();
    await expect(libraryCards.filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('[data-scope="trash"].is-active')).toHaveCount(1);
    await expect(page.locator('[data-scope="all"].is-active')).toHaveCount(0);
    await expect(page.getByTestId("assets-count")).toHaveText("2 files in the trash");
    await expect(page.getByTestId("inspector-empty")).toContainText("Select a file");
    // Anything else of the sidebar goes back, and the library is there.
    for (const other of ["unfiled", "all", "favorites"]) {
      await page.locator(`[data-scope="${other}"]`).click();
      await expect(search).toHaveValue("");
      await expect(cards.filter({ visible: true })).toHaveCount(0);
      await trash.click();
      await expect(cards.first()).toBeInViewport();
    }
    await page.locator('[data-scope="all"]').click();
    await expect(libraryCards.first()).toBeInViewport();
    await trash.click();
    await trash.click(); // (this again: out)
    await expect(search).toHaveValue("");
    await expect(libraryCards.first()).toBeInViewport();
    await trash.click();
    // By name, in the box.
    await search.fill("is:trash nothing");
    await expect(page.getByTestId("trash-empty")).toBeVisible();
    await search.fill("is:trash gone");
    await expect(cards).toHaveCount(1);
    await search.fill("is:trash");
    await expect(cards).toHaveCount(2);
    // Picked: the details say so. Restored: its file where it was, its item back, out of the trash.
    await cards.filter({ hasText: "gone.png" }).click();
    await expect(cards.filter({ hasText: "gone.png" })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("trash-restore").click();
    await expect(cards).toHaveCount(1);
    await expect.poll(() => files(ws).filter((f) => f.startsWith("library/") && f.endsWith("gone.png")).length, { timeout: 15_000 }).toBe(1);
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.some((e) => e.hash === h && e.present)), gone), { timeout: 15_000 }).toBe(true);
    // Delete for good, from its right-click menu: asked first.
    await cards.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete for good" }).click();
    await page.getByTestId("confirm-ok").click();
    await expect(cards).toHaveCount(0);
    await expect(page.getByTestId("trash-empty")).toBeVisible();
    await expect.poll(trashedShown).toBe(0);
    await search.fill("");
    // A hidden item's sealed file in .trash/.hidden (an item deleted on purpose is erased; this is what a stopped app could leave): nothing of it outside hidden mode, not even the count.
    expect(await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"))).toEqual({ ok: true, state: "open" });
    const secret = await hashOf("secret.png");
    await page.evaluate((h) => window.__canvastDebug.libraryOp("hide", h, "1"), secret);
    const sealedFiles = () => files(ws).filter((f) => f.startsWith(".hidden/") && !f.endsWith(".json") && !f.includes("/thumbnails/") && !f.endsWith(".name"));
    await expect.poll(() => sealedFiles().length, { timeout: 15_000 }).toBe(1);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await app.close();
    const sealedFile = sealedFiles()[0]!;
    mkdirSync(join(ws, ".trash", sealedFile.slice(0, sealedFile.lastIndexOf("/"))), { recursive: true });
    renameSync(join(ws, sealedFile), join(ws, ".trash", sealedFile));
    ({ app, page } = await launch(ws, "userdata", true));
    await page.getByTestId("view-assets").click();
    await page.locator('[data-scope="trash"]').click();
    await expect(page.getByTestId("trash-empty")).toBeVisible();
    await expect(page.getByTestId("assets-count")).toHaveText("0 files in the trash");
    await page.getByTestId("assets-search").fill("");
    // In hidden mode: it, by its own name, and only it. Restored: sealed where it was, hidden still.
    await page.getByTestId("assets-search").fill("hidden:");
    await page.getByTestId("prompt-input").fill("pw");
    await page.getByTestId("prompt-ok").click();
    await expect(page.getByTestId("hidden-mode-exit")).toBeVisible();
    await page.locator('[data-scope="trash"]').click();
    const back = page.getByTestId("trash-card");
    await expect(back).toHaveCount(1);
    await expect(back).toContainText("secret.png");
    await back.first().click();
    await page.getByTestId("trash-restore").click();
    await expect(back).toHaveCount(0);
    await expect.poll(() => files(ws).filter((f) => f.startsWith(".trash/.hidden/")).length).toBe(0);
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.originalBytes(h), secret), { timeout: 15_000 }).toEqual(Array.from(png(120)));
    await page.getByTestId("assets-search").fill("");
    await page.getByTestId("hidden-mode-exit").click();
  } finally {
    await app.close();
  }
});

test("the window frame off: a row from the top edge has the window's buttons and moves it; after a restart, and back", async () => {
  const ws = tempDir("cv-frame-");
  let { app, page } = await launch(ws, "userdata", true);
  try {
    await expect(page.getByTestId("win-close")).toHaveCount(0);
    await page.evaluate(() => window.__canvastDebug.setSetting("ui.frame", "off"));
    await expect.poll(() => readFileSync(`${ws}-userdata/window.json`, "utf8")).toContain("off");
    await expect(page.getByTestId("win-close")).toHaveCount(0); // (a window's frame cannot change: at the next start)
    await app.close();
    ({ app, page } = await launch(ws, "userdata", true));
    // It shows for a moment at the start, goes, comes from the very top edge, and goes when the pointer leaves.
    const row = page.getByTestId("win-row");
    await expect(row).toHaveClass(/is-shown/);
    await expect(page.getByTestId("win-close")).toBeVisible();
    await expect(row).not.toHaveClass(/is-shown/, { timeout: 8_000 });
    await expect(page.getByTestId("win-close")).toBeHidden();
    await page.mouse.move(400, 300);
    await page.mouse.move(400, 1);
    await expect(row).toHaveClass(/is-shown/);
    await expect(page.getByTestId("win-minimize")).toBeVisible();
    await expect(page.getByTestId("win-maximize")).toBeVisible();
    await expect(page.getByTestId("win-close")).toBeVisible();
    expect(await row.evaluate((e) => getComputedStyle(e).getPropertyValue("-webkit-app-region"))).not.toBe("drag"); // (the row itself never)
    // Its title is a drag area, as an app's title bar is (the desktop moves the window): only while it shows, never its buttons, and the row is
    // the page's own element then, not in the top layer, where a drag area once took the whole window.
    expect(await row.evaluate((e) => e.matches(":popover-open"))).toBe(false);
    expect(await page.locator(".win-title").evaluate((e) => getComputedStyle(e).getPropertyValue("-webkit-app-region"))).toBe("drag");
    expect(await page.getByTestId("win-close").evaluate((e) => getComputedStyle(e).getPropertyValue("-webkit-app-region"))).toBe("no-drag");
    await page.getByTestId("win-maximize").focus(); // (a button clicked keeps the focus: that must not keep the row)
    await page.mouse.move(400, 300);
    await expect(row).not.toHaveClass(/is-shown/);
    await page.evaluate(() => window.__canvastDebug.setSetting("ui.frame", "system"));
    await expect.poll(() => readFileSync(`${ws}-userdata/window.json`, "utf8")).toContain("system");
    await app.close();
    ({ app, page } = await launch(ws, "userdata", true));
    await expect(page.getByTestId("win-close")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("Copy file: the real files on the clipboard, from the library, as a list of addresses inside the workspace", async () => {
  const ws = tempDir("cv-copy-file-");
  const { app, page } = await launch(ws, "userdata", true);
  try {
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-import-input").setInputFiles([{ name: "a.zip", mimeType: "application/zip", buffer: Buffer.from("PK") }, { name: "b file.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") }]);
    const on = (n: string) => page.locator(`[data-testid="asset-card"][title="${n}"]`);
    await expect(on("b file.pdf")).toBeAttached();
    await expect.poll(() => files(ws).filter((f) => f.startsWith("library/")).length, { timeout: 15_000 }).toBe(2);
    await on("a.zip").click();
    await on("b file.pdf").click({ modifiers: ["Control"] });
    await on("b file.pdf").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy files", exact: true }).click();
    const FORMAT = "text/uri-list";
    const listed = () => app.evaluate(async ({ clipboard }, format) => {
      const [item] = await clipboard.read();
      return item && item.types.includes(format) ? (await item.getType(format) as Blob).text() : `no file list in: ${item?.types.join(", ")}`;
    }, FORMAT);
    await expect.poll(listed).toContain("b%20file.pdf");
    const list = await listed();
    expect(list).toContain("a.zip");
    expect(list.trim().split(/\r\n/)).toHaveLength(2);
    for (const line of list.trim().split(/\r\n/)) expect(decodeURIComponent(line)).toContain(ws);
    // Dragged out: a plain drag says where the files are, as a copy only; with Alt, a real file drag. A hidden item stays in, its file encrypted.
    const drag = (name: string, altKey = false) => on(name).evaluate(async (el, alt) => {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      const dataTransfer = new DataTransfer();
      el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer, altKey: alt }));
      const list = dataTransfer.getData("text/uri-list");
      el.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
      return list;
    }, altKey);
    const carried = await drag("b file.pdf");
    expect(carried.trim().split(/\r\n/)).toHaveLength(2);
    expect(decodeURIComponent(carried)).toContain(`${ws}/library/`);
    await app.evaluate(({ BrowserWindow }) => void (BrowserWindow.getAllWindows()[0]!.webContents.startDrag = (item) => void ((globalThis as { dragged?: unknown }).dragged = item.files ?? [item.file])));
    expect(await drag("b file.pdf", true)).toBe("");
    await expect.poll(() => app.evaluate(() => ((globalThis as { dragged?: string[] }).dragged ?? []).length)).toBe(2);
    await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"));
    const hash = await on("a.zip").getAttribute("data-hash");
    await page.evaluate((h) => window.__canvastDebug.libraryOp("hide", h!, "1"), hash);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await page.keyboard.press("Escape");
    await expect(on("a.zip")).toHaveCount(0);
    await app.evaluate(() => void ((globalThis as { dragged?: unknown }).dragged = undefined));
    await drag("b file.pdf", true);
    await expect.poll(() => app.evaluate(() => ((globalThis as { dragged?: string[] }).dragged ?? []).length)).toBe(1); // (the other, hidden, stays in)
  } finally {
    await app.close();
  }
});

test("Copy of vectors reaches other programs as SVG and PNG; a hidden SVG asks first, and goes nowhere out of reach", async () => {
  const ws = tempDir("cv-copy-svg-");
  const { app, page } = await launch(ws, "userdata", true);
  const MARK = (m: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><title>${m}</title><circle cx="20" cy="15" r="9" fill="#123456"/></svg>`);
  const clear = () => app.evaluate(({ clipboard }) => clipboard.clear());
  /** Whether the file on the clipboard holds these words. */
  const fileHas = async (words: string): Promise<boolean> => {
    const { file } = await out();
    return !!file && existsSync(file) && readFileSync(file, "utf8").includes(words);
  };
  /** What another program would be offered. */
  const out = () => app.evaluate(async ({ clipboard }) => {
    const [item] = await clipboard.read();
    const read = async (t: string): Promise<string> => (item?.types.includes(t) ? await (await item.getType(t) as Blob).text() : "");
    // (what is offered, by its list of types: asked for its data, any picture type comes back as the PNG)
    const offered = (t: string): boolean => !!item?.types.includes(t) || !!item?.types.includes(`electron application/osclipboard;format="${t}"`);
    return { svg: offered("image/svg+xml"), png: offered("image/png"), text: await clipboard.readText(), file: decodeURIComponent((await read("text/uri-list")).trim().replace(/^file:\/\//gm, "")) };
  });
  try {
    // On the canvas: a shape, and an SVG picture with its own file.
    await page.keyboard.press("u");
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(700, 400, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press("v");
    await clear();
    await page.keyboard.press("Control+c");
    await expect.poll(() => out().then((o) => o.file)).toMatch(/\.svg$/);
    expect((await out()).svg).toBe(true);
    expect((await out()).png).toBe(true);
    expect(readFileSync((await out()).file, "utf8")).toMatch(/<svg[\s>]/);
    await page.keyboard.press("Control+v"); // (back in here: the shape itself, not an import)
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(2);
    await page.getByTestId("import-input").setInputFiles({ name: "placed.svg", mimeType: "image/svg+xml", buffer: MARK("placed-mark") });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(3);
    const placed = await page.evaluate(() => (window.__canvastDebug.objects().at(-1) as unknown as { id: string; assetId: string }));
    const at = (await page.evaluate((id) => window.__canvastDebug.objectScreen(id), placed.id))!.box;
    await page.mouse.click((at.minX + at.maxX) / 2, (at.minY + at.maxY) / 2);
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.selection())).toEqual([placed.id]);
    await clear();
    await page.keyboard.press("Control+c");
    await expect.poll(() => fileHas("placed-mark")).toBe(true);
    expect((await out()).file).toMatch(/placed\.svg$/);
    expect((await out()).svg).toBe(true);
    // Several, a picture and two shapes: a file each, and pasted back here the objects, with nothing imported.
    const items = () => page.evaluate(async () => (await window.__canvastDebug.assetListing()).entries.length);
    const had = await items();
    await page.keyboard.press("Control+a");
    await clear();
    await page.keyboard.press("Control+c");
    await expect.poll(() => out().then((o) => o.file.split(/\r?\n/).length)).toBe(3);
    expect((await out()).file).toMatch(/placed\.svg/);
    expect((await out()).file).toMatch(/\/shape\.svg/);
    expect((await out()).file).toMatch(/\/shape-2\.svg/);
    // The shapes' own file keeps their proportions (not those of everything selected).
    const shapesFile = readFileSync((await out()).file.split(/\r?\n/).find((f) => !f.includes("placed"))!, "utf8");
    const [, boxW, boxH, wide, high] = /viewBox="0 0 (\S+) (\S+)" width="([\d.]+)[^"]*" height="([\d.]+)/.exec(shapesFile)!;
    expect(Number(wide) / Number(high)).toBeCloseTo(Number(boxW) / Number(boxH), 1);
    expect((await out()).png, "several files go alone: given one picture, a program would leave the rest").toBe(false);
    await page.keyboard.press("Control+v");
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(6);
    expect(await items()).toBe(had);
    await page.keyboard.press("Control+z");
    await page.mouse.click((at.minX + at.maxX) / 2, (at.minY + at.maxY) / 2);
    // Hidden, out of hidden mode: the canvas puts nothing of its file out.
    await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"));
    await page.evaluate((h) => window.__canvastDebug.libraryOp("hide", h, "1"), placed.assetId);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await clear();
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(1000);
    expect((await out()).svg).toBe(false);
    expect((await out()).file).not.toContain("placed");
    expect((await out()).png, "it goes as a padlock").toBe(true);
    // The Actions bar's Copy as picture too: a padlock, not a failure to read its file.
    await page.evaluate(() => window.__canvastDebug.hiddenOp("lock"));
    await clear();
    await page.locator('[data-ctx="copypng"]').first().click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.blur()); // (away from the app before it is ready: it still lands)
    await expect.poll(() => out().then((o) => o.png)).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.focus());
    await expect(page.getByTestId("toast")).toContainText("padlock");
    await page.evaluate(() => window.__canvastDebug.hiddenOp("check", "pw"));
    // In the library: an SVG goes as itself.
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-import-input").setInputFiles({ name: "shelf.svg", mimeType: "image/svg+xml", buffer: MARK("shelf-mark") });
    const shelf = page.locator('[data-testid="asset-card"][title="shelf.svg"]');
    await expect(shelf).toBeAttached();
    await shelf.click();
    await clear();
    await page.keyboard.press("Control+c");
    await expect.poll(() => fileHas("shelf-mark")).toBe(true);
    expect((await out()).png).toBe(true);
    // A real file too, with its own name, for a program that takes files.
    const shelfFile = (await out()).file;
    expect(shelfFile).toMatch(/shelf\.svg$/);
    expect(readFileSync(shelfFile, "utf8")).toContain("shelf-mark");
    // Several in the library: every file, of any kind.
    await page.getByTestId("assets-import-input").setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video") });
    const clip = page.locator('[data-testid="asset-card"][title="clip.mp4"]');
    await expect(clip).toBeAttached();
    await expect.poll(() => files(ws).filter((f) => f.endsWith("clip.mp4")).length, { timeout: 15_000 }).toBe(1);
    await clip.click({ modifiers: ["Control"] });
    await clear();
    await page.keyboard.press("Control+c");
    await expect.poll(() => out().then((o) => o.file.split(/\r?\n/).length)).toBe(2);
    expect((await out()).file).toContain("clip.mp4");
    expect((await out()).png).toBe(false);
    // Hidden, in hidden mode: it asks; declined, nothing goes; agreed, it goes as itself.
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__canvastDebug.hiddenOp("lock"));
    await page.getByTestId("assets-search").fill("hidden:");
    await page.getByTestId("prompt-input").fill("pw");
    await page.getByTestId("prompt-ok").click();
    await expect(page.getByTestId("hidden-mode-bar")).toBeVisible();
    const secret = page.locator(`[data-testid="asset-card"][data-hash="${placed.assetId}"]`);
    await expect(secret).toBeAttached();
    await secret.click();
    await clear();
    await page.keyboard.press("Control+c");
    await page.getByTestId("confirm-cancel").click();
    await expect(page.getByTestId("confirm-dialog")).toHaveCount(0); // (a dialog leaves the page a moment after it closes, and until then its answer stands)
    expect((await out()).file).toBe("");
    await page.keyboard.press("Control+c");
    await page.getByTestId("confirm-ok").click();
    await expect.poll(() => fileHas("placed-mark")).toBe(true);
    const readable = (await out()).file;
    expect(readFileSync(readable, "utf8")).toContain("placed-mark");
    // A hidden video on the canvas, in hidden mode: its real file, and never the line a copy starts from.
    await page.evaluate(() => window.__canvastDebug.setSetting("library.hiddenStay", true));
    await page.getByTestId("view-canvas").click();
    const placedBefore = await page.evaluate(() => window.__canvastDebug.objects().length);
    await page.getByTestId("import-input").setInputFiles({ name: "secret.mp4", mimeType: "video/mp4", buffer: makeFakeMp4(320, 240, 1, "avc1") });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length), { timeout: 15_000 }).toBe(placedBefore + 1);
    const clipOn = await page.evaluate(() => window.__canvastDebug.objects().at(-1) as unknown as { id: string; assetId: string });
    await page.evaluate((h) => window.__canvastDebug.libraryOp("hide", h, "1"), clipOn.assetId);
    const onCanvas = (await page.evaluate((id) => window.__canvastDebug.objectScreen(id), clipOn.id))!.box;
    await page.keyboard.press("Escape"); // (a press inside what is selected would stay with that)
    await page.mouse.click((onCanvas.minX + onCanvas.maxX) / 2, (onCanvas.minY + onCanvas.maxY) / 2);
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.selection())).toEqual([clipOn.id]);
    await clear();
    await page.keyboard.press("Control+c");
    await expect.poll(() => out().then((o) => o.file)).toMatch(/secret\.mp4$/);
    expect((await out()).text).not.toMatch(/^canvast: \d+ object/);
    await page.getByTestId("view-assets").click();
    // Its time up: off the clipboard with its readable copy; what was copied since is left alone.
    await page.evaluate(() => window.__canvastDebug.setSetting("library.hiddenCopySeconds", 2));
    await secret.click();
    await clear();
    await page.keyboard.press("Control+c");
    await expect.poll(() => fileHas("placed-mark")).toBe(true);
    const timed = (await out()).file;
    await expect.poll(() => existsSync(timed), { timeout: 8000 }).toBe(false);
    await expect.poll(() => out().then((o) => o.file)).toBe("");
    await page.keyboard.press("Control+c");
    await expect.poll(() => fileHas("placed-mark")).toBe(true);
    await app.evaluate(({ clipboard }) => clipboard.writeText("copied since"));
    await page.waitForTimeout(3000);
    expect((await out()).text).toBe("copied since");
    await page.evaluate(() => window.__canvastDebug.setSetting("library.hiddenCopySeconds", 0));
    // Out again and locked: the card is gone, Ctrl+C has nothing to take, and its readable copy is deleted.
    await page.getByTestId("hidden-mode-exit").click();
    await expect(secret).toHaveCount(0);
    await page.evaluate(() => window.__canvastDebug.hiddenOp("lock"));
    await expect.poll(() => existsSync(readable)).toBe(false);
    await clear();
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(500);
    expect((await out()).file).toBe("");
  } finally {
    await app.close();
  }
});

test("Copy on the canvas: a flipped picture alone goes as a PNG, and among several as a new file as it looks", async () => {
  const ws = tempDir("cv-copy-edited-");
  const { app, page } = await launch(ws, "userdata", true);
  const out = () => app.evaluate(async ({ clipboard }) => {
    const [item] = await clipboard.read();
    return { png: !!item?.types.includes("image/png"), files: item?.types.includes("text/uri-list") ? decodeURIComponent(await (await item.getType("text/uri-list") as Blob).text()).trim().split(/\r?\n/).map((f) => f.replace(/^file:\/\//, "")) : [] };
  });
  try {
    for (const [name, seed] of [["plain.png", 40], ["changed.png", 200]] as const) {
      const before = await page.evaluate(() => window.__canvastDebug.objects().length);
      await page.getByTestId("import-input").setInputFiles({ name, mimeType: "image/png", buffer: makePng(60, 40, (x) => [x * 4, seed, 90, 255]) });
      await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(before + 1);
    }
    await expect.poll(() => files(ws).filter((f) => f.startsWith("library/")).length, { timeout: 15_000 }).toBe(2);
    await page.keyboard.press("v");
    const top = (await page.evaluate(() => { const d = window.__canvastDebug; return d.objectScreen(d.objects().at(-1)!.id)!.box; }));
    await page.mouse.click((top.minX + top.maxX) / 2, (top.minY + top.maxY) / 2);
    await page.getByRole("button", { name: "Flip horizontally" }).click();
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.keyboard.press("Control+c");
    await expect.poll(() => out().then((o) => o.png)).toBe(true);
    expect((await out()).files).toEqual([]);
    await page.keyboard.press("Control+a");
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.keyboard.press("Control+c");
    await expect.poll(() => out().then((o) => o.files.length)).toBe(2);
    const got = (await out()).files;
    expect(got.some((f) => f.endsWith("plain.png"))).toBe(true);
    const edited = got.find((f) => f.endsWith("changed-edited.png"))!;
    expect(readFileSync(edited).subarray(1, 4).toString()).toBe("PNG");
    expect((await out()).png).toBe(false);
  } finally {
    await app.close();
  }
});

test("Copy of shapes: a file for each, a group is one, and one thing alone goes with its picture", async () => {
  const ws = tempDir("cv-copy-shapes-");
  const { app, page } = await launch(ws, "userdata", true);
  const out = () => app.evaluate(async ({ clipboard }) => {
    const [item] = await clipboard.read();
    return { png: !!item?.types.includes("image/png"), files: item?.types.includes("text/uri-list") ? (await (await item.getType("text/uri-list") as Blob).text()).trim().split(/\r?\n/) : [] };
  });
  const draw = async (x: number): Promise<void> => {
    await page.keyboard.press("u");
    await page.mouse.move(x, 300);
    await page.mouse.down();
    await page.mouse.move(x + 100, 380, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.press("v");
  };
  const copied = async (n: number): Promise<{ png: boolean; files: string[] }> => {
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.keyboard.press("Control+c");
    await expect.poll(() => out().then((o) => o.files.length)).toBe(n);
    return out();
  };
  try {
    await draw(300);
    await draw(450);
    await page.keyboard.press("Control+a");
    const two = await copied(2);
    expect(two.files.map((f) => f.split("/").at(-1)).sort()).toEqual(["shape-2.svg", "shape.svg"]);
    expect(two.png).toBe(false);
    await page.keyboard.press("Control+g");
    const group = await copied(1);
    expect(group.files[0]).toMatch(/group\.svg$/);
    expect(group.png, "one thing alone: its picture too").toBe(true);
    await draw(600);
    await page.keyboard.press("Control+a");
    const both = await copied(2);
    expect(both.files.map((f) => f.split("/").at(-1)).sort()).toEqual(["group.svg", "shape.svg"]);
  } finally {
    await app.close();
  }
});

test("a folder of files an earlier version named: opening it, twice, renames and moves nothing", async () => {
  const ws = tempDir("cv-names-open-");
  const png = (seed: number): Buffer => makePng(6, 4, () => [seed, 90, 40, 255]);
  const dirs = ["library/A- B", "library/a-b", "library/Refs"];
  for (const d of dirs) mkdirSync(join(ws, d), { recursive: true });
  const NAMES = ["library/A- B/one.png", "library/a-b/two.png", "library/Refs/cafe\u0301.png", "library/Refs/a\u200bb.png", "library/Refs/C# notes.md", "library/Refs/draft.final.png", "library/Refs/README", "library/Refs/x.7z.001"];
  NAMES.forEach((f, i) => writeFileSync(join(ws, f), f.endsWith(".md") ? "# C#\n" : png(i * 20 + 10)));
  const seen = () => files(ws).filter((f) => f.startsWith("library/")).sort();
  const before = seen();
  expect(before).toEqual([...NAMES].sort());
  let { app, page } = await launch(ws, "userdata", true);
  const items = () => page.evaluate(async () => (await window.__canvastDebug.assetListing()).entries.length);
  await expect.poll(items, { timeout: 20_000 }).toBe(NAMES.length);
  await page.waitForTimeout(2500); // (past the app's writing pause)
  expect(seen(), "nothing moved on opening").toEqual(before);
  await app.close();
  ({ app, page } = await launch(ws, "userdata", true));
  await expect.poll(items, { timeout: 20_000 }).toBe(NAMES.length);
  await page.waitForTimeout(2500);
  expect(seen(), "nor on opening again").toEqual(before);
  // A picture an earlier version named from `Scan v2.1`, its extension lost: the library knows it is a PNG.
  await page.getByTestId("view-assets").click();
  await page.getByTestId("assets-import-input").setInputFiles({ name: "scan.png", mimeType: "image/png", buffer: png(200) });
  await expect.poll(seen, { timeout: 15_000 }).toContain("library/images/scan.png");
  await app.close();
  renameSync(join(ws, "library/images/scan.png"), join(ws, "library/Refs/Scan v2.1"));
  ({ app, page } = await launch(ws, "userdata", true));
  await expect.poll(() => page.evaluate(async () => (await window.__canvastDebug.assetListing()).entries.some((e) => e.name === "Scan v2.1" && e.type === "image/png")), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(2500);
  expect(seen(), "not moved either").toContain("library/Refs/Scan v2.1");
  expect(seen()).toHaveLength(NAMES.length + 1);
  await app.close();
});

test("Keep file names: two items of one name are two names in the app too, as on the disk; a name taken in the app comes back to its file's", async () => {
  const ws = tempDir("cv-same-name-");
  const { app, page } = await launch(ws, "userdata", true);
  try {
    await page.getByTestId("view-assets").click();
    const pic = (name: string, seed: number) => ({ name, mimeType: "image/png", buffer: makePng(6, 4, () => [seed, 90, 40, 255]) });
    await page.getByTestId("assets-import-input").setInputFiles([pic("image.png", 10)]);
    await expect(page.locator('[data-testid="asset-card"][title="image.png"]')).toBeAttached();
    await page.getByTestId("assets-import-input").setInputFiles([pic("image.png", 200)]);
    await expect.poll(() => files(ws).filter((f) => f.startsWith("library/")).sort(), { timeout: 15_000 }).toEqual(["library/images/image-2.png", "library/images/image.png"]);
    await expect(page.locator('[data-testid="asset-card"][title="image-2.png"]')).toBeAttached();
    await expect(page.locator('[data-testid="asset-card"][title="image.png"]')).toHaveCount(1);
    // A library from before: an item says the other's name, its file is -2.
    const hash = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.name === "image-2.png")!.hash));
    await page.evaluate((h) => window.__canvastDebug.libraryOp("rename", h, "image.png"), hash);
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.hash === h)!.name), hash), { timeout: 15_000 }).toBe("image-2.png");
    expect(files(ws).filter((f) => f.startsWith("library/")).sort()).toEqual(["library/images/image-2.png", "library/images/image.png"]);
  } finally {
    await app.close();
  }
});

test("Keep file names (the default) with Sort files by kind off: names, places and folders stay, notes find them, a tag leaves the file alone; off, they are tidied and the links follow", async () => {
  const ws = tempDir("cv-keep-names-");
  const lib = join(ws, "library");
  const png = (seed: number): Buffer => makePng(6, 4, () => [seed, 90, 40, 255]);
  const put = (path: string, data: Buffer | string): void => {
    mkdirSync(join(lib, path, ".."), { recursive: true });
    writeFileSync(join(lib, path), data);
  };
  const FILES = ["My Refs/Red-Dress Sky Blue.png", "My Refs/sub dir/deep.png", "Root Pic.PNG", "noext", "plain.md"];
  put(FILES[0]!, png(1));
  put(FILES[1]!, png(2));
  put(FILES[2]!, png(3));
  put(FILES[3]!, png(4));
  const NOTE = "just words\n\n![a](Root%20Pic.PNG)\n";
  put(FILES[4]!, NOTE);
  let { app, page } = await launch(ws, "userdata", true);
  await page.getByTestId("view-assets").click();
  const card = (name: string) => page.locator(`[data-testid="asset-card"][title="${name}"]`);
  await expect(card("plain.md")).toBeAttached({ timeout: 15_000 });
  // A new file: named as written, in its kind's folder (only what a system forbids is replaced).
  await page.getByTestId("assets-import-input").setInputFiles([{ name: "Hand (Loomis) #2.PNG", mimeType: "image/png", buffer: png(20) }, { name: "a:b?.png", mimeType: "image/png", buffer: png(21) }]);
  await expect.poll(() => files(lib)).toEqual([...FILES, "images/Hand (Loomis) #2.PNG", "images/a-b-.png"].sort());
  // A tag on a note stays in the library: the file is as it was.
  await card("plain.md").click();
  await page.getByTestId("asset-tag-input").fill("newtag");
  await page.getByTestId("asset-tag-input").press("Enter");
  await expect(card("plain.md")).toContainText("");
  await page.waitForTimeout(800);
  expect(readFileSync(join(lib, "plain.md"), "utf8")).toBe(NOTE);
  // After a restart nothing moved, and the note finds its picture.
  await app.close();
  ({ app, page } = await launch(ws, "userdata", true));
  await page.getByTestId("view-assets").click();
  await card("plain.md").dblclick();
  const words = page.getByTestId("note-editor").locator(".sun-editor-editable").first();
  await expect.poll(() => words.locator("img").evaluateAll((l) => l.map((i) => (i as HTMLImageElement).naturalWidth > 0))).toEqual([true]);
  await page.getByTestId("slide-view").locator('[data-act="close"]').click();
  expect(files(lib)).toContain("Root Pic.PNG");
  expect(files(lib)).toContain("My Refs/sub dir/deep.png");
  // Sort files alone: what is loose goes in its kind's folder at once, its name as it is; what is filed stays; the note's link follows.
  await page.getByTestId("view-settings").click();
  await page.getByRole("tab", { name: "Saving to the library" }).click();
  await page.locator('[data-set="library.sortFiles"]').click({ force: true });
  await expect.poll(() => files(lib), { timeout: 15_000 }).toContain("images/Root Pic.PNG");
  expect(files(lib)).toContain("My Refs/Red-Dress Sky Blue.png");
  expect(files(lib)).not.toContain("Root Pic.PNG");
  await expect.poll(() => readFileSync(join(lib, "notes/plain.md"), "utf8"), { timeout: 15_000 }).toContain("images/Root%20Pic.PNG");
  // Names off, sorting off: tidied where it lies, and a new file by its kind.
  await page.locator('[data-set="library.sortFiles"]').click({ force: true });
  await page.locator('[data-set="library.keepFileNames"]').click({ force: true });
  await expect.poll(() => files(lib), { timeout: 15_000 }).toContain("my_refs/red-dress_sky_blue.png");
  expect(files(lib)).toContain("images/root_pic.png");
  await page.getByTestId("view-assets").click();
  await page.getByTestId("assets-import-input").setInputFiles({ name: "Next One.png", mimeType: "image/png", buffer: png(40) });
  await expect.poll(() => files(lib), { timeout: 15_000 }).toContain("images/next_one.png");
  await app.close();
});

test("cut, a pan with the middle button (a paste on Linux) places nothing; the paste lands under the pointer", async () => {
  const ws = tempDir("cv-middle-");
  const { app, page } = await launch(ws);
  await page.getByTestId("view-assets").click();
  await page.getByTestId("assets-import-input").setInputFiles({ name: "o.png", mimeType: "image/png", buffer: makePng(120, 80, () => [70, 90, 40, 255]) });
  await page.locator('[data-testid="asset-card"][title="o.png"]').click();
  await page.getByTestId("asset-place").click();
  await page.getByTestId("view-canvas").click();
  await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  const box = () => page.evaluate(() => { const d = window.__canvastDebug; return d.objectScreen(d.objects().at(-1)!.id)!.box; });
  const b = await box();
  await page.mouse.click((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  await page.keyboard.press("Control+x");
  await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(0);
  await page.mouse.move(640, 500);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(300, 300, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__canvastDebug.objects().map((o) => `${o.kind} ${String(o["assetId"] ?? "").slice(0, 6)}`)), "the pan pasted nothing").toEqual([]);
  await page.mouse.move(900, 200, { steps: 4 });
  await page.keyboard.press("Control+v");
  await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  const a = await box();
  expect(Math.abs((a.minX + a.maxX) / 2 - 900)).toBeLessThan(4);
  expect(Math.abs((a.minY + a.maxY) / 2 - 200)).toBeLessThan(4);
  // With the pointer over a bar floating on the canvas: under it too, not back in the middle of the view.
  await page.keyboard.press("Control+x");
  await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(0);
  const bar = (await page.getByTestId("view-assets").boundingBox())!;
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.keyboard.press("Control+v");
  await expect.poll(() => page.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  const c = await box();
  const canvasTop = (await page.locator("canvas").first().boundingBox())!;
  expect(Math.abs((c.minX + c.maxX) / 2 - (bar.x + bar.width / 2 - canvasTop.x))).toBeLessThan(4);
  await app.close();
});

test("sharing (ADR 0184): on in Settings, a guest pairs with the code and the host's Allow, reads files, never hidden ones unless shared; removed, it stops", async () => {
  const ws = tempDir("cv-share-");
  mkdirSync(join(ws, "library"), { recursive: true });
  writeFileSync(join(ws, "library", "shared.png"), makePng(4, 4, () => [10, 200, 30, 255]));
  const { app, page } = await launch(ws, "userdata", true); // (file names as given)
  const call = (port: number, path: string, body: unknown, token?: string): Promise<{ status: number; bytes: Buffer; fingerprint: string }> =>
    new Promise((ok, fail) => {
      const req = httpsRequest({ host: "127.0.0.1", port, path, method: "POST", rejectUnauthorized: false, headers: token ? { authorization: `Bearer ${token}` } : {} }, (res) => {
        const fingerprint = (res.socket as import("node:tls").TLSSocket).getPeerCertificate().fingerprint256; // (read while the connection is open)
        const parts: Buffer[] = [];
        res.on("data", (b: Buffer) => parts.push(b));
        res.on("end", () => ok({ status: res.statusCode ?? 0, bytes: Buffer.concat(parts), fingerprint }));
      });
      req.on("error", fail);
      req.end(JSON.stringify(body));
    });
  try {
    await page.getByTestId("save-status").click();
    await page.getByRole("tab", { name: "Sharing" }).click();
    await expect(page.getByTestId("share-hidden")).toBeDisabled();
    await page.getByTestId("share-on").check();
    const code = (await page.getByTestId("share-code").textContent())!.trim();
    expect(code).toMatch(/^\d{6}$/);
    const st = (await page.evaluate(() => window.canvastDesktop!.share!.call("status"))) as { port: number; fingerprint: string };
    // A guest: the code, then the host is asked; Allow.
    const pairing = call(st.port, "/pair", { code, name: "Test laptop" });
    const ask = page.getByTestId("confirm-dialog").filter({ hasText: "Let Test laptop see this workspace?" });
    await expect(ask).toBeVisible();
    await ask.getByTestId("confirm-ok").click();
    const paired = await pairing;
    expect(paired.status).toBe(200);
    expect(paired.fingerprint, "the certificate is the one Settings shows").toBe(st.fingerprint);
    const token = String((JSON.parse(paired.bytes.toString()) as { token: string }).token);
    await page.getByTestId("share-guests").click();
    await expect(page.getByTestId("share-guests-dialog")).toContainText("Test laptop");
    await page.getByTestId("share-guests-dialog-close").click();
    await expect(page.getByTestId("share-log")).toContainText("Allowed"); // (the latest event, and the dialog with all of them)
    await page.getByTestId("share-activity").click();
    await expect(page.getByTestId("share-activity-dialog")).toContainText("Test laptop");
    await page.getByTestId("share-activity-dialog-close").click();
    // Reads only; hidden items' files only when shared.
    const file = await call(st.port, "/call", { ch: "canvast:read", args: ["library/shared.png"] }, token);
    expect(file.status).toBe(200);
    expect(file.bytes.equals(readFileSync(join(ws, "library", "shared.png")))).toBe(true);
    expect((await call(st.port, "/call", { ch: "canvast:write", args: ["library/x.png", [1]] }, token)).status).toBe(403);
    expect((await call(st.port, "/call", { ch: "canvast:read", args: [".canvast/hidden.json"] }, token)).status).toBe(403);
    expect((await call(st.port, "/call", { ch: "canvast:read", args: ["../outside.txt"] }, token)).status).toBe(400); // (the main process's own path rule)
    await page.getByTestId("share-hidden").check();
    expect((await call(st.port, "/call", { ch: "canvast:read", args: [".canvast/hidden.json"] }, token)).status).not.toBe(403);
    // The page never grows with use: 20 folder logins later it has the same rows, every row in the one design; the list is in a dialog.
    const panel = page.locator('[data-panel="sharing"]');
    await page.getByTestId("share-dav-on").check();
    const rows = await panel.locator(".set-row").count();
    for (let i = 0; i < 20; i++) await page.evaluate((n) => window.canvastDesktop!.share!.call("davAdd", `Device ${n}`), i);
    await page.evaluate(() => window.canvastDesktop!.share!.call("status")); // (drawn from the next status)
    await expect(panel.getByText("20 devices:")).toBeVisible();
    expect(await panel.locator(".set-row").count()).toBe(rows);
    expect(await settingsRowProblems(panel)).toEqual([]);
    await page.getByTestId("share-logins").click();
    await expect(page.getByTestId("share-logins-dialog").locator(".set-row")).toHaveCount(20);
    await page.getByTestId("share-logins-dialog-close").click();
    // Removed: refused at once. (After another tab and back: one press, one dialog.)
    await page.getByRole("tab", { name: "About" }).click();
    await page.getByRole("tab", { name: "Sharing" }).click();
    await page.getByTestId("share-guests").click();
    await expect(page.locator('[data-testid="share-guests-dialog"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Remove Test laptop" }).click();
    await page.getByTestId("share-guests-dialog-close").click();
    expect((await call(st.port, "/call", { ch: "canvast:read", args: ["library/shared.png"] }, token)).status).toBe(401);
    // Off: nothing listens.
    await page.getByTestId("share-on").uncheck();
    await expect(call(st.port, "/hello", null)).rejects.toThrow();
  } finally {
    await app.close();
  }
});

test("sharing (ADR 0184): a browser guest pairs, sees the host's library and canvas read-only, stays paired after a reload, and pairs again once removed", async () => {
  const ws = tempDir("cv-guest-");
  const { app, page } = await launch(ws, "userdata", true); // (file names as given)
  const browser = await chromium.launch();
  try {
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-import-input").setInputFiles({ name: "Shared Picture.png", mimeType: "image/png", buffer: makePng(8, 8, () => [200, 40, 40, 255]) });
    await expect(page.locator('[data-testid="asset-card"][title="Shared Picture.png"]')).toHaveCount(1);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await page.getByTestId("view-canvas").click(); // (the storage status is on the canvas's bar)
    await page.getByTestId("save-status").click();
    await page.getByRole("tab", { name: "Sharing" }).click();
    await page.getByTestId("share-on").check();
    const code = (await page.getByTestId("share-code").textContent())!.trim();
    const { port } = (await page.evaluate(() => window.canvastDesktop!.share!.call("status"))) as { port: number };
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); // (the host's own certificate: a browser warns once)
    const g = await ctx.newPage();
    g.on("pageerror", (e) => console.log(`guest page error: ${e.message}\n${e.stack ?? ""}`));
    const pair = async (): Promise<void> => {
      await g.getByTestId("prompt-input").fill(code);
      await g.getByTestId("prompt-ok").click();
      const ask = page.getByTestId("confirm-dialog").filter({ hasText: /see this workspace\?/ });
      await expect(ask).toBeVisible();
      await ask.getByTestId("confirm-ok").click();
      await g.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 60_000 });
    };
    await g.goto(`https://127.0.0.1:${port}/#debug`);
    await pair();
    // Read-only, said as a guest's; the host's library is there.
    await expect(g.getByTestId("readonly-banner")).toContainText("shared with you");
    await expect(g.getByTestId("readonly-banner").getByRole("button", { name: "Take over" })).toHaveCount(0);
    await g.getByTestId("view-assets").click();
    await expect(g.locator('[data-testid="asset-card"][title="Shared Picture.png"]')).toHaveCount(1, { timeout: 30_000 });
    await page.getByTestId("share-guests").click();
    await expect(page.getByTestId("share-guests-dialog")).toContainText(/on Linux/);
    await page.getByTestId("share-guests-dialog-close").click();
    // Follow the host: where the host goes, the guest goes; moving the view itself stops it.
    await g.getByTestId("view-canvas").click();
    await page.getByTestId("view-canvas").click();
    await g.getByTestId("follow-host").click();
    await expect(g.getByTestId("follow-host")).toHaveAttribute("aria-pressed", "true");
    const there = { cx: "5p0", cy: "-3p0", zi: 2, zf: 0, pz: 2 };
    await page.evaluate((c) => window.__canvastDebug.setCamera(c), there);
    await expect.poll(() => g.evaluate(() => window.__canvastDebug.camera()), { timeout: 10_000 }).toMatchObject({ cx: "5p0", cy: "-3p0", zi: 2 });
    await g.mouse.move(600, 420);
    await g.mouse.wheel(0, 100);
    await expect(g.getByTestId("follow-host")).toHaveAttribute("aria-pressed", "false");
    // A reload keeps the pairing (no code asked).
    await g.reload();
    await g.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 60_000 });
    await expect(g.getByTestId("prompt-input")).toHaveCount(0);
    // Removed by the host: the next start asks for the code again.
    await page.getByTestId("save-status").click();
    await page.getByRole("tab", { name: "Sharing" }).click();
    await page.getByTestId("share-guests").click();
    await page.getByRole("button", { name: /^Remove / }).click();
    await page.getByTestId("share-guests-dialog-close").click();
    await g.reload();
    await expect(g.getByTestId("prompt-input")).toBeVisible({ timeout: 30_000 });
  } finally {
    await browser.close();
    await app.close();
  }
});

const httpsGet = (port: number, path: string): Promise<{ status: number }> =>
  new Promise((ok, fail) => {
    const req = httpsRequest({ host: "127.0.0.1", port, path, method: "GET", rejectUnauthorized: false }, (res) => (res.resume(), res.on("end", () => ok({ status: res.statusCode ?? 0 }))));
    req.on("error", fail);
    req.end();
  });

test("sharing (ADR 0184): hidden items reach a guest only when shared, encrypted; the guest opens them with the Hidden password", async () => {
  const ws = tempDir("cv-guest-hidden-");
  const { app, page } = await launch(ws, "userdata", true); // (file names as given)
  const browser = await chromium.launch();
  const secret = makePng(6, 6, () => [20, 20, 220, 255]);
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  try {
    await page.getByTestId("view-assets").click();
    await page.getByTestId("assets-import-input").setInputFiles([{ name: "Secret.png", mimeType: "image/png", buffer: secret }, { name: "Open.png", mimeType: "image/png", buffer: makePng(6, 6, () => [220, 20, 20, 255]) }]);
    await expect(page.locator('[data-testid="asset-card"][title="Open.png"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.__canvastDebug.hiddenOp("set", "pw"))).toEqual({ ok: true, state: "open" });
    await page.evaluate((h) => window.__canvastDebug.libraryOp("hide", h, "1"), sha(secret));
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    const sealed = files(ws).filter((f) => f.startsWith(".hidden/"));
    expect(sealed).toHaveLength(1);
    const sealedBytes = readFileSync(join(ws, sealed[0]!));
    await page.getByTestId("view-canvas").click(); // (the storage status is on the canvas's bar)
    await page.getByTestId("save-status").click();
    await page.getByRole("tab", { name: "Sharing" }).click();
    await page.getByTestId("share-on").check();
    const code = (await page.getByTestId("share-code").textContent())!.trim();
    const { port } = (await page.evaluate(() => window.canvastDesktop!.share!.call("status"))) as { port: number };
    // The folder for file managers (on this computer): the library, and the hidden items decrypted as they are read. Its own switch.
    expect((await httpsGet(port, "/dav/")).status, "off until its switch is on").toBe(404);
    await page.getByTestId("share-dav-on").check();
    const davSt = (await page.evaluate(() => window.canvastDesktop!.share!.call("status"))) as { dav: { password: string } };
    const dav = (method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> =>
      new Promise((ok, fail) => {
        const req = httpsRequest({ host: "127.0.0.1", port, path, method, rejectUnauthorized: false, headers: { ...headers, authorization: `Basic ${Buffer.from(`me:${davSt.dav.password}`).toString("base64")}` } }, (res) => {
          const parts: Buffer[] = [];
          res.on("data", (b: Buffer) => parts.push(b));
          res.on("end", () => ok({ status: res.statusCode ?? 0, body: Buffer.concat(parts) }));
        });
        req.on("error", fail);
        req.end();
      });
    // (in the folder its kind sorts it into, or at the top)
    const listed = async (path: string): Promise<string> => {
      const text = (await dav("PROPFIND", path, { depth: "1" })).body.toString();
      const subs = [...text.matchAll(/<d:href>([^<]+\/)<\/d:href>/g)].map((m) => m[1]!).filter((h) => h !== path);
      return text + (await Promise.all(subs.map((h) => dav("PROPFIND", h, { depth: "1" }).then((r) => r.body.toString())))).join("");
    };
    expect(await listed("/dav/Library/")).toContain("Open.png");
    await expect.poll(async () => (await dav("PROPFIND", "/dav/Hidden/", { depth: "1" })).body.toString(), { timeout: 15_000 }).toContain("Secret.png");
    const got = await dav("GET", "/dav/Hidden/Secret.png");
    expect(got.status).toBe(200);
    expect(got.body.equals(secret), "decrypted as read: the original bytes").toBe(true);
    expect((await dav("PUT", "/dav/Library/x.png")).status).toBe(403);
    const g = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    g.on("pageerror", (e) => console.log(`guest page error: ${e.message}\n${e.stack ?? ""}`));
    await g.goto(`https://127.0.0.1:${port}/#debug`);
    await g.getByTestId("prompt-input").fill(code);
    await g.getByTestId("prompt-ok").click();
    await page.getByTestId("confirm-dialog").filter({ hasText: /see this workspace\?/ }).getByTestId("confirm-ok").click();
    await g.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 60_000 });
    const guestList = () => g.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, !!e.hidden]).sort()));
    // Not shared: the guest has the shown item only, and the password opens nothing.
    await expect.poll(guestList, { timeout: 30_000 }).toEqual([["Open.png", false]]);
    expect((await g.evaluate(() => window.__canvastDebug.hiddenOp("check", "pw"))).ok).toBe(false);
    // Shared: the guest opens them itself, with the password.
    await page.getByTestId("share-hidden").check();
    expect(await g.evaluate(() => window.__canvastDebug.hiddenOp("check", "pw"))).toEqual({ ok: true, state: "open" });
    await expect.poll(guestList, { timeout: 30_000 }).toEqual([["Open.png", false], ["Secret.png", true]]);
    expect(readFileSync(join(ws, sealed[0]!)).equals(sealedBytes), "the host's encrypted file is as it was").toBe(true);
  } finally {
    await browser.close();
    await app.close();
  }
});

test("sharing (ADR 0184): a guest's library of 120 pictures shows its thumbnails within 30 s, from the host's thumbnails, not the originals", async () => {
  const ws = tempDir("cv-guest-speed-");
  const { app, page } = await launch(ws, "userdata", true);
  const browser = await chromium.launch();
  try {
    await page.getByTestId("view-assets").click();
    const pics = Array.from({ length: 120 }, (_, i) => ({ name: `pic ${i}.png`, mimeType: "image/png", buffer: makePng(64, 48, (x, y) => [(i * 7) % 256, (x * 4) % 256, (y * 5) % 256, 255]) }));
    await page.getByTestId("assets-import-input").setInputFiles(pics);
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length)), { timeout: 60_000 }).toBe(120);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    await page.getByTestId("view-canvas").click();
    await page.getByTestId("save-status").click();
    await page.getByRole("tab", { name: "Sharing" }).click();
    await page.getByTestId("share-on").check();
    const code = (await page.getByTestId("share-code").textContent())!.trim();
    const { port } = (await page.evaluate(() => window.canvastDesktop!.share!.call("status"))) as { port: number };
    const g = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    g.on("pageerror", (e) => console.log(`guest page error: ${e.message}`));
    await g.goto(`https://127.0.0.1:${port}/#debug`);
    await g.getByTestId("prompt-input").fill(code);
    await g.getByTestId("prompt-ok").click();
    await page.getByTestId("confirm-dialog").filter({ hasText: /see this workspace\?/ }).getByTestId("confirm-ok").click();
    await g.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 60_000 });
    const t0 = Date.now();
    await g.getByTestId("view-assets").click();
    const shown = () => g.locator('[data-testid="asset-card"] img').evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).naturalWidth > 0).length);
    await expect.poll(shown, { timeout: 30_000 }).toBeGreaterThanOrEqual(20);
    const ms = Date.now() - t0;
    const stats = await g.evaluate(() => (window as unknown as { __canvastHostStats: Record<string, { n: number; bytes: number; ms: number }> }).__canvastHostStats);
    console.log(`guest library: ${await shown()} thumbnails in ${ms} ms; calls: ${JSON.stringify(stats)}`);
    // The originals are not read to draw thumbnails: the host's own are used.
    expect(stats["read.library"]?.n ?? 0, "originals read whole").toBeLessThan(5);
  } finally {
    await browser.close();
    await app.close();
  }
});

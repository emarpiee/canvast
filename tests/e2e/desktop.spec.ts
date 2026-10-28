import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { buildDir } from "./build-dir";
import { makePng } from "./png";

// The desktop build (ADR 0177): the snapshot's own desktop shell (test-snap builds it into <snapshot>/desktop), on a
// fresh workspace folder, with a hidden window.

/** The app on `workspace`; `device` names the app's own data folder (another one is another device with its own cache). */
async function launch(workspace: string, device = "userdata"): Promise<{ app: ElectronApplication; page: Page; requests: string[] }> {
  const app = await electron.launch({
    args: [join(buildDir(), "desktop"), `--workspace=${workspace}`, `--user-data-dir=${workspace}-${device}`],
    env: { ...process.env, CANVAST_HIDDEN: "1", CANVAST_HASH: "#debug" },
  });
  const page = await app.firstWindow();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000 });
  return { app, page, requests };
}

/** Where the boards are, inside the app's own folder. */
const B = ".canvast/boards/";
/** The workspace's files without the app's own bookkeeping (its boards included). */
const visible = (root: string): string[] => files(root).filter((f) => !f.startsWith(".canvast/") || f.startsWith(B));
const files = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(root, join(dir, e.name)) : [relative(root, join(dir, e.name))])).sort();

/** Settings > Storage > Export backup, as a person would: Electron hands the download over (to a save dialog; here, to `to`). */
async function exportBackup(app: ElectronApplication, page: Page, to: string): Promise<Buffer> {
  await app.evaluate(({ BrowserWindow }, to) => {
    const g = globalThis as { saved?: Promise<string> };
    g.saved = new Promise((done) => BrowserWindow.getAllWindows()[0]!.webContents.session.once("will-download", (_e, item) => {
      item.setSavePath(to);
      item.once("done", (_d, state) => done(state));
    }));
  }, to);
  await page.getByTestId("save-status").click();
  await page.getByTestId("set-export-full").click();
  expect(await app.evaluate(() => (globalThis as { saved?: Promise<string> }).saved)).toBe("completed");
  return readFileSync(to);
}

test("the desktop page is sandboxed: no Node, no path outside the workspace folder, nothing from the network", async () => {
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
  const outside = mkdtempSync(join(tmpdir(), "canvast-out-"));
  symlinkSync(outside, join(ws, "link-out")); // a link inside the workspace that leads out of it
  const { app, page, requests } = await launch(ws);
  try {
    expect(page.url()).toBe("app://canvast/#debug");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle())).toBe(`${ws.split("/").pop()} — canvast`);
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
    expect(readdirSync(outside)).toEqual([]);
    expect(await page.evaluate(() => fetch("https://example.com/").then(() => "fetched", () => "blocked"))).toBe("blocked");
    expect(requests.filter((u) => !/^(app|data|blob):/.test(u))).toEqual([]);
  } finally {
    await app.close();
  }
});

test("library files are readable files under library/: the same bytes once, -2 on a name clash, read back after a restart", async () => {
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
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
  } finally {
    await app.close();
  }
});

test("boards are folders of .canvast/boards/ and canvases .cvst files: safe names, -2 on a clash, renames move them, a deleted canvas goes to .trash, closing writes the last change", async () => {
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
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
  } finally {
    await app.close();
  }
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
  } finally {
    await app.close();
  }
});

test("the folder is the truth: a new device opens the whole workspace, another device's change is read at start-up, edits on both sides keep both", async () => {
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
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
  await a.app.close();

  // A new device (its own empty cache) on the same folder: the whole workspace, as the folder has it.
  let b = await launch(ws, "device-b");
  await ready(b.page);
  await expect.poll(() => counts(b.page)).toEqual([["Sketches", "Characters", 3]]);
  await add(b.page, 2);
  await b.app.close();

  // The first device reads the other one's change at start-up.
  a = await launch(ws, "device-a");
  await ready(a.page);
  await expect.poll(() => counts(a.page)).toEqual([["Sketches", "Characters", 5]]);
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

  // The folder deleted and a new, empty one made at the same path: a new workspace, nothing of the old one's cache.
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws);
  a = await launch(ws, "device-a");
  await ready(a.page);
  expect(await counts(a.page)).toEqual([[expect.any(String), expect.any(String), 0]]);
  await a.app.close();
});

test("library folders are real folders: filing or renaming an item moves its file, undo moves it back, library.json brings the library to a new device", async () => {
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
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
    const json = readFileSync(join(ws, ".canvast/library.json"), "utf8");
    expect(JSON.parse(json).items.map((i: { name: string; file: string; folderId: string | null }) => [i.name, i.file, i.folderId]).sort()).toEqual([
      ["Hand Study.png", "library/anatomy/sub/hand_study.png", "f2"],
      ["Pose.png", "library/images/pose.png", null],
    ]);
  } finally {
    await app.close();
  }
  // Another device (its own empty cache): the library as the folder has it, names, folders and files.
  ({ app, page } = await launch(ws, "device-b"));
  try {
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => [l.folders.map((f) => f.name).sort(), l.entries.map((e) => [e.name, e.folderIds?.[0] ?? null, e.present]).sort()])), { timeout: 10_000 }).toEqual([
      ["Anatomy", "Sub"],
      [["Hand Study.png", "f2", true], ["Pose.png", null, true]],
    ]);
  } finally {
    await app.close();
  }
});

test("a backup exported from Settings and imported into a workspace folder: written as folders and files; Rebuild from the folder reads it all again", async () => {
  const src = mkdtempSync(join(tmpdir(), "canvast-ws-"));
  const green = makePng(3, 2, () => [30, 200, 30, 255]);
  let { app, page } = await launch(src);
  let backup: string;
  try {
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.session().tree?.length ?? 0)).toBe(1);
    const t = await page.evaluate(() => window.__canvastDebug.session().tree!);
    await page.evaluate(([bid, cid]) => window.__canvastDebug.workspaceOp("renameBoard", bid, "Studies").then(() => window.__canvastDebug.workspaceOp("renameCanvas", cid, "Hands")), [t[0]!.id, t[0]!.canvases[0]!.id] as [string, string]);
    await page.getByTestId("import-input").setInputFiles({ name: "Green Leaf.png", mimeType: "image/png", buffer: green });
    await expect.poll(() => page.evaluate((id) => window.__canvastDebug.storedObjectIds(id).then((ids) => ids.length), t[0]!.canvases[0]!.id)).toBe(1);
    const hash = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries[0]!.hash));
    await page.evaluate((h) => window.__canvastDebug.libraryOp("createFolder", "f1", "Plants").then(() => window.__canvastDebug.libraryOp("file", h, "f1")), hash);
    backup = (await exportBackup(app, page, `${src}-backup.canvast`)).toString("base64");
  } finally {
    await app.close();
  }

  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.session().tree?.length ?? 0)).toBe(1);
    await page.getByTestId("save-status").click();
    await page.getByTestId("set-import-input").setInputFiles({ name: "backup.canvast", mimeType: "application/zip", buffer: Buffer.from(backup, "base64") });
    // Imported, its files written into the folder, then the app starts again on it and says the result.
    await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), page.getByTestId("confirm-ok").click()]);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 30_000 });
    await expect(page.getByTestId("toast")).toContainText(/Imported/);
    await page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(visible(ws)).toEqual([`${B}board_1/canvas_1.cvst`, `${B}studies/hands.cvst`, "library/plants/green_leaf.png"]);
    expect(readFileSync(join(ws, "library/plants/green_leaf.png")).equals(green)).toBe(true);
    const canvas = JSON.parse(readFileSync(join(ws, `${B}studies/hands.cvst`), "utf8"));
    expect(canvas.objects.map((o: { kind: string }) => o.kind)).toEqual(["image"]);
    // As if the app had stopped after writing the file but before its record was kept: the next write finds the file by its
    // content and takes it, never writing it a second time beside itself (green_leaf-2.png).
    await page.evaluate(async (bytes) => {
      const db = await new Promise<IDBDatabase>((ok, ko) => Object.assign(indexedDB.open("canvast"), { onsuccess(this: IDBRequest<IDBDatabase>) { ok(this.result); }, onerror: ko }));
      const hash = (await window.__canvastDebug.assetListing()).entries[0]!.hash;
      const tx = db.transaction("assets", "readwrite");
      const st = tx.objectStore("assets");
      await new Promise((ok) => (st.get(hash).onsuccess = (e) => {
        const r = (e.target as IDBRequest<Record<string, unknown>>).result;
        const { ext: _ext, file: _file, ...rest } = r;
        st.put({ ...rest, blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }) }, hash).onsuccess = ok;
      }));
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
  const src = mkdtempSync(join(tmpdir(), "canvast-ws-"));
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
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
  ({ app, page } = await launch(ws));
  try {
    await page.getByTestId("save-status").click();
    await page.getByTestId("set-import-input").setInputFiles({ name: "backup.canvast", mimeType: "application/zip", buffer: backup });
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
    await expect(page.getByTestId("toast")).toContainText(/Imported/);
    expect(visible(ws).filter((f) => f.startsWith("library/"))).toHaveLength(25);
  } finally {
    await app.close();
  }
});

test("switching workspace from the app: the recent ones (a gone one left out), the open one written before the switch, and clearing the list", async () => {
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
  const other = mkdtempSync(join(tmpdir(), "canvast-ws-"));
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
    expect(await items()).toEqual([`current:${ws.split("/").pop()}`, `recent:Switch to the workspace ${other.split("/").pop()}`, "open:Open a folder…", "new:New workspace…", "clear:Clear the recent list"]);
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
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
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
  // (the same device: its data folder is named after the old place here)
  app = await electron.launch({ args: [join(buildDir(), "desktop"), `--workspace=${moved}`, `--user-data-dir=${ws}-userdata`], env: { ...process.env, CANVAST_HIDDEN: "1", CANVAST_HASH: "#debug" } });
  try {
    page = await app.firstWindow();
    await expect(page.getByTestId("lock-screen")).toBeVisible({ timeout: 30_000 });
  } finally {
    await app.close();
  }
});

test("hidden items are encrypted: sealed into .hidden/ with nothing readable left, opened only with the password, shown back into library/, the same key under a new password", async () => {
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
  const secret = makePng(3, 2, () => [200, 40, 160, 255]);
  // Every file of the workspace, as text: no trace of the hidden item's name or its picture may be in any of them.
  const traces = () => files(ws).filter((f) => { const b = readFileSync(join(ws, f)); return /secret/i.test(b.toString("latin1")) || b.includes(secret.subarray(0, 24)); });
  let { app, page } = await launch(ws);
  const lib = (...a: Parameters<typeof window.__canvastDebug.libraryOp>) => page.evaluate((a) => window.__canvastDebug.libraryOp(...a), a);
  const hid = (op: "set" | "check" | "lock", pw?: string) => page.evaluate(([op, pw]) => window.__canvastDebug.hiddenOp(op as "set", pw), [op, pw] as const);
  const flush = () => page.evaluate(() => window.__canvastDebug.flushStorage());
  const listing = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => [e.name, !!e.hidden, e.present])));
  let hash = "";
  try {
    await page.getByTestId("import-input").setInputFiles({ name: "Secret Plan.png", mimeType: "image/png", buffer: secret });
    await expect.poll(listing).toEqual([["Secret Plan.png", false, true]]);
    hash = await page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries[0]!.hash));
    expect(await hid("set", "pw1")).toEqual({ ok: true, state: "open" });
    await lib("hide", hash, "1");
    await flush();
    const sealed = files(ws).filter((f) => f.startsWith(".hidden/"));
    expect(sealed).toHaveLength(1);
    expect(sealed[0]).toMatch(/^\.hidden\/[0-9a-f]{32}\.bin$/);
    expect(files(ws).filter((f) => f.startsWith("library/") || f.startsWith(".trash/"))).toEqual([]);
    expect(traces()).toEqual([]);
    expect(await listing()).toEqual([["Secret Plan.png", true, true]]);
    expect(await hid("set", null as unknown as string)).toEqual({ ok: false, state: "open" }); // (not removed while an item is hidden)
    expect(await hid("set", "pw2")).toEqual({ ok: true, state: "open" }); // the same key under a new password
    // Locked (from the command palette): the picture on the canvas leaves memory and is drawn with a padlock; the password opens it again.
    await page.keyboard.press("Control+k");
    await page.locator(".palette-input").fill("lock hidden");
    await expect(page.locator(".palette-title").first()).toHaveText("Lock hidden items");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.pictureLocked(h), hash)).toBe(true);
    expect(await page.evaluate((h) => window.__canvastDebug.originalBytes(h), hash)).toBeNull();
    expect((await hid("check", "pw2")).ok).toBe(true);
    expect(await page.evaluate((h) => window.__canvastDebug.originalBytes(h), hash)).toEqual(Array.from(secret));
    expect(await page.evaluate((h) => window.__canvastDebug.pictureLocked(h), hash)).toBe(true); // (opened, but still hidden: a padlock)
  } finally {
    await app.close();
  }
  // Another device: it knows nothing of the hidden item until the password is given there.
  ({ app, page } = await launch(ws, "device-b"));
  try {
    await expect.poll(() => hid("check", "x").then((r) => r.state)).toBe("locked");
    expect(await listing()).toEqual([]);
    expect((await hid("check", "pw1")).ok).toBe(false);
    expect(await hid("check", "pw2")).toEqual({ ok: true, state: "open" });
    await expect.poll(listing).toEqual([["Secret Plan.png", true, true]]);
    expect(await page.evaluate((h) => window.__canvastDebug.originalBytes(h), hash)).toEqual(Array.from(secret));
    // Shown again: opened back into its place in library/, the sealed file erased, its picture drawn again.
    await lib("hide", hash, "");
    await flush();
    await expect.poll(() => page.evaluate((h) => window.__canvastDebug.pictureLocked(h), hash)).toBe(false);
    expect(files(ws).filter((f) => f.startsWith("library/") || f.startsWith(".hidden/"))).toEqual(["library/images/secret_plan.png"]);
    expect(readFileSync(join(ws, "library/images/secret_plan.png")).equals(secret)).toBe(true);
    // Locked again: hiding waits for the key (the readable file stays until the password is given).
    await hid("lock");
    await lib("hide", hash, "1");
    await flush();
    expect(files(ws).filter((f) => f.startsWith("library/"))).toEqual(["library/images/secret_plan.png"]);
    expect((await hid("check", "pw2")).ok).toBe(true);
    await flush();
    expect(files(ws).filter((f) => f.startsWith("library/"))).toEqual([]);
    expect(traces()).toEqual([]);
    // A readable file put in .hidden/ from outside (a file manager) while the hidden items are open: it becomes a hidden item, sealed,
    // and nothing readable of it is left.
    const dropped = makePng(2, 3, () => [10, 220, 90, 255]);
    writeFileSync(join(ws, ".hidden", "Dropped Secret.png"), dropped);
    await expect.poll(() => files(ws).filter((f) => f.startsWith(".hidden/") && !/^\.hidden\/[0-9a-f]{32}\.bin$/.test(f)), { timeout: 15_000 }).toEqual([]);
    expect(files(ws).filter((f) => f.startsWith(".hidden/"))).toHaveLength(2);
    expect(files(ws).some((f) => readFileSync(join(ws, f)).includes(dropped.subarray(0, 24)))).toBe(false);
    await expect.poll(listing).toContainEqual(["Dropped Secret.png", true, true]);
  } finally {
    await app.close();
  }
});

test("a hidden item's picture is not read while locked, so after a restart its card shows once its list is opened", async () => {
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
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
  } finally {
    await app.close();
  }
});

test("library files changed outside the app: a renamed or moved file is found by its content, a new one is imported where it lies, a deleted one shows as missing", async () => {
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
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
  rmSync(join(ws, "library/poses/pose_one.png"));
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(listing, { timeout: 10_000 }).toEqual([
      ["Loomis Hands.png", "anatomy", true, 1],
      ["Pose One.png", "poses", false, 0],
    ]);
  } finally {
    await app.close();
  }
});

test("while the app runs it follows the folder: a canvas file renamed by hand, a file dropped into library/, another device's edits (loaded again) and both sides' edits (a conflict copy)", async () => {
  const ws = mkdtempSync(join(tmpdir(), "canvast-ws-"));
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
    writeFileSync(join(ws, "library/drops/New One.png"), makePng(2, 2, () => [5, 200, 5, 255]));
    await expect.poll(() => tree(a.page), { timeout: 10_000 }).toEqual([["Sketches", ["Heroes"]]]);
    await expect.poll(() => a.page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.name === "New One.png").map((e) => l.folders.find((f) => f.id === e.folderIds?.[0])?.name))), { timeout: 10_000 }).toEqual(["drops"]);
    await a.page.evaluate(() => window.__canvastDebug.flushStorage());
    expect(files(ws).filter((f) => f.endsWith(".cvst"))).toEqual([`${B}sketches/heroes.cvst`]);

    // Another device on the same folder at the same time: its saved edits are loaded again on this one (no edits here).
    b = await launch(ws, "device-b");
    await expect.poll(() => b!.page.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
    await add(b.page, 2);
    await b.page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect.poll(() => a.page.evaluate(() => window.__canvastDebug.objects().length), { timeout: 10_000 }).toBe(3);

    // Both edit before either file is written: this device keeps the folder's version, and its own as a conflict copy.
    await add(a.page, 1);
    await add(b.page, 1);
    await b.page.evaluate(() => window.__canvastDebug.flushStorage());
    await expect.poll(async () => (await tree(a.page)).map(([n, cs]) => [n, (cs as string[]).map((c) => c.replace(/\(conflict [^)]*\)/, "(conflict)"))]), { timeout: 10_000 }).toEqual([["Sketches", ["Heroes", "Heroes (conflict)"]]]);
    await expect.poll(() => a.page.evaluate(() => window.__canvastDebug.objects().length)).toBe(4); // (the folder's version: 3 + device B's one)
  } finally {
    await b?.app.close();
    await a.app.close();
  }
});

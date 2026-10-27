import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
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

const files = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(root, join(dir, e.name)) : [relative(root, join(dir, e.name))])).sort();

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
    expect(files(ws)).toEqual(["library/images/hand_study-loomis-2.png", "library/images/hand_study-loomis.png"]);
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

test("boards are folders and canvases .cvst files: safe names, -2 on a clash, renames move them, a deleted canvas goes to .trash, closing writes the last change", async () => {
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
    expect(files(ws).filter((f) => !f.startsWith(".canvast/"))).toEqual(["sketches/characters-2.cvst", "sketches/characters.cvst"]);
    const wsFile = JSON.parse(readFileSync(join(ws, ".canvast/workspace.json"), "utf8"));
    expect(wsFile.boards.map((b: { name: string; folder: string }) => [b.name, b.folder])).toEqual([["Sketches", "sketches"]]);
    await op("renameBoard", t[0]!.id, "Drawings");
    await op("deleteCanvas", t[0]!.canvases[1]!.id);
    // the last change, not flushed: closing the window writes it
    await page.getByTestId("import-input").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: makePng(2, 2, () => [0, 0, 0, 255]) });
    await expect.poll(() => page.evaluate(() => window.__canvastDebug.saveStatus())).toBe("verified");
  } finally {
    await app.close();
  }
  expect(files(ws).filter((f) => !f.startsWith(".canvast/"))).toEqual([".trash/drawings/characters-2.cvst", "drawings/characters.cvst", "library/images/dot.png"]);
  const canvas = JSON.parse(readFileSync(join(ws, "drawings/characters.cvst"), "utf8"));
  expect([canvas.format, canvas.objects.length, canvas.objects[0].kind]).toEqual(["canvast-canvas", 1, "image"]);
  ({ app, page } = await launch(ws));
  try {
    await expect.poll(async () => (await tree()).map((b) => [b.name, b.canvases.map((c) => [c.name, c.objectCount])])).toEqual([["Drawings", [["Characters", 1]]]]);
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
  expect(files(ws).filter((f) => f.endsWith(".cvst")).map((f) => f.replace(/conflict_[0-9_-]+/, "conflict"))).toEqual(["sketches/characters-conflict.cvst", "sketches/characters.cvst"]);
});

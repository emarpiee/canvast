import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";
import { APP_URL, expect, test } from "./harness";
import { blockyFixture, makePng } from "./png";

/**
 * Phase 1, slice 2: the shared asset catalog, Assets view, usage navigation,
 * reference-checked garbage collection, and safe deletion of canvases and
 * boards (ADR 0007).
 */

const BLANK = pathToFileURL(resolve("tests/e2e/fixtures/blank.html")).href;
const BLOCKS = blockyFixture();
const HASH = createHash("sha256").update(BLOCKS).digest("hex");
const GREEN = makePng(4, 4, () => [30, 160, 70, 255]);
const GREEN_HASH = createHash("sha256").update(GREEN).digest("hex");
/** Colour of source pixel (4, 3) of the blocks fixture. */
const BLOCK_4_3: [number, number, number] = [40, 140, 220];

type Sess = Awaited<ReturnType<Window["__canvastDebug"]["session"]>>;
const sess = (p: Page): Promise<Sess> => p.evaluate(() => window.__canvastDebug.session());
const objects = (p: Page) => p.evaluate(() => window.__canvastDebug.objects());
const listing = (p: Page) => p.evaluate(() => window.__canvastDebug.assetListing());
const stored = (p: Page): Promise<string[]> => p.evaluate(() => window.__canvastDebug.storedAssetHashes());
const card = (p: Page, hash: string) => p.locator(`[data-testid="asset-card"][data-hash="${hash}"]`);

async function openApp(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await page.evaluate(() => window.__canvastDebug.nextFrame());
  return page;
}

async function saved(p: Page): Promise<void> {
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.saveStatus()), { timeout: 5000 }).toBe("verified");
}

/** Import through the canvas toolbar: stores the original and places one instance. */
async function importOnCanvas(p: Page, buffer = BLOCKS, name = "blocks.png"): Promise<string> {
  const before = new Set((await objects(p)).map((o) => o.id));
  await p.getByTestId("import-input").setInputFiles({ name, mimeType: "image/png", buffer });
  await expect.poll(async () => (await objects(p)).length).toBe(before.size + 1);
  await saved(p);
  return (await objects(p)).find((o) => !before.has(o.id))!.id;
}

async function toAssets(p: Page): Promise<void> {
  await p.getByTestId("view-assets").click();
  await expect(p.getByTestId("assets-grid")).toBeVisible();
}

async function toCanvas(p: Page): Promise<void> {
  await p.getByTestId("view-canvas").click();
  await expect(p.locator("#canvas")).toBeVisible();
}

async function openMenu(p: Page): Promise<void> {
  if (await p.getByTestId("workspace-menu").isHidden()) await p.getByTestId("workspace-nav").click();
}

async function newCanvas(p: Page, expected: string): Promise<void> {
  await openMenu(p);
  await p.getByRole("button", { name: "+ Canvas" }).last().click();
  await expect(p.getByTestId("workspace-nav")).toHaveText(expected);
}

async function newBoard(p: Page, expected: string): Promise<void> {
  await openMenu(p);
  await p.getByRole("button", { name: "+ Board" }).click();
  await expect(p.getByTestId("workspace-nav")).toHaveText(expected);
}

async function openCanvas(p: Page, name: RegExp, expected: string): Promise<void> {
  await openMenu(p);
  await p.getByRole("menuitemradio", { name }).click();
  await expect(p.getByTestId("workspace-nav")).toHaveText(expected);
}

/** In Assets view: select an asset and place one instance on the open canvas. */
async function placeFromAssets(p: Page, hash: string): Promise<string> {
  const before = new Set((await objects(p)).map((o) => o.id));
  await toAssets(p);
  await card(p, hash).click();
  await p.getByTestId("asset-place").click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.appView())).toBe("canvas");
  await expect.poll(async () => (await objects(p)).length).toBe(before.size + 1);
  await saved(p);
  return (await objects(p)).find((o) => !before.has(o.id))!.id;
}

function near(c: number[], want: number[], tol = 6): boolean {
  return c.every((v, i) => Math.abs(v - want[i]!) <= tol);
}

test("importing a file that is already in the library says so, stores no second copy and still places it", async ({ app }) => {
  const p = app.page;
  await importOnCanvas(p);
  await expect(p.getByTestId("toast")).toBeHidden();
  await importOnCanvas(p); // the same bytes again (a file renamed outside the app counts the same)
  await expect(p.getByTestId("toast")).toContainText("already in your library");
  expect((await listing(p)).entries.map((e) => [e.hash, e.instances])).toEqual([[HASH, 2]]);
  expect(await stored(p)).toEqual([HASH]);
});

test("one original is shared by instances on several boards and canvases; usage is derived from them", async ({ app }) => {
  const p = app.page;
  await importOnCanvas(p);
  await toAssets(p);
  await expect(card(p, HASH)).toHaveCount(1);
  await expect(card(p, HASH).getByTestId("asset-uses")).toHaveText("1 use · 1 canvas");

  // A second instance on the same canvas, one on Canvas 2, one on Board 2.
  await card(p, HASH).click();
  await p.getByTestId("asset-place").click();
  await expect.poll(async () => (await objects(p)).length).toBe(2);
  await saved(p);
  await newCanvas(p, "Board 1 › Canvas 2");
  await placeFromAssets(p, HASH);
  await newBoard(p, "Board 2 › Canvas 1");
  const b2 = await placeFromAssets(p, HASH);
  for (const o of await objects(p)) expect(o).toMatchObject({ kind: "image", assetId: HASH });

  // One catalog entry and one stored original for four instances on three canvases.
  const l = await listing(p);
  expect(l.entries.map((e) => [e.hash, e.instances, e.canvases, e.present])).toEqual([[HASH, 4, 3, true]]);
  expect(await stored(p)).toEqual([HASH]);
  await toAssets(p);
  await expect(card(p, HASH).getByTestId("asset-uses")).toHaveText("4 uses · 3 canvases");
  await card(p, HASH).click();
  const rows = p.getByTestId("asset-places").locator("li");
  await expect(rows).toHaveText([/Board 1 › Canvas 1\s*2/, /Board 1 › Canvas 2\s*1/, /Board 2 › Canvas 1\s*1/]);
  // In use: deleting from the library is refused, with the reason.
  await expect(p.getByTestId("asset-delete")).toBeDisabled();
  await expect(p.getByTestId("asset-delete-note")).toContainText("4 instance(s)");

  // Deleting an instance never deletes the shared original.
  await toCanvas(p);
  await p.evaluate(() => window.__canvastDebug.setTool("select"));
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id)!.box, b2))!;
  await p.mouse.click((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([b2]);
  await p.keyboard.press("Delete");
  await saved(p);
  await toAssets(p);
  await expect(card(p, HASH).getByTestId("asset-uses")).toHaveText("3 uses · 2 canvases");
  expect(await stored(p)).toEqual([HASH]);

  // Importing the same bytes again (here, into the library only) adds no copy.
  await p.getByTestId("assets-import-input").setInputFiles({ name: "copy.png", mimeType: "image/png", buffer: BLOCKS });
  await expect(p.getByTestId("assets-status")).toHaveText("“blocks.png” is already in your library: no second copy is stored.");
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  expect(await stored(p)).toEqual([HASH]);
  expect(app.consoleErrors).toEqual([]);
});

test("Show opens the canvas, selects the instances and frames them, even 1,600 levels deep in either direction", async ({ app }) => {
  const p = app.page;
  // Place one instance 1,600 levels in, at an off-origin position, on Canvas 1 ...
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "123456789p-1590", cy: "-987654321p-1590", zi: 1600, zf: 0.25, pz: 1600 }));
  const deep = await importOnCanvas(p);
  // ... and one 1,600 levels out on Canvas 2.
  await newCanvas(p, "Board 1 › Canvas 2");
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "5p1605", cy: "-3p1610", zi: -1600, zf: 0.5, pz: -1600 }));
  const huge = await placeFromAssets(p, HASH);
  // Wander off: home on Canvas 1.
  await openCanvas(p, /Canvas 1/, "Board 1 › Canvas 1");
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 0, zf: 0, pz: 0 }));
  await app.frame();
  const tiny = await p.evaluate((id) => window.__canvastDebug.objectScreen(id), deep);
  expect(tiny === null || tiny.box.maxX - tiny.box.minX < 1e-100).toBe(true); // far below a pixel from home

  for (const [row, id, canvasName, level] of [
    [0, deep, "Board 1 › Canvas 1", 1600],
    [1, huge, "Board 1 › Canvas 2", -1600],
  ] as const) {
    await toAssets(p);
    await card(p, HASH).click();
    await p.getByTestId("asset-show").nth(row).click();
    await expect(p.getByTestId("workspace-nav")).toHaveText(canvasName);
    await expect.poll(() => p.evaluate(() => window.__canvastDebug.selection())).toEqual([id]);
    await app.frame();
    const cam = await app.camera();
    // The 8×6 px image is framed at 60%: about log2(80) ≈ 6.3 levels beyond where it was placed.
    expect(cam.zi + cam.zf).toBeGreaterThan(level + 5);
    expect(cam.zi + cam.zf).toBeLessThan(level + 8);
    const box = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i)!.box, id))!;
    const vp = await p.evaluate(() => window.__canvastDebug.viewport());
    expect(Math.abs((box.minX + box.maxX) / 2 - vp.width / 2)).toBeLessThan(1);
    expect(Math.abs((box.minY + box.maxY) / 2 - vp.height / 2)).toBeLessThan(1);
    expect(box.maxY - box.minY).toBeGreaterThan(0.6 * vp.height - 2);
    expect(box.maxY - box.minY).toBeLessThanOrEqual(0.6 * vp.height + 0.01);
    // The pixels are really drawn there: source pixel (4, 3) has its colour on screen.
    const x = box.minX + ((box.maxX - box.minX) * 4.5) / 8;
    const y = box.minY + ((box.maxY - box.minY) * 3.5) / 6;
    const c = await p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
    expect(near(c, BLOCK_4_3), `pixel ${c} at level ${cam.zi}`).toBe(true);
  }
  expect(app.consoleErrors).toEqual([]);
});

test("deleting from the library erases only unused originals, and undo history keeps one until it is gone", async ({ app }) => {
  const p = app.page;
  // An unused original (library import only) is erased at once.
  await toAssets(p);
  await p.getByTestId("assets-import-input").setInputFiles({ name: "green.png", mimeType: "image/png", buffer: GREEN });
  await expect(card(p, GREEN_HASH).getByTestId("asset-uses")).toHaveText("Unused");
  expect(await stored(p)).toEqual([GREEN_HASH]);
  await card(p, GREEN_HASH).click();
  await p.getByTestId("asset-delete").click();
  await expect(p.getByTestId("confirm-dialog")).toBeVisible();
  await p.getByTestId("confirm-cancel").click(); // cancel keeps it
  await expect(card(p, GREEN_HASH)).toHaveCount(1);
  await p.getByTestId("asset-delete").click();
  await p.getByTestId("confirm-ok").click();
  await expect(card(p, GREEN_HASH)).toHaveCount(0);
  await expect(p.getByTestId("assets-status")).toHaveText("Deleted from the library. The original was erased.");
  expect(await stored(p)).toEqual([]);

  // An original whose last instance was deleted is still needed by undo.
  await toCanvas(p);
  const id = await importOnCanvas(p);
  await p.evaluate(() => window.__canvastDebug.setTool("select"));
  const box = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i)!.box, id))!;
  await p.mouse.click((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
  await p.keyboard.press("Delete");
  await saved(p);
  await toAssets(p);
  await expect(card(p, HASH).getByTestId("asset-uses")).toHaveText("Unused");
  await card(p, HASH).click();
  await p.getByTestId("asset-delete").click();
  await p.getByTestId("confirm-ok").click();
  await expect(p.getByTestId("assets-status")).toHaveText("Deleted from the library. The original is kept until undo history no longer needs it.");
  await expect(card(p, HASH)).toHaveCount(0);
  expect(await stored(p)).toEqual([HASH]);
  expect(await p.evaluate(() => window.__canvastDebug.gcRoots())).toEqual([HASH]);

  // Undo brings the instance back, and with it the asset returns to the library.
  await toCanvas(p);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await objects(p)).map((o) => o.id)).toEqual([id]);
  await saved(p);
  await expect
    .poll(async () => (await p.evaluate(() => window.__canvastDebug.catalogEntries())).map((e) => [e.hash, e.state]))
    .toEqual([[HASH, "active"]]);
  await toAssets(p);
  await expect(card(p, HASH).getByTestId("asset-uses")).toHaveText("1 use · 1 canvas");

  // Delete the instance and the asset again; once the history is cleared (switching canvas), it is erased.
  await toCanvas(p);
  await p.mouse.click((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
  await p.keyboard.press("Delete");
  await saved(p);
  await toAssets(p);
  await card(p, HASH).click();
  await p.getByTestId("asset-delete").click();
  await p.getByTestId("confirm-ok").click();
  expect(await stored(p)).toEqual([HASH]);
  await toCanvas(p);
  await newCanvas(p, "Board 1 › Canvas 2");
  await expect.poll(() => stored(p)).toEqual([]);
  expect((await p.evaluate(() => window.__canvastDebug.catalogEntries())).length).toBe(0);
  const gc = await p.evaluate(() => window.__canvastDebug.gc());
  expect(gc).toEqual({ swept: [], bytesFreed: 0, retained: [], restored: [] });

  // A reload brings nothing back.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect(await stored(p)).toEqual([]);
  expect((await listing(p)).entries).toEqual([]);
  // The thumbnails went with their assets.
  expect(await p.evaluate(() => window.__canvastDebug.thumbRecords())).toEqual([]);
  expect(app.consoleErrors).toEqual([]);
});

test("garbage collection never erases an original that a stored instance references", async ({ app }) => {
  const p = app.page;
  const id = await importOnCanvas(p);
  // Move to an empty canvas so the open document holds no roots for the asset.
  await newCanvas(p, "Board 1 › Canvas 2");
  expect(await p.evaluate(() => window.__canvastDebug.gcRoots())).toEqual([]);
  // Fault injection: mark the in-use asset deleted behind the UI's in-use check.
  await p.evaluate((h) => window.__canvastDebug.forceCatalogState(h, "deleted"), HASH);
  const report = await p.evaluate(() => window.__canvastDebug.gc());
  expect(report).toEqual({ swept: [], bytesFreed: 0, retained: [], restored: [HASH] });
  expect(await stored(p)).toEqual([HASH]);
  expect((await listing(p)).entries.map((e) => [e.hash, e.instances])).toEqual([[HASH, 1]]);
  // And the instance still renders from it (magnified, so a sample is one source pixel at any DPR).
  await openCanvas(p, /Canvas 1/, "Board 1 › Canvas 1");
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 6, zf: 0, pz: 6 }));
  await app.frame();
  const box = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i)!.box, id))!;
  const c = await p.evaluate(
    ([a, b]) => window.__canvastDebug.pixelAt(a!, b!),
    [box.minX + ((box.maxX - box.minX) * 4.5) / 8, box.minY + ((box.maxY - box.minY) * 3.5) / 6],
  );
  expect(near(c, BLOCK_4_3)).toBe(true);
});

test("deleting canvases and boards removes their objects, keeps shared originals, and survives reload", async ({ app }) => {
  const p = app.page;
  await importOnCanvas(p); // Board 1 › Canvas 1
  await newCanvas(p, "Board 1 › Canvas 2");
  await placeFromAssets(p, HASH);
  await p.keyboard.press("p");
  await p.mouse.move(300, 600);
  await p.mouse.down();
  await p.mouse.move(400, 650, { steps: 5 });
  await p.mouse.up();
  await saved(p);
  const c2 = (await sess(p)).current!.canvasId;
  expect(await p.evaluate((c) => window.__canvastDebug.storedObjectIds(c), c2)).toHaveLength(2);
  await newBoard(p, "Board 2 › Canvas 1");
  await placeFromAssets(p, HASH);
  const board2 = (await sess(p)).current!.boardId;

  // Structural rules: Board 2's only canvas cannot be deleted on its own.
  await openMenu(p);
  await expect(p.getByRole("button", { name: "Delete canvas Canvas 1" }).last()).toBeDisabled();

  // Delete the open canvas Board 1 › Canvas 2: cancel first, then confirm.
  await openCanvas(p, /Canvas 2/, "Board 1 › Canvas 2");
  await openMenu(p);
  await p.getByRole("button", { name: "Delete canvas Canvas 2" }).click();
  await expect(p.getByTestId("confirm-dialog")).toContainText("It holds 2 object(s) on board “Board 1”.");
  await expect(p.getByTestId("confirm-dialog")).toContainText("Images placed on it stay in the Assets library.");
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("confirm-dialog")).toHaveCount(0);
  expect((await sess(p)).tree![0]!.canvases.map((c) => c.name)).toEqual(["Canvas 1", "Canvas 2"]);
  await openMenu(p);
  await p.getByRole("button", { name: "Delete canvas Canvas 2" }).click();
  await p.getByTestId("confirm-ok").click();
  // The app moved to the neighbouring canvas before deleting.
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 1");
  await expect.poll(async () => (await sess(p)).tree![0]!.canvases.map((c) => c.name)).toEqual(["Canvas 1"]);
  expect(await p.evaluate((c) => window.__canvastDebug.storedObjectIds(c), c2)).toEqual([]);
  expect(await stored(p)).toEqual([HASH]);
  expect((await listing(p)).entries.map((e) => [e.instances, e.canvases])).toEqual([[2, 2]]);

  // Delete Board 2 (not open).
  await openMenu(p);
  await p.getByRole("button", { name: "Delete board Board 2" }).click();
  await expect(p.getByTestId("confirm-dialog")).toContainText("Its 1 canvas(es) and 1 object(s) will be deleted.");
  await p.getByTestId("confirm-ok").click();
  await expect.poll(async () => (await sess(p)).tree!.map((b) => b.name)).toEqual(["Board 1"]);
  expect((await listing(p)).entries.map((e) => [e.instances, e.canvases])).toEqual([[1, 1]]);
  expect(await stored(p)).toEqual([HASH]);
  await openMenu(p);
  await expect(p.getByRole("button", { name: "Delete board Board 1" })).toBeDisabled();
  await expect(p.getByRole("button", { name: "Delete canvas Canvas 1" })).toBeDisabled();

  // After a reload the deletions hold, and nothing points at a deleted canvas.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  const s = await sess(p);
  expect(s.startup).toBe("existing");
  expect(s.tree!.map((b) => [b.name, b.canvases.map((c) => c.name)])).toEqual([["Board 1", ["Canvas 1"]]]);
  expect(s.current!.boardId).not.toBe(board2);
  expect((await objects(p)).length).toBe(1);
  expect(app.consoleErrors).toEqual([]);
});

test("a lost original is shown as missing and is restored everywhere by importing the same file", async ({ app }) => {
  const p = app.page;
  const id = await importOnCanvas(p);
  // Looking at the library stores a lower-quality thumbnail of the asset (derived data, ADR 0034).
  await toAssets(p);
  await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.thumbRecords())).map((t) => [t.hash, t.type, t.bytes > 0])).toEqual([[HASH, "image/webp", true]]);
  await toCanvas(p);
  await p.evaluate((h) => window.__canvastDebug.removeAssetBytes(h), HASH);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await app.frame();
  // The instance keeps its place and id (drawn as a placeholder), nothing is silently dropped.
  expect((await objects(p)).map((o) => o.id)).toEqual([id]);
  await toAssets(p);
  await expect(card(p, HASH)).toHaveClass(/is-missing/);
  // The card still shows what the asset looked like, marked as missing.
  await expect.poll(() => card(p, HASH).locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect(card(p, HASH)).toContainText("Original missing");
  await card(p, HASH).click();
  await expect(p.getByTestId("asset-inspector")).toContainText("The original file is missing from storage.");
  await expect(p.getByTestId("asset-place")).toHaveCount(0);
  // Re-import the same bytes: the original is back, for every instance.
  await p.getByTestId("assets-import-input").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer: BLOCKS });
  await expect(card(p, HASH)).not.toHaveClass(/is-missing/);
  expect(await stored(p)).toEqual([HASH]);
  await toCanvas(p);
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 6, zf: 0, pz: 6 }));
  await expect
    .poll(async () => {
      await app.frame();
      const box = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i)!.box, id))!;
      return p.evaluate(
        ([a, b]) => window.__canvastDebug.pixelAt(a!, b!),
        [box.minX + ((box.maxX - box.minX) * 4.5) / 8, box.minY + ((box.maxY - box.minY) * 3.5) / 6],
      );
    })
    .toEqual(BLOCK_4_3);
});

test("schema-2 data is upgraded: the catalog is rebuilt from stored originals and usage from stored instances", async ({ page }) => {
  // Seed a genuine schema-2 database (as Phase 1 slice 1 wrote it) from a page on the same file:// origin.
  await page.goto(BLANK);
  const ids = { ws: "w".repeat(32), board: "b".repeat(32), canvas: "c".repeat(32), obj: "0".repeat(31) + "1" };
  await page.evaluate(
    ([bytes, hash, ids]) =>
      new Promise<void>((resolveSeed, reject) => {
        const req = indexedDB.open("canvast", 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore("snapshots");
          db.createObjectStore("assets");
          db.createObjectStore("meta");
          db.createObjectStore("workspaces", { keyPath: "id" });
          db.createObjectStore("boards", { keyPath: "id" });
          db.createObjectStore("canvases", { keyPath: "id" }).createIndex("boardId", "boardId");
          db.createObjectStore("objects", { keyPath: ["canvasId", "id"] });
          db.createObjectStore("canvasViews");
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["assets", "meta", "workspaces", "boards", "canvases", "objects"], "readwrite");
          const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
          tx.objectStore("assets").put({ hash, type: "image/png", size: bytes.length, name: "legacy.png", pixelW: 8, pixelH: 6, blob, importedAt: 1 }, hash);
          tx.objectStore("workspaces").put({ id: ids.ws, displayName: "My workspace", boardIds: [ids.board], createdAt: 1, schemaVersion: 2 });
          tx.objectStore("boards").put({ id: ids.board, workspaceId: ids.ws, name: "Board 1", canvasIds: [ids.canvas], createdAt: 1 });
          tx.objectStore("canvases").put({ id: ids.canvas, boardId: ids.board, name: "Canvas 1", revision: 3, objectCount: 1, updatedAt: 1 });
          tx.objectStore("objects").put({
            canvasId: ids.canvas,
            id: ids.obj,
            data: { id: ids.obj, kind: "image", ax: "-200p0", ay: "-150p0", unit: 0, z: 1, opacity: 1, attachmentTargetId: null, assetId: hash, w: 400, h: 300, pixelW: 8, pixelH: 6 },
          });
          tx.objectStore("meta").put({ workspaceId: ids.ws, boardId: ids.board, canvasId: ids.canvas }, "current");
          tx.oncomplete = () => {
            db.close();
            resolveSeed();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [[...BLOCKS], HASH, ids] as const,
  );

  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect((await sess(page)).startup).toBe("existing");
  expect((await objects(page)).map((o) => o.id)).toEqual([ids.obj]);
  const l = await listing(page);
  expect(l.entries.map((e) => [e.hash, e.name, e.instances, e.canvases, e.present, e.state])).toEqual([[HASH, "legacy.png", 1, 1, true, "active"]]);
  expect(l.missing).toEqual([]);
  // The instance renders from the original.
  await expect
    .poll(async () => {
      await page.evaluate(() => window.__canvastDebug.nextFrame());
      return page.evaluate(() => window.__canvastDebug.pixelAt(640 + 25, 400 + 25)); // source pixel (4, 3)
    })
    .toEqual(BLOCK_4_3);
});

test("two tabs: a canvas deleted by the writer moves the reader off it; the reader cannot delete", async ({ app, context }) => {
  const p1 = app.page;
  await importOnCanvas(p1);
  await newCanvas(p1, "Board 1 › Canvas 2");
  const p2 = await openApp(context);
  expect((await sess(p2)).readOnly).toBe(true);
  await expect(p2.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 2");

  // The reader's Assets view lists the library but offers no destructive or placing action.
  await toAssets(p2);
  await card(p2, HASH).click();
  await expect(p2.getByTestId("asset-place")).toBeDisabled();
  await expect(p2.getByTestId("assets-import")).toBeDisabled();
  await toCanvas(p2);

  // The writer deletes Canvas 2 (it moves to Canvas 1 first); the reader follows.
  await openMenu(p1);
  await p1.getByRole("button", { name: "Delete canvas Canvas 2" }).click();
  await p1.getByTestId("confirm-ok").click();
  await expect(p1.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 1");
  await expect(p2.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 1");
  expect((await objects(p2)).length).toBe(1);
  expect((await sess(p2)).tree![0]!.canvases.map((c) => c.name)).toEqual(["Canvas 1"]);
  await p2.close();
});

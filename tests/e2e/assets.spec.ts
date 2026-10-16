import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";
import { APP_URL, expect, openActions, rowAction, test } from "./harness";
import { blockyFixture, makePng } from "./png";
import { encodeGif } from "./gif";
import { makeFakeMp4 } from "./mp4";
import { makeWav, makeWebm } from "./video";

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
  // The viewer stays open when the library is left (placing an asset, say); these specs start from the gallery.
  const viewer = p.getByTestId("slide-view");
  if (await viewer.isVisible()) await p.keyboard.press("Escape");
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
  await p.getByRole("button", { name: /^\+ New canvas/ }).last().click();
  await expect(p.getByTestId("workspace-nav")).toHaveText(expected);
}

async function newBoard(p: Page, expected: string): Promise<void> {
  await openMenu(p);
  await p.getByRole("button", { name: /^\+ New board/ }).click();
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
  await expect(card(p, HASH).getByTestId("asset-uses")).toHaveText("Used 1 time on 1 canvas");

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
  await expect(card(p, HASH).getByTestId("asset-uses")).toHaveText("Used 4 times on 3 canvases");
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
  await expect(card(p, HASH).getByTestId("asset-uses")).toHaveText("Used 3 times on 2 canvases");
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
  await expect(card(p, HASH).getByTestId("asset-uses")).toHaveText("Used 1 time on 1 canvas");

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
  await openActions(p, "canvas", "Canvas 1");
  await expect(p.getByRole("menuitem", { name: "Delete canvas Canvas 1" })).toBeDisabled();

  // Delete the open canvas Board 1 › Canvas 2: cancel first, then confirm.
  await openCanvas(p, /Canvas 2/, "Board 1 › Canvas 2");
  await openMenu(p);
  await rowAction(p, "canvas", "Canvas 2", "Delete");
  await expect(p.getByTestId("confirm-dialog")).toContainText("It holds 2 object(s) on board “Board 1”.");
  await expect(p.getByTestId("confirm-dialog")).toContainText("Images placed on it stay in the Assets library.");
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("confirm-dialog")).toHaveCount(0);
  expect((await sess(p)).tree![0]!.canvases.map((c) => c.name)).toEqual(["Canvas 1", "Canvas 2"]);
  await openMenu(p);
  await rowAction(p, "canvas", "Canvas 2", "Delete");
  await p.getByTestId("confirm-ok").click();
  // The app moved to the neighbouring canvas before deleting.
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 1");
  await expect.poll(async () => (await sess(p)).tree![0]!.canvases.map((c) => c.name)).toEqual(["Canvas 1"]);
  expect(await p.evaluate((c) => window.__canvastDebug.storedObjectIds(c), c2)).toEqual([]);
  expect(await stored(p)).toEqual([HASH]);
  expect((await listing(p)).entries.map((e) => [e.instances, e.canvases])).toEqual([[2, 2]]);

  // Delete Board 2 (not open).
  await openMenu(p);
  await rowAction(p, "board", "Board 2", "Delete");
  await expect(p.getByTestId("confirm-dialog")).toContainText("Its 1 canvas(es) and 1 object(s) will be deleted.");
  await p.getByTestId("confirm-ok").click();
  await expect.poll(async () => (await sess(p)).tree!.map((b) => b.name)).toEqual(["Board 1"]);
  expect((await listing(p)).entries.map((e) => [e.instances, e.canvases])).toEqual([[1, 1]]);
  expect(await stored(p)).toEqual([HASH]);
  await openMenu(p);
  await openActions(p, "board", "Board 1");
  await expect(p.getByRole("menuitem", { name: "Delete board Board 1" })).toBeDisabled();
  await openActions(p, "canvas", "Canvas 1");
  await expect(p.getByRole("menuitem", { name: "Delete canvas Canvas 1" })).toBeDisabled();

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
  // Importing stores a lower-quality thumbnail of the asset, made in the background (derived data, ADR 0034).
  await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.thumbRecords())).map((t) => [t.hash, t.type, t.bytes > 0])).toEqual([[HASH, "image/webp", true]]);
  await toAssets(p);
  // The slide view shows the original full window, steps through the library and closes with Esc.
  await p.getByTestId("assets-import-input").setInputFiles({ name: "green.png", mimeType: "image/png", buffer: GREEN });
  await expect(card(p, GREEN_HASH)).toHaveCount(1);
  await card(p, HASH).dblclick();
  const slide = p.getByTestId("slide-view");
  await expect(slide).toBeVisible();
  await expect.poll(() => slide.locator("figure img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const first = await slide.locator("figcaption").textContent();
  expect(first).not.toContain("missing");
  await p.keyboard.press("ArrowRight");
  await expect(slide.locator("figcaption")).not.toHaveText(first!);
  await p.keyboard.press("Escape");
  await expect(slide).toBeHidden();
  await card(p, GREEN_HASH).click();
  await p.getByTestId("asset-delete").click();
  await p.getByTestId("confirm-ok").click();
  await expect(card(p, GREEN_HASH)).toHaveCount(0);
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
  // Its slide view shows the thumbnail and says why.
  await card(p, HASH).dblclick();
  await expect(p.getByTestId("slide-view").locator("figcaption")).toContainText("The original is missing or damaged");
  await expect.poll(() => p.getByTestId("slide-view").locator("figure img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await p.keyboard.press("Escape");
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
  await rowAction(p1, "canvas", "Canvas 2", "Delete");
  await p1.getByTestId("confirm-ok").click();
  await expect(p1.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 1");
  await expect(p2.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 1");
  expect((await objects(p2)).length).toBe(1);
  expect((await sess(p2)).tree![0]!.canvases.map((c) => c.name)).toEqual(["Canvas 1"]);
  await p2.close();
});

test("a video is placed paused; its player steps, repeats, plays and keeps the paused position through undo and reload (ADR 0041)", async ({ app }) => {
  // Decoding video under load (other workers) takes longer than the default 5 s wait.
  const expectSlow = expect.configure({ timeout: 20_000 });
  const p = app.page;
  const webm = await makeWebm(p, 2);
  await p.getByTestId("import-input").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: webm });
  await expectSlow.poll(async () => (await objects(p)).length).toBe(1);
  await saved(p);
  const [o] = await objects(p);
  expectSlow(o!["media"]).toEqual({ kind: "video", t: 0, repeat: false });
  // Select it: the player appears with the video's length.
  await p.keyboard.press("v");
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), o!.id))!.box;
  await p.mouse.click((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
  const bar = p.getByTestId("media-bar");
  await expectSlow(bar).toBeVisible();
  // The scrubber has the room: it takes the bar's whole top row but for the time.
  const barBox = (await bar.boundingBox())!;
  const scrubBox = (await bar.locator(".media-scrub").boundingBox())!;
  expect(scrubBox.width, "the player's scrubber is wide").toBeGreaterThan(barBox.width * 0.7);
  await expectSlow(bar.locator(".media-time")).toHaveText(/^0:00 \/ 0:0[1-9]$/);
  const dur = await p.evaluate(() => document.querySelector<HTMLVideoElement>(".media-video")!.duration);
  expectSlow(dur).toBeGreaterThan(1);
  // While the instance is dragged the overlay is hidden (the canvas shows it at the previewed place); afterwards it follows.
  const overlay = p.locator("video.media-video");
  const cx = Math.round((box.minX + box.maxX) / 2);
  const cy = Math.round((box.minY + box.maxY) / 2);
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx + 60, cy + 40, { steps: 4 });
  await expectSlow(overlay).toBeHidden();
  await expectSlow(bar).toBeHidden(); // the bar would stay behind
  await p.mouse.up();
  await expectSlow(overlay).toBeVisible();
  await expectSlow(bar).toBeVisible();
  const ob = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), o!.id))!.box;
  expectSlow(Math.abs((await overlay.boundingBox())!.x - ob.minX)).toBeLessThan(2);
  const t = async () => ((await objects(p))[0]!["media"] as { t: number; repeat: boolean }).t;
  // The 3 s step is longer than the video: forward stops at the end, back at the start (no repeat).
  await bar.getByRole("button", { name: "Step forward" }).click();
  await expectSlow.poll(t).toBeCloseTo(dur, 1);
  await bar.getByRole("button", { name: "Step back" }).click();
  await expectSlow.poll(t).toBe(0);
  // With repeat the overshoot wraps round.
  await bar.getByRole("button", { name: "Repeat" }).click();
  await bar.getByRole("button", { name: "Step forward" }).click();
  await expectSlow.poll(t).toBeCloseTo(3 % dur, 1);
  // Undo puts the paused position back, and the player follows.
  await p.keyboard.press("Control+z");
  await expectSlow.poll(t).toBe(0);
  // Play, then pause: the position moved and is written once, on pause.
  await p.evaluate(() => window.__canvastDebug.flushSave());
  const before = await p.evaluate(() => window.__canvastDebug.session().revision);
  await bar.getByRole("button", { name: "Play", exact: true }).click();
  await expectSlow.poll(() => p.evaluate(() => document.querySelector<HTMLVideoElement>(".media-video")!.currentTime)).toBeGreaterThan(0.2);
  expectSlow(await p.evaluate(() => window.__canvastDebug.session().revision), "playing writes nothing").toBe(before);
  await bar.getByRole("button", { name: "Pause", exact: true }).click();
  await expectSlow.poll(t).toBeGreaterThan(0.2);
  let paused = await t();
  // The picture drawn when deselected is the paused frame the player showed (a recorded fixture changes colour all the time).
  const liveRgb = await overlay.evaluate((v: HTMLVideoElement) => {
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const x = c.getContext("2d")!;
    x.drawImage(v, 0, 0, 8, 8);
    return [...x.getImageData(4, 4, 1, 1).data.slice(0, 3)];
  });
  await p.mouse.click(1100, 700);
  const mid = [cx + 60, cy + 40] as const;
  await expectSlow.poll(async () => {
    const px = await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x, y), mid);
    return liveRgb.reduce((a, v, i) => a + Math.abs(v - px[i]!), 0);
  }).toBeLessThan(90);
  await p.mouse.click(...mid);
  await expectSlow(bar).toBeVisible();
  // Selected again, the player opens on that same paused frame (not a stale or later one).
  await expectSlow(overlay).toBeVisible();
  await expectSlow(overlay).toHaveCSS("opacity", "1");
  const reopened = await overlay.evaluate((v: HTMLVideoElement) => {
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const x = c.getContext("2d")!;
    x.drawImage(v, 0, 0, 8, 8);
    return [...x.getImageData(4, 4, 1, 1).data.slice(0, 3)];
  });
  expectSlow(liveRgb.reduce((a, v, i) => a + Math.abs(v - reopened[i]!), 0)).toBeLessThan(90);
  // It keeps playing when deselected (no bar), and the bar controls it again when it is selected.
  await bar.getByRole("button", { name: "Play", exact: true }).click();
  await p.mouse.click(1100, 700);
  await expectSlow(bar).toBeHidden();
  const timeNow = () => overlay.evaluate((v: HTMLVideoElement) => (v.paused ? -1 : v.currentTime));
  const t0 = await timeNow();
  expectSlow(t0).toBeGreaterThanOrEqual(0);
  await expectSlow.poll(timeNow).toBeGreaterThan(t0);
  await p.mouse.click(cx + 60, cy + 40); // the instance was moved by the drag above
  await expectSlow(bar.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  // Moving it pauses playback; releasing plays on.
  const isPaused = () => overlay.evaluate((v: HTMLVideoElement) => v.paused);
  await p.mouse.move(cx + 60, cy + 40);
  await p.mouse.down();
  await p.mouse.move(cx + 90, cy + 60, { steps: 3 });
  await expectSlow.poll(isPaused).toBe(true);
  await p.mouse.up();
  await expectSlow.poll(isPaused).toBe(false);
  await bar.getByRole("button", { name: "Pause", exact: true }).click();
  await expectSlow.poll(t).toBeGreaterThan(paused);
  paused = await t();
  await saved(p);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expectSlow(((await objects(p))[0]!["media"] as { t: number }).t).toBe(paused);
  // Unselected, the canvas draws the picture at the paused time (not a placeholder).
  const b2 = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), o!.id))!.box;
  await expect
    .poll(async () => {
      const [r, g, bl] = await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x!, y!), [Math.round((b2.minX + b2.maxX) / 2), Math.round((b2.minY + b2.maxY) / 2)]);
      return Math.max(r!, g!, bl!) - Math.min(r!, g!, bl!);
    })
    .toBeGreaterThan(80);
  // Extract Frame from the video: a plain image next to it.
  await p.keyboard.press("v");
  await p.mouse.click(Math.round((b2.minX + b2.maxX) / 2), Math.round((b2.minY + b2.maxY) / 2));
  // The video layer appears only once it holds the paused picture (never the first frame for a moment), and the bar stays outside the picture.
  await expectSlow(overlay).toBeVisible();
  await expectSlow(overlay, "transparent until it holds the paused picture").toHaveCSS("opacity", "1");
  expectSlow(await overlay.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(paused, 1);
  const bb = (await p.getByTestId("media-bar").boundingBox())!;
  const pb = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), o!.id))!.box;
  expectSlow(bb.y >= pb.maxY || bb.y + bb.height <= pb.minY, "the player does not cover the picture").toBe(true);
  await p.getByTestId("media-bar").getByRole("button", { name: "Extract frame" }).click();
  await expectSlow.poll(async () => (await objects(p)).length).toBe(2);
  expectSlow((await objects(p))[1]!["media"]).toBeUndefined();
  // Layers name the files, not "Image WxH".
  await p.getByRole("button", { name: "Layers panel" }).click();
  await expectSlow(p.getByTestId("layers-panel").locator(".layer-name")).toHaveText(["frame.png", "clip.webm"]);
  // The slide view plays the original video (it is not "missing or damaged").
  await toAssets(p);
  await card(p, String((await objects(p))[0]!["assetId"])).click();
  await p.getByTestId("asset-preview").click();
  const slide = p.getByTestId("slide-view");
  await expectSlow(slide.locator("video")).toBeVisible();
  await expectSlow(slide.locator("figcaption")).not.toContainText("missing");
  expectSlow(await slide.locator("video").evaluate((v: HTMLVideoElement) => v.error)).toBeNull();
  // Switching from the video to a GIF leaves nothing of the video's player behind, and back.
  await p.keyboard.press("Escape");
  await toCanvas(p);
  await p.getByTestId("import-input").setInputFiles({ name: "tiny.gif", mimeType: "image/gif", buffer: Buffer.from(encodeGif(8, 8, [[255, 0, 0], [0, 0, 255]], [0, 1].map((c) => ({ w: 8, h: 8, pixels: Array(64).fill(c) })))) });
  await expectSlow.poll(async () => (await objects(p)).length).toBe(3);
  const [vid, , gifObj] = await objects(p);
  const centre = async (id: string) => {
    const b = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
    return [Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2)] as const;
  };
  const row = (id: string) => p.getByTestId("layers-panel").locator(`li.layer[data-key="${id}"]`);
  await row(vid!.id).click();
  await expectSlow(p.locator("video.media-video")).toBeVisible();
  await row(gifObj!.id).click();
  await expectSlow(p.locator("canvas.media-video")).toBeVisible();
  await expectSlow(p.locator("video.media-video")).toBeHidden();
  await row(vid!.id).click();
  await expectSlow(p.locator("video.media-video")).toBeVisible();
  await expectSlow(p.locator("canvas.media-video")).toBeHidden();
  expectSlow(app.consoleErrors).toEqual([]);
});

test("audio is placed as its waveform; its player steps 1 s and keeps the paused position (ADR 0041)", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("import-input").setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: makeWav(3) });
  await expect.poll(async () => (await objects(p)).length).toBe(1);
  await saved(p);
  const [o] = await objects(p);
  expect(o!["media"]).toEqual({ kind: "audio", t: 0, repeat: false });
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), o!.id))!.box;
  const mid = [Math.round((box.minX + box.maxX) / 2), Math.round((box.minY + box.maxY) / 2)] as const;
  // Unselected: the waveform is drawn (its bars are blue, the card is pale).
  await expect.poll(async () => (await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x, y), mid))[2]! - (await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x, y), mid))[0]!).toBeGreaterThan(60);
  await p.keyboard.press("v");
  await p.mouse.click(mid[0], mid[1]);
  const bar = p.getByTestId("media-bar");
  await expect(bar.locator(".media-time")).toHaveText("0:00 / 0:03");
  await expect(p.locator("video.media-video")).toBeHidden();
  const t = async () => ((await objects(p))[0]!["media"] as { t: number }).t;
  await bar.getByRole("button", { name: "Step forward" }).click();
  await expect.poll(t).toBeCloseTo(1, 1);
  // Volume is a real 0 to 100 control.
  await bar.getByLabel("Volume").fill("40");
  expect(await p.evaluate(() => document.querySelector<HTMLVideoElement>("video.media-video")!.volume)).toBeCloseTo(0.4);
  // The step is a setting (Media & Playback): a bad value is refused, a good one applies to the next press.
  await bar.getByRole("button", { name: "Media & Playback settings" }).click();
  const audioStep = bar.getByLabel("Audio step (s)");
  await audioStep.fill("0");
  await audioStep.blur();
  await expect(audioStep).toHaveValue("1");
  await audioStep.fill("1.5");
  await audioStep.blur();
  await bar.getByRole("button", { name: "Step forward" }).click();
  await expect.poll(t).toBeCloseTo(2.5, 1);
  await bar.getByRole("button", { name: "Step forward" }).click();
  await expect.poll(t).toBeCloseTo(3, 1); // stops at the end
  await saved(p);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect(await t()).toBeCloseTo(3, 1);
  expect(app.consoleErrors).toEqual([]);
});

test("audio that is playing carries on after it leaves the view (ADR 0044)", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("import-input").setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: makeWav(8) });
  await expect.poll(async () => (await objects(p)).length).toBe(1);
  await saved(p);
  const [o] = await objects(p);
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), o!.id))!.box;
  await p.keyboard.press("v");
  await p.mouse.click(Math.round((box.minX + box.maxX) / 2), Math.round((box.minY + box.maxY) / 2));
  await p.getByTestId("media-bar").getByRole("button", { name: "Play", exact: true }).click();
  await p.mouse.click(1100, 700); // deselect: it plays on
  const time = () => p.evaluate(() => { const v = document.querySelector<HTMLVideoElement>("video.media-video"); return v && !v.paused ? v.currentTime : -1; });
  await expect.poll(time).toBeGreaterThan(0);
  // Pan far away: the audio is out of view and still plays (a video would stop).
  await p.evaluate(() => window.__canvastDebug.setCamera({ ...window.__canvastDebug.camera(), cx: "100000p0" }));
  await app.frame();
  const t0 = await time();
  expect(t0).toBeGreaterThan(0);
  await expect.poll(time).toBeGreaterThan(t0);
  expect(app.consoleErrors).toEqual([]);
});

test("an animated GIF steps by frame: placed paused, stepped, wrapped, played and drawn at its paused frame (ADR 0042)", async ({ app }) => {
  const p = app.page;
  const W = 120;
  const H = 80;
  const PAL = [[255, 0, 0], [0, 200, 0], [0, 0, 255], [240, 220, 0], [0, 0, 0]];
  // Four frames: the right half is one colour per frame; the left half is a pattern that needs a growing LZW table.
  const frames = [0, 1, 2, 3].map((c) => ({ w: W, h: H, delay: 20, pixels: Array.from({ length: W * H }, (_, i) => (i % W < 60 ? 4 : c)) }));
  frames[0]!.pixels = frames[0]!.pixels.map((v, i) => (i % W < 60 ? (((i % W) * 7 + Math.floor(i / W) * 3) % 3) + 1 : v));
  const gif = Buffer.from(encodeGif(W, H, PAL, frames));
  // The encoder is checked against the browser's own decoder first (pattern pixel (10,10) is index 2, blue; the right half is red).
  const seen = await p.evaluate(async (bytes) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/gif" }));
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    return [...ctx.getImageData(10, 10, 1, 1).data.slice(0, 3), ...ctx.getImageData(100, 40, 1, 1).data.slice(0, 3)];
  }, [...gif]);
  expect(seen).toEqual([0, 0, 255, 255, 0, 0]);
  await p.getByTestId("import-input").setInputFiles({ name: "anim.gif", mimeType: "image/gif", buffer: gif });
  await expect.poll(async () => (await objects(p)).length).toBe(1);
  await saved(p);
  const [o] = await objects(p);
  expect(o!["media"]).toEqual({ kind: "gif", t: 0, repeat: false });
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), o!.id))!.box;
  const at = [Math.round(box.minX + (box.maxX - box.minX) * 0.75), Math.round((box.minY + box.maxY) / 2)] as const;
  const colour = async () => (await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x, y), at)).slice(0, 3).map((v) => Math.round(v / 40));
  await expect.poll(colour).toEqual([6, 0, 0]); // frame 0: red
  await p.keyboard.press("v");
  await p.mouse.click(Math.round(box.minX + (box.maxX - box.minX) * 0.25), at[1]);
  const bar = p.getByTestId("media-bar");
  await expect(bar.locator(".media-time")).toHaveText("Frame 1 / 4");
  await expect(bar.getByRole("button", { name: "Mute" })).toBeHidden();
  const t = async () => ((await objects(p))[0]!["media"] as { t: number }).t;
  await bar.getByRole("button", { name: "Step forward" }).click();
  await expect(bar.locator(".media-time")).toHaveText("Frame 2 / 4");
  await expect.poll(t).toBe(1);
  // Extract Frame: a plain image of the shown frame (green) appears to the right; the GIF is unchanged.
  await bar.getByRole("button", { name: "Extract frame" }).click();
  await expect.poll(async () => (await objects(p)).length).toBe(2);
  const [orig, ext] = await objects(p);
  expect(ext!["media"]).toBeUndefined();
  expect(ext!["assetId"]).not.toBe(orig!["assetId"]);
  expect(orig!["media"]).toEqual({ kind: "gif", t: 1, repeat: false });
  const xb = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), ext!.id))!.box;
  expect(xb.minX).toBeGreaterThan(box.maxX);
  await expect.poll(async () => (await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x, y), [Math.round(xb.minX + (xb.maxX - xb.minX) * 0.75), at[1]] as const)).slice(0, 3).map((v) => Math.round(v / 40))).toEqual([0, 5, 0]);
  await p.mouse.click(1100, 700);
  await expect.poll(colour).toEqual([0, 5, 0]);
  // Back to the instance: repeat wraps stepping back from the first frame to the last.
  await p.mouse.click(Math.round(box.minX + (box.maxX - box.minX) * 0.25), at[1]);
  await bar.getByRole("button", { name: "Repeat" }).click();
  await bar.getByRole("button", { name: "Step back" }).click();
  await bar.getByRole("button", { name: "Step back" }).click();
  await expect.poll(t).toBe(3);
  // Playing runs through the frames and writes nothing; pausing writes the shown frame.
  await p.evaluate(() => window.__canvastDebug.flushSave());
  const before = await p.evaluate(() => window.__canvastDebug.session().revision);
  await bar.getByRole("button", { name: "Play", exact: true }).click();
  await expect(bar.locator(".media-time")).toHaveText(/Frame [12] \/ 4/); // wrapped past the last frame
  expect(await p.evaluate(() => window.__canvastDebug.session().revision)).toBe(before);
  await bar.getByRole("button", { name: "Pause", exact: true }).click();
  const shown = Number((await bar.locator(".media-time").textContent())!.match(/Frame (\d+)/)![1]) - 1;
  await expect.poll(t).toBe(shown);
  // A duplicate keeps the paused frame and starts paused.
  await p.keyboard.press("Control+d");
  await expect.poll(async () => (await objects(p)).length).toBe(3);
  expect((await objects(p))[2]!["media"]).toEqual({ kind: "gif", t: shown, repeat: true });
  expect(app.consoleErrors).toEqual([]);
});

test("a browser that draws nothing for a video still imports it (the flat picture is kept, not an error)", async ({ app }) => {
  const p = app.page;
  const webm = await makeWebm(p, 2);
  // What Firefox on Android does: drawing a video element leaves the canvas empty.
  await p.evaluate(() => {
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, img: CanvasImageSource, ...a: number[]) {
      if (img instanceof HTMLVideoElement) return;
      return (draw as (...x: unknown[]) => void).call(this, img, ...a);
    } as typeof draw;
  });
  await p.getByTestId("import-input").setInputFiles({ name: "blank.webm", mimeType: "video/webm", buffer: webm });
  await expect.poll(async () => (await objects(p)).length).toBe(1);
  expect(app.consoleErrors).toEqual([]);
});

test("a video this browser cannot decode is still imported as a card of its own shape, with the original available to save (ADR 0045)", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("import-input").setInputFiles({ name: "hevc.mp4", mimeType: "video/mp4", buffer: makeFakeMp4(1080, 1920, 7) });
  await expect.poll(async () => (await objects(p)).length).toBe(1);
  await saved(p);
  const [o] = await objects(p);
  expect([o!["pixelW"], o!["pixelH"]]).toEqual([1080, 1920]);
  expect(o!["media"]).toEqual({ kind: "video", t: 0, repeat: false });
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), o!.id))!.box;
  expect((box.maxY - box.minY) / (box.maxX - box.minX)).toBeCloseTo(1920 / 1080, 1);
  // The card fills the instance (its play mark is at the centre), also straight after the import.
  const sum = async (x: number, y: number) => (await p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y])).slice(0, 3).reduce((s, v) => s + v, 0);
  const mx = Math.round((box.minX + box.maxX) / 2);
  const my = Math.round((box.minY + box.maxY) / 2);
  await expect.poll(async () => (await sum(mx, Math.round(my - (box.maxY - box.minY) * 0.06))) - (await sum(Math.round(box.maxX + 30), my))).toBeGreaterThan(40);
  // The card is drawn (dark, not a placeholder gap) and selecting it offers the file, not playback.
  await p.keyboard.press("v");
  await p.mouse.click(Math.round((box.minX + box.maxX) / 2), Math.round((box.minY + box.maxY) / 2));
  const bar = p.getByTestId("media-bar");
  await expect(bar.locator(".media-time")).toHaveText("Can't play in this browser");
  await expect(bar.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  const download = p.waitForEvent("download");
  await bar.getByRole("button", { name: /Save the original file/ }).click();
  expect((await download).suggestedFilename()).toBe("hevc.mp4");
  // A selected, unplayable instance has no black layer over its card.
  await expect(p.locator("video.media-video")).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

test("viewer: opens from a card, steps through the library with a filmstrip, and the details and the controls can be hidden and stay hidden (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  for (const [i, c] of ([[200, 40, 40], [40, 200, 40], [40, 40, 200]] as const).entries()) {
    await p.getByTestId("assets-import-input").setInputFiles({ name: `ref-${i}.png`, mimeType: "image/png", buffer: makePng(8 + i, 6, () => [c[0], c[1], c[2], 255]) });
  }
  await expect(p.getByTestId("asset-card")).toHaveCount(3);
  // The cards carry the picture only until hovered or selected; a double-click opens the viewer beside the details.
  await p.getByTestId("asset-card").nth(0).dblclick();
  const viewer = p.getByTestId("slide-view");
  await expect(viewer).toBeVisible();
  await expect(p.getByTestId("asset-inspector")).toBeVisible();
  await expect(viewer.locator(".viewer-pos")).toHaveText("1 of 3");
  await expect(viewer.locator(".film-item")).toHaveCount(3);
  await p.keyboard.press("ArrowRight");
  await expect(viewer.locator(".viewer-pos")).toHaveText("2 of 3");
  await expect(viewer.locator(".film-item.is-current")).toHaveCount(1);
  // The details follow the open asset; a filmstrip item opens its asset.
  const name = await p.getByTestId("asset-inspector").locator("h2").textContent();
  await viewer.locator(".film-item").nth(2).click();
  await expect(viewer.locator(".viewer-pos")).toHaveText("3 of 3");
  expect(await p.getByTestId("asset-inspector").locator("h2").textContent()).not.toBe(name);
  // Hide the details (I) and the controls (F): the picture gets the room, a handle brings the controls back, and both choices are remembered.
  await p.keyboard.press("i");
  await expect(p.getByTestId("asset-inspector")).toBeHidden();
  await p.keyboard.press("f");
  await expect(viewer.locator(".viewer-bar")).toBeHidden();
  await expect(viewer.getByRole("button", { name: "Show the controls" })).toBeVisible();
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await toAssets(p);
  await p.getByTestId("asset-card").nth(0).dblclick();
  await expect(viewer).toBeVisible();
  await expect(p.getByTestId("asset-inspector")).toBeHidden();
  await expect(viewer.locator(".viewer-bar")).toBeHidden();
  await viewer.getByRole("button", { name: "Show the controls" }).click();
  await expect(viewer.locator(".viewer-bar")).toBeVisible();
  await p.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

test("picking several: Ctrl and Shift click, checkboxes, select all, and bulk actions on the picked assets (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  for (let i = 0; i < 5; i++) {
    await p.getByTestId("assets-import-input").setInputFiles({ name: `ref-${i}.png`, mimeType: "image/png", buffer: makePng(8 + i, 6, () => [40 * i, 90, 200 - 30 * i, 255]) });
  }
  const cards = p.getByTestId("asset-card");
  await expect(cards).toHaveCount(5);
  const picked = () => p.locator('[data-testid="asset-card"][aria-pressed="true"]');
  const viewer = p.getByTestId("slide-view");
  // A click picks one and shows its details (it does not open the viewer); Ctrl adds and removes; Shift takes the range from the last pick.
  await cards.nth(0).click();
  await expect(picked()).toHaveCount(1);
  await expect(viewer).toBeHidden();
  await expect(p.getByTestId("asset-inspector")).toBeVisible();
  // One picked item shows its details only: the other cards keep their checkboxes hidden until a second one is picked.
  await expect(p.locator(".assets-grid.has-picks")).toHaveCount(0);
  await expect(cards.nth(1).locator("xpath=..").locator(".asset-check")).toHaveCSS("opacity", "0");
  await cards.nth(2).click({ modifiers: ["Control"] });
  await expect(picked()).toHaveCount(2);
  await cards.nth(0).click({ modifiers: ["Control"] });
  await expect(picked()).toHaveCount(1);
  await cards.nth(1).click({ modifiers: ["Control"] });
  await cards.nth(4).click({ modifiers: ["Shift"] });
  await expect(picked()).toHaveCount(4);
  // Once picking has started a plain click picks too; Esc clears the selection (the keyboard need not be in the library).
  await cards.nth(0).click();
  await expect(picked()).toHaveCount(5);
  await expect(viewer).toBeHidden();
  await p.keyboard.press("Escape");
  await expect(picked()).toHaveCount(0);
  // Checkboxes do the same without a keyboard: one tap adds, another removes.
  await p.getByRole("checkbox", { name: /^Select ref-3\.png/ }).check();
  await p.getByRole("checkbox", { name: /^Select ref-1\.png/ }).check();
  await expect(picked()).toHaveCount(2);
  const details = p.getByTestId("asset-inspector");
  await expect(details.locator("h2")).toHaveText("2 selected");
  await p.getByRole("checkbox", { name: /^Select ref-1\.png/ }).uncheck();
  await expect(details.locator("h2")).toContainText("ref-3.png");
  // The checkbox of a picked card is always shown, whether or not the pointer is on it.
  await p.mouse.move(5, 5);
  await expect(p.getByRole("checkbox", { name: /^Select ref-3\.png/ })).toBeVisible();
  expect(await p.getByRole("checkbox", { name: /^Select ref-3\.png/ }).evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  // Select all, then act on all of them: favourite, tag, folder, and delete the unused.
  await p.getByRole("checkbox", { name: /^Select ref-3\.png/ }).focus();
  await p.keyboard.press("Control+a");
  await expect(details.locator("h2")).toHaveText("5 selected");
  await p.getByTestId("bulk-favorite").click();
  await expect(p.getByTestId("assets-side").getByRole("button", { name: /^Favourites/ })).toContainText("5");
  await p.getByTestId("bulk-tag-input").fill("set");
  await p.keyboard.press("Enter");
  await expect(p.locator('[data-testid="asset-card-tags"]')).toHaveCount(5);
  await p.getByTestId("assets-side").getByTestId("folder-new").click();
  await p.getByTestId("folder-name-input").fill("Batch");
  await p.keyboard.press("Enter");
  // "Move all": the choices are No folder and Batch; one folder for each asset.
  await expect(p.getByTestId("bulk-folders").getByRole("radio")).toHaveCount(2);
  await p.getByTestId("bulk-folders").getByRole("radio", { name: "Batch" }).check();
  await p.getByTestId("assets-side").getByRole("button", { name: /^Batch/ }).click();
  await expect(cards).toHaveCount(5);
  // Delete: nothing is used, so all go; the summary says so.
  await p.getByTestId("assets-side").getByRole("button", { name: /^All assets/ }).click();
  await p.getByRole("checkbox", { name: /^Select ref-3\.png/ }).focus();
  await p.keyboard.press("Control+a");
  await p.getByTestId("bulk-delete").click();
  await p.getByTestId("confirm-ok").click();
  await expect(cards).toHaveCount(0);
  await expect(p.getByTestId("toast")).toContainText("Deleted 5 assets from the library.");
  expect(app.consoleErrors).toEqual([]);
});

test("the viewer is still open when you come back from placing an asset (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  await p.getByTestId("assets-import-input").setInputFiles({ name: "one.png", mimeType: "image/png", buffer: makePng(8, 6, () => [200, 60, 60, 255]) });
  await p.getByTestId("assets-import-input").setInputFiles({ name: "two.png", mimeType: "image/png", buffer: makePng(9, 6, () => [60, 200, 60, 255]) });
  await expect(p.getByTestId("asset-card")).toHaveCount(2);
  await p.getByTestId("asset-card").nth(0).dblclick();
  const viewer = p.getByTestId("slide-view");
  await expect(viewer).toBeVisible();
  await p.keyboard.press("ArrowRight");
  await expect(viewer.locator(".viewer-pos")).toHaveText("2 of 2");
  await p.getByTestId("asset-place").click();
  // On the canvas, the image is placed; back in Assets the viewer shows the same asset.
  await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.objects())).length).toBe(1);
  expect(await p.evaluate(() => window.__canvastDebug.appView())).toBe("canvas");
  await p.getByTestId("view-assets").click();
  await expect(viewer).toBeVisible();
  await expect(viewer.locator(".viewer-pos")).toHaveText("2 of 2");
  expect(app.consoleErrors).toEqual([]);
});

test("slideshow: plays through the library on a timer, wraps, stops on Space or Esc, and plays only what was picked (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  for (let i = 0; i < 3; i++) {
    await p.getByTestId("assets-import-input").setInputFiles({ name: `s-${i}.png`, mimeType: "image/png", buffer: makePng(8 + i, 6, () => [60 * i, 120, 200, 255]) });
  }
  await expect(p.getByTestId("asset-card")).toHaveCount(3);
  // The time per slide is a setting (Settings > Media and playback): 2 s, the shortest the test needs.
  await p.getByTestId("view-settings").click();
  await p.locator("#settings-view").getByRole("tab", { name: "Media and playback" }).click();
  await p.locator("#settings-view").getByLabel("Slideshow", { exact: true }).fill("2");
  await toAssets(p);
  // From the library bar: the viewer opens on the first asset and the show starts.
  const viewer = p.getByTestId("slide-view");
  await p.getByTestId("assets-slideshow").click();
  await expect(viewer).toBeVisible();
  const play = viewer.getByRole("button", { name: /slideshow/i });
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.locator(".viewer-pos")).toHaveText("1 of 3");
  await expect(viewer.locator(".viewer-progress")).toBeVisible();
  // After the time it moves on by itself (2 s is the shortest), and keeps going round.
  await expect(viewer.locator(".viewer-pos")).toHaveText("2 of 3", { timeout: 6_000 });
  await expect(viewer.locator(".viewer-pos")).toHaveText("3 of 3", { timeout: 6_000 });
  await expect(viewer.locator(".viewer-pos")).toHaveText("1 of 3", { timeout: 6_000 });
  // Space pauses it: the position holds.
  await viewer.focus();
  await p.keyboard.press(" ");
  await expect(viewer.getByRole("button", { name: "Start the slideshow" })).toHaveAttribute("aria-pressed", "false");
  const at = await viewer.locator(".viewer-pos").textContent();
  await p.waitForTimeout(2600);
  await expect(viewer.locator(".viewer-pos")).toHaveText(at!);
  await p.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  // A selection of two plays only those two.
  const checks = p.getByRole("checkbox", { name: /^Select / });
  await checks.nth(0).check();
  await checks.nth(2).check();
  await p.getByTestId("bulk-slideshow").click();
  await expect(viewer).toBeVisible();
  await expect(viewer.locator(".viewer-pos")).toHaveText("1 of 2");
  await expect(viewer.locator(".film-item")).toHaveCount(2);
  await p.keyboard.press("Escape");
  expect(app.consoleErrors).toEqual([]);
});

test("sorting: each order can be reversed, and the choice and the button say which order it is (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  for (const [i, name] of ["b-ref", "a-ref", "c-ref"].entries()) {
    await p.getByTestId("assets-import-input").setInputFiles({ name: `${name}.png`, mimeType: "image/png", buffer: makePng(8 + i, 6, () => [40 * i, 90, 200, 255]) });
  }
  const names = () => p.getByTestId("asset-card").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").split(",")[0]));
  await expect(p.getByTestId("asset-card")).toHaveCount(3);
  const sort = p.getByTestId("assets-sort");
  const dir = p.getByTestId("assets-sort-dir");
  await expect(sort.locator("option:checked")).toHaveText("Newest first");
  await sort.selectOption("name");
  await expect(sort.locator("option:checked")).toHaveText("Name A–Z");
  expect(await names()).toEqual(["a-ref.png", "b-ref.png", "c-ref.png"]);
  await dir.click();
  await expect(sort.locator("option:checked")).toHaveText("Name Z–A");
  await expect(dir).toHaveAttribute("title", /Sorted: Name Z–A\. Click for Name A–Z\./);
  expect(await names()).toEqual(["c-ref.png", "b-ref.png", "a-ref.png"]);
  // Another order starts from its usual direction, in words again.
  await sort.selectOption("newest");
  await expect(sort.locator("option:checked")).toHaveText("Newest first");
  await dir.click();
  await expect(sort.locator("option:checked")).toHaveText("Oldest first");
  expect((await names())[0]).toBe("b-ref.png");
  await sort.selectOption("size");
  await dir.click();
  await expect(sort.locator("option:checked")).toHaveText("Smallest first");
  expect(app.consoleErrors).toEqual([]);
});

test("a drag that starts inside the app is never imported as a file; a file dropped from outside still is (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  const b64 = makePng(8, 6, () => [200, 80, 40, 255]).toString("base64");
  const drop = () =>
    p.evaluate((data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, b64);
  // A picture dragged out of the library and let go in the window arrives as a file (its thumbnail): it must not become an asset.
  await p.evaluate(() => window.dispatchEvent(new DragEvent("dragstart", { bubbles: true })));
  await drop();
  await p.waitForTimeout(600);
  await expect(p.getByTestId("asset-card")).toHaveCount(0);
  await p.evaluate(() => window.dispatchEvent(new DragEvent("dragend", { bubbles: true })));
  // From outside (no dragstart in the page) the same drop imports.
  await drop();
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  expect(app.consoleErrors).toEqual([]);
});

test("viewer with the controls hidden: the view tabs fade away and return near the top edge (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  await p.getByTestId("assets-import-input").setInputFiles({ name: "one.png", mimeType: "image/png", buffer: makePng(8, 6, () => [200, 60, 60, 255]) });
  await p.getByTestId("asset-card").first().dblclick();
  const viewer = p.getByTestId("slide-view");
  await expect(viewer).toBeVisible();
  const nav = p.locator("#nav");
  const opacity = () => nav.evaluate((e) => getComputedStyle(e).opacity);
  expect(await opacity(), "shown while the controls are").toBe("1");
  await p.keyboard.press("f");
  await expect.poll(opacity).toBe("0");
  await p.mouse.move(300, 24); // near the top edge: back
  await expect.poll(opacity).toBe("1");
  await p.mouse.move(640, 400);
  await expect.poll(opacity).toBe("0");
  // Closing the viewer brings them back for good.
  await p.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect.poll(opacity).toBe("1");
  expect(app.consoleErrors).toEqual([]);
});

/** Import a few small pictures into the library (the first view is the gallery). */
async function libraryOf(p: Page, n: number): Promise<void> {
  await toAssets(p);
  for (let i = 0; i < n; i++) {
    await p.getByTestId("assets-import-input").setInputFiles({ name: `item-${i}.png`, mimeType: "image/png", buffer: makePng(40 + i, 30, (x, y) => [(x * 5 + i * 40) % 256, (y * 6) % 256, 120 + i * 20, 255]) });
  }
  await expect(p.getByTestId("asset-card")).toHaveCount(n);
}

test("keyboard in the library, in either layout: arrows, Home and End move and pick; Ctrl+A picks everything; Shift extends (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await libraryOf(p, 5);
  const cards = p.getByTestId("asset-card");
  const picked = () => p.locator('[data-testid="asset-card"][aria-pressed="true"]');
  const at = async () => (await picked().evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").split(",")[0])))[0];
  for (const layout of ["grid", "list"] as const) {
    await p.locator(`[data-layout="${layout}"]`).click();
    await expect(p.locator("#assets-view")).toHaveClass(layout === "list" ? /is-list/ : /^(?!.*is-list)/);
    // With nothing picked the arrows start at the first item; focus need not be in the library.
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await p.keyboard.press("Escape");
    await expect(picked()).toHaveCount(0);
    await p.keyboard.press("ArrowRight");
    await expect(picked()).toHaveCount(1);
    const first = await at();
    await p.keyboard.press(layout === "list" ? "ArrowDown" : "ArrowRight");
    await expect.poll(at, { message: "moved on" }).not.toBe(first);
    await p.keyboard.press("End");
    await expect.poll(at).toBe("item-0.png"); // newest first: the last card is the oldest
    await p.keyboard.press("Home");
    await expect.poll(at).toBe("item-4.png");
    // Shift extends from where it is; Ctrl+A picks all.
    await p.keyboard.press("Shift+End");
    await expect(picked()).toHaveCount(5);
    await p.keyboard.press("Escape");
    await expect(picked()).toHaveCount(0);
    await p.keyboard.press("Control+a");
    await expect(picked()).toHaveCount(5);
    await expect(p.getByTestId("asset-inspector").locator("h2")).toHaveText("5 selected");
    // A picked card shows its ring above the picture (grid only; the list highlights the row).
    const ring = await cards.first().evaluate((e) => getComputedStyle(e, "::after").boxShadow);
    if (layout === "grid") expect(ring, "picked card has a ring").not.toBe("none");
    await p.keyboard.press("Escape");
    await expect(picked()).toHaveCount(0);
  }
  // From the search box, Down steps into the items.
  await p.getByTestId("assets-search").focus();
  await p.keyboard.press("Escape");
  await p.keyboard.press("ArrowDown");
  await expect(picked()).toHaveCount(1);
  // Shift-click takes a range in the list as in the gallery.
  await p.locator('[data-layout="list"]').click();
  await cards.nth(0).click();
  await cards.nth(3).click({ modifiers: ["Shift"] });
  await expect(picked()).toHaveCount(4);
  expect(app.consoleErrors).toEqual([]);
});

test("list columns: each can be hidden or moved, the header follows, and the choice is remembered (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await libraryOf(p, 2);
  await expect(p.getByTestId("assets-columns")).toBeHidden(); // a list thing
  await p.locator('[data-layout="list"]').click();
  const head = (col: string) => p.locator(`.assets-list-head [data-col="${col}"]`);
  await expect(head("pixels")).toBeVisible();
  await expect(head("added")).toBeHidden(); // off by default
  await p.getByTestId("assets-columns").click();
  const panel = p.getByTestId("columns-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("checkbox", { name: "Pixels" }).uncheck();
  await panel.getByRole("checkbox", { name: "Added" }).check();
  await expect(head("pixels")).toBeHidden();
  await expect(head("added")).toBeVisible();
  await expect(p.locator(".asset-cell").first().locator(".asset-meta")).toBeHidden();
  await expect(p.locator(".asset-cell").first().locator(".asset-added")).toBeVisible();
  // Move Tags to just after Name: its place in the order is second.
  const order = (col: string) => p.locator(".assets-body").evaluate((e, c) => getComputedStyle(e).getPropertyValue(`--o-${c}`).trim(), col);
  expect(await order("tags")).toBe("5");
  await panel.getByRole("button", { name: "Move Tags earlier" }).click();
  await panel.getByRole("button", { name: "Move Tags earlier" }).click();
  await panel.getByRole("button", { name: "Move Tags earlier" }).click();
  expect(await order("tags")).toBe("2");
  expect(await order("pixels")).toBe("3");
  await p.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  // Kept over a reload; Reset puts the columns back.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("view-assets").click();
  await expect(head("pixels")).toBeHidden();
  expect(await order("tags")).toBe("2");
  await p.getByTestId("assets-columns").click();
  await p.getByTestId("columns-panel").getByRole("button", { name: "Reset the columns" }).click();
  await expect(head("pixels")).toBeVisible();
  await expect(head("added")).toBeHidden();
  expect(await order("tags")).toBe("5");
  // More properties can be shown: the folder, the size, the type, whether it is a favourite. (The panel stays open after Reset.)
  await expect(p.getByTestId("columns-panel")).toBeVisible();
  for (const name of ["Folder", "Size", "Favourite", "Type"]) await p.getByTestId("columns-panel").getByRole("checkbox", { name, exact: true }).check();
  for (const col of ["folder", "size", "favourite", "type"]) await expect(head(col)).toBeVisible();
  await p.keyboard.press("Escape");
  // A header dragged onto another takes its place.
  await head("used").dragTo(head("name"));
  expect(await order("used")).toBe("1");
  expect(await order("name")).toBe("2");
  // The list never squeezes a column: it scrolls sideways instead of clipping (the header and the rows are as wide as the columns need).
  await p.setViewportSize({ width: 700, height: 700 });
  const wide = await p.locator(".assets-body.is-list .assets-list-head").evaluate((e) => e.scrollWidth <= e.clientWidth + 1 || e.parentElement!.scrollWidth > e.parentElement!.clientWidth);
  expect(wide).toBe(true);
  expect(app.consoleErrors).toEqual([]);
});

test("viewer zoom: the wheel zooms at the pointer, a drag pans, a double-click toggles Fit and 100%, the keys and the control agree (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  await p.getByTestId("assets-import-input").setInputFiles({ name: "big.png", mimeType: "image/png", buffer: makePng(400, 300, (x, y) => [(x * 2) % 256, (y * 3) % 256, 160, 255]) });
  await p.getByTestId("asset-card").first().dblclick();
  const viewer = p.getByTestId("slide-view");
  await expect(viewer).toBeVisible();
  const img = viewer.locator("figure img");
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(400);
  const pct = viewer.locator(".viewer-zoom-pct");
  // The element fills the stage and the picture is contained in it, so the drawn width follows the aspect (400 x 300).
  const width = async () => {
    const b = (await img.boundingBox())!;
    return Math.min(b.width, (b.height * 400) / 300);
  };
  await expect(pct).toHaveText("Fit");
  const fit = await width();
  // The wheel zooms in at the pointer: the picture grows and the control says how much.
  const box = (await img.boundingBox())!;
  await p.mouse.move(box.x + box.width / 4, box.y + box.height / 4);
  await p.mouse.wheel(0, -400);
  await expect.poll(width).toBeGreaterThan(fit * 1.3);
  await expect(pct).not.toHaveText("Fit");
  // A drag pans the zoomed picture.
  const before = (await img.boundingBox())!;
  await p.mouse.move(640, 420);
  await p.mouse.down();
  await p.mouse.move(700, 450, { steps: 4 });
  await p.mouse.up();
  const after = (await img.boundingBox())!;
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(20);
  // 0 is Fit; a double-click shows the picture at 100% (its own 400 px), and again goes back to Fit.
  await viewer.focus();
  await p.keyboard.press("0");
  await expect(pct).toHaveText("Fit");
  await img.dblclick();
  await expect(pct).toHaveText("100%");
  expect(Math.abs((await width()) - 400)).toBeLessThan(2);
  await img.dblclick();
  await expect(pct).toHaveText("Fit");
  // Keys and the buttons zoom too, and the zoom resets for the next picture.
  await p.keyboard.press("+");
  await expect(pct).not.toHaveText("Fit");
  await viewer.getByRole("button", { name: "Zoom out" }).click();
  await expect(pct).toHaveText("Fit");
  expect(app.consoleErrors).toEqual([]);
});

test("Place on…: the open canvas, another existing canvas, a new canvas in a board, or a new board (ADR 0059)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  await p.getByTestId("assets-import-input").setInputFiles({ name: "green.png", mimeType: "image/png", buffer: GREEN });
  await card(p, GREEN_HASH).click();
  const crumb = p.locator(".nav-crumb");
  const count = () => p.evaluate(() => window.__canvastDebug.objects().length);
  // A new canvas in Board 1: it opens and holds the picture; the first canvas stays empty.
  await p.getByTestId("asset-place-menu").click();
  await p.getByRole("menuitem", { name: /New canvas in Board 1/ }).click();
  await expect(crumb).toHaveText("Board 1 › Canvas 2");
  await expect.poll(count).toBe(1);
  // Back in the library: an existing canvas (the first), listed with what it holds.
  await toAssets(p);
  await card(p, GREEN_HASH).click();
  await p.getByTestId("asset-place-menu").click();
  await expect(p.getByRole("menuitem", { name: /Canvas 2.*open now/ })).toBeVisible();
  await p.getByRole("menuitem", { name: /^Canvas 1/ }).click();
  await expect(crumb).toHaveText("Board 1 › Canvas 1");
  await expect.poll(count).toBe(1);
  // A new board with a canvas.
  await toAssets(p);
  await card(p, GREEN_HASH).click();
  await p.getByTestId("asset-place-menu").click();
  await p.getByRole("menuitem", { name: /New board with a canvas/ }).click();
  await expect(crumb).toHaveText("Board 2 › Canvas 1");
  await expect.poll(count).toBe(1);
  // Escape closes the menu without placing.
  await toAssets(p);
  await card(p, GREEN_HASH).click();
  await p.getByTestId("asset-place-menu").click();
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("place-menu")).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

test("the viewer follows the theme, and a picture with see-through pixels sits on a chequered ground that an opaque one does not get (ADR 0059)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  const HALF = makePng(40, 30, (x) => (x < 20 ? [200, 30, 30, 0] : [30, 30, 200, 255]));
  const halfHash = createHash("sha256").update(HALF).digest("hex");
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "half.png", mimeType: "image/png", buffer: HALF },
    { name: "green.png", mimeType: "image/png", buffer: GREEN },
  ]);
  await expect(p.getByTestId("asset-card")).toHaveCount(2);
  // Cards: only the see-through one is chequered.
  await expect(card(p, halfHash)).toHaveClass(/has-alpha/);
  await expect(card(p, GREEN_HASH)).not.toHaveClass(/has-alpha/);
  const viewer = p.getByTestId("slide-view");
  const checker = viewer.locator(".viewer-checker");
  await card(p, halfHash).dblclick();
  await expect(viewer).toBeVisible();
  await expect(checker).toBeVisible();
  // The chequered ground is exactly the picture (40 x 30), not the whole stage.
  const tile = (await checker.locator("i").boundingBox())!;
  expect(Math.abs(tile.width / tile.height - 40 / 30)).toBeLessThan(0.02);
  const stage = (await viewer.locator(".viewer-stage").boundingBox())!;
  expect(tile.width).toBeLessThan(stage.width);
  await p.keyboard.press("ArrowRight");
  await expect(checker).toBeHidden();
  // The viewer's ground follows the theme: light in a light theme, dark in a dark one.
  const lightness = () => viewer.evaluate((e) => Number(/oklch\(([\d.]+)/.exec(getComputedStyle(e).backgroundColor)?.[1] ?? "NaN"));
  await p.emulateMedia({ colorScheme: "light" });
  await expect.poll(lightness).toBeGreaterThan(0.8);
  await p.emulateMedia({ colorScheme: "dark" });
  await expect.poll(lightness).toBeLessThan(0.3);
  expect(app.consoleErrors).toEqual([]);
});

test("search the canvas: / by file name, # by tag, @ by bookmark; Enter goes there, Shift+Enter selects every match (ADR 0060)", async ({ app }) => {
  const p = app.page;
  const id = await importOnCanvas(p);
  await importOnCanvas(p, GREEN, "green.png");
  // Tag the first picture in the library.
  await toAssets(p);
  await card(p, HASH).click();
  await p.getByTestId("asset-tag-input").fill("sky");
  await p.keyboard.press("Enter");
  await expect(p.getByTestId("asset-tags")).toContainText("#sky");
  await p.getByTestId("view-canvas").click();
  await p.keyboard.press("Escape");
  const box = p.getByRole("combobox", { name: "Search the canvas" });
  const results = p.getByTestId("canvas-search");
  const selection = () => p.evaluate(() => window.__canvastDebug.selection());
  // "/": by file name; Enter selects it and brings it into view.
  await p.keyboard.press("/");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(""); // the key chose the way; it is not part of the search
  await expect(results.getByRole("tab", { name: /Name/ })).toHaveAttribute("aria-selected", "true");
  await box.pressSequentially("blocks");
  await expect(results.getByRole("option")).toHaveCount(1);
  await expect(results.getByRole("option", { name: /blocks\.png/ })).toBeVisible();
  await p.keyboard.press("Enter");
  await expect(box).toBeHidden();
  expect(await selection()).toEqual([id]);
  // "#": by tag; only the tagged picture matches, and a tag nobody has finds nothing.
  await p.keyboard.press("Escape");
  await p.keyboard.press("#");
  await box.pressSequentially("sk");
  await expect(results.getByRole("option")).toHaveCount(1);
  await expect(results.getByRole("option", { name: /#sky/ })).toBeVisible();
  await box.fill("#zzz");
  await expect(p.getByText("Nothing matches.")).toBeVisible();
  // The way can change while typing: the first character decides. Shift+Enter selects every match.
  await box.fill("/.png");
  await expect(box).toHaveValue(".png");
  await expect(results.getByRole("option")).toHaveCount(2);
  await p.keyboard.press("Shift+Enter");
  expect((await selection()).length).toBe(2);
  // "@": bookmarks. Save one, move away, and go back by name.
  await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  await p.getByRole("button", { name: "Add bookmark" }).click();
  await expect(p.getByTestId("bookmarks-panel")).toContainText("Bookmark 1");
  const at = await p.evaluate(() => window.__canvastDebug.camera());
  await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  for (let i = 0; i < 4; i++) await p.keyboard.press("ArrowLeft");
  await app.frame();
  expect(await p.evaluate(() => window.__canvastDebug.camera())).not.toEqual(at);
  await p.keyboard.press("@");
  await expect(results.getByRole("tab", { name: /Bookmark/ })).toHaveAttribute("aria-selected", "true");
  await box.pressSequentially("mark");
  await expect(results.getByRole("option", { name: /Bookmark 1/ })).toBeVisible();
  await p.keyboard.press("Enter");
  await app.frame();
  expect(await p.evaluate(() => window.__canvastDebug.camera())).toEqual(at);
  // The dock button opens it too, and the box never lets its keys reach the canvas (a "p" does not pick the pen).
  await p.getByRole("button", { name: "Search the canvas" }).click();
  await p.keyboard.press("p");
  expect(await p.evaluate(() => window.__canvastDebug.tool())).toBe("select");
  await p.keyboard.press("Escape");
  await expect(box).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

test("in-canvas tags: tag items on the canvas, list them across the workspace, add them to the asset, and choose to carry library tags when placing (ADR 0062)", async ({ app }) => {
  const p = app.page;
  const objs = () => p.evaluate(() => window.__canvastDebug.objects()) as Promise<Array<Record<string, unknown>>>;
  const id = await importOnCanvas(p);
  // Tag the selected item from the Layers panel (they belong to this instance, not to the library).
  await p.getByRole("button", { name: "Layers panel", exact: true }).click();
  const tagBox = p.getByLabel("Add a tag to the selection");
  await p.locator(`[data-testid="layers-panel"] li.layer[data-key="${id}"]`).click();
  await expect(tagBox).toBeEnabled();
  await tagBox.fill("ABC, shot-2");
  await p.keyboard.press("Enter");
  await expect.poll(async () => (await objs()).find((o) => o["id"] === id)?.["tags"]).toEqual(["ABC", "shot-2"]);
  await expect(p.getByTestId("canvas-tags")).toContainText("#ABC");
  // Removing one, then undoing it.
  await p.getByRole("button", { name: "Remove tag shot-2 from the selection" }).click();
  await expect.poll(async () => (await objs()).find((o) => o["id"] === id)?.["tags"]).toEqual(["ABC"]);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await objs()).find((o) => o["id"] === id)?.["tags"]).toEqual(["ABC", "shot-2"]);
  // The search by tag finds it by its in-canvas tag.
  await p.keyboard.press("Escape");
  await p.keyboard.press("#");
  await p.getByRole("combobox", { name: "Search the canvas" }).pressSequentially("abc");
  await expect(p.getByTestId("canvas-search").getByRole("option")).toHaveCount(1);
  await p.keyboard.press("Escape");
  await saved(p);
  // Assets view: the workspace-wide list of in-canvas tags, separate from the library's tags.
  await toAssets(p);
  const ctags = p.getByTestId("canvas-tag-list");
  await expect(ctags.getByRole("button", { name: /#ABC/ })).toBeVisible();
  await expect(p.getByTestId("tag-list")).not.toContainText("#ABC");
  await ctags.getByRole("button", { name: /#ABC/ }).click();
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  await card(p, HASH).click();
  // The properties list the canvas tags the asset does not have; choosing one adds it to the asset.
  const suggest = p.getByTestId("asset-canvas-tags");
  await expect(suggest.getByRole("button", { name: /Add the tag ABC/ })).toBeVisible();
  await expect(suggest.getByRole("button", { name: /Add the tag shot-2/ })).toBeVisible();
  await suggest.getByRole("button", { name: /Add the tag ABC/ }).click();
  await expect(p.getByTestId("asset-tags")).toContainText("#ABC");
  await expect(suggest.getByRole("button", { name: /Add the tag ABC/ })).toHaveCount(0);
  // Placing a picture that has library tags asks; "with" carries them over, cancel places nothing.
  await p.getByRole("button", { name: /^All assets/ }).click();
  await card(p, HASH).click();
  const before = (await objs()).length;
  await p.getByTestId("asset-place").click();
  await p.getByTestId("choose-cancel").click();
  await app.frame();
  expect((await objs()).length).toBe(before);
  await p.getByTestId("asset-place").click();
  await p.getByRole("radio", { name: /Place without tags/ }).check();
  await p.getByTestId("choose-ok").click();
  await expect.poll(async () => (await objs()).length).toBe(before + 1);
  const plain = (await objs()).find((o) => o["id"] !== id && o["kind"] === "image")!;
  expect(plain["tags"]).toBeUndefined();
  await toAssets(p);
  await card(p, HASH).click();
  await p.getByTestId("asset-place").click();
  await p.getByRole("radio", { name: /Place with their tags/ }).check();
  await p.getByTestId("choose-ok").click();
  await expect.poll(async () => (await objs()).length).toBe(before + 2);
  const tagged = (await objs()).filter((o) => o["kind"] === "image" && Array.isArray(o["tags"]) && (o["tags"] as string[]).includes("ABC"));
  expect(tagged.length, "the original instance and the new one").toBe(2);
  expect(app.consoleErrors).toEqual([]);
});

test("phone layout (360 px wide): the gallery is two columns, the details are a bottom sheet, and the viewer has the whole screen (ADR 0061)", async ({ app }) => {
  const p = app.page;
  await p.setViewportSize({ width: 360, height: 780 });
  await toAssets(p);
  for (let i = 0; i < 4; i++) {
    const png = makePng(80 + i * 8, 60, (x, y) => [(x * 5 + i * 40) % 256, (y * 6) % 256, 120, 255]);
    await p.getByTestId("assets-import-input").setInputFiles({ name: `item-${i}.png`, mimeType: "image/png", buffer: png });
  }
  const cards = p.getByTestId("asset-card");
  await expect(cards).toHaveCount(4);
  const [a, b, c] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox(), await cards.nth(2).boundingBox()];
  expect(Math.abs(a!.y - b!.y), "two on a row").toBeLessThan(2);
  expect(c!.y, "the third starts a new row").toBeGreaterThan(a!.y + a!.height - 2);
  expect(a!.width, "each about half the width").toBeLessThan(180);
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x);
  // One tap shows the details as a sheet at the bottom edge, inside the screen.
  await cards.nth(0).click();
  const sheet = p.getByTestId("asset-inspector");
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(Math.abs(box.y + box.height - 780)).toBeLessThan(2);
  expect(box.height).toBeLessThanOrEqual(780 * 0.58 + 2);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  // The viewer: the picture fills the screen under the tabs, with no sheet over it.
  await cards.nth(0).dblclick();
  const viewer = p.getByTestId("slide-view");
  await expect(viewer).toBeVisible();
  await expect(sheet).toBeHidden();
  const v = (await viewer.boundingBox())!;
  expect(v.height).toBeGreaterThan(500);
  expect(v.x + v.width).toBeLessThanOrEqual(360);
  expect(app.consoleErrors).toEqual([]);
});

test("viewer edges: a click on the invisible left or right side goes to the previous or next asset, the width is a setting, and the file name is not floated over the picture (ADR 0054)", async ({ app }) => {
  const p = app.page;
  await toAssets(p);
  for (let i = 0; i < 3; i++) {
    const png = makePng(60 + i * 8, 40, (x, y) => [(x * 5 + i * 60) % 256, (y * 6) % 256, 140, 255]);
    await p.getByTestId("assets-import-input").setInputFiles({ name: `edge-${i}.png`, mimeType: "image/png", buffer: png });
  }
  await expect(p.getByTestId("asset-card")).toHaveCount(3);
  await p.getByTestId("asset-card").first().dblclick();
  const viewer = p.getByTestId("slide-view");
  const pos = viewer.locator(".viewer-pos");
  await expect(pos).toHaveText("1 of 3");
  const stage = (await viewer.locator(".viewer-stage").boundingBox())!;
  const y = stage.y + stage.height / 2;
  // Right edge: next; left edge: back; the middle does nothing (and a double-click there still zooms).
  await p.mouse.click(stage.x + stage.width - 20, y);
  await expect(pos).toHaveText("2 of 3");
  await p.mouse.click(stage.x + 20, y);
  await expect(pos).toHaveText("1 of 3");
  await p.mouse.click(stage.x + stage.width / 2, y);
  await app.frame();
  await expect(pos).toHaveText("1 of 3");
  // There are no buttons to see: the edges are plain areas, and the caption is not drawn over the picture.
  await expect(viewer.locator(".viewer-edge").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect((await viewer.locator("figcaption").boundingBox())!.width).toBeLessThanOrEqual(1);
  // Width 0 turns them off.
  await p.evaluate(() => localStorage.setItem("canvast.settings", JSON.stringify({ "assets.edgeWidth": 0 })));
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await toAssets(p);
  await p.getByTestId("asset-card").first().dblclick();
  await expect(pos).toHaveText("1 of 3");
  const s2 = (await viewer.locator(".viewer-stage").boundingBox())!;
  await p.mouse.click(s2.x + s2.width - 20, s2.y + s2.height / 2);
  await app.frame();
  await expect(pos).toHaveText("1 of 3");
  expect(app.consoleErrors).toEqual([]);
});

test("small screens: the details panel is resizable by its grip (drag, arrow keys, double-click to reset, remembered), and the viewer's picture is centred with the zoom control in the bar (ADR 0061)", async ({ app }) => {
  const p = app.page;
  await p.setViewportSize({ width: 360, height: 780 });
  await toAssets(p);
  for (let i = 0; i < 3; i++) await p.getByTestId("assets-import-input").setInputFiles({ name: `s-${i}.png`, mimeType: "image/png", buffer: makePng(60 + i * 9, 40, (x, y) => [(x * 5 + i * 50) % 256, (y * 6) % 256, 150, 255]) });
  await expect(p.getByTestId("asset-card")).toHaveCount(3);
  await p.getByTestId("asset-card").first().click();
  const sheet = p.getByTestId("asset-inspector");
  const grip = p.getByTestId("sheet-grip");
  await expect(grip).toBeVisible();
  const h0 = (await sheet.boundingBox())!.height;
  const g = (await grip.boundingBox())!;
  const top0 = (await sheet.boundingBox())!.y;
  expect(Math.abs(g.y + g.height / 2 - top0), "the grip sits on the sheet's top edge, whatever its content").toBeLessThan(10);
  await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await p.mouse.down();
  await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2 - 120, { steps: 6 });
  await p.mouse.up();
  const h1 = (await sheet.boundingBox())!.height;
  expect(h1, "dragging up makes it taller").toBeGreaterThan(h0 + 80);
  expect(h1).toBeLessThanOrEqual(780 * 0.88 + 2);
  await grip.focus();
  await p.keyboard.press("ArrowDown");
  expect((await sheet.boundingBox())!.height, "the arrow keys step it").toBeLessThan(h1 - 30);
  const h2 = (await sheet.boundingBox())!.height;
  // Remembered over a reload, and a double-click goes back to the default.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await toAssets(p);
  await p.getByTestId("asset-card").first().click();
  await expect(sheet).toBeVisible();
  expect(Math.abs((await sheet.boundingBox())!.height - h2)).toBeLessThan(3);
  await grip.dblclick();
  expect(Math.abs((await sheet.boundingBox())!.height - h0)).toBeLessThan(3);
  // The viewer: the picture is centred in the stage (equal room above and below) and the zoom control sits in the bar, off the picture.
  await p.getByTestId("asset-card").first().dblclick();
  const viewer = p.getByTestId("slide-view");
  await expect(viewer).toBeVisible();
  const stage = (await viewer.locator(".viewer-stage").boundingBox())!;
  const img = viewer.locator("figure img");
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const ib = (await img.boundingBox())!;
  expect(Math.abs(ib.y - stage.y - (stage.y + stage.height - ib.y - ib.height)), "equal room above and below").toBeLessThan(2);
  expect(Math.abs(ib.x - stage.x - (stage.x + stage.width - ib.x - ib.width)), "equal room left and right").toBeLessThan(2);
  // The controls are two rows on a phone: previous, count, next; then zoom on the left and the buttons on the right, nothing wrapped.
  const controls = (await viewer.locator(".viewer-bar").boundingBox())!;
  expect(controls.height, "two tidy rows").toBeLessThan(120);
  const prev = (await viewer.locator('[data-act="prev"]').boundingBox())!;
  const closeB = (await viewer.locator('.viewer-tools [data-act="close"]').boundingBox())!;
  expect(closeB.y).toBeGreaterThan(prev.y + prev.height - 2);
  const zoom = (await viewer.locator(".viewer-zoom").boundingBox())!;
  const bar = (await viewer.locator(".viewer-bar").boundingBox())!;
  expect(zoom.y).toBeGreaterThanOrEqual(bar.y - 1);
  expect(zoom.y + zoom.height).toBeLessThanOrEqual(stage.y + stage.height + bar.height + 1);
  expect(app.consoleErrors).toEqual([]);
});

test("Ctrl+F searches the canvas (or the library in the Assets view); Ctrl+Shift+F goes to the library's search from anywhere", async ({ app }) => {
  const p = app.page;
  const canvasBox = p.getByRole("combobox", { name: "Search the canvas" });
  await p.keyboard.press("Control+f");
  await expect(canvasBox).toBeFocused();
  await p.keyboard.press("Escape");
  await expect(canvasBox).toBeHidden();
  await p.keyboard.press("Control+Shift+f");
  await expect(p.getByTestId("assets-search")).toBeFocused();
  expect(await p.evaluate(() => window.__canvastDebug.appView())).toBe("assets");
  // In the library Ctrl+F is the same search box again, even after focus has gone elsewhere.
  await p.getByTestId("assets-search").fill("abc");
  await p.getByTestId("view-assets").focus();
  await p.keyboard.press("Control+f");
  await expect(p.getByTestId("assets-search")).toBeFocused();
  expect(app.consoleErrors).toEqual([]);
});

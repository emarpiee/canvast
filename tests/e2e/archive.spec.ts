import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { APP_URL, expect, openActions, rowAction, test } from "./harness";
import { blockyFixture, makePng } from "./png";
import { readZip, writeZip } from "../../src/storage/zip";

/**
 * Phase 1, slice 3: portable `.canvast` archives (ADR 0008). Export in four
 * scopes, verification, import into another browser profile, deduplication,
 * and hostile or damaged files.
 */

const BLOCKS = blockyFixture();
const HASH = createHash("sha256").update(BLOCKS).digest("hex");
const GREEN = makePng(4, 4, () => [30, 160, 70, 255]);
const GREEN_HASH = createHash("sha256").update(GREEN).digest("hex");
const BLOCK_4_3: [number, number, number] = [40, 140, 220];

type Sess = Awaited<ReturnType<Window["__canvastDebug"]["session"]>>;
const sess = (p: Page): Promise<Sess> => p.evaluate(() => window.__canvastDebug.session());
const objects = (p: Page) => p.evaluate(() => window.__canvastDebug.objects());
const stored = (p: Page): Promise<string[]> => p.evaluate(() => window.__canvastDebug.storedAssetHashes());
const dump = (p: Page, id: string) => p.evaluate((c) => window.__canvastDebug.canvasDump(c), id);
const usage = async (p: Page) =>
  (await p.evaluate(() => window.__canvastDebug.assetListing())).entries.map((e) => [e.hash, e.instances, e.canvases]).sort();

async function openApp(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await page.evaluate(() => window.__canvastDebug.nextFrame());
  return page;
}

/** A separate browser profile: its own, empty storage. */
async function freshProfile(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  return { context, page: await openApp(context) };
}

async function saved(p: Page): Promise<void> {
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.saveStatus()), { timeout: 5000 }).toBe("verified");
}

async function importImage(p: Page, buffer = BLOCKS): Promise<string> {
  const before = new Set((await objects(p)).map((o) => o.id));
  await p.getByTestId("import-input").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer });
  await expect.poll(async () => (await objects(p)).length).toBe(before.size + 1);
  await saved(p);
  return (await objects(p)).find((o) => !before.has(o.id))!.id;
}

async function stroke(p: Page, x: number, y: number): Promise<void> {
  await p.keyboard.press("p");
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x + 90, y + 40, { steps: 5 });
  await p.mouse.up();
  await p.keyboard.press("v");
  await saved(p);
}

async function openMenu(p: Page): Promise<void> {
  if (await p.getByTestId("workspace-menu").isHidden()) await p.getByTestId("workspace-nav").click();
}

async function openPanel(p: Page): Promise<void> {
  if (await p.getByTestId("set-export-full").isHidden()) await p.getByTestId("save-status").click();
  await expect(p.getByTestId("set-export-full")).toBeVisible();
}

/** Run an export action and return the downloaded file. */
async function download(p: Page, action: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const [dl] = await Promise.all([p.waitForEvent("download"), action()]);
  return { name: dl.suggestedFilename(), bytes: await readFile((await dl.path())!) };
}

async function manifestOf(bytes: Buffer): Promise<Record<string, unknown> & { boards: Array<{ name: string; canvases: Array<{ name: string }> }>; assets: Array<{ hash: string }> }> {
  const z = await readZip(new Blob([new Uint8Array(bytes)]));
  return JSON.parse(await z.get("manifest.json")!.data.text());
}

/** Import through the storage panel; returns the confirmation dialog for inspection. */
async function importArchive(p: Page, name: string, bytes: Buffer, accept = true): Promise<string> {
  await openPanel(p);
  await p.getByTestId("set-import-input").setInputFiles({ name, mimeType: "application/zip", buffer: bytes });
  const dlg = p.getByTestId("confirm-dialog");
  await expect(dlg).toBeVisible();
  const text = (await dlg.textContent()) ?? "";
  // Clear the last message so the wait below sees this import's outcome, not an earlier one.
  await p.getByTestId("toast").evaluate((t) => (t.textContent = ""));
  await p.getByTestId(accept ? "confirm-ok" : "confirm-cancel").click();
  await expect(dlg).toHaveCount(0);
  // Wait for the outcome, not the dialog: a fresh profile already shows "Board 1 › Canvas 1".
  if (accept) await expect(p.getByTestId("toast")).toContainText(/Imported|Import failed/);
  await p.getByTestId("view-canvas").click(); // (the backup tools are in Settings > Storage; the canvas is read from here)
  return text;
}

/** Source pixel (4, 3) of an image placed at the origin at level 0 shows its true colour (magnified 2^6×). */
async function expectBlockColour(p: Page, id: string): Promise<void> {
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 6, zf: 0, pz: 6 }));
  await expect
    .poll(async () => {
      await p.evaluate(() => window.__canvastDebug.nextFrame());
      const box = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i)!.box, id))!;
      return p.evaluate(
        ([x, y]) => window.__canvastDebug.pixelAt(x!, y!),
        [box.minX + ((box.maxX - box.minX) * 4.5) / 8, box.minY + ((box.maxY - box.minY) * 3.5) / 6],
      );
    })
    .toEqual(BLOCK_4_3);
}

/** Build a workspace: two boards, three canvases, shared and unused assets, a deep stroke and saved views. */
async function buildWorkspace(p: Page): Promise<void> {
  await importImage(p); // Board 1 › Canvas 1
  await stroke(p, 300, 600);
  // A stroke drawn 1,600 levels in, at an off-origin position.
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "123456789p-1590", cy: "-98765p-1590", zi: 1600, zf: 0.25, pz: 1600 }));
  await stroke(p, 640, 400);
  // A bookmark 1,600 levels in (its frame must be kept, exported and imported with the canvas).
  await p.getByRole("button", { name: "Bookmarks panel" }).click();
  await p.getByRole("button", { name: "Add bookmark" }).click();
  await expect(p.getByTestId("bookmarks-panel").locator("li.bookmark")).toHaveCount(1);
  await p.getByRole("button", { name: "Hide the Bookmarks panel" }).click();
  await openMenu(p);
  await p.getByRole("button", { name: /^\+ New canvas/ }).click();
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 2");
  await importImage(p); // same original again
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "5p0", cy: "-3p0", zi: 5, zf: 0.5, pz: 5 }));
  await openMenu(p);
  await p.getByRole("button", { name: /^\+ New board/ }).click();
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 2 › Canvas 1");
  await stroke(p, 500, 500);
  // An unused library asset.
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "green.png", mimeType: "image/png", buffer: GREEN });
  await expect(p.locator(`[data-testid="asset-card"][data-hash="${GREEN_HASH}"]`)).toHaveCount(1);
  await p.getByTestId("view-canvas").click();
}

test("a workspace backup round-trips to another browser profile exactly", async ({ app, browser }) => {
  const p = app.page;
  await buildWorkspace(p);
  // Device settings travel in the backup (ADR 0160): nav.mode and nav.arrive are changed here.
  await p.evaluate(() => localStorage.setItem("canvast.settings", JSON.stringify({ "nav.mode": "anywhere", "nav.arrive": "keep" })));
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  const src = (await sess(p)).tree!;
  const srcDumps = await Promise.all(src.flatMap((b) => b.canvases.map((c) => dump(p, c.id))));
  const srcUsage = await usage(p);
  expect(srcUsage).toEqual([
    [HASH, 2, 2],
    [GREEN_HASH, 0, 0],
  ].sort());

  await openPanel(p);
  await expect(p.getByTestId("set-last-backup")).toContainText("No backup made yet");
  const file = await download(p, () => p.getByTestId("set-export-full").click());
  expect(file.name).toMatch(/^My-workspace-\d{4}-\d{2}-\d{2}\.canvast$/);
  await expect(p.getByTestId("set-last-backup")).toContainText(file.name);

  // The file: one entry per original (not per instance), every checksum valid.
  const m = await manifestOf(file.bytes);
  expect(m["format"]).toBe("canvast-archive");
  expect(m["scope"]).toBe("workspace");
  expect(m.boards.map((b) => [b.name, b.canvases.map((c) => c.name)])).toEqual([
    ["Board 1", ["Canvas 1", "Canvas 2"]],
    ["Board 2", ["Canvas 1"]],
  ]);
  expect(m.assets.map((a) => a.hash).sort()).toEqual([HASH, GREEN_HASH].sort());
  const z = await readZip(new Blob([new Uint8Array(file.bytes)]));
  expect(z.size).toBe(1 + 3 + 2);
  expect(Buffer.from(await z.get(`assets/${HASH}`)!.data.arrayBuffer())).toEqual(BLOCKS);

  // Import into an empty profile.
  const other = await freshProfile(browser);
  const q = other.page;
  // The other device has set nav.mode itself: that one is kept; nav.arrive, which it has not set, comes with the backup.
  await q.evaluate(() => localStorage.setItem("canvast.settings", JSON.stringify({ "nav.mode": "layer" })));
  await q.reload();
  await q.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  const text = await importArchive(q, file.name, file.bytes);
  expect(text).toContain("Contains 3 canvases, 5 objects and 2 originals.");
  expect(text).toContain("It also carries your settings");
  expect(await q.evaluate(() => JSON.parse(localStorage.getItem("canvast.settings")!))).toMatchObject({ "nav.mode": "layer", "nav.arrive": "keep" });
  expect(text).toContain("2 new boards");
  await expect(q.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 1");
  const tree = (await sess(q)).tree!;
  expect(tree.map((b) => [b.name, b.canvases.map((c) => [c.name, c.objectCount])])).toEqual([
    ["Board 1", [["Canvas 1", 0]]], // the new profile's own empty board
    ["Board 1", [["Canvas 1", 3], ["Canvas 2", 1]]],
    ["Board 2", [["Canvas 1", 1]]],
  ]);
  // Every object (ids, exact anchors, depth) and every saved view is identical.
  const dstDumps = await Promise.all(tree.slice(1).flatMap((b) => b.canvases.map((c) => dump(q, c.id))));
  expect(dstDumps).toEqual(srcDumps);
  expect(await stored(q)).toEqual([HASH, GREEN_HASH].sort());
  expect(await usage(q)).toEqual(srcUsage);
  // The first imported canvas is open, and its image renders from the imported original.
  expect((await sess(q)).current!.canvasId).toBe(tree[1]!.canvases[0]!.id);
  const img = (await objects(q)).find((o) => o.kind === "image")!.id;
  await expectBlockColour(q, img);

  // Importing the same archive again adds boards but no second copy of any original.
  await importArchive(q, file.name, file.bytes);
  expect((await sess(q)).tree!.map((b) => b.name)).toEqual(["Board 1", "Board 1", "Board 2", "Board 1", "Board 2"]);
  expect(await stored(q)).toEqual([HASH, GREEN_HASH].sort());
  expect(await usage(q)).toEqual([
    [HASH, 4, 4],
    [GREEN_HASH, 0, 0],
  ].sort());
  expect(other.page.isClosed()).toBe(false);
  await other.context.close();
  expect(app.consoleErrors).toEqual([]);
});

test("canvas, board and asset exports contain only what their scope needs", async ({ app, browser }) => {
  const p = app.page;
  await buildWorkspace(p);
  const c2 = (await sess(p)).tree![0]!.canvases[1]!;

  // Canvas scope (Board 1 › Canvas 2): one canvas, only the original it uses.
  await openMenu(p);
  const canvasFile = await download(p, () => rowAction(p, "canvas", "Canvas 2", "Export"));
  expect(canvasFile.name).toMatch(/^Board-1-Canvas-2-.*\.canvast$/);
  let m = await manifestOf(canvasFile.bytes);
  expect([m["scope"], m.boards.length, m.boards[0]!.canvases.length, m.assets.map((a) => a.hash)]).toEqual(["canvas", 1, 1, [HASH]]);
  // Board scope (Board 2): its canvas, which uses no images, so no originals.
  await openMenu(p);
  const boardFile = await download(p, () => rowAction(p, "board", "Board 2", "Export"));
  m = await manifestOf(boardFile.bytes);
  expect([m["scope"], m.boards.map((b) => b.name), m.assets.length]).toEqual(["board", ["Board 2"], 0]);
  // Asset scope, from the Assets view inspector: the original and no canvases.
  await p.getByTestId("view-assets").click();
  await p.locator(`[data-testid="asset-card"][data-hash="${GREEN_HASH}"]`).click();
  const assetFile = await download(p, () => p.getByTestId("asset-export").click());
  m = await manifestOf(assetFile.bytes);
  expect([m["scope"], m.boards.length, m.assets.map((a) => a.hash)]).toEqual(["assets", 0, [GREEN_HASH]]);
  await expect(p.getByTestId("assets-status")).toContainText("Exported");

  const other = await freshProfile(browser);
  const q = other.page;
  // A canvas archive becomes a new canvas on the open board.
  const text = await importArchive(q, canvasFile.name, canvasFile.bytes);
  expect(text).toContain("added as a new canvas on the open board");
  await expect(q.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 2");
  expect((await sess(q)).tree!.map((b) => [b.name, b.canvases.map((c) => c.name)])).toEqual([["Board 1", ["Canvas 1", "Canvas 2"]]]);
  expect((await dump(q, (await sess(q)).current!.canvasId)).objects).toEqual((await dump(p, c2.id)).objects);
  // An asset archive only adds to the library (dropped on the page this time).
  await q.evaluate(
    async ([b64, name]) => {
      const bytes = Uint8Array.from(atob(b64!), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name!, { type: "application/zip" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, cancelable: true }));
    },
    [assetFile.bytes.toString("base64"), assetFile.name],
  );
  await expect(q.getByTestId("confirm-dialog")).toContainText("added to the library");
  await q.getByTestId("confirm-ok").click();
  await expect.poll(() => stored(q)).toEqual([HASH, GREEN_HASH].sort());
  expect((await sess(q)).tree!.length).toBe(1);
  expect(await usage(q)).toEqual([
    [HASH, 1, 1],
    [GREEN_HASH, 0, 0],
  ].sort());
  await other.context.close();
});

test("damaged and hostile archives are refused or reported, and nothing partial is written", async ({ app }) => {
  const p = app.page;
  await importImage(p);
  await openPanel(p);
  const good = await download(p, () => p.getByTestId("set-export-full").click());
  const before = await sess(p);
  const treeShape = (s: Sess) => s.tree!.map((b) => [b.name, b.canvases.map((c) => [c.name, c.objectCount])]);

  const refuse = async (name: string, bytes: Buffer, message: RegExp): Promise<void> => {
    await openPanel(p);
    await p.getByTestId("set-import-input").setInputFiles({ name, mimeType: "application/zip", buffer: bytes });
    await expect(p.getByTestId("toast")).toHaveText(message);
    await expect(p.getByTestId("confirm-dialog")).toHaveCount(0);
    expect(treeShape(await sess(p))).toEqual(treeShape(before));
  };
  // Not an archive at all.
  await refuse("notes.canvast", Buffer.from("just text"), /Cannot import notes\.canvast: not an archive/);
  // Truncated in transfer.
  await refuse("cut.canvast", good.bytes.subarray(0, good.bytes.length - 40), /Cannot import cut\.canvast: .*(archive|damaged)/);
  // A newer format version.
  const z = await readZip(new Blob([new Uint8Array(good.bytes)]));
  const rebuild = async (edit: (m: Record<string, unknown>) => void, swap?: [string, Blob]): Promise<Buffer> => {
    const man = JSON.parse(await z.get("manifest.json")!.data.text()) as Record<string, unknown>;
    edit(man);
    const entries = [...z.values()].map((e) => ({ name: e.name, data: e.name === "manifest.json" ? new Blob([JSON.stringify(man)]) : swap && e.name === swap[0] ? swap[1] : e.data }));
    return Buffer.from(await (await writeZip(entries)).arrayBuffer());
  };
  await refuse("future.canvast", await rebuild((m) => (m["version"] = 99)), /made by a newer canvast \(format 99\)/);
  await refuse("other.canvast", await rebuild((m) => (m["format"] = "something-else")), /not a canvast archive/);
  // A manifest pointing at a file that is not in the archive.
  await refuse(
    "hole.canvast",
    await rebuild((m) => ((m["boards"] as Array<{ canvases: Array<{ file: string }> }>)[0]!.canvases[0]!.file = "canvases/nope.json")),
    /missing "canvases\/nope\.json"/,
  );

  // An original whose bytes were altered (valid ZIP, wrong content): reported, skipped; the instance shows as missing.
  const tampered = Buffer.from(BLOCKS);
  tampered.writeUInt8(tampered.readUInt8(tampered.length - 20) ^ 0x55, tampered.length - 20);
  const fresh = await (async () => {
    // Import into a state where the original is not already stored, so the damaged copy matters.
    await p.evaluate((h) => window.__canvastDebug.removeAssetBytes(h), HASH);
    return rebuild(() => undefined, [`assets/${HASH}`, new Blob([new Uint8Array(tampered)])]);
  })();
  const text = await importArchive(p, "tampered.canvast", fresh);
  expect(text).toContain("does not match its content hash (damaged) and was skipped.");
  expect(text).toContain("1 image refers to originals that are not in the archive");
  await expect(p.getByTestId("toast")).toContainText("1 original is still missing.");
  expect(await stored(p)).toEqual([]);
  expect((await sess(p)).tree!.length).toBe(2);

  // Cancel writes nothing.
  await importArchive(p, good.name, good.bytes, false);
  expect((await sess(p)).tree!.length).toBe(2);
  // The good archive restores the original for every instance.
  await importArchive(p, good.name, good.bytes);
  expect(await stored(p)).toEqual([HASH]);
  expect((await sess(p)).tree!.length).toBe(3);
  expect(app.consoleErrors).toEqual([]);
});

test("a read-only tab can export but not import", async ({ app, context }) => {
  const p1 = app.page;
  await importImage(p1);
  const p2 = await openApp(context);
  expect((await sess(p2)).readOnly).toBe(true);
  await openPanel(p2);
  await expect(p2.getByTestId("set-import")).toBeDisabled();
  const file = await download(p2, () => p2.getByTestId("set-export-full").click());
  const m = await manifestOf(file.bytes);
  expect(m.assets.map((a) => a.hash)).toEqual([HASH]);
  // A read-only tab does not record the backup (it cannot write); the writer's panel shows none yet.
  await openPanel(p1);
  await expect(p1.getByTestId("set-last-backup")).toContainText("No backup made yet");
  await p2.close();
});

test("a version 1 archive (absolute positions, no frames) still imports, converted into frames", async ({ app }) => {
  const p = app.page;
  const obj = (id: string, ax: string, ay: string, unit: number) => ({
    id, kind: "stroke", unit, z: 1, opacity: 1, attachmentTargetId: null, points: [0, 0, 50, 30], width: 3, color: "#102030", ax, ay,
  });
  const planned = [
    obj("a".repeat(32), "5p0", "-3p0", 0),
    obj("b".repeat(32), "7p-3000", "9p-3000", -3000), // 3,000 levels in
    obj("c".repeat(32), "1p500", "1p500", 500), // far out
  ];
  const manifest = {
    format: "canvast-archive", version: 1, app: "test", exportedAt: Date.now(), scope: "canvas", workspaceName: "old",
    boards: [{ id: "x", name: "Old", canvases: [{ id: "y", name: "Old canvas", objectCount: 3, file: "canvases/y.json" }] }],
    assets: [], missingAssets: [],
  };
  const file = Buffer.from(
    await (
      await writeZip([
        { name: "manifest.json", data: new Blob([JSON.stringify(manifest)]) },
        { name: "canvases/y.json", data: new Blob([JSON.stringify({ objects: planned, view: { cx: "5p0", cy: "-3p0", zi: 2, zf: 0, pz: 2 } })]) },
      ])
    ).arrayBuffer(),
  );
  await importArchive(p, "old.canvast", file);
  const tree = (await sess(p)).tree!;
  const imported = tree.flatMap((b) => b.canvases).find((c) => c.name === "Old canvas")!;
  expect((await sess(p)).current!.canvasId).toBe(imported.id);
  // Every object has the same absolute position, and the ones far from the origin live in frames of their own.
  expect((await objects(p)).map((o) => [o.id[0], o.ax, o.ay, o.unit]).sort()).toEqual(planned.map((o) => [o.id[0], o.ax, o.ay, o.unit]).sort());
  expect((await p.evaluate(() => window.__canvastDebug.objectFrames())).filter((o) => o.level !== "0")).toHaveLength(2);
  expect((await dump(p, imported.id)).view).toMatchObject({ cx: "5p0", cy: "-3p0", zi: 2 });
});

test("an incremental backup holds only what changed, a chain of backups restores as one, and the saved styles travel with a workspace backup (ADR 0133)", async ({ app, browser }) => {
  const p = app.page;
  await buildWorkspace(p);
  // a saved style: an empty palette
  await p.getByRole("button", { name: "Styles panel", exact: true }).click();
  const panel = p.getByTestId("styles-panel");
  await panel.getByRole("tab", { name: /^Palettes/ }).click();
  await panel.locator('[data-new-from="empty"]').click();
  await expect(panel.locator(".style-card", { hasText: "Palette 1" })).toBeVisible();
  await p.getByRole("button", { name: "Hide the Styles panel" }).click();

  await openPanel(p);
  // no backup yet: there is nothing to go on from
  await expect(p.getByTestId("set-export-changes")).toBeDisabled();
  const full = await download(p, () => p.getByTestId("set-export-full").click());
  const fullM = await manifestOf(full.bytes);
  expect(fullM["incremental"]).toBeUndefined();
  expect((fullM["styles"] as unknown[]).length).toBe(1);

  await p.getByTestId("view-canvas").click(); // (Settings > Storage was open for the backup)
  // one canvas changes (a stroke on the open one) and one original is added
  const before = (await sess(p)).current!.canvasId;
  await stroke(p, 700, 300);
  await p.getByTestId("view-assets").click();
  const NEW = makePng(5, 5, () => [200, 40, 40, 255]);
  await p.getByTestId("assets-import-input").setInputFiles({ name: "red.png", mimeType: "image/png", buffer: NEW });
  await p.getByTestId("view-canvas").click();
  await saved(p);

  await openPanel(p);
  const inc = await download(p, () => p.getByTestId("set-export-changes").click());
  const m = await manifestOf(inc.bytes);
  expect(m["incremental"]).toEqual({ since: fullM["exportedAt"] });
  const canvases = m.boards.flatMap((b) => b.canvases) as unknown as Array<{ id: string; file?: string }>;
  expect(canvases).toHaveLength(3); // every canvas is listed (the structure) ...
  expect(canvases.filter((c) => c.file).map((c) => c.id)).toEqual([before]); // ... but only the one that changed has its content
  const withFile = (m.assets as unknown as Array<{ hash: string; file?: string }>).filter((a) => a.file);
  expect(withFile).toHaveLength(1); // the new original only
  const z = await readZip(new Blob([new Uint8Array(inc.bytes)]));
  expect(z.size).toBe(1 + 1 + 1);
  expect(inc.bytes.length).toBeLessThan(full.bytes.length);
  await expect(p.getByTestId("set-last-backup")).toContainText(inc.name);

  // a chain restores as one, in whichever order the files are picked
  const srcTree = (await sess(p)).tree!;
  const srcDumps = await Promise.all(srcTree.flatMap((b) => b.canvases.map((c) => dump(p, c.id))));
  const other = await freshProfile(browser);
  const q = other.page;
  await openPanel(q);
  await q.getByTestId("set-import-input").setInputFiles([
    { name: inc.name, mimeType: "application/zip", buffer: inc.bytes },
    { name: full.name, mimeType: "application/zip", buffer: full.bytes },
  ]);
  const dlg = q.getByTestId("confirm-dialog");
  await expect(dlg).toBeVisible();
  expect((await dlg.textContent()) ?? "").toContain("put together from 2 files");
  await q.getByTestId("confirm-ok").click();
  await expect(dlg).toHaveCount(0);
  await expect(q.getByTestId("toast")).toContainText(/Imported 3 canvases/);
  await expect(q.getByTestId("toast")).toContainText("1 saved style added");
  const tree = (await sess(q)).tree!;
  const dst = await Promise.all(tree.slice(1).flatMap((b) => b.canvases.map((c) => dump(q, c.id))));
  expect(dst).toEqual(srcDumps); // the changed canvas as it is now, the others as they were
  expect((await stored(q)).length).toBe(3); // the library: the two originals of the full backup and the new one

  // the incremental file alone says what it is; two of them without the full one are refused
  await openPanel(q);
  await q.getByTestId("set-import-input").setInputFiles({ name: inc.name, mimeType: "application/zip", buffer: inc.bytes });
  await expect(dlg).toBeVisible();
  const alone = (await dlg.textContent()) ?? "";
  expect(alone).toContain("incremental backup on its own");
  await q.getByTestId("confirm-cancel").click();
  await expect(dlg).toHaveCount(0);
  await q.getByTestId("toast").evaluate((t) => (t.textContent = ""));
  await openPanel(q);
  await q.getByTestId("set-import-input").setInputFiles([
    { name: inc.name, mimeType: "application/zip", buffer: inc.bytes },
    { name: "again.canvast", mimeType: "application/zip", buffer: inc.bytes },
  ]);
  await expect(q.getByTestId("toast")).toContainText(/Cannot import 2 backup files/);
  await other.context.close();
  expect(app.consoleErrors).toEqual([]);
});

test("Settings > Storage holds the backup: the last backup, a full export, the changes only (once there is a backup to go on from), the files as ZIP and the import (ADR 0133)", async ({ app }) => {
  const p = app.page;
  await importImage(p);
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Storage" }).click();
  await expect(p.getByTestId("set-last-backup")).toHaveText("No backup made yet.");
  await expect(p.getByTestId("set-export-changes")).toBeDisabled();
  const full = await download(p, () => p.getByTestId("set-export-full").click());
  expect(full.name).toMatch(/\.canvast$/);
  await expect(p.getByTestId("set-last-backup")).toContainText("(full)");
  await expect(p.getByTestId("set-last-backup")).toContainText(full.name);
  await expect(p.getByTestId("set-export-changes")).toBeEnabled();
  const inc = await download(p, () => p.getByTestId("set-export-changes").click());
  await expect(p.getByTestId("set-last-backup")).toContainText("(incremental)");
  expect(((await manifestOf(inc.bytes))["incremental"] as { since: number }).since).toBe((await manifestOf(full.bytes))["exportedAt"]);
  await p.getByTestId("set-import-input").setInputFiles({ name: full.name, mimeType: "application/zip", buffer: full.bytes });
  await expect(p.getByTestId("confirm-dialog")).toBeVisible();
  await p.getByTestId("confirm-cancel").click();
  expect(app.consoleErrors).toEqual([]);
});

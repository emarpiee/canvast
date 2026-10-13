import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import { blockyFixture } from "./png";

/**
 * Raster tile cache (ADR 0009): tiles must give the same picture as direct
 * rendering, be reused while panning and redrawing, and be refreshed exactly
 * where an edit happened.
 *
 * Pixel criterion. Direct rendering batches runs of same-colour strokes; a
 * batched union and separate paints differ in antialiasing where strokes
 * overlap, and a tile composites through a transparent layer (8-bit
 * rounding). So a few edge pixels may differ slightly. A missing, extra or
 * shifted object changes hundreds to thousands of pixels by large amounts,
 * which the limits below reject.
 */
const LIMIT = { over16: 0.001, over60: 0.0002 } as const;

interface Diff {
  pixels: number;
  over16: number;
  over60: number;
  max: number;
}

/** Render the current view directly and through tiles, and compare every pixel. */
async function compare(p: Page): Promise<Diff & { tiles: unknown }> {
  return p.evaluate(async () => {
    const h = window.__canvastDebug;
    const c = document.getElementById("canvas") as HTMLCanvasElement;
    const snap = async (): Promise<Uint8ClampedArray> => {
      await h.nextFrame();
      return c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    };
    h.setTileCache(false);
    const direct = await snap();
    h.setTileCache(true);
    await snap(); // first frame at a zoom is direct; tiles are built on the next
    const tiled = await snap();
    let over16 = 0;
    let over60 = 0;
    let max = 0;
    for (let i = 0; i < direct.length; i += 4) {
      const d = Math.max(Math.abs(direct[i]! - tiled[i]!), Math.abs(direct[i + 1]! - tiled[i + 1]!), Math.abs(direct[i + 2]! - tiled[i + 2]!));
      if (d > 16) over16++;
      if (d > 60) over60++;
      if (d > max) max = d;
    }
    return { pixels: direct.length / 4, over16, over60, max, tiles: h.tileStats() };
  });
}

function expectSamePicture(d: Diff, label: string): void {
  expect(d.over16 / d.pixels, `${label}: pixels differing by >16 (${d.over16})`).toBeLessThanOrEqual(LIMIT.over16);
  expect(d.over60 / d.pixels, `${label}: pixels differing by >60 (${d.over60})`).toBeLessThanOrEqual(LIMIT.over60);
}

const stats = (p: Page) => p.evaluate(() => window.__canvastDebug.tileStats());
/**
 * Tiles rendered while `action` runs plus two frames. Each change also
 * schedules frames of its own, so the count is cumulative, not "last frame".
 */
async function renderedDuring(p: Page, action: () => Promise<unknown>): Promise<number> {
  const before = (await stats(p)).renderedTotal;
  await action();
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  return (await stats(p)).renderedTotal - before;
}

test("tiles give the same picture as direct rendering: dense scene, after a pan, and at DPR", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.benchLoad({ kind: "dense", n: 3000 }));
  const home = await compare(p);
  expectSamePicture(home, "home");
  expect((home.tiles as { last: { tiles: number } | null }).last?.tiles).toBeGreaterThan(0);
  // A pan by whole pixels reuses tiles and still matches.
  await p.evaluate(() => {
    const h = window.__canvastDebug;
    const v = h.viewport();
    const w = h.screenToWorld(v.width / 2 + 300, v.height / 2 + 170);
    h.setCamera({ ...h.camera(), cx: w.x, cy: w.y });
  });
  expectSamePicture(await compare(p), "after pan");
  expect(app.consoleErrors).toEqual([]);
});

test("panning reuses tiles; a still camera renders none; the zoom changing renders directly", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.benchLoad({ kind: "dense", n: 3000 }));
  await renderedDuring(p, async () => undefined); // let the frames the load scheduled finish
  const built = await renderedDuring(p, () => p.evaluate(() => window.__canvastDebug.setTileCache(true)));
  const full = (await stats(p)).last!.tiles;
  expect(built).toBe(full); // built from scratch, once
  // Still camera: every tile reused, no visibility query at all.
  expect(await renderedDuring(p, async () => undefined)).toBe(0);
  expect((await stats(p)).last).toMatchObject({ rendered: 0, visible: 0 });
  // Pan 40 px right in 8 steps of whole pixels: only newly exposed tiles render.
  const panned = await renderedDuring(p, async () => {
    for (let i = 0; i < 8; i++) {
      await p.evaluate(() => {
        const h = window.__canvastDebug;
        const v = h.viewport();
        const w = h.screenToWorld(v.width / 2 + 5, v.height / 2);
        h.setCamera({ ...h.camera(), cx: w.x, cy: w.y });
      });
      await app.frame();
    }
  });
  expect(panned).toBeLessThanOrEqual(2 * Math.ceil(800 / 256 + 1)); // at most a new column or two
  expect(panned).toBeLessThan(full);
  // While the zoom changes every frame (a wheel or pinch gesture), frames are rendered
  // directly: no tile is built, scaled or reused at a stale zoom.
  const during = await p.evaluate(() => {
    const h = window.__canvastDebug;
    const before = h.tileStats().renderedTotal;
    h.benchRun(20, "panzoom"); // synchronous frames, new zoom each frame
    return { added: h.tileStats().renderedTotal - before, last: h.tileStats().last };
  });
  expect(during).toEqual({ added: 0, last: null });
  // Once it holds still, frames are tiled again (rebuilt at the current zoom).
  await app.frame();
  await app.frame();
  expect((await stats(p)).last).not.toBeNull();
  expectSamePicture(await compare(p), "after zoom");
});

test("a pan that is not a whole number of device pixels rebuilds tiles instead of resampling them", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.benchLoad({ kind: "dense", n: 1000 }));
  await renderedDuring(p, async () => undefined);
  const full = (await stats(p)).last!.tiles;
  const rebuilt = await renderedDuring(p, () =>
    p.evaluate(() => {
      const h = window.__canvastDebug;
      const v = h.viewport();
      const w = h.screenToWorld(v.width / 2 + 0.375, v.height / 2);
      h.setCamera({ ...h.camera(), cx: w.x, cy: w.y });
    }),
  );
  expect(rebuilt).toBe(full);
  expectSamePicture(await compare(p), "sub-pixel pan");
});

test("edits refresh exactly the affected tiles: draw, move, undo, delete, opacity", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.benchLoad({ kind: "dense", n: 300 }));
  await renderedDuring(p, async () => undefined);
  const full = (await stats(p)).last!.tiles;
  // Draw a stroke with the pen (the stroke in progress is an overlay; the committed one goes into tiles).
  await p.keyboard.press("p");
  const afterDraw = await renderedDuring(p, () => app.drag({ x: 300, y: 300 }, { x: 420, y: 360 }));
  expect(afterDraw).toBeGreaterThan(0);
  expect(afterDraw).toBeLessThan(full); // only the tiles it touches
  expectSamePicture(await compare(p), "after drawing");
  const id = (await p.evaluate(() => window.__canvastDebug.objects())).at(-1)!.id;
  // Move it with the select tool (preview frames render directly; the commit refreshes tiles).
  await p.keyboard.press("v");
  await app.drag({ x: 360, y: 330 }, { x: 760, y: 530 });
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([id]);
  expectSamePicture(await compare(p), "after move");
  await p.keyboard.press("Control+z");
  expectSamePicture(await compare(p), "after undo");
  await p.evaluate((i) => window.__canvastDebug.setOpacity(i, 0.4), id);
  expectSamePicture(await compare(p), "after opacity");
  await p.keyboard.press("Delete");
  expectSamePicture(await compare(p), "after delete");
  expect(app.consoleErrors).toEqual([]);
});

test("deep zoom: tiles hold exact-path strokes and image pixels, and match direct rendering 1,600 levels in", async ({ app }) => {
  const p = app.page;
  // An image and a stroke placed 1,600 levels in, then viewed 30 levels deeper still (exact paths).
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "123456789p-1590", cy: "-98765p-1590", zi: 1600, zf: 0.25, pz: 1600 }));
  await p.getByTestId("import-input").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer: blockyFixture() });
  await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.objects())).length).toBe(1);
  await p.keyboard.press("p");
  await app.drag({ x: 500, y: 300 }, { x: 800, y: 500 });
  await p.keyboard.press("v");
  for (const extra of [0, 8, 30]) {
    await p.evaluate((k) => {
      const h = window.__canvastDebug;
      const v = h.viewport();
      const w = h.screenToWorld(v.width / 2 + 40, v.height / 2 + 20);
      h.setCamera({ cx: w.x, cy: w.y, zi: 1600 + k, zf: 0.25, pz: 1600 + k });
    }, extra);
    const d = await compare(p);
    expectSamePicture(d, `deep +${extra}`);
    expect((d.tiles as { last: unknown }).last).not.toBeNull();
  }
  expect(app.consoleErrors).toEqual([]);
});

test("a tile showing an image placeholder is refreshed when the original finishes loading", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("import-input").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer: blockyFixture() });
  await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.objects())).length).toBe(1);
  await p.evaluate(() => window.__canvastDebug.flushSave());
  // Reload: the image draws as a placeholder until its original is decoded.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 6, zf: 0, pz: 6 }));
  await app.frame(); // first frame at a new zoom is direct
  await app.frame(); // then tiles are built, likely while the original is still decoding
  const box = await p.evaluate((i) => window.__canvastDebug.objectScreen(i)!.box, (await p.evaluate(() => window.__canvastDebug.objects()))[0]!.id);
  const at: [number, number] = [box.minX + ((box.maxX - box.minX) * 4.5) / 8, box.minY + ((box.maxY - box.minY) * 3.5) / 6];
  await expect
    .poll(async () => {
      await app.frame();
      return p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x!, y!), at);
    })
    .toEqual([40, 140, 220]);
  await app.frame();
  expect((await stats(p)).last).not.toBeNull(); // drawn from tiles, not because the cache was bypassed
  expect(await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x!, y!), at)).toEqual([40, 140, 220]);
});

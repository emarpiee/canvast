import type { Page } from "@playwright/test";
import { expect, setPenColour, test } from "./harness";

/**
 * Density preview (ADR 0010): content too small to draw object by object
 * stays visible, in its own colour, as a faint mark where it is; it never
 * becomes selectable or changes the document, and it follows edits.
 */

/**
 * World point far from the origin (axes and origin landmarks off-screen at
 * every tested zoom) and not on a power-of-two grid line.
 */
const FAR = "1234567891p0";

/**
 * For a view 200 levels out: every finite point collapses towards the origin
 * pixel, so this cluster sits proportionally farther away (2^210), with an odd
 * mantissa at 2^180 so no visible grid line passes through it.
 */
const FARTHER = "1234567891p180";

/** Draw `n` short red strokes around the world point (at, at) at zoom level `level`. */
async function drawCluster(p: Page, level: number, n: number, at = FAR): Promise<void> {
  await p.evaluate(([c, z]) => window.__canvastDebug.setCamera({ cx: c as string, cy: c as string, zi: z as number, zf: 0, pz: z as number }), [at, level] as const);
  await p.keyboard.press("p");
  await setPenColour(p, "#dc2626"); // red: far from the background in every channel
  for (let i = 0; i < n; i++) {
    const x = 560 + (i % 5) * 40;
    const y = 340 + Math.floor(i / 5) * 30;
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x + 25, y + 12, { steps: 3 });
    await p.mouse.up();
  }
  await p.keyboard.press("v");
}

/** View the cluster from `level`, with it at screen (900, 500), and return that pixel with the preview off and on. */
async function look(p: Page, level: number, at = FAR): Promise<{ off: number[]; on: number[]; bg: number[]; cells: number }> {
  return p.evaluate(
    async ([c, z]) => {
      const h = window.__canvastDebug;
      h.setCamera({ cx: c as string, cy: c as string, zi: z as number, zf: 0, pz: z as number });
      await h.nextFrame();
      // Shift so the cluster sits at (900, 500): exact world offset of a screen offset.
      const v = h.viewport();
      const w = h.screenToWorld(v.width / 2 - (900 - v.width / 2), v.height / 2 - (500 - v.height / 2));
      h.setCamera({ ...h.camera(), cx: w.x, cy: w.y });
      const at = h.worldToScreen(c as string, c as string);
      const px = (): [number, number, number] => h.pixelAt(Math.floor(at.x), Math.floor(at.y));
      h.setDensity(false);
      await h.nextFrame();
      const off = px();
      const bg = h.pixelAt(Math.floor(at.x) + 3, Math.floor(at.y) + 3);
      h.setDensity(true);
      await h.nextFrame();
      return { off, on: px(), bg, cells: h.densityCells() };
    },
    [at, level] as const,
  );
}

const diff = (a: number[], b: number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

test("a cluster stays visible in its colour at every zoom-out, where it used to vanish", async ({ app }) => {
  const p = app.page;
  await drawCluster(p, 0, 15);
  const colour = (await p.evaluate(() => window.__canvastDebug.objects()))[0]!["color"] as string;
  const rgb = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  // (FAR is 2^30 from the origin: the origin stays off-screen up to about 20 levels out.)
  const cases: Array<[number, string]> = [[6, FAR], [10, FAR], [14, FAR], [20, FAR], [200, FARTHER]];
  await drawCluster(p, -180, 15, FARTHER);
  for (const [out, at] of cases) {
    const r = await look(p, -out, at);
    if (out < 10) {
      // Still drawn object by object: visible either way.
      expect(diff(r.on, r.bg), `on at -${out}`).toBeGreaterThanOrEqual(30);
      continue;
    }
    // Without the preview the cluster is gone (its pixel looks like the background beside it)...
    expect(diff(r.off, r.bg), `off at -${out}`).toBeLessThanOrEqual(12);
    // ...with it, there is a clear mark...
    expect(diff(r.on, r.off), `on vs off at -${out}`).toBeGreaterThanOrEqual(30);
    // ...tinted towards the strokes' colour (each channel that can move does so towards it).
    for (let k = 0; k < 3; k++) {
      if (Math.abs(rgb[k]! - r.off[k]!) > 40) expect(Math.sign(r.on[k]! - r.off[k]!), `channel ${k} at -${out}`).toBe(Math.sign(rgb[k]! - r.off[k]!));
    }
    expect(r.cells).toBeGreaterThan(0);
  }
  expect(app.consoleErrors).toEqual([]);
});

test("content drawn 60 levels deep is visible from home as a mark to zoom into", async ({ app }) => {
  const p = app.page;
  await drawCluster(p, 60, 5);
  const r = await look(p, 0);
  expect(diff(r.off, r.bg)).toBeLessThanOrEqual(12); // invisible without the preview (2^-60 of a pixel)
  expect(diff(r.on, r.off)).toBeGreaterThanOrEqual(30); // a discoverable mark with it
  // Zooming in on the mark finds the strokes (drawn individually again).
  await p.evaluate(([c]) => window.__canvastDebug.setCamera({ cx: c as string, cy: c as string, zi: 60, zf: 0, pz: 60 }), [FAR] as const);
  await app.frame();
  const shown = await p.evaluate(() => window.__canvastDebug.objects().filter((o) => window.__canvastDebug.objectScreen(o.id) !== null).length);
  expect(shown).toBe(5);
});

test("the preview follows edits and is never selectable", async ({ app }) => {
  const p = app.page;
  await drawCluster(p, 0, 10);
  const before = await look(p, -14);
  expect(diff(before.on, before.off)).toBeGreaterThanOrEqual(30);
  // Clicking the mark selects nothing: selection uses authoritative, individually drawn objects only.
  await p.keyboard.press("v");
  const at = await p.evaluate(([c]) => window.__canvastDebug.worldToScreen(c as string, c as string), [FAR] as const);
  await p.mouse.click(Math.floor(at.x), Math.floor(at.y));
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([]);
  // Delete everything (at a zoom where the strokes are visible), then look again: the mark is gone.
  await p.evaluate(([c]) => window.__canvastDebug.setCamera({ cx: c as string, cy: c as string, zi: 0, zf: 0, pz: 0 }), [FAR] as const);
  await app.frame();
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Delete");
  await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.objects())).length).toBe(0);
  const gone = await look(p, -14);
  expect(diff(gone.on, gone.off)).toBe(0);
  expect(gone.cells).toBe(0);
  // Undo brings the strokes, and the mark, back.
  await p.keyboard.press("Control+z");
  const back = await look(p, -14);
  expect(diff(back.on, back.off)).toBeGreaterThanOrEqual(30);
});

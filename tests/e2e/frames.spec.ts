import { expect, recordMetric, test } from "./harness";
import type { App } from "./harness";
import { blockyFixture } from "./png";
import { readFile } from "node:fs/promises";
import { APP_URL } from "./harness";

/**
 * Nested frames (ADR 0014): work at any depth costs the same, and every
 * input path (jumps, wheel, keys, drag pan, Home) works in both directions.
 * Before frames a pan took 5.9 s at 2^1,000,000 and 2^10^12 was unreachable.
 */

/** Slowest acceptable input step (input plus the frames it causes). */
const MAX_STEP_MS = 500;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

async function boxOf(app: App, id: string): Promise<Box | null> {
  const s = await app.page.evaluate((i) => window.__canvastDebug.objectScreen(i), id);
  return s && s.box;
}

function timer(app: App): { timed: (fn: () => Promise<void>) => Promise<void>; steps: number[] } {
  const steps: number[] = [];
  return {
    steps,
    timed: async (fn) => {
      const t0 = Date.now();
      await fn();
      await app.frame();
      steps.push(Date.now() - t0);
    },
  };
}

test("at 2^10^12 (reached by a jump) drawing, selecting, moving, undo, redo and panning stay fast and exact", async ({ app }, info) => {
  const p = app.page;
  const { timed, steps } = timer(app);
  await timed(() => p.evaluate(() => window.__canvastDebug.jump(1e12)));
  expect(await p.evaluate(() => window.__canvastDebug.depth())).toBe("1000000000000");
  await p.mouse.click(640, 400);
  for (let i = 0; i < 4; i++) await timed(() => p.keyboard.press("ArrowRight"));

  await p.keyboard.press("p");
  await timed(() => app.drag({ x: 500, y: 400 }, { x: 700, y: 450 }, 6));
  const [s] = await p.evaluate(() => window.__canvastDebug.objectFrames());
  expect(s?.kind).toBe("stroke");
  expect(BigInt(s!.level), "the stroke lives in a deep frame").toBeGreaterThan(10n ** 10n);
  const drawn = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), s!.id))!;
  expect(Math.abs(drawn.q[0]! - 500) + Math.abs(drawn.q[1]! - 400), "first point under the pointer").toBeLessThan(1);

  await p.keyboard.press("v");
  await timed(() => p.mouse.click(600, 425));
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([s!.id]);
  await timed(() => app.drag({ x: 600, y: 425 }, { x: 650, y: 475 }, 6));
  const moved = (await boxOf(app, s!.id))!;
  expect(moved.minX - drawn.box.minX).toBeCloseTo(50, 0);
  expect(moved.minY - drawn.box.minY).toBeCloseTo(50, 0);

  await timed(() => p.keyboard.press("Control+z"));
  expect(await boxOf(app, s!.id)).toEqual(drawn.box);
  await timed(() => p.keyboard.press("Control+y"));
  expect(await boxOf(app, s!.id)).toEqual(moved);

  // Pan away and back: the stroke returns to exactly the same pixels.
  for (const k of ["ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight", "ArrowRight"]) await timed(() => p.keyboard.press(k));
  expect(await boxOf(app, s!.id)).toEqual(moved);

  // Storage holds frames (plan step 4): work a trillion levels down saves like any other.
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");

  recordMetric(info, "work at 2^10^12", { maxStepMs: Math.max(...steps), steps });
  expect(Math.max(...steps)).toBeLessThan(MAX_STEP_MS);
});

test("a stroke drawn while wheel-zooming across frame changes stays under the pointer", async ({ app }) => {
  const p = app.page;
  await p.mouse.click(640, 400);
  await p.keyboard.press("p");
  await p.mouse.move(400, 400);
  await p.mouse.down();
  await p.mouse.move(500, 400, { steps: 5 });
  // Past 40 levels about the pointer: the camera changes frame at least once mid-stroke.
  // (Levels per notch depend on the device pixel ratio, so wheel until there.)
  for (let i = 0; i < 400 && Number(await p.evaluate(() => window.__canvastDebug.depth())) <= 40; i++) await app.wheel(500, 400, -100);
  await p.mouse.move(600, 420, { steps: 5 });
  await p.mouse.up();
  await app.frame();
  const [s] = await p.evaluate(() => window.__canvastDebug.objectFrames());
  expect(s?.kind).toBe("stroke");
  const q = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), s!.id))!.q;
  // The point drawn before zooming stays at the zoom anchor; the last one is under the pointer.
  let nearAnchor = Infinity;
  for (let i = 0; i < q.length; i += 2) nearAnchor = Math.min(nearAnchor, Math.hypot(q[i]! - 500, q[i + 1]! - 400));
  expect(nearAnchor).toBeLessThan(1);
  expect(Math.hypot(q[q.length - 2]! - 600, q[q.length - 1]! - 420)).toBeLessThan(1);
  expect(Number(await p.evaluate(() => window.__canvastDebug.depth()))).toBeGreaterThan(40);
});

test("after giant zoom-outs (−10^12 five times) wheel, keys, drag pan and Home stay fast and return exactly", async ({ app }, info) => {
  const p = app.page;
  const { timed, steps } = timer(app);
  await p.mouse.click(640, 400);
  await p.keyboard.press("p");
  await app.drag({ x: 500, y: 400 }, { x: 700, y: 450 }, 6);
  const [s] = await p.evaluate(() => window.__canvastDebug.objectFrames());
  const home = (await boxOf(app, s!.id))!;

  // In, then far out: the camera ends 4·10^12 levels above home.
  await timed(() => p.evaluate(() => window.__canvastDebug.jump(1e12)));
  for (let i = 0; i < 5; i++) await timed(() => p.evaluate(() => window.__canvastDebug.jump(-1e12)));
  expect(await p.evaluate(() => window.__canvastDebug.depth())).toBe("-4000000000000");
  for (let i = 0; i < 20; i++) await timed(() => app.wheel(640, 400, i < 10 ? -240 : 240));
  for (const k of ["+", "+", "-", "-", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) await timed(() => p.keyboard.press(k));
  await p.keyboard.press("h");
  await timed(() => app.drag({ x: 600, y: 400 }, { x: 300, y: 250 }, 8));
  await timed(() => p.keyboard.press("Home"));

  expect(await app.camera()).toEqual({ cx: "0p0", cy: "0p0", zi: 0, zf: 0, pz: 0 });
  expect(await boxOf(app, s!.id)).toEqual(home);
  recordMetric(info, "zoom out 5e12 then every input", { maxStepMs: Math.max(...steps) });
  expect(Math.max(...steps)).toBeLessThan(MAX_STEP_MS);
});

test("work at 2^10,000,000 off the origin saves and reopens after a reload (Firefox caps BigInts at ~2^20 bits)", async ({ app }) => {
  const p = app.page;
  const view = { cx: "12345p-10000003", cy: "-678p-10000001", zi: 10_000_000, zf: 0.25, pz: 10_000_000 };
  await p.evaluate((v) => window.__canvastDebug.setCamera(v), view);
  await p.mouse.click(640, 400);
  await p.keyboard.press("p");
  await app.drag({ x: 500, y: 400 }, { x: 700, y: 450 }, 6);
  const [s] = await p.evaluate(() => window.__canvastDebug.objectFrames());
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  const t0 = Date.now();
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  expect(Date.now() - t0, "reopens quickly").toBeLessThan(10_000);
  expect(await p.evaluate(() => document.querySelector('[role="status"]')?.textContent ?? "")).not.toContain("Could not open");
  expect((await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id)).toEqual([s!.id]);
  await p.evaluate((v) => window.__canvastDebug.setCamera(v), view);
  await app.frame();
  expect(await p.evaluate((id) => window.__canvastDebug.objectScreen(id), s!.id)).not.toBeNull();
});

/** Colour of the canvas at the corners and the centre, or null when they differ. */
async function uniformColour(app: App): Promise<string | null> {
  const vp = await app.page.evaluate(() => window.__canvastDebug.viewport());
  const pts = [[2, 2], [vp.width - 3, 2], [2, vp.height - 3], [vp.width - 3, vp.height - 3], [vp.width / 2, vp.height / 2]] as const;
  const c = await app.page.evaluate((ps) => ps.map(([x, y]) => window.__canvastDebug.pixelAt(x, y).join(",")), pts);
  return c.every((v) => v === c[0]) ? c[0]! : null;
}

const state = (app: App, id: string) => app.page.evaluate((i) => window.__canvastDebug.coarseState(i), id);

test("a stroke far above the view covers it at any depth: every input path, both directions, exact return", async ({ app }, info) => {
  const p = app.page;
  const { timed, steps } = timer(app);
  await p.keyboard.press("p");
  await app.drag({ x: 300, y: 400 }, { x: 980, y: 400 }, 6); // through the view centre
  await app.drag({ x: 300, y: 150 }, { x: 980, y: 150 }, 6); // well off it
  const [thru, off] = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id);
  const homeBox = (await boxOf(app, thru!))!;
  const ink = (await p.evaluate(() => window.__canvastDebug.pixelAt(640, 400))).join(",");
  expect(await uniformColour(app), "at home the stroke is a thin line").toBeNull();
  await p.keyboard.press("v");

  // Two frames later, so the tile cache has built its tiles from the covering object too.
  const allInk = async (what: string): Promise<void> => {
    await app.frame();
    await app.frame();
    expect(await uniformColour(app), what).toBe(ink);
  };
  for (const depth of [5_000, 100_001, 1e6, 1e9, 1e12]) {
    await timed(() => p.evaluate((d) => window.__canvastDebug.jump(d), depth));
    expect(await state(app, thru!), `${depth}`).toBe("cover");
    expect(await state(app, off!), `${depth}`).toBe("miss");
    await allInk(`${depth} levels down: the whole view is inside the stroke`);

    // Every input path, in both directions, at this depth.
    for (const d of [-240, 240]) await timed(() => app.wheel(640, 400, d));
    for (const k of ["+", "+", "-", "-", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) await timed(() => p.keyboard.press(k));
    await p.keyboard.press("h");
    await timed(() => app.drag({ x: 600, y: 420 }, { x: 640, y: 380 }, 6));
    await allInk(`${depth}: after wheel, keys and drag`);
    expect(await state(app, thru!)).toBe("cover");

    // Picking: the view is inside the stroke, and only that stroke.
    await p.keyboard.press("v");
    await timed(() => p.mouse.click(700, 450));
    expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([thru]);
    await p.keyboard.press("Escape");

    // Back out by the same jump after undoing the pan: the stroke returns to exactly the same pixels.
    await p.keyboard.press("h");
    await timed(() => app.drag({ x: 640, y: 380 }, { x: 600, y: 420 }, 6));
    await p.keyboard.press("v");
    await timed(() => p.evaluate((d) => window.__canvastDebug.jump(-d), depth));
    expect(await boxOf(app, thru!)).toEqual(homeBox);
    expect(await uniformColour(app)).toBeNull();
    await p.keyboard.press("Home");
  }
  expect(Math.max(...steps)).toBeLessThan(MAX_STEP_MS);
  recordMetric(info, "coarse stroke from 5e3 to 1e12 levels", { maxStepMs: Math.max(...steps) });
});

test("crossing from near to coarse (4,096 levels) one level at a time keeps the stroke covering the view, in and out", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await app.drag({ x: 300, y: 400 }, { x: 980, y: 400 }, 6);
  const [thru] = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id);
  const ink = (await p.evaluate(() => window.__canvastDebug.pixelAt(640, 400))).join(",");
  await p.evaluate(() => window.__canvastDebug.jump(4_150));
  const seen = new Set<string>();
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 110; i++) {
      await p.evaluate((d) => window.__canvastDebug.jump(d), dir);
      await app.frame();
      await app.frame(); // the first frame can still be the one scheduled before the jump
      seen.add(await state(app, thru!));
      expect(await uniformColour(app), `level ${await p.evaluate(() => window.__canvastDebug.depth())}`).toBe(ink);
    }
  }
  expect([...seen].sort(), "both the exact path and the coarse path were crossed").toEqual(["cover", "near"]);
});

test("an image far above the view shows the source pixel under it, at any depth", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("import-input").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer: blockyFixture() });
  await p.waitForFunction(() => window.__canvastDebug.objects().length === 1);
  await app.frame();
  const [img] = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id);
  // The image (8 px wide at home) is centred on the view, on a pixel corner: zoom in so a pixel is 64 px, then move off the corner.
  await p.evaluate(() => window.__canvastDebug.jump(6));
  await p.keyboard.press("h");
  await app.drag({ x: 600, y: 420 }, { x: 617, y: 413 }, 4);
  await p.keyboard.press("v");
  const colour = (await p.evaluate(() => window.__canvastDebug.pixelAt(640, 400))).join(",");
  for (const depth of [5_000, 1e6, 1e12]) {
    await p.evaluate((d) => window.__canvastDebug.jump(d), depth);
    await app.frame();
    expect(await state(app, img!), `${depth}`).toBe("cover");
    expect(await uniformColour(app), `${depth}: one source pixel fills the view`).toBe(colour);
    await p.evaluate((d) => window.__canvastDebug.jump(-d), depth);
    await app.frame();
  }
});

test("work at 2^10^12 and 10^15 saves, reopens after a reload, and travels in an archive to another profile", async ({ app, browser }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await app.drag({ x: 500, y: 400 }, { x: 700, y: 450 }, 6); // at home
  const [home] = await p.evaluate(() => window.__canvastDebug.objectFrames());
  await p.evaluate(() => window.__canvastDebug.jump(1e12));
  await app.drag({ x: 500, y: 300 }, { x: 640, y: 350 }, 6); // a trillion levels down
  await p.evaluate(() => window.__canvastDebug.jump(1e12));
  await p.evaluate(() => window.__canvastDebug.jump(5e14));
  await app.drag({ x: 400, y: 300 }, { x: 600, y: 380 }, 6); // 5·10^14 levels down
  const objs = await p.evaluate(() => window.__canvastDebug.objectFrames());
  expect(objs).toHaveLength(3);
  const depth = await p.evaluate(() => window.__canvastDebug.depth());
  expect(BigInt(depth)).toBe(2n * 10n ** 12n + 5n * 10n ** 14n);
  const deep = objs.find((o) => o.id !== home!.id && BigInt(o.level) > 10n ** 13n)!;
  const where = (pg: typeof p, id: string) => pg.evaluate((i) => window.__canvastDebug.objectScreen(i), id);
  const before = (await where(p, deep.id))!;
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");

  // Reload: the objects are in the same frames and the view (frame form, no absolute numbers) is where it was.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  expect(await p.evaluate(() => window.__canvastDebug.depth())).toBe(depth);
  expect((await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => [o.id, o.level]).sort()).toEqual(objs.map((o) => [o.id, o.level]).sort());
  expect(await where(p, deep.id)).toEqual(before);

  // Export the workspace and import it into an empty profile.
  await p.getByTestId("save-status").click();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("export-workspace").click()]);
  const bytes = await readFile((await dl.path())!);
  const context = await browser.newContext();
  const q = await context.newPage();
  await q.setViewportSize({ width: 1280, height: 800 });
  await q.goto(APP_URL);
  await q.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await q.getByTestId("save-status").click();
  await q.getByTestId("import-archive-input").setInputFiles({ name: "deep.canvast", mimeType: "application/zip", buffer: bytes });
  await q.getByTestId("confirm-ok").click();
  await expect(q.getByTestId("toast")).toContainText(/Imported/);
  // The imported canvas opens at its saved view with the same three objects in the same frames.
  await expect.poll(async () => (await q.evaluate(() => window.__canvastDebug.objectFrames())).length).toBe(3);
  expect(await q.evaluate(() => window.__canvastDebug.depth())).toBe(depth);
  await q.evaluate(() => window.__canvastDebug.nextFrame());
  expect(await where(q, deep.id)).toEqual(before);
  await context.close();
});

test("frames of paths the camera has left are collected, and the ones objects and the view need are kept", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await app.drag({ x: 500, y: 400 }, { x: 700, y: 450 }, 6);
  const [s] = await p.evaluate(() => window.__canvastDebug.objectFrames());
  // A long wheel-like zoom path: thousands of levels in many steps, each frame on the path saved with the view.
  for (let i = 0; i < 40; i++) {
    await p.evaluate(() => window.__canvastDebug.jump(31));
    await p.evaluate(() => window.__canvastDebug.jump(1));
    if (i % 8 === 7) await p.evaluate(() => window.__canvastDebug.flushSave());
  }
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  const deep = await p.evaluate(() => window.__canvastDebug.storedFrameCount());
  expect(deep, "the path down is stored").toBeGreaterThan(10);
  await p.keyboard.press("Home");
  await p.evaluate(() => window.__canvastDebug.collectFrames());
  const after = await p.evaluate(() => window.__canvastDebug.storedFrameCount());
  expect(after, "paths nothing refers to any more are gone").toBeLessThanOrEqual(2);
  expect(s).toBeDefined();
  // And everything still opens.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  expect((await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id)).toEqual([s!.id]);
});

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

/** Colour at the four corners of the view, or null when they differ (the centre has a marker drawn on it). */
async function cornerColour(app: App): Promise<string | null> {
  const vp = await app.page.evaluate(() => window.__canvastDebug.viewport());
  const c = await app.page.evaluate((v) => [[2, 2], [v.width - 3, 2], [2, v.height - 3], [v.width - 3, v.height - 3]].map(([x, y]) => window.__canvastDebug.pixelAt(x!, y!).join(",")), vp);
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

test("thickness lock: new strokes keep the same width on the canvas at any zoom; without it they keep the same width on screen", async ({ app }) => {
  const p = app.page;
  const radius = async (id: string): Promise<number | undefined> => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))?.radius;
  const ids = () => p.evaluate(() => window.__canvastDebug.objectFrames().map((o) => o.id));
  const drawn = async (from: { x: number; y: number }, to: { x: number; y: number }): Promise<string> => {
    const before = new Set(await ids());
    await app.drag(from, to, 5);
    return (await ids()).find((i) => !before.has(i))!;
  };
  await p.keyboard.press("p");
  await p.getByRole("button", { name: "Pen width 8 px" }).click();
  const lock = p.getByRole("button", { name: "Lock thickness" });
  await expect(lock).toHaveAttribute("aria-pressed", "false");

  // Reference stroke at home, lock off: 8 px wide.
  const ref = await drawn({ x: 450, y: 395 }, { x: 980, y: 395 });
  expect(await radius(ref)).toBe(4);
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "true");

  // Zoom in 3 levels: strokes scale with the canvas (the reference is 32 px of radius), and a locked stroke matches it.
  await p.evaluate(() => window.__canvastDebug.jump(3));
  expect(await radius(ref)).toBe(32);
  const matched = await drawn({ x: 450, y: 500 }, { x: 980, y: 500 });
  expect(await radius(matched), "same width on the canvas as the reference").toBe(32);

  // Out to home and 2 levels beyond: the locked stroke is the reference's width again, and still equal to it.
  await p.evaluate(() => window.__canvastDebug.jump(-3));
  expect(await radius(matched)).toBe(4);
  await p.evaluate(() => window.__canvastDebug.jump(-2));
  const smaller = await drawn({ x: 450, y: 410 }, { x: 980, y: 410 });
  expect(await radius(smaller)).toBe(1); // 2 px wide at 2^-2: 8 px at home
  await p.evaluate(() => window.__canvastDebug.jump(2));
  expect(await radius(smaller)).toBe(4);

  // Lock off: a new stroke is 8 px on screen again, whatever the zoom.
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await p.evaluate(() => window.__canvastDebug.jump(3));
  const screen = await drawn({ x: 450, y: 400 }, { x: 980, y: 400 });
  expect(await radius(screen)).toBe(4);
  expect(await radius(ref), "the reference still scales with the canvas").toBe(32);

  // A new pen size while locked is the new reference, at the zoom where it was chosen.
  await lock.click();
  await p.getByRole("button", { name: "Pen width 3 px" }).click();
  const thin = await drawn({ x: 450, y: 380 }, { x: 980, y: 380 });
  expect(await radius(thin)).toBe(1.5);
  await p.evaluate(() => window.__canvastDebug.jump(-3));
  expect(await radius(thin)).toBe(0.1875);

  // The slider gives any size from 0.5 to 128 px, and it is the new reference too.
  const setSize = (v: number) => p.evaluate((x) => {
    const el = document.querySelector<HTMLInputElement>("[data-size]")!;
    el.value = String(x);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);
  await p.evaluate(() => window.__canvastDebug.jump(3));
  await setSize(100);
  await expect(p.locator("[data-size-out]")).toHaveText("128 px");
  const big = await drawn({ x: 450, y: 420 }, { x: 980, y: 420 });
  expect(await radius(big)).toBe(64);
  await setSize(0);
  await expect(p.locator("[data-size-out]")).toHaveText("0.5 px");
  const tiny = await drawn({ x: 450, y: 440 }, { x: 980, y: 440 });
  expect(await radius(tiny)).toBe(0.25);
  await p.evaluate(() => window.__canvastDebug.jump(-3)); // out 3 levels: the sizes scale with the canvas
  expect(await radius(big)).toBe(8);
  expect(await radius(tiny)).toBe(0.03125);

  // The lock keeps following far out and far in (not just a few levels), and far beyond it holds: drawing stays fast.
  await setSize(50);
  for (const levels of [-40, 100, 900]) {
    await p.evaluate((d) => window.__canvastDebug.jump(d), levels);
    const t0 = Date.now();
    const id = await drawn({ x: 450, y: 380 + (levels > 0 ? 10 : 0) }, { x: 980, y: 380 + (levels > 0 ? 10 : 0) });
    expect(Date.now() - t0, `${levels}`).toBeLessThan(2500);
    expect(await radius(id), `drawn ${levels} levels away`).toBeGreaterThan(0);
  }
  await p.evaluate(() => window.__canvastDebug.jump(1e12));
  const t0 = Date.now();
  const far = await drawn({ x: 450, y: 350 }, { x: 980, y: 350 });
  expect(await radius(far)).toBeGreaterThan(0);
  expect(Date.now() - t0, "a trillion levels away").toBeLessThan(2500);
});

test("stabilizer: hand wobble does not reach the stroke (at home and a trillion levels down); off draws every wobble", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  const stab = p.getByRole("button", { name: "Stabilizer" });
  const strength = p.locator("[data-strength]");
  await expect(stab).toHaveAttribute("aria-pressed", "false");
  await expect(strength).toBeHidden();
  const wobble = async (y: number): Promise<{ spread: number; end: number }> => {
    const before = new Set((await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id));
    await p.mouse.move(400, y);
    await p.mouse.down();
    for (let i = 1; i <= 40; i++) await p.mouse.move(400 + i * 12, y + (i % 2 ? 7 : -7));
    await p.mouse.up();
    await app.frame();
    const id = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id).find((i) => !before.has(i))!;
    const q = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.q;
    const ys = q.filter((_, i) => i % 2 === 1);
    return { spread: Math.max(...ys) - Math.min(...ys), end: q[q.length - 2]! };
  };
  const setStrength = (v: number) => p.evaluate((x) => {
    const el = document.querySelector<HTMLInputElement>("[data-strength]")!;
    el.value = String(x);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);

  for (const depth of [0, 1e12]) {
    if (depth) await p.evaluate((d) => window.__canvastDebug.jump(d), depth);
    const off = await wobble(300);
    expect(off.spread, `${depth}: every wobble is drawn`).toBeGreaterThan(12);
    await stab.click();
    await expect(stab).toHaveAttribute("aria-pressed", "true");
    await expect(strength).toBeVisible();
    await setStrength(50); // a 30 px rope
    const on = await wobble(500);
    expect(on.spread, `${depth}: the rope hides 7 px wobble`).toBeLessThan(3);
    expect(on.end, `${depth}: the tip follows the drag (rope behind the pointer)`).toBeGreaterThan(400 + 40 * 12 - 31);
    await setStrength(1); // 0.6 px rope: nearly the pointer
    expect((await wobble(600)).spread, `${depth}: a short rope barely smooths`).toBeGreaterThan(10);
    await stab.click(); // off again for the next round
  }
});

test("pen size follows zoom: drawing while zooming keeps the pen's screen size (pieces of different widths), in one undo step; off or locked, one stroke", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await p.getByRole("button", { name: "Pen width 8 px" }).click();
  const follow = p.getByRole("button", { name: "Pen size follows zoom" });
  const lock = p.getByRole("button", { name: "Lock thickness" });
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  const ids = () => p.evaluate(() => window.__canvastDebug.objectFrames().map((o) => o.id));
  const radii = async (): Promise<Array<number | undefined>> =>
    Promise.all((await ids()).map(async (i) => (await p.evaluate((x) => window.__canvastDebug.objectScreen(x), i))?.radius));
  /** Draw a line, zooming in `levels` half way through (the camera zooms about the view centre, so the line is kept near it). */
  const stroke = async (y: number, levels: number): Promise<void> => {
    await p.mouse.move(600, y);
    await p.mouse.down();
    await p.mouse.move(640, y, { steps: 4 });
    await p.evaluate((d) => window.__canvastDebug.jump(d), levels);
    await p.mouse.move(641, y, { steps: 2 });
    await p.mouse.move(680, y, { steps: 4 });
    await p.mouse.up();
    await app.frame();
  };

  // Off: one stroke, one width, which scales with the canvas (8 px at home is 64 px of radius 3 levels in... radius 32).
  await stroke(400, 3);
  expect(await ids()).toHaveLength(1);
  expect(await radii()).toEqual([32]);
  await p.evaluate(() => window.__canvastDebug.jump(-3));

  // On: the part drawn after zooming in is 8 px again on screen, so the line is made of pieces.
  await p.keyboard.press("Control+z");
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await stroke(400, 3);
  const after = await ids();
  expect(after.length, "pieces").toBeGreaterThan(1);
  const r = (await radii()).map((x) => x ?? 0);
  expect(r[0], "the part drawn before zooming is magnified with the canvas").toBe(32);
  expect(r[r.length - 1]!, "the last piece is the pen's size on screen").toBeGreaterThanOrEqual(3.9);
  expect(r[r.length - 1]!).toBeLessThanOrEqual(4 * 2 ** 0.25 + 0.01);
  expect(r.every((x, i) => i === 0 || x <= r[i - 1]! + 1e-9), "narrowing along the line").toBe(true);
  // One undo takes the whole stroke away; redo brings it back.
  await p.keyboard.press("Control+z");
  expect(await ids()).toHaveLength(0);
  await p.keyboard.press("Control+y");
  expect(await ids()).toHaveLength(after.length);
  await p.keyboard.press("Control+z");
  await p.evaluate(() => window.__canvastDebug.jump(-3));

  // With the lock the width is the same on the canvas anyway: one stroke even with the option on.
  await lock.click();
  await stroke(400, 3);
  expect(await ids()).toHaveLength(1);
  await p.keyboard.press("Control+z");
  await p.evaluate(() => window.__canvastDebug.jump(-3));

  // A huge jump mid-stroke (a trillion levels): fast, still one undo step.
  await lock.click();
  const t0 = Date.now();
  await stroke(400, 1e12);
  expect(Date.now() - t0).toBeLessThan(5000);
  expect((await ids()).length).toBeGreaterThan(1);
  await p.keyboard.press("Control+z");
  expect(await ids()).toHaveLength(0);
});

test("thickness lock on resize: dragging a handle scales a stroke's shape but keeps its line width; without the lock the width scales too", async ({ app }) => {
  const p = app.page;
  const info = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!;
  await p.keyboard.press("p");
  await p.getByRole("button", { name: "Pen width 8 px" }).click();
  await app.drag({ x: 400, y: 380 }, { x: 560, y: 460 }, 6);
  const [id] = await p.evaluate(() => window.__canvastDebug.objectFrames().map((o) => o.id));
  await p.keyboard.press("v");
  const lock = p.getByRole("button", { name: "Lock thickness" });
  await expect(lock, "the lock is on the select tool's bar too").toBeVisible();

  const resize = async (): Promise<{ before: Awaited<ReturnType<typeof info>>; after: Awaited<ReturnType<typeof info>> }> => {
    await p.mouse.click(480, 420);
    const before = await info(id!);
    await app.drag({ x: Math.round(before.box.maxX), y: Math.round(before.box.maxY) }, { x: Math.round(before.box.maxX) + 80, y: Math.round(before.box.maxY) + 40 }, 6);
    return { before, after: await info(id!) };
  };

  // Lock off: the width scales with the shape.
  const off = await resize();
  const grew = (off.after.box.maxX - off.after.box.minX) / (off.before.box.maxX - off.before.box.minX);
  expect(grew).toBeGreaterThan(1.3);
  expect(off.after.radius).toBeCloseTo(off.before.radius * grew, 0);
  await p.keyboard.press("Control+z");
  expect((await info(id!)).radius).toBe(off.before.radius);

  // Lock on: the shape grows, the line stays 8 px.
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  const on = await resize();
  expect((on.after.box.maxX - on.after.box.minX) / (on.before.box.maxX - on.before.box.minX)).toBeGreaterThan(1.3);
  expect(on.after.radius, "line width unchanged").toBe(on.before.radius);
  // One undo returns the exact original; redo the resized one.
  await p.keyboard.press("Control+z");
  expect(await info(id!)).toEqual(on.before);
  await p.keyboard.press("Control+y");
  expect(await info(id!)).toEqual(on.after);

  // Far out and deep the same holds (a trillion levels down).
  await p.evaluate(() => window.__canvastDebug.jump(1e12));
  await p.keyboard.press("p");
  await lock.click(); // off for drawing (a locked brush this far from where the lock was set is astronomically wide)
  await app.drag({ x: 400, y: 380 }, { x: 560, y: 460 }, 6);
  const deep = (await p.evaluate(() => window.__canvastDebug.objectFrames().map((o) => o.id))).find((i) => i !== id)!;
  await p.keyboard.press("v");
  await lock.click(); // on for resizing
  await p.mouse.click(480, 420);
  const d0 = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), deep))!;
  await app.drag({ x: Math.round(d0.box.maxX), y: Math.round(d0.box.maxY) }, { x: Math.round(d0.box.maxX) + 60, y: Math.round(d0.box.maxY) + 30 }, 6);
  const d1 = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), deep))!;
  expect(d1.box.maxX - d1.box.minX).toBeGreaterThan(d0.box.maxX - d0.box.minX + 20);
  expect(d1.radius).toBe(d0.radius);
});

test("colour at depth: zoomed 10^6, 10^9 and 10^12 levels into an image or a letter, its colour is still there (every kind of object, not just strokes)", async ({ app }) => {
  const p = app.page;
  const px = (pts: number[][]) => p.evaluate((ps) => ps.map(([x, y]) => window.__canvastDebug.pixelAt(x!, y!).join(",")), pts);

  // An image: its centre is a source-pixel corner, so four pixels meet at the view centre.
  await p.getByTestId("import-input").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer: blockyFixture() });
  await p.waitForFunction(() => window.__canvastDebug.objects().length === 1);
  await p.evaluate(() => window.__canvastDebug.jump(6)); // 64 px per source pixel
  await p.keyboard.press("h");
  await app.drag({ x: 600, y: 420 }, { x: 630, y: 400 }, 4); // the corner is now at (670, 380): four pixels around it
  const around = [[650, 360], [690, 360], [650, 400], [690, 400]];
  await app.frame();
  const home = await px(around);
  expect(new Set(home).size, "four different source pixels").toBeGreaterThan(1);
  await p.keyboard.press("Home"); // exactly on the corner again (the pan above moved the camera off it)
  await app.frame();
  for (const depth of [1e6, 1e9, 1e12]) {
    await p.evaluate((d) => window.__canvastDebug.jump(d), depth);
    await app.drag({ x: 600, y: 420 }, { x: 630, y: 400 }, 4); // (a pan of 30, -20 px at this depth too)
    await app.frame();
    await app.frame();
    expect(await px(around), `image, ${depth} levels in: the same four pixels`).toEqual(home);
    await p.keyboard.press("Home");
  }

  // A letter: inside its stem the view is the text colour at any depth.
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Delete");
  await p.keyboard.press("t");
  await p.getByRole("button", { name: "Pen colour #dc2626" }).click();
  await p.mouse.click(600, 400);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await p.keyboard.type("HHH");
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("text-editor")).toBeHidden();
  await p.evaluate(() => window.__canvastDebug.jump(5));
  await app.frame();
  // Find a spot well inside a red stem (a 9×9 patch of red), and bring it to the view centre.
  const spot = await p.evaluate(() => {
    const red = (x: number, y: number): boolean => {
      const [r, g, b] = window.__canvastDebug.pixelAt(x, y);
      return r > 180 && g < 90 && b < 90;
    };
    for (let y = 120; y < 700; y += 6) for (let x = 360; x < 1000; x += 6) if ([-8, 0, 8].every((dy) => [-8, 0, 8].every((dx) => red(x + dx, y + dy)))) return [x, y];
    return null;
  });
  expect(spot, "a red stem was found").not.toBeNull();
  await p.keyboard.press("h");
  await app.drag({ x: spot![0]!, y: spot![1]! }, { x: 640, y: 400 }, 6);
  await app.frame();
  const red = (await px([[640, 400]]))[0]!;
  for (const depth of [1e6, 1e9, 1e12]) {
    await p.evaluate((d) => window.__canvastDebug.jump(d), depth);
    await app.frame();
    await app.frame();
    expect(await px([[640, 400], [10, 10], [1270, 790], [10, 790], [1270, 10]]), `letter, ${depth} levels in`).toEqual([red, red, red, red, red]);
    await p.evaluate((d) => window.__canvastDebug.jump(-d), depth);
  }
});

test("option: ignore the object that fills the view, so zooming far into something cannot select it by accident", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await p.getByRole("button", { name: "Pen width 8 px" }).click();
  await app.drag({ x: 300, y: 400 }, { x: 980, y: 400 }, 6);
  const [id] = await p.evaluate(() => window.__canvastDebug.objectFrames().map((o) => o.id));
  await p.keyboard.press("v");
  const ignore = p.getByRole("button", { name: "Ignore the object that fills the view" });
  await expect(ignore).toHaveAttribute("aria-pressed", "false");
  const selected = () => p.evaluate(() => window.__canvastDebug.selection());
  // A band that does not fill the view (3 levels in: 64 px wide) stays selectable with the option on.
  await ignore.click();
  await p.evaluate(() => window.__canvastDebug.jump(3));
  await p.mouse.click(700, 402);
  expect(await selected(), "3 levels in: a 64 px band does not fill the view").toEqual([id]);
  await p.keyboard.press("Escape");
  await ignore.click();
  await p.evaluate(() => window.__canvastDebug.jump(-3));
  for (const depth of [30, 5_000, 1e6, 1e12]) {
    await p.evaluate((d) => window.__canvastDebug.jump(d), depth);
    await app.frame();
    // Off: the view is inside the stroke and a click picks it (as before).
    await p.mouse.click(700, 402);
    expect(await selected(), `${depth}: off`).toEqual([id]);
    await p.keyboard.press("Escape");
    // On: it is ignored by a click, by Ctrl+A-free lasso and box select too.
    if ((await ignore.getAttribute("aria-pressed")) === "false") await ignore.click();
    await p.mouse.click(700, 402);
    expect(await selected(), `${depth}: on`).toEqual([]);
    await app.drag({ x: 500, y: 300 }, { x: 800, y: 600 }, 6);
    expect(await selected(), `${depth}: box select`).toEqual([]);
    await ignore.click(); // off again
    await expect(ignore).toHaveAttribute("aria-pressed", "false");
    await p.evaluate((d) => window.__canvastDebug.jump(-d), depth);
  }
  // At home the stroke is a line: with the option on, it is still selectable (it does not fill the view).
  await ignore.click();
  await p.mouse.click(640, 400);
  expect(await selected()).toEqual([id]);
});

test("an edge in view past 100,000 levels is drawn as a dimmed approximate fill, not nothing (ADR 0016)", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await p.getByRole("button", { name: "Pen width 8 px" }).click();
  await app.drag({ x: 300, y: 400 }, { x: 980, y: 400 }, 6);
  const [id] = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id);
  const bg = (await p.evaluate(() => window.__canvastDebug.pixelAt(20, 20))).join(",");
  const ink = (await p.evaluate(() => window.__canvastDebug.pixelAt(640, 400))).join(",");
  // The stroke's lower edge, exactly: centre the camera on it at home, then dive with jumps (about the centre).
  const edge = await app.worldAt(640, 404);
  await p.keyboard.press("v");
  for (const depth of [5e4, 2e5, 1e6, 1e12]) {
    await p.evaluate(([x, y]) => window.__canvastDebug.setCamera({ cx: x!, cy: y!, zi: 0, zf: 0, pz: 0 }), [edge.x, edge.y]);
    await p.evaluate((d) => window.__canvastDebug.jump(d), depth);
    await app.frame();
    await app.frame();
    expect(await state(app, id!), `${depth}: the edge is at the view centre`).toBe("exact");
    if (depth <= 1e5) {
      expect(await cornerColour(app), `${depth}: exact path draws the real edge`).toBeNull();
      continue;
    }
    const c = await cornerColour(app);
    expect(c, `${depth}: one dimmed colour over the view`).not.toBeNull();
    expect(c, `${depth}: not the background`).not.toBe(bg);
    expect(c, `${depth}: dimmer than the stroke itself`).not.toBe(ink);
  }
});

test("size slider on Select sets the thickness of the selected strokes in one undo step; on Pen it leaves them alone", async ({ app }) => {
  const p = app.page;
  const radius = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.radius;
  await p.keyboard.press("p");
  await app.drag({ x: 400, y: 380 }, { x: 560, y: 460 }, 6);
  const [id] = (await p.evaluate(() => window.__canvastDebug.objectFrames().map((o) => o.id)));
  const r0 = await radius(id!);
  const setSize = (v: number) =>
    p.evaluate((x) => {
      const el = document.querySelector<HTMLInputElement>("[data-size]")!;
      el.value = String(x);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true })); // a release
    }, v);
  await setSize(80); // pen tool: only the pen changes
  expect(await radius(id!)).toBe(r0);
  await p.keyboard.press("v");
  await p.mouse.click(480, 420);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([id]);
  await setSize(20);
  await setSize(80);
  await app.frame();
  expect(await radius(id!), "thicker").toBeGreaterThan(r0 * 3);
  await p.keyboard.press("Control+z");
  await p.keyboard.press("Control+z");
  expect(await radius(id!), "each change is one undo step; two undos restore the original").toBe(r0);
});

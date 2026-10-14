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

test("pen and select options come back after a reload (device settings, ADR 0017)", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await p.getByRole("button", { name: "Pen colour #2563eb" }).click();
  await p.getByRole("button", { name: "Pen width 8 px" }).click();
  await p.getByRole("button", { name: "Stabilizer", exact: true }).click();
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.keyboard.press("p");
  await expect(p.getByRole("button", { name: "Pen colour #2563eb" })).toHaveClass(/is-on/);
  await expect(p.getByRole("button", { name: "Pen width 8 px" })).toHaveClass(/is-on/);
  await expect(p.getByRole("button", { name: "Stabilizer", exact: true })).toHaveAttribute("aria-pressed", "true");
});

/** Drag an object's rotate handle (26 px above the selection box) to the right of its centre: a quarter turn clockwise. */
async function turnQuarter(app: App, id: string): Promise<void> {
  const b = (await boxOf(app, id))!;
  const cx = Math.round((b.minX + b.maxX) / 2);
  const cy = Math.round((b.minY + b.maxY) / 2);
  await app.drag({ x: cx, y: Math.round(b.minY) - 26 }, { x: cx + Math.round(cy - b.minY) + 26, y: cy }, 8);
}

test("rotate a stroke with its handle: the shape turns, picking follows, one undo step, it survives a reload and works a trillion levels down (ADR 0018)", async ({ app }) => {
  const p = app.page;
  const box = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
  const rotateQuarter = (id: string) => turnQuarter(app, id);
  for (const deep of [false, true]) {
    if (deep) await p.evaluate(() => window.__canvastDebug.jump(1e12));
    await p.keyboard.press("p");
    await app.drag({ x: 500, y: 400 }, { x: 740, y: 420 }, 6); // a wide, flat stroke
    const id = (await p.evaluate(() => window.__canvastDebug.objectFrames())).at(-1)!.id;
    await p.keyboard.press("v");
    await p.mouse.click(620, 410);
    const flat = await box(id);
    expect(flat.maxX - flat.minX).toBeGreaterThan((flat.maxY - flat.minY) * 4);
    await rotateQuarter(id);
    const tall = await box(id);
    expect(tall.maxY - tall.minY, "now taller than wide").toBeGreaterThan((tall.maxX - tall.minX) * 4);
    const rot = (await p.evaluate(() => window.__canvastDebug.storedObjects())).find((o) => o.id === id)!["rot"];
    expect(rot as number, "a quarter turn, to the nearest whole angle").toBeGreaterThan(2 ** 30 * 0.97);
    expect(rot as number).toBeLessThan(2 ** 30 * 1.03);
    // Picking follows the rotated stroke: its old horizontal middle is empty now, its new vertical middle is not.
    await p.keyboard.press("Escape");
    await p.mouse.click(Math.round(flat.minX) + 8, Math.round((flat.minY + flat.maxY) / 2));
    expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([]);
    await p.mouse.click(Math.round((tall.minX + tall.maxX) / 2), Math.round((tall.minY + tall.maxY) / 2));
    expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([id]);
    // One undo step, exactly back.
    await p.keyboard.press("Control+z");
    expect(await box(id)).toEqual(flat);
    await p.keyboard.press("Control+y");
    expect(await box(id)).toEqual(tall);
    // Saved and reloaded (the view is saved with it).
    expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
    await p.reload();
    await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
    await p.evaluate(() => window.__canvastDebug.nextFrame());
    expect(await box(id)).toEqual(tall);
    await p.keyboard.press("Control+a");
    await p.keyboard.press("Delete");
    await p.evaluate(() => window.__canvastDebug.nextFrame());
    await p.keyboard.press("Home");
  }
});

test("rotate an image and a text: drawn turned, picked turned, exact pixels deep inside, one undo step (ADR 0018)", async ({ app }) => {
  const p = app.page;
  const px = (pts: number[][]) => p.evaluate((ps) => ps.map(([x, y]) => window.__canvastDebug.pixelAt(x!, y!).join(",")), pts);
  // An image: four different source pixels meet at its centre.
  await p.getByTestId("import-input").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer: blockyFixture() });
  await p.waitForFunction(() => window.__canvastDebug.objects().length === 1);
  const id = (await p.evaluate(() => window.__canvastDebug.objectFrames()))[0]!.id;
  await p.mouse.click(640, 400);
  await app.frame();
  const flat = (await boxOf(app, id))!;
  // (Sampled with nothing selected: the handles are drawn over the corners.)
  await p.keyboard.press("Escape");
  await app.frame();
  const topLeft = (await px([[flat.minX + 14, flat.minY + 14]]))[0]!;
  await p.mouse.click(640, 400);
  await turnQuarter(app, id);
  await p.keyboard.press("Escape");
  await app.frame();
  const turned = (await boxOf(app, id))!;
  expect(turned.maxX - turned.minX, "width and height swap").toBeCloseTo(flat.maxY - flat.minY, 0);
  expect(turned.maxY - turned.minY).toBeCloseTo(flat.maxX - flat.minX, 0);
  // A quarter turn clockwise moves the top-left corner to the top-right.
  expect((await px([[turned.maxX - 14, turned.minY + 14]]))[0], "the corner colour went with it").toBe(topLeft);
  // Zoomed far into the turned image (more than 64 px per source pixel) the four pixels at its centre are still there.
  const around = [[620, 380], [660, 380], [620, 420], [660, 420]];
  await p.evaluate(() => window.__canvastDebug.jump(6));
  await app.frame();
  const inside = await px(around);
  expect(new Set(inside).size, "four source pixels meet at the centre").toBeGreaterThan(1);
  await p.evaluate(() => window.__canvastDebug.jump(-6));
  await p.keyboard.press("Control+z");
  expect(await boxOf(app, id), "one undo step, exactly back").toEqual(flat);

  // A text.
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Delete");
  await p.keyboard.press("t");
  await p.mouse.click(500, 400);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await p.keyboard.type("HHHH HHHH");
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("text-editor")).toBeHidden();
  const tid = (await p.evaluate(() => window.__canvastDebug.objectFrames())).at(-1)!.id;
  await p.keyboard.press("v");
  const tb = (await boxOf(app, tid))!;
  await p.mouse.click(Math.round((tb.minX + tb.maxX) / 2), Math.round((tb.minY + tb.maxY) / 2));
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([tid]);
  await turnQuarter(app, tid);
  await app.frame();
  const tt = (await boxOf(app, tid))!;
  expect(tt.maxY - tt.minY, "the text now stands up").toBeGreaterThan((tb.maxY - tb.minY) * 1.5);
  expect(tt.maxX - tt.minX).toBeLessThan((tb.maxX - tb.minX) * 0.8);
  expect(await p.evaluate(() => window.__canvastDebug.inkedPixels(2)), "it is drawn").toBeGreaterThan(50);
  await p.keyboard.press("Escape");
  await p.mouse.click(Math.round((tt.minX + tt.maxX) / 2), Math.round((tt.minY + tt.maxY) / 2));
  expect(await p.evaluate(() => window.__canvastDebug.selection()), "picked where it is now").toEqual([tid]);
});

test("snapping: a moved stroke lines up exactly with another one (home and a trillion levels down); the toggle turns it off (ADR 0019)", async ({ app }) => {
  const p = app.page;
  const box = async (id: string) => (await boxOf(app, id))!;
  for (const deep of [false, true]) {
    if (deep) await p.evaluate(() => window.__canvastDebug.jump(1e12));
    await p.keyboard.press("p");
    await app.drag({ x: 400, y: 300 }, { x: 600, y: 300 }, 4);
    await app.drag({ x: 420, y: 500 }, { x: 620, y: 500 }, 4);
    const ids = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id).slice(-2);
    const [a, b] = ids as [string, string];
    await p.keyboard.press("v");
    const snap = p.getByRole("button", { name: "Snap to other objects" });
    await expect(snap).toHaveAttribute("aria-pressed", "true");
    // 20 px apart; move B left by 17: within 6 px of A's left edge, so it jumps to exactly it.
    await app.drag({ x: 520, y: 500 }, { x: 503, y: 500 }, 6);
    expect((await box(b)).minX).toBe((await box(a)).minX);
    await p.keyboard.press("Control+z");
    // Off: the same move lands where the pointer put it.
    await snap.click();
    await expect(snap).toHaveAttribute("aria-pressed", "false");
    await app.drag({ x: 520, y: 500 }, { x: 503, y: 500 }, 6);
    expect((await box(b)).minX - (await box(a)).minX).toBeCloseTo(3, 6);
    await snap.click();
    await p.keyboard.press("Control+a");
    await p.keyboard.press("Delete");
    await p.keyboard.press("Home");
  }
});

test("groups: picking one member picks the group, it moves as one, nests, enters, ungroups, reorders, and survives undo and a reload (ADR 0020)", async ({ app }) => {
  const p = app.page;
  const sel = () => p.evaluate(() => window.__canvastDebug.selection());
  const zs = () => p.evaluate(() => Object.fromEntries(window.__canvastDebug.objects().map((o) => [o.id, o["z"] as number])));
  await p.keyboard.press("p");
  for (const y of [250, 350, 450]) await app.drag({ x: 400, y }, { x: 600, y }, 4);
  const [a, b, c] = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id) as [string, string, string];
  await p.keyboard.press("v");
  await p.mouse.click(500, 250);
  await p.keyboard.down("Shift");
  await p.mouse.click(500, 350);
  await p.keyboard.up("Shift");
  expect(await sel()).toEqual([a, b].sort());
  await p.keyboard.press("Control+g");
  await p.keyboard.press("Escape");
  await p.mouse.click(500, 250);
  expect((await sel()).sort(), "one member picks the group").toEqual([a, b].sort());
  const before = { a: (await boxOf(app, a))!, b: (await boxOf(app, b))!, c: (await boxOf(app, c))! };
  await app.drag({ x: 500, y: 250 }, { x: 560, y: 250 }, 6);
  expect((await boxOf(app, b))!.minX - before.b.minX, "the whole group moved").toBeCloseTo(60, 4);
  expect((await boxOf(app, c))!, "the loose stroke did not").toEqual(before.c);
  // Nest: group the group with the loose stroke; entering goes one level at a time.
  await p.mouse.click(500, 450);
  await p.keyboard.down("Shift");
  await p.mouse.click(560, 250);
  await p.keyboard.up("Shift");
  await p.keyboard.press("Control+g");
  await p.keyboard.press("Escape");
  await p.mouse.click(500, 450);
  expect((await sel()).sort(), "the outer group").toEqual([a, b, c].sort());
  await p.mouse.dblclick(560, 250);
  expect((await sel()).sort(), "entered: the inner group").toEqual([a, b].sort());
  await p.keyboard.press("Control+Shift+g"); // ungroup the inner level
  await p.mouse.click(560, 250);
  expect(await sel(), "a is loose inside the outer group now").toEqual([a]);
  await p.keyboard.press("Control+z"); // undo the ungroup: the inner group is back
  await p.mouse.click(560, 250);
  expect((await sel()).sort()).toEqual([a, b].sort());
  // Arrange: the picked group goes behind everything, in the same order among its members.
  const z0 = await zs();
  await p.keyboard.press("Control+[");
  const z1 = await zs();
  expect(z1[a]! < z1[c]! && z1[b]! < z1[c]!, "behind the loose stroke").toBe(true);
  expect(z1[a]! < z1[b]!, "a is still below b").toBe(true);
  expect(z0[a]! < z0[b]!).toBe(true);
  // Saved with the objects: after a reload one click still picks the whole outer group.
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  await p.mouse.click(500, 450);
  expect((await sel()).sort()).toEqual([a, b, c].sort());
});

test("hide and lock: a hidden object is not drawn or picked, a locked one is drawn but cannot be picked; both undo, save, and come back with the Show all and Unlock all buttons (ADR 0021)", async ({ app }) => {
  const p = app.page;
  const sel = () => p.evaluate(() => window.__canvastDebug.selection());
  const ink = () => p.evaluate(() => window.__canvastDebug.inkedPixels(2));
  const none = await ink();
  await p.keyboard.press("p");
  await app.drag({ x: 400, y: 300 }, { x: 800, y: 300 }, 6);
  const drawn = await ink();
  expect(drawn).toBeGreaterThan(none);
  await p.keyboard.press("v");
  await p.mouse.click(600, 300);
  await p.getByRole("button", { name: "Hide", exact: true }).click();
  await app.frame();
  expect(await ink(), "not drawn").toBe(none);
  expect(await sel(), "not selected").toEqual([]);
  await p.mouse.click(600, 300);
  expect(await sel(), "not picked").toEqual([]);
  await p.keyboard.press("Control+z");
  await app.frame();
  expect(await ink(), "undo brings it back").toBe(drawn);
  await p.getByRole("button", { name: "Hide", exact: true }).click(); // nothing selected: no change
  await p.mouse.click(600, 300);
  await p.getByRole("button", { name: "Hide", exact: true }).click();
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await app.frame();
  expect(await ink(), "still hidden after a reload").toBe(none);
  await p.getByRole("button", { name: "Show all hidden" }).click();
  await app.frame();
  expect(await ink()).toBe(drawn);
  // Locked: drawn, but a click, a box and select-all all miss it.
  await p.mouse.click(600, 300);
  await p.getByRole("button", { name: "Lock", exact: true }).click();
  await p.mouse.click(600, 300);
  expect(await sel()).toEqual([]);
  await app.drag({ x: 350, y: 250 }, { x: 850, y: 350 }, 6);
  expect(await sel(), "a box around it does not take it").toEqual([]);
  await p.keyboard.press("Control+a");
  expect(await sel(), "select all skips it").toEqual([]);
  expect(await ink(), "still drawn").toBe(drawn);
  await p.getByRole("button", { name: "Unlock all" }).click();
  await p.mouse.click(600, 300);
  expect((await sel()).length).toBe(1);
});

test("object eraser: a fast swipe takes what the brush crosses once, whole groups or only members, never locked objects, in one undo step (ADR 0022)", async ({ app }) => {
  const p = app.page;
  const count = () => p.evaluate(() => window.__canvastDebug.objects().length);
  await p.keyboard.press("p");
  for (const y of [250, 350, 450]) await app.drag({ x: 400, y }, { x: 600, y }, 4);
  const [, b, c] = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id) as [string, string, string];
  await p.keyboard.press("v");
  await p.mouse.click(500, 250);
  await p.keyboard.down("Shift");
  await p.mouse.click(500, 350);
  await p.keyboard.up("Shift");
  await p.keyboard.press("Control+g");
  await p.mouse.click(500, 450);
  await p.getByRole("button", { name: "Lock", exact: true }).click();
  await p.keyboard.press("Escape");
  await p.keyboard.press("e");
  await expect(p.getByRole("radio", { name: /Object eraser/ })).toHaveAttribute("aria-checked", "true");
  // One pointer jump from y=200 to y=300 crosses only the first stroke; as a group both go.
  await app.drag({ x: 500, y: 200 }, { x: 500, y: 300 }, 1);
  expect(await count(), "the group went, the locked stroke stayed").toBe(1);
  await p.keyboard.press("Control+z");
  expect(await count(), "one undo brings the group back").toBe(3);
  // Members only: the swipe takes just the stroke it crosses.
  await p.getByRole("button", { name: "Erase whole groups" }).click();
  await app.drag({ x: 500, y: 200 }, { x: 500, y: 300 }, 1);
  const left = (await p.evaluate(() => window.__canvastDebug.objects())).map((o) => o.id);
  expect(left.sort()).toEqual([b, c].sort());
  // A swipe across everything still leaves the locked stroke, and a swipe over nothing takes nothing.
  await app.drag({ x: 500, y: 200 }, { x: 500, y: 520 }, 1);
  expect((await p.evaluate(() => window.__canvastDebug.objects())).map((o) => o.id)).toEqual([c]);
  await app.drag({ x: 900, y: 200 }, { x: 900, y: 520 }, 3);
  expect(await count()).toBe(1);
});

test("backend recovery: after the drawing surface is lost and restored the picture, the camera and editing come back (ADR 0023)", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await app.drag({ x: 400, y: 300 }, { x: 800, y: 340 }, 6);
  await p.evaluate(() => window.__canvastDebug.jump(3));
  await app.frame();
  const cam = await app.camera();
  const ink = await p.evaluate(() => window.__canvastDebug.inkedPixels(2));
  expect(ink).toBeGreaterThan(100);
  // The browser's own events, fired by hand (a real loss cannot be forced from a test).
  const prevented = await p.evaluate(() => {
    const c = document.getElementById("canvas")!;
    const lost = new Event("contextlost", { cancelable: true });
    c.dispatchEvent(lost);
    c.dispatchEvent(new Event("contextrestored"));
    return lost.defaultPrevented;
  });
  expect(prevented, "the loss is acknowledged so the browser may restore the surface").toBe(true);
  await app.frame();
  await app.frame();
  expect(await p.evaluate(() => window.__canvastDebug.inkedPixels(2)), "the same picture").toBe(ink);
  expect(await app.camera(), "the same view").toEqual(cam);
  await app.drag({ x: 400, y: 500 }, { x: 800, y: 540 }, 6); // and editing still works
  expect((await p.evaluate(() => window.__canvastDebug.objects())).length).toBe(2);
});

test("layers panel: lists objects front to back, selects, hides and locks from its rows, reorders by dragging, and can be hidden (ADR 0024)", async ({ app }) => {
  const p = app.page;
  const panel = p.getByTestId("layers-panel");
  await expect(panel).toBeHidden();
  await p.getByRole("button", { name: "Layers panel" }).click();
  await expect(panel).toBeVisible();
  await expect(panel.locator("li.layer")).toHaveCount(0);
  await p.keyboard.press("p");
  for (const y of [250, 350, 450]) await app.drag({ x: 400, y }, { x: 600, y }, 4);
  const ids = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id); // back to front
  const rows = panel.locator("li.layer");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-key", ids[2]!); // front first
  await expect(rows.nth(2)).toHaveAttribute("data-key", ids[0]!);
  // Click selects; the eye hides (and unselects), the lock locks.
  const ink = () => p.evaluate(() => window.__canvastDebug.inkedPixels(2));
  const withAll = await ink(); // measured with nothing selected: selection outlines add ink
  await rows.nth(1).click();
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([ids[1]]);
  await rows.nth(1).getByRole("button", { name: /^Hide / }).click();
  await app.frame();
  expect(await ink(), "the hidden stroke is not drawn").toBeLessThan(withAll);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([]);
  await rows.nth(1).getByRole("button", { name: /^Show / }).click();
  await app.frame();
  expect(await ink()).toBe(withAll);
  await rows.nth(0).getByRole("button", { name: /^Lock / }).click();
  await p.keyboard.press("v");
  await p.mouse.click(500, 450);
  expect(await p.evaluate(() => window.__canvastDebug.selection()), "a locked layer is not picked on the canvas").toEqual([]);
  // Drag the back row onto the front row: it moves in front.
  const z = () => p.evaluate(() => Object.fromEntries(window.__canvastDebug.objects().map((o) => [o.id, o["z"] as number])));
  await rows.nth(2).dragTo(rows.nth(0));
  const z1 = await z();
  expect(z1[ids[0]!]! > z1[ids[2]!]!, "now in front of the one that was in front").toBe(true);
  await p.keyboard.press("Control+z");
  expect((await z())[ids[0]!]!, "undo puts it back").toBeLessThan((await z())[ids[1]!]!);
  // Hide the panel with its close button; the state is kept after a reload.
  await panel.getByRole("button", { name: "Hide the Layers panel" }).click();
  await expect(panel).toBeHidden();
  await p.getByRole("button", { name: "Layers panel" }).click();
  await expect(panel).toBeVisible();
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(p.getByTestId("layers-panel")).toBeVisible();
});

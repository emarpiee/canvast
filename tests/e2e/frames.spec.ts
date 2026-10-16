import { expect, recordMetric, test } from "./harness";
import type { App } from "./harness";
import { blockyFixture, makePng } from "./png";
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
  // One pixel in the middle of the stroke: drawn or not (a count of all inked pixels moves with tile and direct drawing).
  const ink = () => p.evaluate(() => window.__canvastDebug.pixelAt(600, 300).join(","));
  const none = await ink();
  await p.keyboard.press("p");
  await app.drag({ x: 400, y: 300 }, { x: 800, y: 300 }, 6);
  const drawn = await ink();
  expect(drawn).not.toBe(none);
  await p.keyboard.press("v");
  await p.mouse.click(600, 300);
  await p.getByTestId("context-bar").getByRole("button", { name: "Hide selection" }).click();
  await app.frame();
  expect(await ink(), "not drawn").toBe(none);
  expect(await sel(), "not selected").toEqual([]);
  await p.mouse.click(600, 300);
  expect(await sel(), "not picked").toEqual([]);
  await p.keyboard.press("Control+z");
  await app.frame();
  expect(await ink(), "undo brings it back").toBe(drawn);
  await expect(p.getByTestId("context-bar"), "nothing selected: no selection bar").toBeHidden();
  await p.mouse.click(600, 300);
  await p.getByTestId("context-bar").getByRole("button", { name: "Hide selection" }).click();
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await app.frame();
  await expect.poll(ink, { message: "still hidden after a reload (the canvas is painted again once the saved canvas has loaded)" }).toBe(none);
  await p.getByRole("button", { name: "Show all hidden" }).click();
  await app.frame();
  expect(await ink()).toBe(drawn);
  // Locked: drawn, but a click, a box and select-all all miss it.
  await p.mouse.click(600, 300);
  await p.getByTestId("context-bar").getByRole("button", { name: "Lock selection" }).click();
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
  await p.getByTestId("context-bar").getByRole("button", { name: "Lock selection" }).click();
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
  // One pixel in the middle of the second stroke (a count of all inked pixels moves with tile and direct drawing).
  const ink = () => p.evaluate(() => window.__canvastDebug.pixelAt(500, 350).join(","));
  const withAll = await ink();
  await rows.nth(1).click();
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([ids[1]]);
  await rows.nth(1).getByRole("button", { name: /^Hide / }).click();
  await app.frame();
  expect(await ink(), "the hidden stroke is not drawn").not.toBe(withAll);
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
  // Opacity slider acts on the selection, one undo step per release.
  const opacityOf = () => p.evaluate((id) => window.__canvastDebug.objects().find((o) => o.id === id)!["opacity"] as number, ids[1]!);
  await expect(panel.locator("[data-opacity]")).toBeDisabled();
  await rows.nth(1).click();
  await panel.locator("[data-opacity]").fill("40");
  expect(await opacityOf()).toBeCloseTo(0.4);
  await p.keyboard.press("Control+z");
  expect(await opacityOf()).toBe(1);
  // Blend mode (ADR 0047): set from the panel, one undo step, kept with the object.
  const field = (id: string, k: string) => p.evaluate(([i, key]) => window.__canvastDebug.objects().find((o) => o.id === i)![key!], [id, k] as const);
  const before = await ink();
  await panel.locator("[data-blend]").selectOption("difference");
  await app.frame();
  expect(await ink(), "the blend mode changes the pixels (the view is drawn directly, not from tiles)").not.toBe(before);
  await panel.locator("[data-blend]").selectOption("multiply");
  expect(await field(ids[1]!, "blend")).toBe("multiply");
  await app.frame();
  await p.keyboard.press("Control+z");
  expect(await field(ids[1]!, "blend"), "undo is one step").toBe("difference");
  await p.keyboard.press("Control+y");
  expect(await field(ids[1]!, "blend")).toBe("multiply");
  // Rename a layer by double-clicking its name; an empty name goes back to the automatic one.
  await rows.nth(1).locator(".layer-name").dblclick();
  await panel.locator("[data-rename]").fill("sky line");
  await p.keyboard.press("Enter");
  await expect(rows.nth(1).locator(".layer-name")).toHaveText("sky line");
  expect(await field(ids[1]!, "name")).toBe("sky line");
  // Group two layers and name the group.
  await rows.nth(0).click();
  await rows.nth(2).click({ modifiers: ["Shift"] });
  await p.getByTestId("context-bar").getByRole("button", { name: "Group", exact: true }).click();
  const group = panel.locator('li.layer[data-group="true"]');
  await group.locator(".layer-name").dblclick();
  await panel.locator("[data-rename]").fill("pair");
  await p.keyboard.press("Enter");
  await expect(group.locator(".layer-name")).toHaveText("pair");
  // Hide the panel with its close button; the state is kept after a reload.
  await panel.getByRole("button", { name: "Hide the Layers panel" }).click();
  await expect(panel).toBeHidden();
  await p.getByRole("button", { name: "Layers panel" }).click();
  await expect(panel).toBeVisible();
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(p.getByTestId("layers-panel")).toBeVisible();
  const kept = p.getByTestId("layers-panel");
  await expect(kept.locator(".layer-name", { hasText: "sky line" })).toHaveCount(1);
  await expect(kept.locator(".layer-name", { hasText: "pair" })).toHaveCount(1);
  expect(await p.evaluate((id) => window.__canvastDebug.objects().find((o) => o.id === id)!["blend"], ids[1]!)).toBe("multiply");
});

test("bookmarks: save the current place and zoom, go back to it exactly (a trillion levels down too), rename, delete, and keep them across a reload and frame clean-up (ADR 0025)", async ({ app }) => {
  const p = app.page;
  const panel = p.getByTestId("bookmarks-panel");
  await expect(panel).toBeHidden();
  await p.getByRole("button", { name: "Bookmarks panel" }).click();
  await expect(panel).toBeVisible();
  await expect(panel.locator("li.bookmark")).toHaveCount(0);
  // Bookmark 1: home. Bookmark 2: far in, off the origin.
  await p.getByRole("button", { name: "Add bookmark" }).click();
  await p.evaluate(() => window.__canvastDebug.jump(1e12));
  await p.keyboard.press("h");
  await app.drag({ x: 700, y: 300 }, { x: 400, y: 500 }, 6);
  const deepCam = await app.camera();
  await p.getByRole("button", { name: "Add bookmark" }).click();
  const rows = panel.locator("li.bookmark");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator(".bookmark-name")).toHaveText("Bookmark 1");
  await expect(rows.nth(1).locator(".bookmark-name")).toHaveText("Bookmark 2");
  await expect(rows.nth(1).locator("img.bookmark-thumb")).toHaveCount(1);
  // Go home and back: the camera comes back exactly.
  await rows.nth(0).locator(".bookmark-name").click();
  await app.frame();
  expect(await app.camera()).toEqual({ cx: "0p0", cy: "0p0", zi: 0, zf: 0, pz: 0 });
  await rows.nth(1).locator(".bookmark-name").click();
  await app.frame();
  expect(await app.camera()).toEqual(deepCam);
  expect(await p.evaluate(() => window.__canvastDebug.depth())).toBe("1000000000000");
  // Rename.
  await rows.nth(1).locator(".bookmark-name").dblclick();
  await p.keyboard.type("Far corner");
  await p.keyboard.press("Enter");
  await expect(rows.nth(1).locator(".bookmark-name")).toHaveText("Far corner");
  // Survives frame clean-up and a reload.
  await p.evaluate(() => window.__canvastDebug.collectFrames());
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.keyboard.press("Home");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await app.frame();
  const after = p.getByTestId("bookmarks-panel").locator("li.bookmark");
  await expect(after).toHaveCount(2);
  await after.nth(1).locator(".bookmark-name").click();
  await app.frame();
  expect(await app.camera()).toEqual(deepCam);
  // Delete.
  await p.getByTestId("bookmarks-panel").getByRole("button", { name: "Delete Bookmark 1" }).click();
  await expect(after).toHaveCount(1);
});

test("decoded images are a cache with a budget: idle ones are released when over it, and decoded again when drawn (ADR 0027)", async ({ app }) => {
  const p = app.page;
  const stats = () => p.evaluate(() => window.__canvastDebug.decodedStats());
  const MB = 2 ** 20;
  // Four 1000 x 1000 images (4 MB decoded each), a budget of 9 MB.
  await p.evaluate((b) => window.__canvastDebug.setDecodedBudget(b), 9 * MB);
  const colours: Array<[number, number, number]> = [[200, 30, 30], [30, 160, 60], [40, 70, 220], [230, 190, 20]];
  const files = colours.map((c, i) => ({ name: `solid${i}.png`, mimeType: "image/png", buffer: makePng(1000, 1000, () => [c[0], c[1], c[2], 255]) }));
  await p.getByTestId("import-input").setInputFiles(files);
  await p.waitForFunction(() => window.__canvastDebug.objects().length === 4);
  await expect.poll(async () => (await stats()).count, { message: "all four are decoded (in full, they are shown large) while in use" }).toBe(4);
  // Look somewhere else; once they have been idle for a while the extra ones are released.
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "1000000p0", cy: "0p0", zi: 0, zf: 0, pz: 0 }));
  await app.frame();
  await expect.poll(async () => (await stats()).bytes, { timeout: 15_000 }).toBeLessThanOrEqual(9 * MB);
  expect((await stats()).count).toBeLessThan(4);
  // Back to them: released ones are decoded again, and every image draws its own colour.
  await p.keyboard.press("Home");
  await app.frame();
  await p.waitForFunction(() => window.__canvastDebug.decodedStats().count >= 2);
  const objs = await p.evaluate(() => window.__canvastDebug.objects().map((o) => o["id"] as string));
  for (const id of objs) {
    const b = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
    const x = Math.round((b.minX + b.maxX) / 2);
    const y = Math.round((b.minY + b.maxY) / 2);
    // (They overlap: the pixel is the colour of whichever image is in front there, never the placeholder.)
    await expect
      .poll(async () => colours.map((c) => c.join(",")).includes(await p.evaluate(([a, c]) => window.__canvastDebug.pixelAt(a!, c!).join(","), [x, y])), { timeout: 10_000 })
      .toBe(true);
  }
});

test("adaptive quality: a lower level draws the canvas at a lower resolution and everything still works (ADR 0028)", async ({ app }) => {
  const p = app.page;
  const ratio = () => p.evaluate(() => (document.getElementById("canvas") as HTMLCanvasElement).width / window.__canvastDebug.viewport().width);
  const dpr = await p.evaluate(() => window.devicePixelRatio);
  await p.keyboard.press("p");
  await app.drag({ x: 400, y: 300 }, { x: 800, y: 340 }, 6);
  const levels: Array<[0 | 1 | 2, number]> = [[0, dpr], [1, Math.min(dpr, 1.5)], [2, Math.min(dpr, 1)], [0, dpr]];
  for (const [level, expected] of levels) {
    await p.evaluate((l) => window.__canvastDebug.setQualityLevel(l), level);
    await app.frame();
    expect(await p.evaluate(() => window.__canvastDebug.qualityLevel())).toBe(level);
    expect(await ratio(), `level ${level}: canvas pixels per CSS px`).toBeCloseTo(expected, 2);
    expect(await p.evaluate(() => window.__canvastDebug.inkedPixels(2)), `level ${level}: the stroke is drawn`).toBeGreaterThan(50);
    // Picking and the pixel read are in CSS px whatever the resolution.
    await p.keyboard.press("v");
    await p.mouse.click(600, 320);
    expect((await p.evaluate(() => window.__canvastDebug.selection())).length, `level ${level}: picking works`).toBe(1);
    await p.keyboard.press("Escape");
  }
});

test("a big document is indexed in slices and ends up with every object (ADR 0029)", async ({ app }) => {
  const p = app.page;
  // 60,000 strokes is over the threshold for slice-by-slice indexing (20,000).
  const load = await p.evaluate(() => window.__canvastDebug.benchLoad({ kind: "dense", n: 60_000 }));
  expect(load.objects).toBe(60_000);
  expect((await p.evaluate(() => window.__canvastDebug.indexStats())).objects, "every object is in the index when the build is done").toBe(60_000);
  await app.frame();
  expect(await p.evaluate(() => window.__canvastDebug.inkedPixels(2)), "and it draws").toBeGreaterThan(100);
  expect(await p.evaluate(() => document.querySelector(".hud-readout")?.textContent ?? ""), "the progress message is gone").not.toContain("Indexing");
});

test("a batch import is laid out in a grid in one undo step, and big images drawn small are served from reduced copies (ADR 0030)", async ({ app }) => {
  const p = app.page;
  const MB = 2 ** 20;
  const stats = () => p.evaluate(() => window.__canvastDebug.decodedStats());
  // Six 2000 x 1200 images (9.6 MB each when decoded in full); only 12 MB of decoded pixels are allowed.
  await p.evaluate((b) => window.__canvastDebug.setDecodedBudget(b), 12 * MB);
  const colours: Array<[number, number, number]> = [[200, 30, 30], [30, 160, 60], [40, 70, 220], [230, 190, 20], [120, 40, 160], [20, 150, 160]];
  const files = colours.map((c, i) => ({ name: `big${i}.png`, mimeType: "image/png", buffer: makePng(2000, 1200, () => [c[0], c[1], c[2], 255]) }));
  await p.getByTestId("import-input").setInputFiles(files);
  await p.waitForFunction(() => window.__canvastDebug.objects().length === 6);
  // A grid as square as 5:3 cells allow: 2 columns by 3 rows, in the order given, no overlaps, inside the viewport.
  const ids = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id);
  const boxes = [];
  for (const id of ids) boxes.push((await boxOf(app, id))!);
  expect(new Set(boxes.map((b) => Math.round(b.minY))).size, "three rows").toBe(3);
  expect(new Set(boxes.map((b) => Math.round(b.minX))).size, "two columns").toBe(2);
  expect(boxes[1]!.minX, "left to right").toBeGreaterThan(boxes[0]!.maxX);
  expect(boxes[2]!.minY, "then the next row").toBeGreaterThan(boxes[0]!.maxY);
  for (const b of boxes) expect(b.maxX - b.minX, "shrunk to fit, not up").toBeLessThan(2000);
  // Each shows its own colour, drawn from a reduced copy: far less than six full decodes stay in memory.
  for (let i = 0; i < 6; i++) {
    const b = boxes[i]!;
    const x = Math.round((b.minX + b.maxX) / 2);
    const y = Math.round((b.minY + b.maxY) / 2);
    await expect.poll(() => p.evaluate(([a, c]) => window.__canvastDebug.pixelAt(a!, c!).join(","), [x, y]), { timeout: 10_000 }).toBe(colours[i]!.join(","));
  }
  await expect.poll(async () => (await stats()).bytes, { timeout: 15_000 }).toBeLessThanOrEqual(12 * MB);
  // One undo step takes the whole batch away.
  await p.keyboard.press("Control+z");
  expect(await p.evaluate(() => window.__canvastDebug.objects().length)).toBe(0);
});

test("hundreds of images asked for at once decode a few at a time, so memory stays low (ADR 0030)", async ({ app }) => {
  const p = app.page;
  const MB = 2 ** 20;
  // 40 images of 1600 x 1000 (6.4 MB each in full: 256 MB if decoded together), a budget of 20 MB.
  await p.evaluate((b) => window.__canvastDebug.setDecodedBudget(b), 20 * MB);
  const colours = Array.from({ length: 40 }, (_, i): [number, number, number] => [20 + i * 5, 240 - i * 5, 90 + (i % 7) * 20]);
  const files = colours.map((c, i) => ({ name: `m${String(i).padStart(2, "0")}.png`, mimeType: "image/png", buffer: makePng(1600, 1000, () => [c[0], c[1], c[2], 255]) }));
  await p.getByTestId("import-input").setInputFiles(files);
  await p.waitForFunction(() => window.__canvastDebug.objects().length === 40, null, { timeout: 120_000 });
  const ids = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id);
  // Every image ends up drawn with its own colour...
  for (let i = 0; i < 40; i += 7) {
    const b = (await boxOf(app, ids[i]!))!;
    const x = Math.round((b.minX + b.maxX) / 2);
    const y = Math.round((b.minY + b.maxY) / 2);
    await expect.poll(() => p.evaluate(([a, c]) => window.__canvastDebug.pixelAt(a!, c!).join(","), [x, y]), { timeout: 30_000 }).toBe(colours[i]!.join(","));
  }
  // ...though never more than three were decoding at the same time, and memory stays within the budget.
  const s = await p.evaluate(() => window.__canvastDebug.decodedStats());
  expect(s.maxRunning).toBeLessThanOrEqual(3);
  await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.decodedStats())).bytes, { timeout: 15_000 }).toBeLessThanOrEqual(20 * MB);
});

test("information readout: one button cycles Simple, More, Technical and Hidden, and the choice is remembered (ADR 0055)", async ({ app }) => {
  const p = app.page;
  const button = () => p.getByRole("button", { name: /^Information shown/ });
  const zoom = p.getByTestId("zoom-readout");
  const fps = p.getByTestId("fps-readout");
  // The default: the zoom as a magnification and whether the work is saved, in plain words, and nothing else.
  await expect(button()).toHaveAttribute("data-mode", "simple");
  await expect(zoom).toHaveText("Zoom 1×");
  await expect(p.getByTestId("position-readout")).toBeHidden();
  await expect(fps).toBeHidden();
  await expect(p.getByTestId("diagnostics")).toBeHidden();
  await expect(p.getByTestId("save-status")).toHaveText("Saved");
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 3, zf: 0, pz: 3 }));
  await expect(zoom).toHaveText("Zoom 8×");
  // More: adds where you are, what is on the canvas and how smoothly it runs, still in words.
  await button().click();
  await expect(button()).toHaveAttribute("data-mode", "more");
  await expect(p.getByTestId("position-readout")).toContainText("Position 0, 0");
  await expect(p.getByTestId("objects-readout")).toHaveText("Nothing on the canvas yet");
  await expect(fps).toHaveText(/^(Running smoothly|A little slow|Slow)$/, { timeout: 10_000 });
  // Technical: the numbers.
  await button().click();
  await expect(button()).toHaveAttribute("data-mode", "technical");
  await expect(zoom).toContainText("zoom 2^3.00");
  await expect(fps).toHaveText(/^\d+ FPS · [\d.]+ ms · worst \d+ ms · draw [\d.]+ ms/, { timeout: 10_000 });
  await expect.poll(async () => Number(((await fps.textContent()) ?? "").match(/^(\d+) FPS/)?.[1] ?? 0), { message: "a responsive page runs near the display rate", timeout: 10_000 }).toBeGreaterThan(20);
  await expect(p.getByTestId("diagnostics")).toHaveText(/p50 [\d.]+ · p95 [\d.]+ · p99 [\d.]+ ms\nobjects 0 · drawn \d+\ndecoded 0 images · 0 \/ \d+ MiB · decoding 0 · waiting 0/);
  await expect(p.getByTestId("save-status")).toContainText("Saved");
  // Hidden: nothing of the readout is left.
  await button().click();
  await expect(button()).toHaveAttribute("data-mode", "hidden");
  await expect(zoom).toBeHidden();
  await expect(fps).toBeHidden();
  // The choice is kept over a reload, and the tooltip names this view and the next.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(button()).toHaveAttribute("data-mode", "hidden");
  await expect(button()).toHaveAttribute("title", /Information shown: Hidden\. Click for Simple\./);
});

test("canvas pattern: one button cycles Grid, Dots, Multi-scale grid and None, and the choice is remembered (ADR 0056)", async ({ app }) => {
  const p = app.page;
  const button = () => p.getByRole("button", { name: /^Canvas pattern/ });
  /** Marked pixels in a patch of empty canvas (nothing but the pattern is there): a measure of how much pattern is drawn. */
  const marked = () =>
    p.evaluate(() => {
      // One read of the patch (a pixel at a time is far too slow in Firefox).
      const c = document.getElementById("canvas") as HTMLCanvasElement;
      const r = c.width / c.getBoundingClientRect().width;
      const d = c.getContext("2d")!.getImageData(Math.round(90 * r), Math.round(70 * r), Math.round(390 * r), Math.round(180 * r)).data;
      const bg = `${d[0]},${d[1]},${d[2]}`;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (`${d[i]},${d[i + 1]},${d[i + 2]}` !== bg) n++;
      return Math.round(n / (r * r));
    });
  // The default is the regular grid; dots are fewer marks than lines; the multi-scale grid is what the app always had; None is blank.
  await expect(button()).toHaveAttribute("data-pattern", "grid");
  await app.frame();
  const grid = await marked();
  expect(grid, "a grid of lines is drawn").toBeGreaterThan(300);
  await button().click();
  await expect(button()).toHaveAttribute("data-pattern", "dots");
  await app.frame();
  const dots = await marked();
  expect(dots, "dots are drawn").toBeGreaterThan(20);
  expect(dots, "far fewer marks than lines").toBeLessThan(grid / 3);
  await button().click();
  await expect(button()).toHaveAttribute("data-pattern", "scale");
  await app.frame();
  expect(await marked(), "the multi-scale grid is drawn").toBeGreaterThan(300);
  await button().click();
  await expect(button()).toHaveAttribute("data-pattern", "none");
  await app.frame();
  expect(await marked(), "None leaves the canvas blank").toBe(0);
  // Kept over a reload; the tooltip names this one and the next.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(button()).toHaveAttribute("data-pattern", "none");
  await expect(button()).toHaveAttribute("title", /Canvas pattern: None\. Click for Grid\./);
  // The grid keeps its squares a regular size as you zoom: its spacing is never more than twice another zoom's.
  await button().click();
  await app.frame();
  const at = async (z: number) => {
    await p.evaluate((zf) => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: Math.floor(zf), zf: zf - Math.floor(zf), pz: Math.floor(zf) }), z);
    await app.frame();
    return marked();
  };
  const counts = [await at(0), await at(0.5), await at(1), await at(1.5), await at(2.25)];
  for (const c of counts) expect(c, "a grid at every zoom").toBeGreaterThan(300);
});

test("selection boxes follow the rotation, rotation works from outside a corner, and a marquee takes what it touches (ADR 0031)", async ({ app }) => {
  const p = app.page;
  const frame = () => p.evaluate(() => window.__canvastDebug.selectionFrame());
  const rots = () => p.evaluate(() => window.__canvastDebug.objects().map((o) => (o["rot"] as number | undefined) ?? 0));
  const files = Array.from({ length: 4 }, (_, i) => ({ name: `g${i}.png`, mimeType: "image/png", buffer: makePng(800, 500, () => [40 + i * 50, 90, 200 - i * 40, 255]) }));
  await p.getByTestId("import-input").setInputFiles(files);
  await p.waitForFunction(() => window.__canvastDebug.objects().length === 4);
  const ids = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id);
  await p.evaluate(() => window.__canvastDebug.jump(-1)); // smaller, away from the toolbars
  await app.frame();
  const b0 = (await boxOf(app, ids[0]!))!;
  // A marquee that starts inside an image and leaves it touches it; one that stays inside it takes nothing.
  await p.keyboard.press("v");
  await app.drag({ x: Math.round(b0.minX) + 20, y: Math.round(b0.minY) + 20 }, { x: Math.round(b0.minX) + 60, y: Math.round(b0.minY) + 50 }, 6);
  expect(await p.evaluate(() => window.__canvastDebug.selection()), "a marquee wholly inside an image takes nothing").toEqual([]);
  await app.drag({ x: Math.round(b0.maxX) - 30, y: Math.round(b0.maxY) - 30 }, { x: Math.round(b0.maxX) + 30, y: Math.round(b0.maxY) + 30 }, 6);
  expect(await p.evaluate(() => window.__canvastDebug.selection()), "a marquee that touches the corner takes it").toContain(ids[0]);
  await p.keyboard.press("Control+a");
  const f0 = (await frame())!;
  expect(f0.angle).toBe(0);
  // Turn them all by a quarter by the handle above the box: the box turns with them.
  const [c0, c1, c2f] = [f0.corners[0]!, f0.corners[1]!, f0.corners[2]!];
  const top: [number, number] = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2];
  const centre: [number, number] = [(c0[0] + c2f[0]) / 2, (c0[1] + c2f[1]) / 2];
  await app.drag({ x: Math.round(top[0]), y: Math.round(top[1]) - 26 }, { x: Math.round(centre[0]) + 200, y: Math.round(centre[1]) }, 8);
  const f1 = (await frame())!;
  expect(f1.angle, "a quarter turn clockwise").toBeCloseTo(Math.PI / 2, 1);
  expect(Math.abs(f1.corners[1]![0] - f1.corners[0]![0]), "its top edge now runs down the screen").toBeLessThan(2);
  const turned = await rots();
  expect(turned.every((r) => r === turned[0] && r > 0), "all four turned by the same angle").toBe(true);
  // The box can be axis-aligned instead.
  await p.getByRole("button", { name: "Axis-aligned selection box" }).click();
  expect((await frame())!.angle).toBe(0);
  await p.getByRole("button", { name: "Axis-aligned selection box" }).click();
  // Turning from just outside a corner (the handle may be out of the view for a big selection).
  const before = (await rots())[0]!;
  const f2 = (await frame())!;
  const c2 = f2.corners[2]!;
  const cc: [number, number] = [(f2.corners[0]![0] + f2.corners[2]![0]) / 2, (f2.corners[0]![1] + f2.corners[2]![1]) / 2];
  const out = Math.hypot(c2[0] - cc[0], c2[1] - cc[1]);
  const ux = (c2[0] - cc[0]) / out;
  const uy = (c2[1] - cc[1]) / out;
  // The cursor says so before the press, and the box is drawn in the axis-aligned mode too.
  await p.mouse.move(Math.round(c2[0] + ux * 20), Math.round(c2[1] + uy * 20));
  await expect(p.locator("#canvas")).toHaveClass(/is-rotate/);
  await p.mouse.move(Math.round(cc[0]), Math.round(cc[1]));
  await expect(p.locator("#canvas")).not.toHaveClass(/is-rotate/);
  await app.drag({ x: Math.round(c2[0] + ux * 20), y: Math.round(c2[1] + uy * 20) }, { x: Math.round(cc[0] + 120), y: Math.round(cc[1] + 120) }, 8);
  expect((await rots())[0]!, "turned from outside the corner").not.toBe(before);
});

test("keyboard shortcuts still work after using a slider (focus stays on it)", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await app.drag({ x: 400, y: 300 }, { x: 700, y: 340 }, 6);
  expect((await p.evaluate(() => window.__canvastDebug.objects())).length).toBe(1);
  await p.locator("[data-size]").focus(); // the pen size slider has keyboard focus now
  await p.keyboard.press("Control+z");
  expect((await p.evaluate(() => window.__canvastDebug.objects())).length, "undo works with the slider focused").toBe(0);
  await p.keyboard.press("Control+y");
  expect((await p.evaluate(() => window.__canvastDebug.objects())).length, "and redo").toBe(1);
});

test("Shift snaps a rotation to whole 15 degree steps and it sticks (a step is not a whole number of angle units); corners show a resize cursor", async ({ app }) => {
  const p = app.page;
  const stored = () => p.evaluate(() => window.__canvastDebug.storedObjects().map((o) => o["rot"] as number | undefined));
  await p.keyboard.press("p");
  await app.drag({ x: 500, y: 400 }, { x: 700, y: 440 }, 6);
  await p.keyboard.press("v");
  await p.mouse.click(600, 420);
  const f = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
  const c = (a: number): [number, number] => [(f.corners[a]![0] + f.corners[(a + 2) % 4]![0]) / 2, (f.corners[a]![1] + f.corners[(a + 2) % 4]![1]) / 2];
  const centre = c(0);
  const top = [(f.corners[0]![0] + f.corners[1]![0]) / 2, (f.corners[0]![1] + f.corners[1]![1]) / 2] as const;
  // From straight above the centre to 20 degrees clockwise of that, holding Shift: it lands on 15 degrees, not back at 0.
  const r = Math.hypot(top[0] - centre[0], top[1] - centre[1]) + 26;
  const a = (20 * Math.PI) / 180;
  await p.keyboard.down("Shift");
  await app.drag({ x: Math.round(top[0]), y: Math.round(top[1]) - 26 }, { x: Math.round(centre[0] + r * Math.sin(a)), y: Math.round(centre[1] - r * Math.cos(a)) }, 8);
  await p.keyboard.up("Shift");
  await app.frame();
  const [rot] = await stored();
  expect(Number.isInteger(rot), "a whole number of angle units").toBe(true);
  expect(Math.abs(rot! - 2 ** 32 / 24), "15 degrees").toBeLessThan(3);
  // Over a corner handle: a resize cursor (and the rotate arrow just outside it).
  const f2 = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
  const corner = f2.corners[2]!;
  await p.mouse.move(Math.round(corner[0]), Math.round(corner[1]));
  await expect(p.locator("#canvas")).toHaveAttribute("data-hover", /^(ew|ns|nwse|nesw)$/);
  await p.mouse.move(Math.round(centre[0]), Math.round(centre[1]) + 80);
  await expect(p.locator("#canvas")).not.toHaveAttribute("data-hover", /.+/);
});

test("the Arrange menu aligns and arranges the selection in a grid, each as one undo step, and says when too little is selected", async ({ app }) => {
  const p = app.page;
  const boxes = async (): Promise<Array<{ minX: number; minY: number; maxX: number; maxY: number }>> =>
    p.evaluate(() => window.__canvastDebug.objects().map((o) => window.__canvastDebug.objectScreen(o.id)!.box));
  await p.keyboard.press("p");
  const at = [[420, 260], [560, 400], [700, 300], [500, 520]] as const;
  for (const [x, y] of at) await app.drag({ x, y }, { x: x + 60, y: y + 40 }, 4);
  await p.keyboard.press("v");
  const menuItem = async (name: string): Promise<void> => {
    await p.getByRole("button", { name: "Arrange and align" }).click();
    await p.getByRole("menuitem", { name }).click();
  };
  // One stroke selected: nothing to align, and the message says so.
  await p.mouse.click(450, 280);
  await menuItem("Left");
  await expect(p.getByTestId("toast")).toContainText("Select at least 2 items");
  await p.keyboard.press("Control+a");
  const before = await boxes();
  await menuItem("Left");
  const left = await boxes();
  expect(new Set(left.map((b) => Math.round(b.minX))).size, "every left edge is the same").toBe(1);
  expect(left.map((b) => Math.round(b.minY)), "vertical positions are untouched").toEqual(before.map((b) => Math.round(b.minY)));
  await p.keyboard.press("Control+z"); // one step back
  expect((await boxes()).map((b) => Math.round(b.minX))).toEqual(before.map((b) => Math.round(b.minX)));
  await menuItem("In stacking order");
  const grid = await boxes();
  expect(new Set(grid.map((b) => Math.round(b.minX))).size, "2 columns").toBe(2);
  expect(new Set(grid.map((b) => Math.round(b.minY))).size, "2 rows").toBe(2);
  await p.keyboard.press("Control+z");
  expect((await boxes()).map((b) => Math.round(b.minX))).toEqual(before.map((b) => Math.round(b.minX)));
  expect(app.consoleErrors).toEqual([]);
});

test("the pens differ: fine is one stroke, marker one translucent wide one, pencil and ink make grouped strokes, and the choice is remembered (ADR 0037)", async ({ app }) => {
  const p = app.page;
  const strokes = async () => (await p.evaluate(() => window.__canvastDebug.objects())) as unknown as Array<Record<string, unknown> & { id: string; opacity: number; width: number; groups?: string[] }>;
  const draw = async (name: string, y: number): Promise<Awaited<ReturnType<typeof strokes>>> => {
    const before = new Set((await strokes()).map((o) => o.id));
    await p.keyboard.press("p");
    await p.getByRole("radio", { name }).click();
    await p.mouse.move(480, y);
    await p.mouse.down();
    for (let i = 1; i <= 40; i++) await p.mouse.move(480 + i * 8, y + 30 * Math.sin(i / 5));
    await p.mouse.up();
    return (await strokes()).filter((o) => !before.has(o.id));
  };
  const fine = await draw("Fine pen", 200);
  expect(fine).toHaveLength(1);
  expect(fine[0]).toMatchObject({ opacity: 1 });
  expect(fine[0]!.groups).toBeUndefined();
  const marker = await draw("Marker", 280);
  expect(marker).toHaveLength(1);
  expect(marker[0]!.opacity).toBeLessThan(0.5);
  expect(marker[0]!.width).toBeGreaterThan(fine[0]!.width * 2);
  const pencil = await draw("Pencil", 360);
  expect(pencil).toHaveLength(3);
  expect(new Set(pencil.map((o) => o.groups?.[0])).size).toBe(1);
  expect(pencil.every((o) => o.opacity < 1 && o.width < fine[0]!.width)).toBe(true);
  const ink = await draw("Ink pen", 440);
  expect(ink.length).toBeGreaterThan(1);
  expect(new Set(ink.map((o) => o.groups?.[0])).size).toBe(1);
  expect(new Set(ink.map((o) => Math.round(o.width * 1000))).size, "the width varies along the line").toBeGreaterThan(1);
  // Esc leaves the pen for the Select tool.
  await p.keyboard.press("Escape");
  await expect(p.getByRole("radio", { name: "Select" })).toHaveAttribute("aria-checked", "true");
  // One undo takes a whole pencil or ink stroke away.
  const count = (await strokes()).length;
  await p.keyboard.press("Control+z");
  expect((await strokes()).length).toBe(count - ink.length);
  // The pen stays chosen after a reload.
  await p.keyboard.press("p");
  await p.getByRole("radio", { name: "Ink pen" }).click();
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.keyboard.press("p");
  await expect(p.getByRole("radio", { name: "Ink pen" })).toHaveAttribute("aria-checked", "true");
  expect(app.consoleErrors).toEqual([]);
});

test("copy, cut, paste and duplicate: Ctrl+C/X/V/D on the selection, pasted at the size it had on screen, one undo step each (ADR 0038)", async ({ app }) => {
  const p = app.page;
  const strokes = async () => (await p.evaluate(() => window.__canvastDebug.objects())) as unknown as Array<{ id: string }>;
  const boxOf = (id: string) => p.evaluate((i) => window.__canvastDebug.objectScreen(i)!.box, id);
  await p.keyboard.press("p");
  await app.drag({ x: 500, y: 250 }, { x: 600, y: 300 }, 6);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Control+a");
  const [orig] = await strokes();
  const ob = await boxOf(orig!.id);
  // Ctrl+D: a copy a little down and right of the original, selected, the clipboard untouched.
  await p.keyboard.press("Control+d");
  const afterDup = await strokes();
  expect(afterDup).toHaveLength(2);
  const dup = afterDup.find((o) => o.id !== orig!.id)!;
  const db = await boxOf(dup.id);
  expect(Math.round(db.minX - ob.minX)).toBe(24);
  expect(Math.round(db.maxX - db.minX)).toBe(Math.round(ob.maxX - ob.minX));
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([dup.id]);
  await p.keyboard.press("Control+z");
  expect(await strokes()).toHaveLength(1);
  // Ctrl+C then, after zooming in two levels, Ctrl+V: the same size on screen, centred in the view.
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Control+c");
  await p.evaluate(() => {
    const c = window.__canvastDebug.camera();
    window.__canvastDebug.setCamera({ ...c, zi: c.zi + 2, pz: Math.max(c.pz, c.zi + 2) });
  });
  await app.frame();
  await p.keyboard.press("Control+v");
  const pasted = (await strokes()).find((o) => o.id !== orig!.id)!;
  const pb = await boxOf(pasted.id);
  expect(Math.abs(pb.maxX - pb.minX - (ob.maxX - ob.minX))).toBeLessThan(1.5);
  const vp = await p.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  expect(Math.abs((pb.minX + pb.maxX) / 2 - vp.w / 2)).toBeLessThan(4);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([pasted.id]);
  await p.keyboard.press("Control+z");
  expect(await strokes()).toHaveLength(1);
  // Ctrl+X takes the selection away (one undo step brings it back) and it can still be pasted.
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Control+x");
  expect(await strokes()).toHaveLength(0);
  await p.keyboard.press("Control+v");
  expect(await strokes()).toHaveLength(1);
  expect(app.consoleErrors).toEqual([]);
});

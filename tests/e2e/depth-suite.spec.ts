import { expect, percentile, recordMetric, test } from "./harness";
import type { App } from "./harness";

/**
 * Step 5, the depth suite (ADR 0014 acceptance, A1 A2 A3 A5 A7): the canvas
 * costs the same at any depth. The limits below were fixed before the first
 * run and are never loosened to make a test pass (CLAUDE.md).
 */
const LIM = {
  /** A1: median frame time at any depth ≤ RATIO × the median at 2^10, plus this floor (ms, timer noise). */
  frameRatio: 3,
  frameFloorMs: 3,
  /** A2 and A5: one jump / one input step including the frame it causes. */
  stepMs: 100,
  /** A3: continuity of a point's screen position across frame changes. */
  rebasePx: 1e-6,
  /** A7: JS heap growth over many dives (Chromium; Firefox exposes no heap figure). */
  heapGrowthMB: 20,
};

const jump = (app: App, levels: number): Promise<void> => app.page.evaluate((l) => window.__canvastDebug.jump(l), levels);
const depth = async (app: App): Promise<number> => Number(await app.page.evaluate(() => window.__canvastDebug.depth()));

/** Run `fn`, wait for the frame it causes, and return the elapsed ms. */
async function timed(app: App, fn: () => Promise<void>): Promise<number> {
  const t0 = Date.now();
  await fn();
  await app.frame();
  return Date.now() - t0;
}

/** Draw one stroke with the pen at the centre of the view and return its id. */
async function drawStroke(app: App, from = { x: 560, y: 380 }, to = { x: 700, y: 440 }): Promise<string> {
  const p = app.page;
  await p.mouse.click(640, 400);
  await p.keyboard.press("p");
  const before = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id);
  await app.drag(from, to, 6);
  const ids = (await p.evaluate(() => window.__canvastDebug.objectFrames())).map((o) => o.id).filter((i) => !before.includes(i));
  expect(ids).toHaveLength(1);
  return ids[0]!;
}

const qOf = async (app: App, id: string): Promise<number[]> => (await app.page.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.q;

test("A1: frame time is the same from 2^10 to 2^10^12", async ({ app }, info) => {
  const p = app.page;
  const median: Record<string, number> = {};
  for (const d of [10, 1e3, 1e6, 1e9, 1e12]) {
    await p.keyboard.press("Home");
    await app.frame();
    await jump(app, d);
    await drawStroke(app);
    await p.keyboard.press("h");
    await p.evaluate(() => window.__canvastDebug.resetFrameTimes());
    for (const k of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
      await p.keyboard.press(k);
      await app.frame();
    }
    // Zoom wiggle too: frames while the zoom changes.
    for (const l of [0.3, -0.3, 0.3, -0.3]) {
      await jump(app, l);
      await app.frame();
    }
    const ft = await p.evaluate(() => window.__canvastDebug.frameTimes());
    expect(ft.length).toBeGreaterThan(8);
    median[String(d)] = percentile(ft, 50);
  }
  recordMetric(info, "A1 median frame ms by depth", median);
  const base = median["10"]!;
  for (const [d, m] of Object.entries(median)) {
    expect(m, `median frame at 2^${d} (${m} ms) vs 2^10 (${base} ms)`).toBeLessThanOrEqual(LIM.frameRatio * base + LIM.frameFloorMs);
  }
});

test("A2: a 10^12 jump, in and out, takes under 100 ms", async ({ app }, info) => {
  await app.page.mouse.click(640, 400);
  await drawStroke(app);
  const steps: number[] = [];
  for (let i = 0; i < 4; i++) {
    steps.push(await timed(app, () => jump(app, 1e12)));
    steps.push(await timed(app, () => jump(app, -1e12)));
  }
  steps.push(await timed(app, () => jump(app, -1e12))); // above home
  steps.push(await timed(app, () => jump(app, 1e12)));
  recordMetric(info, "A2 jump ms", { steps });
  expect(await depth(app)).toBe(0);
  expect(Math.max(...steps)).toBeLessThan(LIM.stepMs);
});

test("A3: rebase continuity: a point's screen position stays continuous across frame changes and returns exactly", async ({ app }, info) => {
  const p = app.page;
  const vp = await p.evaluate(() => window.__canvastDebug.viewport());
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  let worst = 0;
  for (const start of [0, 1e12]) {
    await p.keyboard.press("Home");
    await app.frame();
    // Just below a frame boundary (frames are 32 levels apart), so small zooms cross it.
    await jump(app, start + 31.6);
    const id = await drawStroke(app, { x: 600, y: 390 }, { x: 680, y: 420 });
    // Forward: small zoom steps across the frame boundaries (every 32 levels), each against the zoom's own prediction.
    let prev = await qOf(app, id);
    let cam = await app.camera();
    const dz = 0.05;
    for (let i = 0; i < 160; i++) {
      const s = i < 80 ? dz : -dz; // 4 levels in, then 4 out: crosses at least one frame boundary each way
      await jump(app, s);
      await app.frame();
      const q = await qOf(app, id);
      // The zoom actually applied (the camera keeps its zoom on a grid, so a step is not exactly `s`).
      const now = await app.camera();
      const f = 2 ** (now.zi - cam.zi + (now.zf - cam.zf));
      cam = now;
      const n = Math.min(q.length, prev.length);
      for (let k = 0; k + 1 < n; k += 2) {
        const ex = cx + (prev[k]! - cx) * f;
        const ey = cy + (prev[k + 1]! - cy) * f;
        // The stroke may leave the view; compare only points still near it.
        if (Math.abs(ex) < 5000 && Math.abs(ey) < 5000) worst = Math.max(worst, Math.hypot(q[k]! - ex, q[k + 1]! - ey) / Math.max(1, f));
      }
      prev = q;
    }
    // Round trips over frame boundaries: exactly the same pixels.
    const home = await qOf(app, id);
    for (const L of [0.3, 31.7, 32, 33, 64.5, 1000]) {
      await jump(app, L);
      await app.frame();
      await jump(app, -L);
      await app.frame();
      const q = await qOf(app, id);
      expect(q.length).toBe(home.length);
      for (let k = 0; k < q.length; k++) worst = Math.max(worst, Math.abs(q[k]! - home[k]!));
    }
  }
  recordMetric(info, "A3 worst rebase error px", { worst });
  expect(worst).toBeLessThan(LIM.rebasePx);
});

test("A5: at 2^10^12 draw, select, move, resize, undo and type each take under 100 ms", async ({ app }, info) => {
  const p = app.page;
  await jump(app, 1e12);
  expect(await p.evaluate(() => window.__canvastDebug.depth())).toBe("1000000000000");
  const steps: Record<string, number> = {};
  await p.mouse.click(640, 400);
  await p.keyboard.press("p");
  steps["draw"] = await timed(app, () => app.drag({ x: 500, y: 400 }, { x: 700, y: 450 }, 2));
  const [s] = await p.evaluate(() => window.__canvastDebug.objectFrames());
  expect(s?.kind).toBe("stroke");
  await p.keyboard.press("v");
  steps["select"] = await timed(app, () => p.mouse.click(600, 425));
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([s!.id]);
  const box0 = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), s!.id))!.box;
  steps["move"] = await timed(app, () => app.drag({ x: 600, y: 425 }, { x: 640, y: 455 }, 2));
  const box1 = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), s!.id))!.box;
  expect(box1.minX - box0.minX).toBeCloseTo(40, 0);
  steps["resize"] = await timed(app, () => app.drag({ x: Math.round(box1.maxX), y: Math.round(box1.maxY) }, { x: Math.round(box1.maxX) + 60, y: Math.round(box1.maxY) + 30 }, 2));
  const box2 = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), s!.id))!.box;
  expect(box2.maxX - box2.minX).toBeGreaterThan((box1.maxX - box1.minX) * 1.2);
  steps["undo"] = await timed(app, () => p.keyboard.press("Control+z"));
  steps["redo"] = await timed(app, () => p.keyboard.press("Control+y"));
  await p.keyboard.press("t");
  steps["type-open"] = await timed(app, () => p.mouse.click(400, 250));
  await expect(p.getByTestId("text-editor")).toBeFocused();
  steps["type"] = await timed(app, () => p.keyboard.type("Hi"));
  await p.keyboard.press("Escape");
  await app.frame();
  const texts = (await p.evaluate(() => window.__canvastDebug.objectFrames())).filter((o) => o.kind === "text");
  expect(texts).toHaveLength(1);
  expect(BigInt(texts[0]!.level), "the text lives a trillion levels down").toBeGreaterThan(10n ** 10n);
  recordMetric(info, "A5 step ms at 2^10^12", steps);
  for (const [name, ms] of Object.entries(steps)) expect(ms, name).toBeLessThan(LIM.stepMs);
});

test("A7: memory stays flat after many dives to 2^10^12 and back", async ({ app }, info) => {
  const p = app.page;
  await drawStroke(app);
  await jump(app, 1e12);
  await drawStroke(app);
  await p.keyboard.press("Home");
  const dive = async (): Promise<void> => {
    for (const l of [1e12, 1e9, -1e9, -2e12, 1e12]) {
      await jump(app, l);
      await p.keyboard.press("ArrowRight");
      await app.frame();
    }
    await p.keyboard.press("Home");
    await app.frame();
  };
  await dive(); // warm up caches
  await p.evaluate(() => window.__canvastDebug.collectFrames());
  const objects0 = (await p.evaluate(() => window.__canvastDebug.indexStats())).objects;
  const frames0 = await p.evaluate(() => window.__canvastDebug.storedFrameCount());
  const heap0 = await p.evaluate(() => window.__canvastDebug.heapMB());
  for (let i = 0; i < 15; i++) await dive();
  await p.evaluate(() => window.__canvastDebug.collectFrames());
  const heap1 = await p.evaluate(() => window.__canvastDebug.heapMB());
  expect((await p.evaluate(() => window.__canvastDebug.indexStats())).objects).toBe(objects0);
  expect(await p.evaluate(() => window.__canvastDebug.storedFrameCount()), "stored frames do not pile up").toBeLessThanOrEqual(frames0);
  recordMetric(info, "A7 heap MB", { heap0, heap1 });
  if (heap0 !== null && heap1 !== null) expect(heap1 - heap0).toBeLessThan(LIM.heapGrowthMB);
});

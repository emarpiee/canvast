import * as D from "../../src/core/dyadic";
import { expect, percentile, recordMetric, reps, test } from "./harness";
import type { App } from "./harness";

/**
 * Regression tests for deep-zoom vector rendering (holes / flicker when
 * zooming far into a stroke) and for single-paint compositing under opacity.
 * Ground truth is the exact signed edge distance from the debug hook, never
 * the double-precision screen geometry being tested.
 */

type Obj = { id: string; ax: string; ay: string; unit: number; points: number[]; width: number; color: string };

async function draw(app: App, pts: Array<[number, number]>): Promise<Obj> {
  await app.page.keyboard.press("p");
  await app.page.mouse.move(pts[0]![0], pts[0]![1]);
  await app.page.mouse.down();
  for (const [x, y] of pts.slice(1)) await app.page.mouse.move(x, y, { steps: 4 });
  await app.page.mouse.up();
  await app.frame();
  const all = (await app.page.evaluate(() => window.__canvastDebug.objects())) as unknown as Obj[];
  return all[all.length - 1]!;
}

/** Sample a grid of pixels and classify them against the exact outline distance. */
async function coverageErrors(app: App, id: string, region: { x0: number; y0: number; x1: number; y1: number }, step: number) {
  return app.page.evaluate(
    ([oid, r, s]) => {
      const h = window.__canvastDebug;
      let inside = 0;
      let outside = 0;
      let holes = 0;
      let spill = 0;
      for (let y = r.y0; y <= r.y1; y += s) {
        for (let x = r.x0; x <= r.x1; x += s) {
          const e = h.strokeEdgeDistance(oid, x + 0.5, y + 0.5);
          const c = h.pixelAt(x, y);
          // Ink = close to the stroke colour (#1f2329); other dark marks such as
          // the orange world axis must not count.
          const dark = Math.abs(c[0] - 0x1f) + Math.abs(c[1] - 0x23) + Math.abs(c[2] - 0x29) < 60;
          if (e < -1.5) {
            inside++;
            if (!dark) holes++;
          } else if (e > 1.5) {
            outside++;
            if (dark) spill++;
          }
        }
      }
      return { inside, outside, holes, spill };
    },
    [id, region, step] as const,
  );
}

test("zooming deep into a curvy stroke never shows holes or spill (wheel input)", async ({ app }, info) => {
  test.setTimeout(reps(480_000, 180_000)); // 240 wheel steps with a full-frame coverage check every 4th: Firefox needs over 3 min
  const pts: Array<[number, number]> = [];
  for (let t = 0; t <= 1.0001; t += 0.02) pts.push([400 + 480 * t, 400 + 120 * Math.sin(t * 14) * Math.cos(t * 3)]);
  const s = await draw(app, pts);
  const scr = (await app.page.evaluate((id) => window.__canvastDebug.objectScreen(id), s.id))!;
  // Zoom at the midpoint of a segment.
  const tx = Math.round((scr.q[20]! + scr.q[22]!) / 2);
  const ty = Math.round((scr.q[21]! + scr.q[23]!) / 2);
  let worst = { holes: 0, spill: 0, z: 0 };
  let checks = 0;
  await app.page.evaluate(() => window.__canvastDebug.resetFrameTimes());
  let exactFrames = 0;
  const STEPS = reps(240, 90); // ~100 or ~37 levels at DPR 1 (half at DPR 2: it must still reach the exact path)
  for (let step = 0; step < STEPS; step++) {
    await app.wheel(tx, ty, -100);
    if (step % 4) continue;
    await app.frame();
    const res = await coverageErrors(app, s.id, { x0: 4, y0: 4, x1: 1276, y1: 796 }, 23);
    const cam = await app.camera();
    const scrNow = await app.page.evaluate((id) => window.__canvastDebug.objectScreen(id), s.id);
    if (scrNow && scrNow.radius > 2 ** 14) exactFrames++;
    checks++;
    if (res.holes + res.spill > worst.holes + worst.spill) worst = { holes: res.holes, spill: res.spill, z: cam.zi + cam.zf };
  }
  const frames = await app.page.evaluate(() => window.__canvastDebug.frameTimes());
  recordMetric(info, "deep-zoom-curvy", {
    checks,
    exactFrames,
    levels: Math.round((STEPS * 100) / 240),
    worst,
    renderMs: { p50: percentile(frames, 50), p95: percentile(frames, 95), p99: percentile(frames, 99), max: Math.max(...frames) },
  });
  expect(exactFrames).toBeGreaterThan(reps(20, 4)); // the exact path was exercised
  expect(worst).toEqual({ holes: 0, spill: 0, z: 0 });
});

test("a stroke edge stays exactly placed from 2^0 to 2^300 magnification", async ({ app }, info) => {
  const s = await draw(app, [[300, 400], [700, 400], [900, 400]]); // horizontal: y = 0 locally
  const r = s.width / 2;
  let errors = 0;
  let checked = 0;
  for (let k = 0; k <= 300; k += 6) {
    // Centre the camera exactly on the upper edge (local y = −r) at x = 123 local units.
    const ex = D.add(D.parse(s.ax), D.shift(D.fromNumber(123), s.unit));
    const ey = D.sub(D.parse(s.ay), D.shift(D.fromNumber(r), s.unit));
    const zi = -s.unit + k;
    await app.page.evaluate((c) => window.__canvastDebug.setCamera(c), { cx: D.toString(ex), cy: D.toString(ey), zi, zf: 0, pz: zi });
    await app.frame();
    for (const dy of [-6, -3, 3, 6]) {
      const e = await app.page.evaluate(([id, y]) => window.__canvastDebug.strokeEdgeDistance(id, 640, y), [s.id, 400 + dy] as const);
      const c = await app.page.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x, y), [640, 400 + dy] as const);
      const dark = Math.abs(c[0]! - 0x1f) + Math.abs(c[1]! - 0x23) + Math.abs(c[2]! - 0x29) < 60;
      // Above the edge is outside, below is inside (once the stroke is wider than 6 px).
      const expectedInside = e < 0;
      if (Math.abs(e) > 1.5) {
        checked++;
        if (dark !== expectedInside) errors++;
      }
    }
    expect(Math.abs(await app.page.evaluate((id) => window.__canvastDebug.strokeEdgeDistance(id, 640, 400), s.id))).toBeLessThan(0.01);
  }
  recordMetric(info, "edge-exact", { depths: 51, checked, errors });
  expect(checked).toBeGreaterThan(150);
  expect(errors).toBe(0);
});

test("opacity: a self-crossing stroke is painted once (no double blend, no holes), shallow and deep", async ({ app }, info) => {
  const s = await draw(app, [[400, 400], [700, 400], [550, 250], [550, 560]]); // crosses itself at (550, 400)
  await app.page.evaluate((id) => window.__canvastDebug.setOpacity(id, 0.5), s.id);
  await app.frame();
  const results: Record<string, number> = {};
  for (const [label, zi] of [["shallow", 0], ["deep +40", 40], ["deep +200", 200]] as const) {
    if (zi > 0) {
      const w = await app.worldAt(550, 400);
      await app.page.evaluate((c) => window.__canvastDebug.setCamera(c), { cx: w.x, cy: w.y, zi, zf: 0, pz: zi });
    } else {
      await app.page.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 0, zf: 0, pz: 0 }));
    }
    await app.frame();
    // Sample points inside the stroke (exact distance), including the crossing.
    const pts = (await app.page.evaluate((id) => {
      const h = window.__canvastDebug;
      const out: Array<[number, number]> = [];
      for (let y = 240; y <= 570; y += 3) for (let x = 390; x <= 710; x += 3) if (h.strokeEdgeDistance(id, x + 0.5, y + 0.5) < -0.75) out.push([x, y]);
      return out;
    }, s.id)) as Array<[number, number]>;
    const withStroke = await app.page.evaluate((p) => p.map(([x, y]) => window.__canvastDebug.pixelAt(x, y)), pts);
    // Background alone: delete the stroke, sample, then undo.
    await app.page.keyboard.press("v");
    await app.page.keyboard.press("Control+a");
    await app.page.keyboard.press("Delete");
    await app.frame();
    const bg = await app.page.evaluate((p) => p.map(([x, y]) => window.__canvastDebug.pixelAt(x, y)), pts);
    await app.page.keyboard.press("Control+z");
    await app.page.keyboard.press("Escape");
    await app.frame();
    const ink = [0x1f, 0x23, 0x29];
    let worst = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(withStroke[i]![c]! - (bg[i]![c]! * 0.5 + ink[c]! * 0.5)));
    }
    results[label] = worst;
    expect(pts.length, label).toBeGreaterThan(100);
    expect(worst, `${label}: max channel error vs single 50% paint`).toBeLessThanOrEqual(2);
  }
  recordMetric(info, "opacity-single-paint", { maxChannelError: results });
});

for (const item of ["stroke", "image"] as const) {
  test(`a ${item} placed 600 levels deep stays visible while zooming 1500 more levels into it`, async ({ app }, info) => {
    await app.page.evaluate(() => window.__canvastDebug.setCamera({ cx: "-5p1", cy: "-3p0", zi: 600, zf: 0.5, pz: 600 }));
    await app.frame();
    let expectColor: number[];
    if (item === "stroke") {
      await app.page.keyboard.press("p"); // pen options are shown for the pen tool
      await app.page.getByRole("button", { name: /Pen colour #dc2626/ }).click();
      await app.page.getByRole("button", { name: "Pen width 8 px" }).click();
      await draw(app, [[500, 400], [780, 400]]);
      expectColor = [0xdc, 0x26, 0x26];
    } else {
      const { blockyFixture } = await import("./png");
      await app.page.getByTestId("import-input").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: blockyFixture() });
      await app.page.waitForFunction(() => window.__canvastDebug.objects().length === 1);
      await app.frame();
      // Centre the view on the middle of source pixel (3, 2), whose colour is
      // known from the fixture. (The viewport centre itself lies on a pixel
      // boundary of this 8×6 image, where smoothed minified drawing blends.)
      const img = (await app.page.evaluate(() => window.__canvastDebug.objects()))[0] as unknown as Obj & { w: number; h: number };
      const cx = D.add(D.parse(img.ax), D.shift(D.fromNumber((3.5 * img.w) / 8), img.unit));
      const cy = D.add(D.parse(img.ay), D.shift(D.fromNumber((2.5 * img.h) / 6), img.unit));
      await app.page.evaluate((c) => window.__canvastDebug.setCamera(c), { cx: D.toString(cx), cy: D.toString(cy), zi: 600, zf: 0.5, pz: 600 });
      expectColor = [40, 140, 220]; // palette[(3 + 2·3) mod 4] in png.ts
    }
    await app.page.locator("#canvas").focus();
    const failures: number[] = [];
    const PRESSES = reps(300, 150); // +2 levels each: 600 or 300 levels by keyboard
    for (let i = 1; i <= PRESSES; i++) {
      await app.page.keyboard.press("Shift+Equal"); // +2 levels at the viewport centre
      if (i % 25 === 0) {
        await app.frame();
        const c = await app.page.evaluate(() => window.__canvastDebug.pixelAt(640, 400));
        if (Math.max(...c.map((v, k) => Math.abs(v - expectColor[k]!))) > 3) failures.push(600 + 2 * i);
      }
    }
    if (PRESSES < 750) {
      // Quick suite: jump the rest of the way (past the old 2^900 cutoff) and check again.
      await app.page.getByTestId("zoom-readout").click();
      await app.page.getByTestId("zoom-input").fill("2100.5");
      await app.page.getByTestId("zoom-input").press("Enter");
      await app.frame();
      const c = await app.page.evaluate(() => window.__canvastDebug.pixelAt(640, 400));
      if (Math.max(...c.map((v, k) => Math.abs(v - expectColor[k]!))) > 3) failures.push(2100);
    }
    const cam = await app.camera();
    recordMetric(info, `deep-item-${item}`, { finalZoom: cam.zi + cam.zf, magnificationBeyondItemLog2: 1500, keyboardLevels: 2 * PRESSES, failures });
    expect(cam.zi).toBe(2100);
    // Picking agrees with drawing at this depth: a click selects the item.
    const id = (await app.page.evaluate(() => window.__canvastDebug.objects()))[0]!.id;
    await app.page.keyboard.press("v");
    await app.page.mouse.click(640, 400);
    await app.frame();
    expect(await app.page.evaluate(() => window.__canvastDebug.selection())).toEqual([id]);
    expect(failures, "zoom levels where the item's colour was missing at the centre").toEqual([]);
  });
}

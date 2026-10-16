import { FULL, LIMITS, assertFiniteCamera, distance, expect, percentile, recordMetric, reps, showTechnicalReadout, test } from "./harness";
import type { App } from "./harness";

/**
 * Phase 0A endless-navigation regression harness. Every test drives real
 * browser input against the single-file production build and measures the
 * result through exact world coordinates.
 */

const LANDMARK = "origin-0"; // unit square at the world origin

// Navigation tests drive the Hand tool so primary-button drags pan.
test.beforeEach(async ({ app }) => {
  await app.page.keyboard.press("h");
  expect(await app.page.evaluate(() => window.__canvastDebug.tool())).toBe("hand");
});

async function expectInked(app: App, label: string): Promise<number> {
  await app.frame();
  const n = await app.inked();
  expect(n, `visible rendering at ${label}`).toBeGreaterThan(LIMITS.minInkedSamples);
  return n;
}

test("loads offline from file:// with no network requests or errors", async ({ app }) => {
  await expect(app.page).toHaveTitle("canvast");
  await showTechnicalReadout(app.page);
  await expect(app.page.getByTestId("zoom-readout")).toContainText("zoom 2^0.00");
  await expectInked(app, "home");
  const lm = await app.landmark(LANDMARK);
  expect(distance(lm, { x: 640, y: 400 })).toBeLessThan(1e-9);
  expect(app.externalRequests).toEqual([]);
  expect(app.consoleErrors).toEqual([]);
});

for (const direction of ["in-first", "out-first"] as const) {
  const NOTCHES = reps(480, 120);
  test(`continuous wheel zoom ${direction}: ${NOTCHES} notches each way, anchored, exact return`, async ({ app }, info) => {
    // Trusted mouse events are delivered at integer CSS px in Chromium.
    const pointer = { x: 913, y: 247 };
    const before = await app.landmark(LANDMARK);
    const sign = direction === "in-first" ? -1 : 1;
    let maxDrift = 0;
    let checks = 0;
    await app.page.evaluate(() => window.__canvastDebug.resetFrameTimes());
    // The CSS-px delta of one notch is browser- and DPR-dependent (Chromium
    // reports 100 device px as 50 CSS px at DPR 2), so derive the expected
    // depth from the zoom change the first notch actually produced.
    let perNotch = 0;
    for (const phase of [sign, -sign]) {
      for (let i = 0; i < NOTCHES; i++) {
        const anchor = i % 25 === 0 ? await app.worldAt(pointer.x, pointer.y) : null;
        await app.wheel(pointer.x, pointer.y, 100 * phase);
        if (perNotch === 0) {
          await app.frame();
          const c = await app.camera();
          perNotch = Math.abs(c.zi + c.zf);
          expect(perNotch).toBeGreaterThan(0.1);
        }
        if (anchor) {
          await app.frame();
          maxDrift = Math.max(maxDrift, distance(await app.screenOf(anchor), pointer));
          checks++;
        }
      }
      await app.frame();
      const cam = await app.camera();
      assertFiniteCamera(cam);
      if (phase === sign) {
        // Full: 480 notches × 100/240 level = 200 levels at DPR 1. Every notch
        // must keep zooming by the same amount: no ramp-down, no clamp.
        expect(Math.abs(cam.zi + cam.zf)).toBeCloseTo(NOTCHES * perNotch, 3);
        expect(Math.abs(cam.zi + cam.zf)).toBeGreaterThan(NOTCHES * 0.2);
        await expectInked(app, `zoom ${cam.zi}`);
      }
    }
    const after = await app.landmark(LANDMARK);
    const cam = await app.camera();
    const frames = await app.page.evaluate(() => window.__canvastDebug.frameTimes());
    recordMetric(info, `wheel-zoom-${direction}`, {
      notches: 2 * NOTCHES,
      levelsPerNotch: perNotch,
      depthLevels: NOTCHES * perNotch,
      anchorChecks: checks,
      maxAnchorDriftPx: maxDrift,
      roundTripErrorPx: distance(after, before),
      frames: frames.length,
      renderMs: { p50: percentile(frames, 50), p95: percentile(frames, 95), p99: percentile(frames, 99), max: Math.max(...frames) },
    });
    expect(maxDrift).toBeLessThan(LIMITS.anchorDriftPx);
    expect(distance(after, before)).toBeLessThan(LIMITS.roundTripPx);
    expect(cam.zi + cam.zf).toBe(0);
    expect(percentile(frames, 95)).toBeLessThan(LIMITS.renderP95Ms);
    expect(app.consoleErrors).toEqual([]);
  });
}

// The one long run (full suite, `chromium` only: ~3.5 min): a slow leak or drift that only shows after
// many hundreds of notches. Replaces the old 1,200-notch loop of the wheel tests.
test("very long wheel zoom: 2,000 notches in, then 2,000 out, returns exactly", async ({ app }, info) => {
  test.skip(!FULL || info.project.name !== "chromium", "full suite, chromium project only");
  test.setTimeout(600_000);
  const pointer = { x: 913, y: 247 };
  const before = await app.landmark(LANDMARK);
  for (const sign of [-1, 1]) for (let i = 0; i < 2000; i++) await app.wheel(pointer.x, pointer.y, 100 * sign);
  await app.frame();
  assertFiniteCamera(await app.camera());
  expect(distance(await app.landmark(LANDMARK), before)).toBeLessThan(LIMITS.roundTripPx);
  const cam = await app.camera();
  expect(cam.zi + cam.zf).toBe(0);
});

test("mixed zoom inputs: pinch (ctrl+wheel), keyboard, buttons", async ({ app }, info) => {
  const pointer = { x: 333, y: 611 };
  const before = await app.landmark(LANDMARK);
  let maxDrift = 0;
  const anchor = await app.worldAt(pointer.x, pointer.y);
  const PINCH = reps(120, 60);
  for (let i = 0; i < PINCH; i++) {
    await app.wheel(pointer.x, pointer.y, -3.7, { ctrl: true });
  }
  await app.frame();
  maxDrift = Math.max(maxDrift, distance(await app.screenOf(anchor), pointer));
  for (let i = 0; i < PINCH; i++) {
    await app.wheel(pointer.x, pointer.y, 3.7, { ctrl: true });
  }
  await app.frame();
  maxDrift = Math.max(maxDrift, distance(await app.screenOf(anchor), pointer));
  const afterPinch = await app.landmark(LANDMARK);

  // Keyboard and buttons zoom about the viewport center.
  const center = await app.worldAt(640, 400);
  const canvas = app.page.locator("#canvas");
  await canvas.focus();
  for (let i = 0; i < 40; i++) await app.page.keyboard.press("Equal");
  for (let i = 0; i < 20; i++) await app.page.getByRole("button", { name: "Zoom in" }).click();
  await app.frame();
  const deep = await app.camera();
  expect(deep.zi + deep.zf).toBeCloseTo(40, 6);
  for (let i = 0; i < 20; i++) await app.page.getByRole("button", { name: "Zoom out" }).click();
  await canvas.focus();
  for (let i = 0; i < 40; i++) await app.page.keyboard.press("Minus");
  await app.frame();
  const centerDrift = distance(await app.screenOf(center), { x: 640, y: 400 });
  const after = await app.landmark(LANDMARK);
  recordMetric(info, "mixed-zoom", {
    pinchSteps: 2 * PINCH,
    pinchAnchorDriftPx: maxDrift,
    pinchRoundTripPx: distance(afterPinch, before),
    keyboardButtonCenterDriftPx: centerDrift,
    roundTripPx: distance(after, before),
  });
  expect(maxDrift).toBeLessThan(LIMITS.anchorDriftPx);
  expect(distance(afterPinch, before)).toBeLessThan(LIMITS.roundTripPx);
  expect(centerDrift).toBeLessThan(LIMITS.anchorDriftPx);
  expect(distance(after, before)).toBeLessThan(LIMITS.roundTripPx);
});

test("directional pan at shallow, deep and far-out zoom returns exactly", async ({ app }, info) => {
  test.setTimeout(480_000); // 480 drags + full-resolution ink checks; slow at DPR 2
  const results: Record<string, number> = {};
  const DEPTH_NOTCHES = reps(240, 120); // 100 or 50 levels at DPR 1
  const DRAGS = reps(16, 4);
  for (const [label, notches] of [["home", 0], ["deep", -DEPTH_NOTCHES], ["far out", DEPTH_NOTCHES]] as const) {
    await app.page.getByRole("button", { name: "Return to origin" }).click();
    for (let i = 0; i < Math.abs(notches); i++) await app.wheel(500, 300, Math.sign(notches) * 100);
    await app.frame();
    const ref = await app.worldAt(640, 400);
    const startPos = await app.screenOf(ref);
    // Long traversal: DRAGS drags of 600 px in each direction, then back.
    const legs: Array<[number, number]> = [[600, 0], [0, 350], [-600, 0], [0, -350]];
    for (const [dx, dy] of legs) {
      for (let i = 0; i < DRAGS; i++) {
        await app.drag({ x: 640 - dx / 2, y: 400 - dy / 2 }, { x: 640 + dx / 2, y: 400 + dy / 2 });
      }
      await expectInked(app, `${label} after leg ${dx},${dy}`);
      assertFiniteCamera(await app.camera());
    }
    const endPos = await app.screenOf(ref);
    results[label] = distance(endPos, startPos);
  }
  // Keyboard panning in all four directions.
  const ref = await app.worldAt(640, 400);
  await app.page.locator("#canvas").focus();
  for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
    for (let i = 0; i < reps(25, 10); i++) await app.page.keyboard.press(key);
  }
  await app.frame();
  results["keyboard"] = distance(await app.screenOf(ref), { x: 640, y: 400 });
  recordMetric(info, "directional-pan", { returnErrorPx: results });
  for (const [label, err] of Object.entries(results)) {
    expect(err, label).toBeLessThan(LIMITS.roundTripPx);
  }
});

test("drag pans content exactly with the pointer, near and astronomically far away", async ({ app }) => {
  for (const cam of [
    { cx: "0p0", cy: "0p0", zi: 0, zf: 0, pz: 0 },
    { cx: "1p5000", cy: "-1p5000", zi: -4990, zf: 0.5, pz: -4990 },
    { cx: "3p-3000", cy: "1p0", zi: 3005, zf: 0.25, pz: 3005 },
  ]) {
    await app.page.evaluate((c) => window.__canvastDebug.setCamera(c), cam);
    const w = await app.worldAt(380, 260);
    await app.drag({ x: 380, y: 260 }, { x: 517, y: 133 }, 13);
    await app.frame();
    expect(distance(await app.screenOf(w), { x: 517, y: 133 })).toBeLessThan(LIMITS.anchorDriftPx);
    await expectInked(app, `camera ${cam.cx}`);
  }
});

test("renders and stays interactive at extreme depths and distances", async ({ app }) => {
  for (const cam of [
    { cx: "0p0", cy: "0p0", zi: 1100, zf: 0.5, pz: 1100 },
    { cx: "0p0", cy: "0p0", zi: -1100, zf: 0.5, pz: -1100 },
    { cx: "-3p200", cy: "5p200", zi: -190, zf: 0, pz: -190 },
    { cx: "1p0", cy: "1p0", zi: 305, zf: 0, pz: 305 },
    { cx: "12345678901234567890123p9000", cy: "-1p-9000", zi: 9000, zf: 0.75, pz: 9000 },
  ]) {
    await app.page.evaluate((c) => window.__canvastDebug.setCamera(c), cam);
    await expectInked(app, `camera ${JSON.stringify(cam)}`);
    // Still responds to zoom input after arrival.
    const before = await app.camera();
    await app.wheel(640, 400, -100);
    await app.frame();
    const after = await app.camera();
    expect(after.zi + after.zf).toBeGreaterThan(before.zi + before.zf);
  }
  // Landmarks beyond the double range are where they belong.
  await app.page.evaluate(() =>
    window.__canvastDebug.setCamera({ cx: "-3p200", cy: "5p200", zi: -190, zf: 0, pz: -190 }),
  );
  const west = await app.landmark("west-2^200");
  expect(distance(west, { x: 640, y: 400 })).toBeLessThan(1e-9);
  expect(west.sizePx).toBe(1);
  await app.page.evaluate(() => window.__canvastDebug.setCamera({ cx: "1p0", cy: "1p0", zi: 305, zf: 0, pz: 305 }));
  const nearOne = await app.landmark("near-one-2^-300");
  // 2^-300 world units to the right of 1.0 at 2^305 px/unit = 32 px.
  expect(distance(nearOne, { x: 672, y: 400 })).toBeLessThan(1e-9);
  await showTechnicalReadout(app.page);
  await expect(app.page.getByTestId("zoom-readout")).toContainText("2^305.00");
  expect(app.consoleErrors).toEqual([]);
});

test("touch pinch zooms about a fractional finger centroid and returns", async ({ app, browserName }, info) => {
  test.skip(info.project.name !== "chromium-dpr2", "touch runs in the touch-enabled project");
  test.skip(browserName !== "chromium", "uses the Chromium touch protocol");
  const cdp = await app.page.context().newCDPSession(app.page);
  const touch = async (type: "touchStart" | "touchMove" | "touchEnd", points: Array<{ x: number; y: number }>): Promise<void> => {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
    });
  };
  // Touch reaches the app as PointerEvents, which keep fractional CSS px
  // (unlike MouseEvent/WheelEvent clientX, which Chromium truncates).
  const c = { x: 700.35, y: 380.6 };
  const anchor = await app.worldAt(c.x, c.y);
  const before = await app.landmark(LANDMARK);
  let maxDrift = 0;
  for (let rep = 0; rep < reps(6, 2); rep++) {
    for (const [from, to] of [[40, 320], [320, 40]] as const) {
      await touch("touchStart", [{ x: c.x - from, y: c.y }, { x: c.x + from, y: c.y }]);
      for (let s = 1; s <= 12; s++) {
        const r = from + ((to - from) * s) / 12;
        await touch("touchMove", [{ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }]);
      }
      await touch("touchEnd", []);
      await app.frame();
      maxDrift = Math.max(maxDrift, distance(await app.screenOf(anchor), c));
    }
  }
  const after = await app.landmark(LANDMARK);
  const cam = await app.camera();
  recordMetric(info, "touch-pinch", { gestures: 2 * reps(6, 2), maxAnchorDriftPx: maxDrift, roundTripPx: distance(after, before), finalZoom: cam.zi + cam.zf });
  expect(maxDrift).toBeLessThan(LIMITS.anchorDriftPx);
  expect(distance(after, before)).toBeLessThan(LIMITS.roundTripPx);
});

import * as D from "../../src/core/dyadic";
import { LIMITS, distance, expect, recordMetric, reps, test } from "./harness";
import type { App } from "./harness";
import { blockyFixture } from "./png";

/**
 * Phase 0B: editing, precision and recovery. Scenario ids (U1, U2, ...) match
 * docs/testing/phase-0b.md. Every assertion inspects authoritative object
 * coordinates through the debug hook, not just pixels.
 */

type Obj = Record<string, unknown> & { id: string; kind: string; ax: string; ay: string };
type Box = { minX: number; minY: number; maxX: number; maxY: number };

const PEN_WIDTH_PX = 3; // default pen width

async function objects(app: App): Promise<Obj[]> {
  return (await app.page.evaluate(() => window.__canvastDebug.objects())) as Obj[];
}
async function selection(app: App): Promise<string[]> {
  return app.page.evaluate(() => window.__canvastDebug.selection());
}
async function screenOfObject(app: App, id: string) {
  return app.page.evaluate((i) => window.__canvastDebug.objectScreen(i), id);
}
async function key(app: App, k: string): Promise<void> {
  await app.page.keyboard.press(k);
}
async function importImage(app: App): Promise<Obj> {
  const before = new Set((await objects(app)).map((o) => o.id));
  await app.page.getByTestId("import-input").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer: blockyFixture() });
  await app.page.waitForFunction((n) => window.__canvastDebug.objects().length === n + 1, before.size);
  await app.frame();
  return (await objects(app)).find((o) => !before.has(o.id))!;
}
/** Draw with the pen along the given screen points (real mouse input). */
async function penStroke(app: App, pts: Array<[number, number]>): Promise<Obj> {
  const before = new Set((await objects(app)).map((o) => o.id));
  await key(app, "p");
  await app.page.mouse.move(pts[0]![0], pts[0]![1]);
  await app.page.mouse.down();
  for (let i = 1; i < pts.length; i++) await app.page.mouse.move(pts[i]![0], pts[i]![1], { steps: 6 });
  await app.page.mouse.up();
  await app.frame();
  const created = (await objects(app)).filter((o) => !before.has(o.id));
  expect(created).toHaveLength(1);
  return created[0]!;
}
async function click(app: App, x: number, y: number, mods: string[] = []): Promise<void> {
  for (const m of mods) await app.page.keyboard.down(m);
  await app.page.mouse.click(x, y);
  for (const m of mods) await app.page.keyboard.up(m);
  await app.frame();
}
async function drag(app: App, from: [number, number], to: [number, number]): Promise<void> {
  await app.drag({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, 10);
  await app.frame();
}
function worldDelta(a: { x: string; y: string }, b: { x: string; y: string }) {
  return { dx: D.sub(D.parse(b.x), D.parse(a.x)), dy: D.sub(D.parse(b.y), D.parse(a.y)) };
}
function moved(o: Obj, d: { dx: D.Dyadic; dy: D.Dyadic }): { ax: string; ay: string } {
  return { ax: D.toString(D.add(D.parse(o.ax), d.dx)), ay: D.toString(D.add(D.parse(o.ay), d.dy)) };
}
const pick = (o: Obj) => ({ ax: o.ax, ay: o.ay });
function byId(all: Obj[], id: string): Obj {
  const o = all.find((x) => x.id === id);
  if (!o) throw new Error(`object ${id} missing`);
  return o;
}
async function wheelSteps(app: App, x: number, y: number, n: number, deltaY: number): Promise<void> {
  for (let i = 0; i < n; i++) await app.wheel(x, y, deltaY);
  await app.frame();
}
async function reload(app: App): Promise<void> {
  expect(await app.page.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await app.page.reload();
  await app.page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await app.frame();
}

test("U1/U2/U4/U5: draw over deep-zoomed media, move only the media, lasso strokes only, undo/redo, save/reopen", async ({ app }, info) => {
  const img0 = await importImage(app);
  expect(img0.kind).toBe("image");
  expect(await selection(app)).toEqual([]);

  // U1 — zoom 10 levels into the 8×6-pixel image: one source pixel ≈ 1024 px.
  // Keyboard steps (0.5 level each, at the centre) do not depend on the
  // DPR-scaled CSS size of a wheel notch.
  await app.page.locator("#canvas").focus();
  for (let i = 0; i < 20; i++) await app.page.keyboard.press("Equal");
  await app.frame();
  expect((await app.camera()).zi).toBe(10);
  const imgScreen = (await screenOfObject(app, img0.id))!;
  expect(imgScreen.box.maxX - imgScreen.box.minX).toBeGreaterThan(8000);
  const stroke = await penStroke(app, [[500, 300], [650, 420], [800, 500]]);
  const afterDraw = await objects(app);
  expect(byId(afterDraw, img0.id)).toEqual(img0); // media untouched
  expect(stroke.kind).toBe("stroke");
  expect(stroke["attachmentTargetId"]).toBeNull();
  expect(stroke["z"] as number).toBeGreaterThan(img0["z"] as number);
  expect(await selection(app)).toEqual([]); // drawing never selects
  const sq = (await screenOfObject(app, stroke.id))!;
  expect(distance({ x: sq.q[0]!, y: sq.q[1]! }, { x: 500, y: 300 })).toBeLessThan(LIMITS.anchorDriftPx);
  expect(distance({ x: sq.q[sq.q.length - 2]!, y: sq.q[sq.q.length - 1]! }, { x: 800, y: 500 })).toBeLessThan(LIMITS.anchorDriftPx);
  expect(Math.abs(2 * sq.radius - PEN_WIDTH_PX)).toBeLessThan(1e-6);
  // Magnified media shows its own pixels (one of the 4 source colours), never invented detail.
  const palette = ["220,60,50", "40,140,220", "250,200,40", "60,170,90"];
  for (const [x, y] of [[100, 700], [1200, 100], [300, 120]] as const) {
    expect(palette).toContain((await app.page.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y])).join(","));
  }

  // U5 — direct click selects the viewport-filling image; dragging it moves only it.
  await key(app, "v");
  // This test checks the exact pointer delta, so snapping to the stroke nearby is off (it has its own test).
  await app.page.getByRole("button", { name: "Snap to other objects" }).click();
  await click(app, 300, 560);
  expect(await selection(app)).toEqual([img0.id]);
  const w0 = await app.worldAt(300, 560);
  const w1 = await app.worldAt(500, 550);
  await drag(app, [300, 560], [500, 550]);
  const afterMove = await objects(app);
  const img1 = byId(afterMove, img0.id);
  expect(pick(img1)).toEqual(moved(img0, worldDelta(w0, w1))); // exact world delta
  expect(byId(afterMove, stroke.id)).toEqual(stroke); // U2: stroke stays at A

  // U2 — undo/redo are exact.
  await app.page.keyboard.press("Control+z");
  await app.frame();
  expect(byId(await objects(app), img0.id)).toEqual(img0);
  await app.page.keyboard.press("Control+Shift+z");
  await app.frame();
  expect(byId(await objects(app), img0.id)).toEqual(img1);

  // Dragging from an *unselected* image never moves it (it starts a box select).
  await key(app, "Escape");
  await drag(app, [200, 700], [260, 740]);
  expect(byId(await objects(app), img0.id)).toEqual(img1);

  // U4 — lasso around the stroke while the image fills the viewport.
  const cam0 = await app.camera();
  const strokeNow = (await screenOfObject(app, stroke.id))!;
  const pad = 30;
  const lasso: Array<[number, number]> = [
    [strokeNow.box.minX - pad, strokeNow.box.minY - pad],
    [strokeNow.box.maxX + pad, strokeNow.box.minY - pad],
    [strokeNow.box.maxX + pad, strokeNow.box.maxY + pad],
    [strokeNow.box.minX - pad, strokeNow.box.maxY + pad],
  ];
  for (const filter of ["strokes", "all"] as const) {
    await key(app, "Escape");
    await app.page.evaluate((f) => window.__canvastDebug.setLassoFilter(f), filter);
    await key(app, "l");
    await app.page.mouse.move(...lasso[0]!);
    await app.page.mouse.down();
    for (const p of [...lasso.slice(1), lasso[0]!]) await app.page.mouse.move(p[0], p[1], { steps: 5 });
    await app.page.mouse.up();
    await app.frame();
    expect(await selection(app), `lasso filter ${filter}`).toEqual([stroke.id]);
  }
  expect(await app.camera()).toEqual(cam0); // no accidental camera move
  expect(byId(await objects(app), img0.id)).toEqual(img1); // no accidental image move

  // Persistence — save, reopen: identical ids, coordinates and camera.
  const beforeReload = await objects(app);
  await reload(app);
  expect(await objects(app)).toEqual(beforeReload);
  expect(await app.camera()).toEqual(cam0);
  // Undo history does not survive reload (snapshot persistence), the state does.
  expect(await app.page.evaluate(() => window.__canvastDebug.canUndo())).toBe(false);
  recordMetric(info, "u1-u2-u4-u5", {
    strokeEndpointErrorPx: [
      distance({ x: sq.q[0]!, y: sq.q[1]! }, { x: 500, y: 300 }),
      distance({ x: sq.q[sq.q.length - 2]!, y: sq.q[sq.q.length - 1]! }, { x: 800, y: 500 }),
    ],
    strokeWidthPx: 2 * sq.radius,
    imageScreenWidthPx: imgScreen.box.maxX - imgScreen.box.minX,
  });
  expect(app.consoleErrors).toEqual([]);
});

test("U7: stroke drawn at a tiny scale is stable after zooming out and back, and stays editable", async ({ app }, info) => {
  // Arrive 300 levels deep near 1 + 2^-300 (far below double resolution at 1.0).
  await app.page.evaluate(() =>
    window.__canvastDebug.setCamera({ cx: "1p0", cy: "1p0", zi: 300, zf: 0.5, pz: 300 }),
  );
  await app.frame();
  const stroke = await penStroke(app, [[400, 300], [520, 380], [700, 340], [760, 520]]);
  const s0 = (await screenOfObject(app, stroke.id))!;
  // Zoom out ~125 levels at a point away from the stroke, then back in.
  const OUT = reps(300, 80); // ~125 or ~33 levels out, then back
  await wheelSteps(app, 1000, 150, OUT, 100);
  const tiny = (await screenOfObject(app, stroke.id))!;
  // Far below a pixel. (Quick mode at DPR 2 zooms out only ~17 levels: a notch is 50 CSS px there.)
  expect(tiny.box.maxX - tiny.box.minX).toBeLessThan(reps(1e-30, 0.05));
  await wheelSteps(app, 1000, 150, OUT, -100);
  const s1 = (await screenOfObject(app, stroke.id))!;
  let maxErr = 0;
  for (let i = 0; i < s0.q.length; i += 2) maxErr = Math.max(maxErr, distance({ x: s0.q[i]!, y: s0.q[i + 1]! }, { x: s1.q[i]!, y: s1.q[i + 1]! }));
  expect(maxErr).toBeLessThan(LIMITS.roundTripPx);
  expect(Math.abs(s1.radius - s0.radius)).toBeLessThan(1e-9);

  // Hit-test, drag and resize at this scale.
  await key(app, "v");
  await click(app, 520, 380);
  expect(await selection(app)).toEqual([stroke.id]);
  const w0 = await app.worldAt(520, 380);
  const w1 = await app.worldAt(580, 330);
  await drag(app, [520, 380], [580, 330]);
  const movedStroke = byId(await objects(app), stroke.id);
  expect(pick(movedStroke)).toEqual(moved(stroke, worldDelta(w0, w1)));
  const r = await resizeFromBottomRight(app, stroke.id, 80, 40);
  recordMetric(info, "u7", { roundTripMaxErrorPx: maxErr, widthPx: 2 * s1.radius, resize: r });
});

/**
 * Drag the bottom-right selection handle by (dx, dy) and check the fixed
 * top-left corner and the uniform scale factor against the projected result.
 */
async function resizeFromBottomRight(app: App, id: string, dx: number, dy: number) {
  const before = (await screenOfObject(app, id))!;
  const b = before.box;
  // Trusted mouse input is integral; the gesture measures the pointer against
  // the exact handle corner, so compute the expected factor the same way.
  const from: [number, number] = [Math.round(b.maxX), Math.round(b.maxY)];
  const to: [number, number] = [from[0] + dx, from[1] + dy];
  await drag(app, from, to);
  const after = (await screenOfObject(app, id))!;
  const sx = b.maxX - b.minX;
  const sy = b.maxY - b.minY;
  const k = (sx * (to[0] - b.minX) + sy * (to[1] - b.minY)) / (sx * sx + sy * sy);
  const a = after.box;
  const cornerErr = distance({ x: a.minX, y: a.minY }, { x: b.minX, y: b.minY });
  const sizeErr = Math.max(Math.abs(a.maxX - a.minX - sx * k), Math.abs(a.maxY - a.minY - sy * k));
  expect(cornerErr).toBeLessThan(LIMITS.anchorDriftPx);
  expect(sizeErr).toBeLessThan(LIMITS.anchorDriftPx);
  return { k, cornerErr, sizeErr };
}

for (const scenario of [
  { name: "deep +1000 levels near 3·2^-1000", cam: { cx: "3p-1000", cy: "-5p-1001", zi: 1000, zf: 0.25, pz: 1000 } },
  { name: "far out -1000 levels at 2^1000", cam: { cx: "1p1000", cy: "-7p998", zi: -1000, zf: 0.75, pz: -1000 } },
]) {
  test(`new-scale creation: draw, hit-test, drag, resize, undo at ${scenario.name}`, async ({ app }, info) => {
    await app.page.evaluate((c) => window.__canvastDebug.setCamera(c), scenario.cam);
    await app.frame();
    const a = await penStroke(app, [[300, 300], [420, 260], [520, 360]]);
    const b = await penStroke(app, [[700, 500], [820, 420], [900, 560]]);
    await key(app, "v");
    await click(app, 420, 260);
    expect(await selection(app)).toEqual([a.id]);
    await click(app, 820, 420, ["Shift"]);
    expect(await selection(app)).toEqual([a.id, b.id].sort());
    const w0 = await app.worldAt(420, 260);
    const w1 = await app.worldAt(470, 230);
    await drag(app, [420, 260], [470, 230]); // multi-move
    const all = await objects(app);
    const d = worldDelta(w0, w1);
    expect(pick(byId(all, a.id))).toEqual(moved(a, d));
    expect(pick(byId(all, b.id))).toEqual(moved(b, d));
    await key(app, "Escape");
    await click(app, 470, 230);
    const r = await resizeFromBottomRight(app, a.id, 60, 60);
    // Undo resize and move restore the exact stored objects.
    await app.page.keyboard.press("Control+z");
    await app.page.keyboard.press("Control+z");
    await app.frame();
    const restored = await objects(app);
    expect(byId(restored, a.id)).toEqual(a);
    expect(byId(restored, b.id)).toEqual(b);
    recordMetric(info, `new-scale-${scenario.cam.zi}`, { resize: r });
  });
}

test("U8: strokes in far-apart regions stay independent, addressable and persistent", async ({ app }, info) => {
  const a = await penStroke(app, [[560, 380], [640, 420], [720, 380]]);
  const aScreen = (await screenOfObject(app, a.id))!;
  // Travel with real input: zoom out ~1000 levels (shift+minus = 2 levels),
  // pan 12 half-screens to the right and 6 down, zoom back in ~1000 levels.
  await app.page.locator("#canvas").focus();
  const TRAVEL = reps(500, 100); // ×2 levels: ~1000 or ~200 levels out and back
  for (let i = 0; i < TRAVEL; i++) await app.page.keyboard.press("Shift+Minus");
  for (let i = 0; i < 12; i++) await app.page.keyboard.press("Shift+ArrowRight");
  for (let i = 0; i < 6; i++) await app.page.keyboard.press("Shift+ArrowDown");
  for (let i = 0; i < TRAVEL; i++) await app.page.keyboard.press("Shift+Equal");
  await app.frame();
  const farCam = await app.camera();
  expect(farCam.zi + farCam.zf).toBeCloseTo(0, 6);
  // The new region is ~2^1000 world units away: the first stroke is far offscreen.
  expect(await screenOfObject(app, a.id)).toBeNull();
  const farX = D.parse(farCam.cx);
  expect(D.bitLength(farX.m) + farX.e).toBeGreaterThan(2 * TRAVEL - 100); // log2 of the distance
  const b = await penStroke(app, [[500, 300], [600, 250], [700, 320]]);
  const bScreen = (await screenOfObject(app, b.id))!;

  // Home: A is exactly where it was drawn; B is not visible.
  await key(app, "0");
  await app.frame();
  expect((await screenOfObject(app, a.id))!.q).toEqual(aScreen.q);
  expect(await screenOfObject(app, b.id)).toBeNull();
  await key(app, "v");
  await click(app, 640, 420);
  expect(await selection(app)).toEqual([a.id]);

  // Save and reopen, then revisit the far region via the saved camera.
  await app.page.evaluate((c) => window.__canvastDebug.setCamera(c), farCam);
  await app.frame();
  const beforeReload = await objects(app);
  await reload(app);
  expect(await objects(app)).toEqual(beforeReload);
  expect(await app.camera()).toEqual(farCam);
  expect((await screenOfObject(app, b.id))!.q).toEqual(bScreen.q);
  await click(app, 600, 250);
  expect(await selection(app)).toEqual([b.id]);
  const w0 = await app.worldAt(600, 250);
  const w1 = await app.worldAt(650, 280);
  await drag(app, [600, 250], [650, 280]);
  const all = await objects(app);
  expect(pick(byId(all, b.id))).toEqual(moved(b, worldDelta(w0, w1)));
  expect(byId(all, a.id)).toEqual(a);
  recordMetric(info, "u8", { farDistanceLog2: D.bitLength(farX.m) + farX.e, objects: all.length });
});

test("delete, undo delete, and invalid imports are reported without corrupting the document", async ({ app }) => {
  const s = await penStroke(app, [[300, 300], [400, 350]]);
  await key(app, "v");
  await click(app, 350, 325);
  await key(app, "Delete");
  await app.frame();
  expect(await objects(app)).toEqual([]);
  await app.page.keyboard.press("Control+z");
  await app.frame();
  expect(await objects(app)).toEqual([s]);
  await app.page
    .getByTestId("import-input")
    .setInputFiles({ name: "not-an-image.png", mimeType: "image/png", buffer: Buffer.from("definitely not a png") });
  await expect(app.page.getByTestId("toast")).toContainText("could not be decoded");
  expect(await objects(app)).toEqual([s]);
});

test("selection action bar: follows the selection, hides while moving and for non-selecting tools, and acts (ADR 0051)", async ({ app }) => {
  const p = app.page;
  const bar = p.getByTestId("context-bar");
  await expect(bar).toBeHidden();
  await key(app, "p");
  await app.drag({ x: 500, y: 450 }, { x: 700, y: 470 }, 4);
  await app.drag({ x: 500, y: 520 }, { x: 700, y: 540 }, 4);
  expect(await objects(app)).toHaveLength(2);
  await key(app, "v");
  const [a, b] = await objects(app);
  const click = async (id: string) => {
    const s = (await screenOfObject(app, id))!;
    await p.mouse.click(Math.round((s.box.minX + s.box.maxX) / 2), Math.round((s.box.minY + s.box.maxY) / 2));
  };
  await click(a!.id);
  await expect(bar).toBeVisible();
  // Below the selection, and clear of it.
  const sel = (await screenOfObject(app, a!.id))!.box;
  const bb = (await bar.boundingBox())!;
  expect(bb.y).toBeGreaterThanOrEqual(sel.maxY);
  await expect(bar.getByRole("button", { name: "Group" })).toBeHidden(); // one object
  // It follows a pan.
  const y0 = bb.y;
  await key(app, "ArrowUp");
  await app.frame();
  await expect.poll(async () => (await bar.boundingBox())!.y).not.toBe(y0);
  await key(app, "ArrowDown");
  // Not for tools that do not select.
  await key(app, "h");
  await expect(bar).toBeHidden();
  await key(app, "v");
  await expect(bar).toBeVisible();
  // Two objects: Group appears and works; Duplicate adds; Delete removes.
  await p.keyboard.press("Control+a");
  await expect(bar.getByRole("button", { name: "Group" })).toBeVisible();
  await bar.getByRole("button", { name: "Group" }).click();
  expect((await objects(app)).every((o) => Array.isArray(o["groups"]))).toBe(true);
  await expect(bar.getByRole("button", { name: "Ungroup" })).toBeVisible();
  await bar.getByRole("button", { name: "Duplicate" }).click();
  expect(await objects(app)).toHaveLength(4);
  await bar.getByRole("button", { name: "Delete selection" }).click();
  expect(await objects(app)).toHaveLength(2);
  await expect(bar).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

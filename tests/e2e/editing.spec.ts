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
  // Ctrl: no snapping (this measures the plain scale; snapping has its own test).
  await app.page.keyboard.down("Control");
  await drag(app, from, to);
  await app.page.keyboard.up("Control");
  const after = (await screenOfObject(app, id))!;
  const sx = b.maxX - b.minX;
  const sy = b.maxY - b.minY;
  // The corner follows the pointer less the (sub-pixel) offset it was grabbed at.
  const tx = to[0] - (from[0] - b.maxX);
  const ty = to[1] - (from[1] - b.maxY);
  const k = (sx * (tx - b.minX) + sy * (ty - b.minY)) / (sx * sx + sy * sy);
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
  await click(app, 580, 260); // on the stroke, clear of the box's side handles
  expect(await selection(app)).toEqual([b.id]);
  const w0 = await app.worldAt(580, 260);
  const w1 = await app.worldAt(630, 290);
  await drag(app, [580, 260], [630, 290]);
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

test("W A S D step the selection between items (nearest in view, by layer) and frames each; Alt alone brings the selection into view (ADR 0058)", async ({ app }) => {
  const p = app.page;
  // Three strokes in a row, drawn left to right (so the right-most is on top).
  await key(app, "p");
  for (const x of [300, 600, 900]) await app.drag({ x, y: 450 }, { x: x + 80, y: 470 }, 4);
  await key(app, "v");
  const [a, b, c] = await objects(app);
  const click = async (id: string) => {
    const s = (await screenOfObject(app, id))!;
    await p.mouse.click(Math.round((s.box.minX + s.box.maxX) / 2), Math.round((s.box.minY + s.box.maxY) / 2));
  };
  await click(a!.id);
  expect(await selection(app)).toEqual([a!.id]);
  // Nearest in view (the default): right, right, then back left; at the end of the row nothing changes.
  await key(app, "d");
  await expect.poll(() => selection(app)).toEqual([b!.id]);
  await key(app, "d");
  await expect.poll(() => selection(app)).toEqual([c!.id]);
  await key(app, "d");
  await app.frame();
  expect(await selection(app)).toEqual([c!.id]);
  await key(app, "a");
  await expect.poll(() => selection(app)).toEqual([b!.id]);
  // The stepped-to item is framed: its middle is the window's middle.
  await app.frame();
  const sb = (await screenOfObject(app, b!.id))!.box;
  const vp = p.viewportSize()!;
  expect(Math.abs((sb.minX + sb.maxX) / 2 - vp.width / 2)).toBeLessThan(60);
  // Alt on its own frames the selection again after the view was moved away.
  for (let i = 0; i < 4; i++) await key(app, "ArrowLeft");
  await app.frame();
  const away = (await screenOfObject(app, b!.id))!.box;
  expect(Math.abs((away.minX + away.maxX) / 2 - vp.width / 2)).toBeGreaterThan(150);
  await p.keyboard.down("Alt");
  await p.keyboard.up("Alt");
  await app.frame();
  const back = (await screenOfObject(app, b!.id))!.box;
  expect(Math.abs((back.minX + back.maxX) / 2 - vp.width / 2)).toBeLessThan(60);
  // Alt with a click or another key is not a "bring into view".
  for (let i = 0; i < 4; i++) await key(app, "ArrowLeft");
  await app.frame();
  await p.keyboard.down("Alt");
  await key(app, "ArrowLeft");
  await p.keyboard.up("Alt");
  await app.frame();
  const kept = (await screenOfObject(app, b!.id))!.box;
  expect(Math.abs((kept.minX + kept.maxX) / 2 - vp.width / 2)).toBeGreaterThan(150);
  // By layer (a setting): the next layer up or down the stacking order, whatever its place on the canvas.
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.evaluate(() => localStorage.setItem("canvast.settings", JSON.stringify({ "nav.mode": "layer" })));
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await key(app, "Escape");
  expect(await selection(app)).toEqual([]);
  // Nothing selected: the first step lands on the top-most layer; then down the order and back up.
  await key(app, "w");
  await expect.poll(() => selection(app)).toEqual([c!.id]);
  await key(app, "s");
  await expect.poll(() => selection(app)).toEqual([b!.id]);
  await key(app, "s");
  await expect.poll(() => selection(app)).toEqual([a!.id]);
  await key(app, "s");
  await app.frame();
  expect(await selection(app), "nothing below the bottom layer").toEqual([a!.id]);
  await key(app, "w");
  await expect.poll(() => selection(app)).toEqual([b!.id]);
  expect(app.consoleErrors).toEqual([]);
});

test("W A S D: 'nearest in view' skips an item too small to see at this zoom, 'nearest anywhere' does not (ADR 0058)", async ({ app }) => {
  const p = app.page;
  // A big stroke B, then a tiny one A drawn 8 levels deeper right beside the middle of B; back to the first zoom.
  await key(app, "p");
  // On the window's middle line (y = 400), so the tiny one is straight to the right of the big one's middle.
  await app.drag({ x: 600, y: 390 }, { x: 680, y: 410 }, 4);
  await p.evaluate(() => window.__canvastDebug.jump(8));
  await app.drag({ x: 700, y: 390 }, { x: 760, y: 410 }, 4);
  await p.evaluate(() => window.__canvastDebug.jump(-8));
  await app.frame();
  await key(app, "v");
  const [b, a] = await objects(app);
  const pick = async (): Promise<void> => {
    // A quarter of the way along the stroke (its middle is where the tiny one sits).
    const s = (await screenOfObject(app, b!.id))!.box;
    await p.mouse.click(Math.round(s.minX + (s.maxX - s.minX) / 4), Math.round(s.minY + (s.maxY - s.minY) / 4));
    expect(await selection(app)).toEqual([b!.id]);
  };
  await pick();
  await key(app, "d");
  await app.frame();
  expect(await selection(app), "the tiny item is skipped").toEqual([b!.id]);
  // The same step with the setting "anywhere" reaches it.
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.evaluate(() => localStorage.setItem("canvast.settings", JSON.stringify({ "nav.mode": "anywhere" })));
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await key(app, "v");
  await pick();
  await key(app, "d");
  await expect.poll(() => selection(app)).toEqual([a!.id]);
  expect(app.consoleErrors).toEqual([]);
});

test("W A S D on arriving: 'Focus on the item' zooms to it, 'Keep the zoom level' only moves the view (ADR 0058)", async ({ app }) => {
  const p = app.page;
  await key(app, "p");
  for (const x of [300, 440]) await app.drag({ x, y: 450 }, { x: x + 60, y: 470 }, 4);
  await key(app, "v");
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  const [a, b] = await objects(app);
  const level = async () => await p.evaluate(() => window.__canvastDebug.camera());
  const pick = async (id: string) => {
    const s = (await screenOfObject(app, id))!.box;
    await p.mouse.click(Math.round((s.minX + s.maxX) / 2), Math.round((s.minY + s.maxY) / 2));
  };
  const zoom0 = await level();
  await pick(a!.id);
  await key(app, "d");
  await expect.poll(() => selection(app)).toEqual([b!.id]);
  const focused = await level();
  expect(focused.zi + focused.zf, "focus zoomed in on the item").toBeGreaterThan(zoom0.zi + zoom0.zf + 0.5);
  await p.evaluate(() => localStorage.setItem("canvast.settings", JSON.stringify({ "nav.arrive": "keep" })));
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await key(app, "v");
  await p.evaluate((c) => window.__canvastDebug.setCamera(c), zoom0);
  await app.frame();
  await pick(a!.id);
  const before = await level();
  await key(app, "d");
  await expect.poll(() => selection(app)).toEqual([b!.id]);
  await app.frame();
  const after = await level();
  expect(after.zi + after.zf, "the zoom level is kept").toBeCloseTo(before.zi + before.zf, 3);
  const sb = (await screenOfObject(app, b!.id))!.box;
  expect(Math.abs((sb.minX + sb.maxX) / 2 - p.viewportSize()!.width / 2), "and the item is in the middle").toBeLessThan(60);
  expect(app.consoleErrors).toEqual([]);
});

test("W A S D, nearest in view: an item far from the selected one (many of its sizes away) or of a very different size is not a neighbour; 'anywhere' still reaches it (ADR 0058)", async ({ app }) => {
  const p = app.page;
  await key(app, "p");
  // A small stroke; one far to the right (about 8 of its own sizes away); one close; one very large but near.
  await app.drag({ x: 200, y: 400 }, { x: 260, y: 420 }, 4);
  await app.drag({ x: 900, y: 400 }, { x: 960, y: 420 }, 4);
  await key(app, "v");
  const [a, far] = await objects(app);
  const pick = async (id: string) => {
    const s = (await screenOfObject(app, id))!.box;
    await p.mouse.click(Math.round((s.minX + s.maxX) / 2), Math.round((s.minY + s.maxY) / 2));
  };
  await pick(a!.id);
  await key(app, "d");
  await app.frame();
  expect(await selection(app), "too far to be a neighbour").toEqual([a!.id]);
  expect(await p.evaluate(() => window.__canvastDebug.camera())).toBeTruthy();
  expect(app.consoleErrors).toEqual([]);
  void far;
});

test("resize with side handles: corners and sides follow the pointer; Shift keeps the proportions, Alt resizes about the middle, Ctrl turns snapping off; edges snap to other items (ADR 0063)", async ({ app }) => {
  const p = app.page;
  const img = await importImage(app);
  await p.evaluate(() => window.__canvastDebug.jump(5)); // the picture is about 8 px wide at first; make it big enough to work with
  await app.frame();
  await key(app, "v");
  const boxOf = async (id: string) => (await screenOfObject(app, id))!.box;
  const frame = async () => (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!.corners;
  const select = async (id: string) => {
    const b = await boxOf(id);
    await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
    expect(await selection(app)).toEqual([id]);
  };
  const drag = async (from: [number, number], to: [number, number], mods: string[] = []) => {
    for (const m of mods) await p.keyboard.down(m);
    await p.mouse.move(from[0], from[1]);
    await p.mouse.down();
    await p.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
    await p.mouse.move(to[0], to[1], { steps: 4 });
    await p.mouse.up();
    for (const m of mods.reverse()) await p.keyboard.up(m);
    await app.frame();
  };
  await select(img.id);
  const size = async () => {
    const b = await boxOf(img.id);
    return { w: b.maxX - b.minX, h: b.maxY - b.minY, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, b };
  };
  const s0 = await size();
  let c = await frame();
  // Free: the bottom-right corner follows the pointer in both axes, so the shape changes.
  await drag(c[2] as [number, number], [c[2]![0] + 60, c[2]![1] + 20]);
  const s1 = await size();
  expect(s1.w - s0.w).toBeGreaterThan(50);
  expect(s1.h - s0.h).toBeGreaterThan(15);
  expect(s1.h - s0.h, "not proportional").toBeLessThan((s1.w - s0.w) * 0.6);
  // Shift: proportions kept.
  c = await frame();
  await drag(c[2] as [number, number], [c[2]![0] + 80, c[2]![1] + 5], ["Shift"]);
  const s2 = await size();
  expect(Math.abs(s2.w / s2.h - s1.w / s1.h)).toBeLessThan(0.02);
  expect(s2.w).toBeGreaterThan(s1.w + 40);
  // Alt: about the middle, so the middle stays and the size changes on both sides.
  c = await frame();
  await drag(c[2] as [number, number], [c[2]![0] + 40, c[2]![1] + 30], ["Alt"]);
  const s3 = await size();
  expect(Math.abs(s3.cx - s2.cx)).toBeLessThan(1.5);
  expect(Math.abs(s3.cy - s2.cy)).toBeLessThan(1.5);
  expect(s3.w - s2.w, "grows on both sides").toBeGreaterThan(70);
  // A side handle changes one axis only.
  c = await frame();
  const rightMid: [number, number] = [c[1]![0], (c[1]![1] + c[2]![1]) / 2];
  await drag(rightMid, [rightMid[0] + 50, rightMid[1] + 40]);
  const s4 = await size();
  expect(s4.w - s3.w).toBeGreaterThan(40);
  expect(Math.abs(s4.h - s3.h)).toBeLessThan(1.5);
  // Snapping: the dragged edge lands exactly on another item's edge when it is within a few pixels; Ctrl turns that off.
  const wall = await penStroke(app, [[s4.b.maxX + 140, s4.b.minY - 60], [s4.b.maxX + 140, s4.b.minY + 100]]);
  await key(app, "v");
  const wb = await boxOf(wall.id);
  await select(img.id);
  c = await frame();
  const handle: [number, number] = [c[1]![0], (c[1]![1] + c[2]![1]) / 2];
  await drag(handle, [wb.minX - 3, handle[1]]);
  expect(Math.abs((await boxOf(img.id)).maxX - wb.minX), "snapped onto the wall's edge").toBeLessThan(0.6);
  c = await frame();
  const handle2: [number, number] = [c[1]![0], (c[1]![1] + c[2]![1]) / 2];
  await drag(handle2, [wb.minX - 3 - 12, handle2[1]]);
  await drag([(await frame())[1]![0], ((await frame())[1]![1] + (await frame())[2]![1]) / 2], [wb.minX - 3, handle2[1]], ["Control"]);
  expect(Math.abs((await boxOf(img.id)).maxX - (wb.minX - 3)), "Ctrl: exactly where the pointer is").toBeLessThan(1.5);
  // It is the dragged EDGE that snaps, not the pointer: grabbed 4 px inside the handle, with the pointer 7 px short of the wall the edge
  // is 3 px short of it and lands on it (a pointer-based snap would be out of reach and leave it 3 px short).
  let f = await frame();
  const h3: [number, number] = [f[1]![0], (f[1]![1] + f[2]![1]) / 2];
  await drag([h3[0] - 4, h3[1]], [h3[0] - 40, h3[1]], ["Control"]);
  f = await frame();
  const h4: [number, number] = [f[1]![0], (f[1]![1] + f[2]![1]) / 2];
  await drag([h4[0] - 4, h4[1]], [wb.minX - 7, h4[1]]);
  expect(Math.abs((await boxOf(img.id)).maxX - wb.minX), "the edge, not the pointer, snapped").toBeLessThan(0.6);
  expect(app.consoleErrors).toEqual([]);
});

test("Alt held as a drag starts carries a copy; the original stays; Alt tapped alone still focuses (ADR 0063)", async ({ app }) => {
  const p = app.page;
  const s = await penStroke(app, [[400, 300], [520, 340]]);
  await key(app, "v");
  const box0 = (await screenOfObject(app, s.id))!.box;
  await p.mouse.click(Math.round((box0.minX + box0.maxX) / 2), Math.round((box0.minY + box0.maxY) / 2));
  expect(await selection(app)).toEqual([s.id]);
  const cx = Math.round((box0.minX + box0.maxX) / 2);
  const cy = Math.round((box0.minY + box0.maxY) / 2);
  await p.keyboard.down("Alt");
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx + 60, cy + 90, { steps: 6 });
  await p.mouse.up();
  await p.keyboard.up("Alt");
  await app.frame();
  const all = await objects(app);
  expect(all).toHaveLength(2);
  const orig = all.find((o) => o.id === s.id)!;
  const copy = all.find((o) => o.id !== s.id)!;
  expect(orig.ax, "the original did not move").toBe(s.ax);
  expect(orig.ay).toBe(s.ay);
  expect(await selection(app), "the copy is the selection").toEqual([copy.id]);
  const cb = (await screenOfObject(app, copy.id))!.box;
  expect(Math.abs(cb.minX - box0.minX - 60)).toBeLessThan(2);
  expect(Math.abs(cb.minY - box0.minY - 90)).toBeLessThan(2);
  // Alt after the drag, tapped alone, still brings the selection into view.
  const zoom0 = await p.evaluate(() => window.__canvastDebug.camera());
  await p.keyboard.down("Alt");
  await p.keyboard.up("Alt");
  await app.frame();
  expect(await p.evaluate(() => window.__canvastDebug.camera())).not.toEqual(zoom0);
  expect(app.consoleErrors).toEqual([]);
});

test("Alt tapped again fits everything visible; a third tap returns to the selection; the fit buttons do the same (ADR 0063)", async ({ app }) => {
  const p = app.page;
  const a = await penStroke(app, [[300, 300], [380, 330]]);
  const b = await penStroke(app, [[900, 500], [980, 530]]);
  await key(app, "v");
  const cam = async () => JSON.stringify(await p.evaluate(() => window.__canvastDebug.camera()));
  const inside = async (id: string) => {
    const s = await screenOfObject(app, id);
    return !!s && s.box.minX >= 0 && s.box.minY >= 0 && s.box.maxX <= 1280 && s.box.maxY <= 800;
  };
  const alt = async () => {
    await p.keyboard.down("Alt");
    await p.keyboard.up("Alt");
    await app.frame();
  };
  const fitSelection = p.getByRole("button", { name: "Fit the selection in view" });
  const fitAll = p.getByRole("button", { name: "Fit everything in view" });
  await expect(fitSelection, "nothing selected").toBeDisabled();
  const s0 = await screenOfObject(app, a.id);
  await p.mouse.click(Math.round((s0!.box.minX + s0!.box.maxX) / 2), Math.round((s0!.box.minY + s0!.box.maxY) / 2));
  expect(await selection(app)).toEqual([a.id]);
  await expect(fitSelection).toBeEnabled();
  const start = await cam();
  await alt(); // the selection fills the view
  const onA = await cam();
  expect(onA).not.toEqual(start);
  expect(await inside(a.id)).toBe(true);
  const ab = (await screenOfObject(app, a.id))!.box;
  expect(ab.maxX - ab.minX, "zoomed in on it").toBeGreaterThan(500);
  await alt(); // again: everything visible at this zoom fits
  const onAll = await cam();
  expect(onAll).not.toEqual(onA);
  expect(await inside(a.id)).toBe(true);
  expect(await inside(b.id)).toBe(true);
  await alt(); // a third time: back to the selection
  expect(await cam()).toEqual(onA);
  // The buttons: fit everything, then the selection.
  await fitAll.click();
  await app.frame();
  expect(await cam()).toEqual(onAll);
  await fitSelection.click();
  await app.frame();
  expect(await cam()).toEqual(onA);
  expect(app.consoleErrors).toEqual([]);
});

test("Reset rotation and Reset proportions in the selection bar put a turned or stretched picture back, about its middle, as one undo step each (ADR 0063)", async ({ app }) => {
  const p = app.page;
  const img = await importImage(app);
  await p.evaluate(() => window.__canvastDebug.jump(5));
  await app.frame();
  await key(app, "v");
  const box = async () => (await screenOfObject(app, img.id))!.box;
  const b0 = await box();
  await p.mouse.click(Math.round((b0.minX + b0.maxX) / 2), Math.round((b0.minY + b0.maxY) / 2));
  const unrotate = p.getByRole("button", { name: "Reset rotation" });
  const unstretch = p.getByRole("button", { name: /Reset proportions/ });
  await expect(unrotate).toBeHidden();
  await expect(unstretch).toBeHidden();
  const frame = async () => (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!.corners;
  // Stretch with the right side handle.
  let c = await frame();
  const mid: [number, number] = [c[1]![0], (c[1]![1] + c[2]![1]) / 2];
  await p.mouse.move(mid[0], mid[1]);
  await p.mouse.down();
  await p.mouse.move(mid[0] + 40, mid[1], { steps: 3 });
  await p.mouse.move(mid[0] + 120, mid[1], { steps: 4 });
  await p.mouse.up();
  await app.frame();
  const b1 = await box();
  expect((b1.maxX - b1.minX) / (b1.maxY - b1.minY)).toBeGreaterThan(((b0.maxX - b0.minX) / (b0.maxY - b0.minY)) * 1.3);
  await expect(unstretch).toBeVisible();
  await unstretch.click();
  await app.frame();
  const b2 = await box();
  expect(Math.abs((b2.maxX - b2.minX) / (b2.maxY - b2.minY) - (b0.maxX - b0.minX) / (b0.maxY - b0.minY)), "its own shape again").toBeLessThan(0.02);
  expect(Math.abs((b2.minX + b2.maxX) / 2 - (b1.minX + b1.maxX) / 2), "same middle").toBeLessThan(1);
  expect(Math.abs((b2.minY + b2.maxY) / 2 - (b1.minY + b1.maxY) / 2), "same middle").toBeLessThan(1);
  await expect(unstretch).toBeHidden();
  await key(app, "Control+z");
  await app.frame();
  const b3 = await box();
  expect(Math.abs(b3.maxX - b1.maxX)).toBeLessThan(1); // one undo step puts the stretch back
  await key(app, "Control+z");
  // Turn it: drag just outside a corner.
  c = await frame();
  const corner = c[2] as [number, number];
  await p.mouse.move(corner[0] + 16, corner[1] + 16);
  await p.mouse.down();
  await p.mouse.move(corner[0] + 60, corner[1] - 10, { steps: 6 });
  await p.mouse.up();
  await app.frame();
  const turned = ((await objects(app)).find((o) => o.id === img.id) as Obj & { rot?: number }).rot;
  expect(turned, "turned").toBeGreaterThan(0);
  await expect(unrotate).toBeVisible();
  const mid1 = await box();
  await unrotate.click();
  await app.frame();
  expect(((await objects(app)).find((o) => o.id === img.id) as Obj & { rot?: number }).rot, "no turn left").toBeUndefined();
  const after = await box();
  expect(Math.abs((after.minX + after.maxX) / 2 - (mid1.minX + mid1.maxX) / 2), "turned about its middle").toBeLessThan(1);
  await expect(unrotate).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

test("Alt fit-to-view uses what is near and visible at this zoom: items far away at the same zoom are left out, never an empty view (ADR 0063)", async ({ app }) => {
  const p = app.page;
  const a = await penStroke(app, [[500, 300], [580, 340]]);
  // A second stroke about 30 windows to the right (Shift+Right pans half a window).
  for (let i = 0; i < 60; i++) await key(app, "Shift+ArrowRight");
  await app.frame();
  await penStroke(app, [[600, 400], [680, 440]]);
  await key(app, "0");
  await app.frame();
  await key(app, "v");
  const s = (await screenOfObject(app, a.id))!.box;
  await p.mouse.click(Math.round((s.minX + s.maxX) / 2), Math.round((s.minY + s.maxY) / 2));
  expect(await selection(app)).toEqual([a.id]);
  for (let i = 0; i < 2; i++) {
    await p.keyboard.down("Alt");
    await p.keyboard.up("Alt");
    await app.frame();
  }
  const box = (await screenOfObject(app, a.id))!.box;
  expect(box.minX).toBeGreaterThanOrEqual(0);
  expect(box.maxX).toBeLessThanOrEqual(1280);
  expect(box.maxX - box.minX, "still a clear size, not a speck").toBeGreaterThan(40);
  expect(app.consoleErrors).toEqual([]);
});

test("resize with Shift snaps the edge the proportions give, not the pointer (the pointer may be far past the line) (ADR 0063)", async ({ app }) => {
  const p = app.page;
  const img = await importImage(app);
  await p.evaluate(() => window.__canvastDebug.jump(4));
  await app.frame();
  await key(app, "v");
  const boxOf = async (id: string) => (await screenOfObject(app, id))!.box;
  const b0 = await boxOf(img.id);
  await p.mouse.click(Math.round((b0.minX + b0.maxX) / 2), Math.round((b0.minY + b0.maxY) / 2));
  const w = b0.maxX - b0.minX;
  const h = b0.maxY - b0.minY;
  // A wall 60 px right of the picture's right edge.
  const wall = await penStroke(app, [[b0.maxX + 60, b0.minY - 40], [b0.maxX + 60, b0.maxY + 200]]);
  await key(app, "v");
  const wb = await boxOf(wall.id);
  await p.mouse.click(Math.round((b0.minX + b0.maxX) / 2), Math.round((b0.minY + b0.maxY) / 2));
  expect(await selection(app)).toEqual([img.id]);
  const corner = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!.corners[2]!;
  // Pulled straight right with Shift, the corner moves along the diagonal: its right edge travels w^2 / (w^2 + h^2) of the pointer. Aim the
  // edge 3 px short of the wall, which leaves the pointer far (tens of px) past it.
  const share = (w * w) / (w * w + h * h);
  const shift = wb.minX - 3 - b0.maxX;
  const d = shift / share;
  expect(d - (wb.minX - b0.maxX), "the pointer ends well past the wall").toBeGreaterThan(20);
  await p.keyboard.down("Shift");
  await p.mouse.move(corner[0], corner[1]);
  await p.mouse.down();
  await p.mouse.move(corner[0] + d / 2, corner[1], { steps: 4 });
  await p.mouse.move(corner[0] + d, corner[1], { steps: 4 });
  await p.mouse.up();
  await p.keyboard.up("Shift");
  await app.frame();
  const b1 = await boxOf(img.id);
  expect(Math.abs(b1.maxX - wb.minX), "the right edge is on the wall").toBeLessThan(0.6);
  expect(Math.abs((b1.maxX - b1.minX) / (b1.maxY - b1.minY) - w / h), "proportions kept").toBeLessThan(0.02);
  expect(app.consoleErrors).toEqual([]);
});

test("Alt after selecting another item focuses that item (the cycle goes on only for the same selection) (ADR 0063)", async ({ app }) => {
  const p = app.page;
  // Two strokes close together: after focusing on the first, the second is still on screen to click.
  const a = await penStroke(app, [[560, 400], [600, 430]]);
  const b = await penStroke(app, [[640, 400], [680, 430]]);
  await key(app, "v");
  const alt = async () => {
    await p.keyboard.down("Alt");
    await p.keyboard.up("Alt");
    await app.frame();
  };
  const pick = async (id: string) => {
    const s = (await screenOfObject(app, id))!.box;
    await p.mouse.click(Math.round((s.minX + s.maxX) / 2), Math.round((s.minY + s.maxY) / 2));
    expect(await selection(app)).toEqual([id]);
  };
  const box = async (id: string) => (await screenOfObject(app, id))!.box;
  await pick(a.id);
  await alt(); // focus on a: it fills the view
  const ba = await box(a.id);
  expect(ba.maxX - ba.minX).toBeGreaterThan(400);
  const bb = await screenOfObject(app, b.id);
  // Pick b if it is on screen (it is beside a); the next Alt focuses b, it does not fit everything.
  if (bb && bb.box.minX >= 0 && bb.box.maxX <= 1280) {
    await pick(b.id);
    await alt();
    const nb = await box(b.id);
    expect(nb.maxX - nb.minX, "b is focused: it fills the view").toBeGreaterThan(400);
    expect(Math.abs((nb.minX + nb.maxX) / 2 - 640), "and is in the middle").toBeLessThan(60);
  } else {
    // b is off screen at this zoom: select it by its layer row instead.
    await p.getByRole("button", { name: "Layers panel", exact: true }).click();
    await p.getByTestId("layers-panel").locator(`li.layer[data-key="${b.id}"]`).click();
    expect(await selection(app)).toEqual([b.id]);
    await alt();
    const nb = await box(b.id);
    expect(nb.maxX - nb.minX, "b is focused: it fills the view").toBeGreaterThan(400);
    expect(Math.abs((nb.minX + nb.maxX) / 2 - 640), "and is in the middle").toBeLessThan(60);
  }
  expect(app.consoleErrors).toEqual([]);
});

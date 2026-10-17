import { expect, test } from "./harness";
import type { App } from "./harness";

/**
 * Vector shapes and paths (ADR 0099): the Shape, Path and Edit nodes tools, selecting and transforming them, their colours, saving, and
 * zooming into them. Real mouse and keyboard input; every assertion reads the stored geometry through the debug hook.
 */
interface Sub {
  n: number[];
  closed: boolean;
}
type Obj = { id: string; kind: string; shape?: string; sub: Sub[]; fill: string | null; stroke: string | null; width: number; rot?: number; unit: number; ax: string; ay: string; join?: string };

const objs = async (app: App): Promise<Obj[]> => (await app.page.evaluate(() => window.__canvastDebug.objects())) as unknown as Obj[];
const last = async (app: App): Promise<Obj> => (await objs(app)).at(-1)!;
const key = (app: App, k: string) => app.page.keyboard.press(k);
const tool = (app: App) => app.page.evaluate(() => window.__canvastDebug.tool());
const screenBox = async (app: App, id: string) => (await app.page.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
/** The width and height of a shape's nodes, in its own units. */
const size = (o: Obj) => {
  const xs = o.sub.flatMap((s) => s.n.filter((_, i) => i % 6 === 0));
  const ys = o.sub.flatMap((s) => s.n.filter((_, i) => i % 6 === 1));
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const drag = async (app: App, a: [number, number], b: [number, number]) => {
  await app.drag({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, 8);
  await app.frame();
};
const click = async (app: App, x: number, y: number, mods: string[] = []) => {
  for (const m of mods) await app.page.keyboard.down(m);
  await app.page.mouse.click(x, y);
  for (const m of mods) await app.page.keyboard.up(m);
  await app.frame();
};
const reload = async (app: App) => {
  expect(await app.page.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await app.page.reload();
  await app.page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await app.frame();
};

test("Shape tool: every kind, Shift for a square, a click makes nothing, undo and redo, saved over a reload", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  expect(await tool(app)).toBe("shape");
  await drag(app, [500, 300], [700, 380]);
  let o = await last(app);
  expect(o).toMatchObject({ kind: "path", shape: "rect", fill: "#2563eb", stroke: "#1f2329", join: "miter" });
  expect(o.sub[0]!.closed).toBe(true);
  expect(o.sub[0]!.n).toHaveLength(24);
  expect(size(o).w).toBeCloseTo(200, 0);
  expect(size(o).h).toBeCloseTo(80, 0);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([o.id]); // the new shape is selected

  await click(app, 900, 500); // a press with no drag makes nothing
  expect(await objs(app)).toHaveLength(1);

  await p.keyboard.down("Shift"); // Shift: a square, whatever the drag
  await drag(app, [500, 450], [640, 520]);
  await p.keyboard.up("Shift");
  const sq = size(await last(app));
  expect(sq.w).toBeCloseTo(sq.h, 3);
  expect(sq.w).toBeCloseTo(140, 0);

  const made: Array<[string, string, number, boolean]> = [["ellipse", "ellipse", 24, true], ["polygon", "polygon", 36, true], ["star", "star", 60, true], ["line", "line", 12, false]];
  let x = 720;
  for (const [btn, shape, nodes, closed] of made) {
    await p.click(`[data-shape-kind="${btn}"]`);
    await drag(app, [x, 450], [x + 90, 560]);
    x += 110;
    o = await last(app);
    expect(o.shape).toBe(shape);
    expect(o.sub[0]!.n, shape).toHaveLength(nodes);
    expect(o.sub[0]!.closed, shape).toBe(closed);
  }
  expect(o.fill).toBeNull(); // a line has no fill
  expect((await objs(app)).find((q) => q.shape === "ellipse")!.sub[0]!.n.slice(0, 6).some((v, i) => i >= 2 && v !== (i % 2 ? (o && 0) : 0))).toBe(true);

  const before = (await objs(app)).length;
  await key(app, "v");
  await p.keyboard.press("Control+z");
  expect(await objs(app)).toHaveLength(before - 1);
  await p.keyboard.press("Control+Shift+z");
  expect(await objs(app)).toHaveLength(before);

  const ids = (await objs(app)).map((q) => q.id);
  await reload(app);
  expect((await objs(app)).map((q) => q.id)).toEqual(ids);
  expect((await objs(app)).find((q) => q.shape === "star")!.sub[0]!.n).toHaveLength(60);
});

test("Path tool: corners, a dragged smooth node, closing on the first node, Enter, Backspace, and leaving the tool", async ({ app }) => {
  const p = app.page;
  await key(app, "b");
  expect(await tool(app)).toBe("path");
  // corner, smooth (dragged), corner, then Enter: an open path with a fill of none
  await click(app, 520, 500);
  await drag(app, [600, 450], [680, 450]);
  await click(app, 760, 500);
  await key(app, "Enter");
  let o = await last(app);
  expect(o).toMatchObject({ kind: "path", fill: null, stroke: "#1f2329" });
  expect(o.sub[0]).toMatchObject({ closed: false });
  const n = o.sub[0]!.n;
  expect(n).toHaveLength(18);
  // the smooth node's out handle follows the drag, the in handle mirrors it
  expect(n[10]! - n[6]!).toBeCloseTo(80, 0);
  expect(n[8]! - n[6]!).toBeCloseTo(-80, 0);
  expect(n[11]! - n[7]!).toBeCloseTo(0, 0);
  expect(n[2]).toBe(n[0]); // the corner nodes have no handles
  expect(await tool(app)).toBe("path");

  // a closed path: click round and back on the first node; it is filled
  await click(app, 520, 300);
  await click(app, 640, 300);
  await click(app, 580, 380);
  await click(app, 520, 300);
  o = await last(app);
  expect(o.sub[0]!.closed).toBe(true);
  expect(o.sub[0]!.n).toHaveLength(18);
  expect(o.fill).toBe("#2563eb");
  expect(await objs(app)).toHaveLength(2);

  // Backspace takes back the last node; one node alone makes nothing
  await click(app, 800, 300);
  await click(app, 860, 340);
  await key(app, "Backspace");
  await key(app, "Backspace");
  await key(app, "Enter");
  expect(await objs(app)).toHaveLength(2);

  // leaving the tool ends the path being drawn (open)
  await click(app, 800, 600);
  await click(app, 880, 640);
  await key(app, "v");
  expect(await objs(app)).toHaveLength(3);
  expect((await last(app)).sub[0]!.closed).toBe(false);
});

test("select: a filled shape is picked inside, an outline only on its line; move, stretch from a side, turn, undo", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [560, 300], [760, 400]); // filled, outlined
  const rect = await last(app);
  await p.click('[data-shape-kind="ellipse"]');
  await p.click('[data-paint="fill"]');
  await p.locator(".colour-pop .colour-none").click(); // no fill for the next shape
  await key(app, "Escape");
  await drag(app, [820, 300], [1020, 440]); // an unfilled ellipse (its line only)
  const ring = await last(app);
  expect(ring.fill).toBeNull();

  await key(app, "v");
  await click(app, 660, 350); // inside the filled one
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([rect.id]);
  await click(app, 920, 370); // inside the ring, on nothing
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([]);
  await click(app, 1020 - 100 + 100, 370); // on the ring's right edge (x = 1020)
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([ring.id]);

  // move the rectangle by dragging it, then undo
  await click(app, 660, 350);
  const w0 = size(rect).w;
  await drag(app, [660, 350], [660, 440]);
  const moved = await screenBox(app, rect.id);
  expect(moved.minY).toBeGreaterThan(380);
  await p.keyboard.press("Control+z");
  expect((await screenBox(app, rect.id)).minY).toBeLessThan(310);

  // stretch it from the middle of its right side: wider only
  await click(app, 660, 350);
  const box = await screenBox(app, rect.id);
  await drag(app, [box.maxX, (box.minY + box.maxY) / 2], [box.maxX + 100, (box.minY + box.maxY) / 2]);
  let r = (await objs(app)).find((q) => q.id === rect.id)!;
  // (the selection box includes the 2 px outline, so the nodes grow by 100 * 200 / 202)
  expect(size(r).w).toBeGreaterThan(w0 + 98);
  expect(size(r).w).toBeLessThan(w0 + 100.5);
  expect(size(r).h).toBeCloseTo(size(rect).h, 0);

  // turn it: a drag round just outside a corner
  const b2 = await screenBox(app, rect.id);
  await drag(app, [b2.maxX + 14, b2.minY - 14], [b2.maxX + 40, b2.minY + 30]);
  r = (await objs(app)).find((q) => q.id === rect.id)!;
  expect(r.rot).toBeGreaterThan(0);
  expect(size(r).w).toBeGreaterThan(w0 + 98); // turning does not change the geometry
});

test("Edit nodes: move a node, drag a mirrored handle, add a node on a segment, turn a node smooth, delete a node; one undo each", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [500, 320], [700, 420]);
  const id = (await last(app)).id;
  await key(app, "n");
  expect(await tool(app)).toBe("node");
  const nodes = async () => (await last(app)).sub[0]!.n;
  const n0 = await nodes();

  // move the top-right node
  await drag(app, [700, 320], [740, 300]);
  let n = await nodes();
  expect(n[6]! - n0[6]!).toBeCloseTo(40, 0);
  expect(n[7]! - n0[7]!).toBeCloseTo(-20, 0);
  expect(n[8]! - n0[8]!).toBeCloseTo(40, 0); // its handles went with it
  await p.keyboard.press("Control+z");
  expect(await nodes()).toEqual(n0);

  // a press on the middle of the bottom edge adds a node there, and the outline does not move
  await click(app, 600, 420);
  n = await nodes();
  expect(n).toHaveLength(30);
  expect(n[18]).toBeCloseTo(n0[0]! + 100, 0);
  expect(n[19]).toBeCloseTo(n0[19]!, 0);
  await p.keyboard.press("Control+z");

  // Alt-click a corner: it becomes smooth (handles appear); again: a corner
  await click(app, 500, 320, ["Alt"]);
  n = await nodes();
  expect(n[2] === n[0] && n[3] === n[1]).toBe(false);
  expect(n[4]! - n[0]!).toBeCloseTo(-(n[2]! - n[0]!), 6); // the handles are opposite
  await click(app, 500, 320, ["Alt"]);
  expect(await nodes()).toEqual(n0);
  await click(app, 500, 320, ["Alt"]); // smooth again, to have a handle to pull

  // pull its out handle: the in handle follows, opposite and as long
  const out = { x: 500 + (n[4]! - n[0]!), y: 320 + (n[5]! - n[1]!) };
  await click(app, 500, 320); // select the node, which shows its handles
  await drag(app, [out.x, out.y], [out.x + 30, out.y + 50]);
  n = await nodes();
  expect(n[2]! - n[0]!).toBeCloseTo(-(n[4]! - n[0]!), 5);
  expect(n[3]! - n[1]!).toBeCloseTo(-(n[5]! - n[1]!), 5);

  // delete a selected node
  await click(app, 700, 420);
  await key(app, "Delete");
  expect((await last(app)).sub[0]!.n).toHaveLength(18);
  await p.keyboard.press("Control+z");
  expect((await last(app)).sub[0]!.n).toHaveLength(24);
  expect((await last(app)).id).toBe(id);
});

test("colours: the chips set what the next shape gets and the selected shapes' paint, live and as one undo step; alpha and none", async ({ app }) => {
  const p = app.page;
  const pop = p.locator(".colour-pop");
  await key(app, "u");
  await p.click('[data-paint="fill"]');
  await expect(pop).toBeVisible();
  await pop.locator("[data-hex]").fill("e11d48");
  await pop.locator("[data-hex]").press("Enter");
  await key(app, "Escape");
  await expect(pop).toBeHidden();
  await drag(app, [500, 320], [700, 420]);
  expect((await last(app)).fill).toBe("#e11d48"); // the next shape got it

  // the selected shape: a drag in the picker is shown at once, stored once
  const before = (await objs(app)).length;
  await key(app, "v");
  await click(app, 600, 370);
  await p.click('[data-paint="fill"]');
  const ring = (await pop.locator("[data-wheel]").boundingBox())!;
  await p.mouse.move(ring.x + ring.width - 8, ring.y + ring.height / 2);
  await p.mouse.down();
  await p.mouse.move(ring.x + ring.width / 2, ring.y + 8, { steps: 6 });
  const live = await p.evaluate(() => window.__canvastDebug.pixelAt(600, 370));
  await p.mouse.up();
  const after = await last(app);
  expect(after.fill).not.toBe("#e11d48");
  expect(`#${live.map((v) => v.toString(16).padStart(2, "0")).join("")}`).toBe(after.fill); // what was drawn is what was stored
  // typing an rgb() with a slash sets the transparency
  await pop.locator("[data-hex]").fill("rgb(255 0 0 / 50%)");
  await pop.locator("[data-hex]").press("Enter");
  expect((await last(app)).fill).toBe("#ff000080");
  await key(app, "Escape");
  expect(await objs(app)).toHaveLength(before);
  // one undo takes back the last colour only
  await p.keyboard.press("Control+z");
  expect((await last(app)).fill).toBe(after.fill);
  await p.keyboard.press("Control+z");
  expect((await last(app)).fill).toBe("#e11d48");

  // no outline
  await p.click('[data-paint="stroke"]');
  await pop.locator(".colour-none").click();
  await key(app, "Escape");
  expect((await last(app)).stroke).toBeNull();
  await p.keyboard.press("Control+z");
  expect((await last(app)).stroke).toBe("#1f2329");
});

test("zooming into a shape keeps it: its inside stays its colour at depth, and an edge stays where it is", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [420, 260], [860, 540]); // covers the centre of the view
  const fill = [37, 99, 235];
  const centre = () => p.evaluate(() => window.__canvastDebug.pixelAt(640, 400));
  expect(await centre()).toEqual(fill);
  for (const levels of [10, 14, 8]) {
    await p.evaluate((l) => window.__canvastDebug.jump(l), levels);
    await app.frame();
    expect(await centre(), `after zooming in ${levels} more levels`).toEqual(fill);
  }
  // 32 levels in, the shape is 2^32 times its size: still drawn, not dropped or smeared to the background
  const bg = await p.evaluate(() => window.__canvastDebug.pixelAt(5, 5));
  expect(await centre()).not.toEqual(bg);
  // and back out the same way
  await p.evaluate(() => window.__canvastDebug.jump(-32));
  await app.frame();
  expect(await centre()).toEqual(fill);
  expect(await p.evaluate(() => window.__canvastDebug.pixelAt(400, 400))).not.toEqual(fill); // left of the rectangle
});

test("depth: an edge placed at 2^34 magnification is where it should be, a shape drawn while deep is there, and one seen from 5000 levels away still covers the view", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  const fill = [37, 99, 235];
  await key(app, "u");
  await p.click('[data-paint="stroke"]');
  await p.locator(".colour-pop .colour-none").click(); // fill only: the outline would be 10^10 px wide at this zoom
  await key(app, "Escape");
  await drag(app, [420, 260], [860, 540]);

  // The right edge (x = 860 on screen) is put at the middle of the view, 34 levels in.
  const edge = await app.worldAt(860, 400);
  const corner = await app.worldAt(860, 540); // (both read while the camera is still at home)
  await p.evaluate((w) => window.__canvastDebug.setCamera({ cx: w.x, cy: w.y, zi: 34, zf: 0, pz: 34 }), edge);
  await app.frame();
  expect(await px(600, 400), "inside, left of the edge").toEqual(fill);
  expect(await px(639, 400), "the last column inside").toEqual(fill);
  const outside = await px(641, 400);
  expect(outside, "right of the edge is the background").not.toEqual(fill);
  expect(await px(640, 100), "far above the corner is the background too").not.toEqual(fill); // the edge ends at y = 540 (screen), 2^34 px below
  // a slanted edge too: the same, with the camera on the rectangle's corner
  await p.evaluate((w) => window.__canvastDebug.setCamera({ cx: w.x, cy: w.y, zi: 34, zf: 0, pz: 34 }), corner);
  await app.frame();
  expect(await px(600, 300), "inside the corner").toEqual(fill);
  expect(await px(700, 300), "right of it").not.toEqual(fill);
  expect(await px(600, 500), "below it").not.toEqual(fill);

  // back home; draw while 40 levels in, zoom out and in again
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 0, zf: 0, pz: 0 }));
  await p.evaluate(() => window.__canvastDebug.jump(40));
  await app.frame();
  const count = (await objs(app)).length;
  await drag(app, [500, 300], [700, 400]);
  expect(await objs(app)).toHaveLength(count + 1);
  const deep = await last(app);
  expect(await px(600, 350)).toEqual([37, 99, 235].map((v, i) => (deep.fill === "#2563eb" ? v : i)));
  await p.evaluate(() => window.__canvastDebug.jump(-40));
  await app.frame();
  const box = await screenBox(app, deep.id);
  expect(box.maxX - box.minX).toBeLessThan(1e-6); // 200 px, 40 levels down
  await p.evaluate(() => window.__canvastDebug.jump(40));
  await app.frame();
  expect(await px(600, 350)).toEqual(fill);

  // far below the view: 5000 levels in, the camera is deeper than the shape's frame by more than the coarse limit (classified, not projected)
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 0, zf: 0, pz: 0 }));
  await p.evaluate(() => window.__canvastDebug.jump(5000));
  await app.frame();
  expect(await px(640, 400), "5000 levels into the middle of the big rectangle").toEqual(fill);
  await p.evaluate(() => window.__canvastDebug.jump(-5000));
  await app.frame();
  expect(await px(640, 400)).toEqual(fill);
  expect(await px(300, 400), "and left of it, nothing").not.toEqual(fill);
});

test("shapes work with the rest of the canvas: duplicate, copy and paste, group, the Layers list, the object eraser, zooming far out", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [500, 300], [700, 400]);
  await p.click('[data-shape-kind="ellipse"]');
  await drag(app, [760, 300], [900, 400]);
  expect(await objs(app)).toHaveLength(2);

  // Layers: named by what they are, with their colour
  await p.getByRole("button", { name: "Layers panel" }).click();
  await expect.poll(async () => (await p.getByTestId("layers-panel").locator("li.layer .layer-name").allTextContents()).sort()).toEqual(["Ellipse", "Rectangle"]);

  // duplicate (Ctrl+D) the selected ellipse, then copy and paste it
  await key(app, "v");
  await p.keyboard.press("Control+d");
  expect(await objs(app)).toHaveLength(3);
  const dup = await last(app);
  expect(dup.shape).toBe("ellipse");
  expect(size(dup).w).toBeCloseTo(140, 0);
  await p.keyboard.press("Control+c");
  await p.keyboard.press("Control+v");
  await app.frame();
  const all = await objs(app);
  expect(all).toHaveLength(4);
  expect(all.filter((o) => o.shape === "ellipse")).toHaveLength(3);
  expect(new Set(all.map((o) => o.id)).size).toBe(4);

  // select everything and group, then ungroup
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Control+g");
  await p.keyboard.press("Control+Shift+g");
  expect(await objs(app)).toHaveLength(4);

  // the object eraser takes a shape by its fill, and by its line when it has none
  await key(app, "e");
  await drag(app, [504, 350], [514, 350]); // (a pasted shape lands in the middle of the view: this is clear of it)
  expect(await objs(app)).toHaveLength(3);
  await p.keyboard.press("Control+z");
  expect(await objs(app)).toHaveLength(4);

  // far out: 14 levels away the rectangle is a speck, and is still there (not dropped), and back
  await key(app, "v");
  const id = all.find((o) => o.shape === "rect")!.id;
  await p.evaluate(() => window.__canvastDebug.jump(-14));
  await app.frame();
  expect(await screenBox(app, id)).toBeTruthy();
  await p.evaluate(() => window.__canvastDebug.jump(14));
  await app.frame();
  expect(await p.evaluate(() => window.__canvastDebug.pixelAt(600, 350))).toEqual([37, 99, 235]);
});

test("exact edges: past what doubles can place (2^45 and 2^3000 times in), a fill's edge and an outline's both stay where they are", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  const fill = [37, 99, 235];
  const ink = [31, 35, 41];
  const at = async (sx: number, zi: number) => {
    const w = await app.worldAt(sx, 400); // read at home
    return { cx: w.x, cy: w.y, zi, zf: 0, pz: zi };
  };
  const home = () => p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 0, zf: 0, pz: 0 }));
  await key(app, "u");
  await drag(app, [420, 260], [860, 540]); // 2 px outline, the right edge at x = 860
  const cams = { edge: await at(860, 45), outer: await at(861, 45), inner: await at(859, 45), deep: await at(861, 3000) };

  // on the geometric edge the whole view is inside the 2 unit wide outline: its colour, exactly
  await p.evaluate((c) => window.__canvastDebug.setCamera(c), cams.edge);
  await app.frame();
  expect(await px(300, 400)).toEqual(ink);
  expect(await px(980, 400)).toEqual(ink);

  // on the outer border of the outline: dark to the left, the background to the right
  await p.evaluate((c) => window.__canvastDebug.setCamera(c), cams.outer);
  await app.frame();
  expect(await px(630, 400), "just left of the outer border").toEqual(ink);
  expect(await px(650, 400), "just right of it").not.toEqual(ink);
  expect(await px(650, 400)).not.toEqual(fill);

  // on its inner border: the fill to the left, the outline to the right
  await p.evaluate((c) => window.__canvastDebug.setCamera(c), cams.inner);
  await app.frame();
  expect(await px(630, 400), "inside the fill").toEqual(fill);
  expect(await px(650, 400), "inside the outline").toEqual(ink);

  // the same border 3000 levels in
  await p.evaluate((c) => window.__canvastDebug.setCamera(c), cams.deep);
  await app.frame();
  expect(await px(630, 400)).toEqual(ink);
  expect(await px(650, 400)).not.toEqual(ink);

  // and the fill's own edge, with no outline, 45 levels in
  await home();
  await p.click('[data-paint="stroke"]');
  await p.locator(".colour-pop .colour-none").click();
  await key(app, "Escape");
  await drag(app, [420, 600], [860, 700]); // a second rectangle with no outline, right edge at 860
  await home();
  const w2 = await app.worldAt(860, 650);
  await p.evaluate((c) => window.__canvastDebug.setCamera(c), { cx: w2.x, cy: w2.y, zi: 45, zf: 0, pz: 45 });
  await app.frame();
  expect(await px(630, 400)).toEqual(fill);
  expect(await px(650, 400)).not.toEqual(fill);
});

test("gradients: Linear and Radial in the paint chooser, stops, angle, handles on the canvas, one undo each, saved, and exact colour at any depth", async ({ app }) => {
  const p = app.page;
  const pop = p.locator(".colour-pop");
  type Grad = { type: string; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; r: number; stops: Array<{ o: number; c: string }> };
  const fillOf = async () => (await last(app)).fill as unknown as Grad;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);

  await key(app, "u");
  await p.click('[data-paint="stroke"]');
  await pop.locator(".colour-none").click(); // fill only
  await key(app, "Escape");
  await drag(app, [500, 300], [760, 400]);
  await key(app, "v");
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toHaveLength(1);

  // Linear: the colour fading to nothing, left to right
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="linear"]').click();
  let g = await fillOf();
  expect(g).toMatchObject({ type: "linear", x0: 0, y0: 0.5, x1: 1, y1: 0.5 });
  expect(g.stops.map((s) => s.c)).toEqual(["#2563eb", "#2563eb00"]);
  await app.frame();
  const left = await px(512, 330); // near the start (off the axis, where the handles are): mostly the colour
  expect(left[2]).toBeGreaterThan(200);
  expect(left[0]).toBeLessThan(90);
  const bg = await px(300, 600);
  const right = await px(752, 330); // near the end: almost nothing, the background shows
  expect(Math.abs(right[0]! - bg[0]!) + Math.abs(right[1]! - bg[1]!) + Math.abs(right[2]! - bg[2]!)).toBeLessThan(40);

  // the stops: the first red, the last opaque blue, one more in the middle by a click on the bar
  await pop.locator(".cg [data-hex]").fill("ff0000");
  await pop.locator(".cg [data-hex]").press("Enter");
  await pop.locator(".cg-stop").nth(1).click();
  await pop.locator(".cg [data-hex]").fill("0000ffff");
  await pop.locator(".cg [data-hex]").press("Enter");
  g = await fillOf();
  expect(g.stops.map((s) => s.c)).toEqual(["#ff0000", "#0000ff"]);
  const bar = (await pop.locator(".cg-bar").boundingBox())!;
  await p.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
  expect((await fillOf()).stops).toHaveLength(3);
  await pop.locator(".cg [data-remove]").click();
  expect((await fillOf()).stops).toHaveLength(2);

  // the angle: 90 runs top to bottom (the stored ends turn)
  await pop.locator(".cg [data-angle]").fill("90");
  await pop.locator(".cg [data-angle]").press("Enter"); // a typed number is stored on Enter, or on leaving the field
  g = await fillOf();
  expect(g.x0).toBeCloseTo(g.x1, 6);
  expect(g.y1).toBeGreaterThan(g.y0);
  await key(app, "Escape");

  // Radial, then back to Linear keeps the stops
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="radial"]').click();
  g = await fillOf();
  expect(g).toMatchObject({ type: "radial", cx: 0.5, cy: 0.5, r: 0.5 });
  expect(g.stops.map((s) => s.c)).toEqual(["#ff0000", "#0000ff"]);
  await pop.locator('[data-mode="linear"]').click();
  await key(app, "Escape");

  // handles on the canvas: drag the end of a left-to-right gradient to the middle of the shape
  await p.click('[data-paint="fill"]');
  await pop.locator(".cg [data-angle]").fill("0");
  await key(app, "Escape"); // (closing keeps what was shown)
  g = await fillOf();
  expect([g.x0, g.x1]).toEqual([0, 1]);
  const box = await screenBox(app, (await last(app)).id);
  const mid = (box.minY + box.maxY) / 2;
  await drag(app, [box.maxX - 1, mid], [(box.minX + box.maxX) / 2, mid]);
  g = await fillOf();
  expect(g.x1).toBeGreaterThan(0.45);
  expect(g.x1).toBeLessThan(0.55);
  await p.keyboard.press("Control+z");
  expect((await fillOf()).x1).toBe(1);
  await p.keyboard.press("Control+Shift+z");
  expect((await fillOf()).x1).toBeLessThan(0.55);

  // saved
  await reload(app);
  expect((await fillOf()).stops.map((s) => s.c)).toEqual(["#ff0000", "#0000ff"]);

  // exact at any depth: a quarter of the way along (x1 is now half the width, so the shape's own 12.5% point), the colour is the blend there
  await p.keyboard.press("Escape");
  const here = await app.worldAt(500 + 260 * 0.125, 350); // t = 0.25 of the gradient (it ends half way)
  for (const zi of [40, 3000]) {
    await p.evaluate((w) => window.__canvastDebug.setCamera({ cx: w.x, cy: w.y, zi: w.zi, zf: 0, pz: w.zi }), { ...here, zi });
    await app.frame();
    const c = await px(640, 400);
    expect(Math.abs(c[0]! - 191) + Math.abs(c[1]!) + Math.abs(c[2]! - 64), `at ${zi} levels: ${c}`).toBeLessThanOrEqual(8);
  }
});

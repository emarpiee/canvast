import { stateWith, alignWith, boolWith, expect, exportWith, maskWith, outlineShapes, pathWith, test } from "./harness";
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
  expect(o).toMatchObject({ kind: "path", shape: "rect", fill: "#2563eb", stroke: null, join: "miter" }); // (no outline at first)
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
  await outlineShapes(p);
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
  await outlineShapes(p);
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
  await outlineShapes(p);
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
  await outlineShapes(p);
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
  await outlineShapes(p);
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

test("a gradient handle snaps like a move does (the Snap toggle): to the middle and the sides of the shape and of what is in view; off, it does not", async ({ app }) => {
  const p = app.page;
  const pop = p.locator(".colour-pop");
  await key(app, "u");
  await p.click('[data-paint="stroke"]');
  await pop.locator(".colour-none").click();
  await key(app, "Escape");
  await drag(app, [500, 300], [760, 400]);
  await key(app, "v");
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="linear"]').click();
  await pop.locator(".cg [data-angle]").fill("0");
  await key(app, "Escape");
  const box = await screenBox(app, (await last(app)).id);
  const mid = (box.minY + box.maxY) / 2;
  const cx = (box.minX + box.maxX) / 2;
  const x1 = async () => ((await last(app)).fill as unknown as { x1: number }).x1;
  await drag(app, [box.maxX - 1, mid], [cx - 4, mid]); // dropped 4 px short of the shape's middle
  expect(await x1(), "snapped onto the middle").toBeCloseTo(0.5, 6);
  await p.keyboard.press("Control+z");
  expect(await x1()).toBe(1);
  await p.getByRole("button", { name: "Snap to other objects" }).click(); // off
  await drag(app, [box.maxX - 1, mid], [cx - 4, mid]);
  expect(Math.abs((await x1()) - 0.5), "not snapped").toBeGreaterThan(0.005);
  expect(app.consoleErrors).toEqual([]);
});

test("Booleans (non-destructive boolean groups): the four operations from the selection bar, the shapes kept inside a group, one undo step", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  const fill = [37, 99, 235];
  const filled = async (x: number, y: number) => {
    const c = await px(x, y);
    return Math.abs(c[0]! - fill[0]!) + Math.abs(c[1]! - fill[1]!) + Math.abs(c[2]! - fill[2]!) < 12;
  };
  const menu = async (item: string) => {
    await boolWith(p, `op:${item.toLowerCase()}`);
    await app.frame();
  };
  type G = Obj & { result?: string; groups?: string[]; boolOps?: Record<string, string> };
  const all = async () => (await objs(app)) as unknown as G[];
  const res = async () => (await all()).find((o) => o.result !== undefined)!;

  await key(app, "u");
  await drag(app, [500, 300], [700, 400]); // at the back
  await drag(app, [600, 350], [800, 450]); // in front, overlapping its bottom right
  await key(app, "v");
  await expect(p.locator('[data-ctx="boolmenu"]')).toBeHidden(); // nothing selected yet
  await p.keyboard.press("Control+a");
  await expect(p.locator('[data-ctx="boolmenu"]')).toBeVisible();

  await menu("Union");
  let list = await all();
  expect(list).toHaveLength(3); // the two shapes are still there, and the result
  expect(list.filter((o) => o.result === undefined && o.boolOps)).toHaveLength(2);
  expect((await res()).sub[0]!.n).toHaveLength(8 * 6); // an L-shaped union: eight corners
  expect(await filled(550, 350)).toBe(true);
  expect(await filled(650, 375)).toBe(true);
  expect(await filled(750, 430)).toBe(true);
  expect(await filled(550, 430)).toBe(false); // the notch
  // the group is what is selected, and one click on the result picks the whole unit, not a hidden shape
  await p.keyboard.press("Escape");
  await click(app, 750, 430);
  expect((await p.evaluate(() => window.__canvastDebug.selection())).length).toBe(3);

  // the operation changes later, with the current one ticked
  await p.locator('[data-ctx="boolmenu"]').click();
  await expect(p.locator('.pop-menu [data-id="op:union"]')).toHaveAttribute("aria-checked", "true");
  await p.keyboard.press("Escape");
  await boolWith(p, "op:intersect");
  await app.frame();
  expect(await filled(650, 375)).toBe(true);
  expect(await filled(550, 350)).toBe(false);
  expect(await filled(750, 430)).toBe(false);
  expect((await all())).toHaveLength(3); // the same objects, a different result
  await boolWith(p, "op:subtract");
  await app.frame();
  expect(await filled(550, 350)).toBe(true);
  expect(await filled(650, 375)).toBe(false);
  await boolWith(p, "op:exclude");
  await app.frame();
  expect(await filled(550, 350)).toBe(true);
  expect(await filled(650, 375)).toBe(false);
  expect(await filled(750, 430)).toBe(true);

  // one undo takes the last change of operation back; more take the group away and leave the two shapes as they were
  await p.keyboard.press("Control+z");
  await app.frame();
  expect(await filled(750, 430)).toBe(false); // subtract again
  await p.keyboard.press("Control+z");
  await p.keyboard.press("Control+z");
  await p.keyboard.press("Control+z");
  expect(await all()).toHaveLength(2);
  expect((await all()).every((o) => o.groups === undefined && o.boolOps === undefined)).toBe(true);
});

test("Boolean groups: enter one to edit its shapes, the result follows as you drag; the group's own paint; flatten and release", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  type G = Obj & { result?: string; groups?: string[]; boolOps?: Record<string, string> };
  const all = async () => (await objs(app)) as unknown as G[];
  const res = async () => (await all()).find((o) => o.result !== undefined)!;
  await key(app, "u");
  await drag(app, [500, 300], [700, 400]);
  await drag(app, [600, 350], [800, 450]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  const gid = (await res()).result!;

  // Layers: one row, named by the operation, with the shapes inside it and no row for the result
  await p.getByRole("button", { name: "Layers panel" }).click();
  const rows = p.getByTestId("layers-panel").locator("li.layer");
  await expect.poll(async () => (await rows.locator(".layer-name").allTextContents()).join("|")).toContain("Union");
  await expect(rows.first()).toHaveAttribute("data-group", "true");
  await expect.poll(async () => rows.count()).toBe(3); // the group (open: its shapes are selected) and its two shapes, and no row for the result
  await p.getByTestId("layers-panel").locator("[data-twist]").first().click();
  await expect.poll(async () => rows.count()).toBe(1); // collapsed: only the group

  // double-click the result to go inside: the shapes show as outlines and can be picked one at a time
  await key(app, "Escape");
  await p.mouse.dblclick(750, 430); // on the front shape's own area: that shape is what is selected inside
  await app.frame();
  const inner = await p.evaluate(() => window.__canvastDebug.selection());
  expect(inner).toHaveLength(1);
  expect((await all()).find((o) => o.id === inner[0])!.result).toBeUndefined(); // a shape, not the result
  await click(app, 550, 350); // the back shape only (its own area)
  const sel = await p.evaluate(() => window.__canvastDebug.selection());
  expect(sel).toHaveLength(1);
  const back = (await all()).find((o) => o.id === sel[0])!;
  expect(back.groups).toEqual([gid]);

  // drag it: the result follows live (the pixel under the pointer's old place empties while it is still held), and one undo takes the move back
  const before = await px(540, 320);
  expect(before).toEqual([37, 99, 235]);
  await p.mouse.move(550, 350);
  await p.mouse.down();
  await p.mouse.move(350, 350, { steps: 8 });
  await app.frame();
  expect(await px(540, 320), "the result follows the shape while it is dragged").not.toEqual([37, 99, 235]);
  await p.mouse.up();
  await app.frame();
  expect(await px(540, 320)).not.toEqual([37, 99, 235]);
  expect(await px(350, 330)).toEqual([37, 99, 235]); // where it is now
  await p.keyboard.press("Control+z");
  await app.frame();
  expect(await px(540, 320)).toEqual([37, 99, 235]);
  expect((await all()).find((o) => o.id === back.id)!.ax).toBe(back.ax);

  // out again; the group's own paint changes the result and leaves the shapes alone
  await key(app, "Escape");
  await key(app, "Escape");
  await click(app, 750, 430);
  await p.click('[data-paint="fill"]');
  await p.locator(".colour-pop [data-hex]").fill("e11d48ff");
  await p.locator(".colour-pop [data-hex]").press("Enter");
  await key(app, "Escape");
  expect((await res()).fill).toBe("#e11d48");
  expect((await all()).filter((o) => o.result === undefined).every((o) => o.fill === "#2563eb")).toBe(true);

  // flatten (Ctrl+E): one plain path, the shapes gone; one undo brings the group back
  await p.keyboard.press("Control+e");
  await app.frame();
  let list = await all();
  expect(list).toHaveLength(1);
  expect(list[0]!.groups).toBeUndefined();
  expect(list[0]!.result).toBeUndefined();
  expect(list[0]!.fill).toBe("#e11d48");
  await p.keyboard.press("Control+z");
  expect(await all()).toHaveLength(3);

  // release: the two shapes come back as separate, plain shapes where they were
  await click(app, 750, 430);
  await boolWith(p, "release");
  await app.frame();
  list = await all();
  expect(list).toHaveLength(2);
  expect(list.every((o) => o.groups === undefined && o.boolOps === undefined && o.result === undefined)).toBe(true);
  expect(await px(550, 350)).toEqual([37, 99, 235]);
  expect(await px(750, 430)).toEqual([37, 99, 235]);
});

test("Boolean groups: saved over a reload, copied and pasted as a working group, nested in another", async ({ app }) => {
  const p = app.page;
  type G = Obj & { result?: string; groups?: string[]; boolOps?: Record<string, string> };
  const all = async () => (await objs(app)) as unknown as G[];
  await key(app, "u");
  await drag(app, [500, 300], [700, 400]);
  await drag(app, [600, 350], [800, 450]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:subtract");
  await app.frame();
  const first = (await all()).find((o) => o.result !== undefined)!;

  await reload(app);
  const again = await all();
  expect(again).toHaveLength(3);
  expect(again.find((o) => o.result !== undefined)!.sub).toEqual(first.sub);

  // copy and paste the group: a second, independent group
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Control+c");
  await p.keyboard.press("Control+v");
  await app.frame();
  const two = await all();
  expect(two).toHaveLength(6);
  const groupIds = new Set(two.map((o) => o.groups![0]));
  expect(groupIds.size).toBe(2);
  expect(two.filter((o) => o.result !== undefined)).toHaveLength(2);

  // nest: the group and a new shape combined into a group of its own, a result at each level (a selection of a group and a plain shape must not break the bar)
  await key(app, "Escape");
  await p.keyboard.press("Control+z"); // (take the paste back: one group and its three objects)
  await key(app, "u");
  await drag(app, [900, 300], [1000, 380]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await app.frame();
  await boolWith(p, "op:union");
  await app.frame();
  const nested = await all();
  expect(nested).toHaveLength(5); // the first group (two shapes and its result), the new shape, and the outer group's result
  expect(nested.filter((o) => o.result !== undefined)).toHaveLength(2);
  expect(nested.filter((o) => (o.groups?.length ?? 0) === 2)).toHaveLength(3); // the inner group's three objects are two deep
  expect(nested.filter((o) => (o.groups?.length ?? 0) === 1)).toHaveLength(2); // the new shape and the outer result
  expect(nested.find((o) => o.result !== undefined && o.groups!.length === 1)!.sub).toHaveLength(2); // the inner result and the new shape, side by side
});

test("outline options: width, position inside, centre or outside the edge (drawn, picked and bounded), corners; one undo each; saved", async ({ app }) => {
  const p = app.page;
  await outlineShapes(p);
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  const dark = (c: number[] | null) => !!c && Math.abs(c[0]! - 31) < 12 && Math.abs(c[1]! - 35) < 12 && Math.abs(c[2]! - 41) < 12;
  const pop = p.locator(".outline-pop");
  const picked = () => p.evaluate(() => window.__canvastDebug.selection().length);
  await key(app, "u");
  // the next shape: 20 px wide, outside the edge
  await p.click("[data-outline-options]");
  await expect(pop).toBeVisible();
  await pop.locator(".op-width").fill("20");
  await pop.locator(".op-width").press("Enter");
  await pop.locator('[data-align="outside"]').click();
  await key(app, "Escape");
  await expect(pop).toBeHidden();
  await drag(app, [500, 300], [800, 500]);
  const made = await last(app);
  expect((made as Obj & { align?: string }).align).toBe("outside");
  expect(made.join).toBe("miter"); // a rectangle keeps its sharp corners
  expect(dark(await px(490, 400))).toBe(true); // the line is out there, 10 px left of the edge (x 500)
  expect(dark(await px(510, 400))).toBe(false); // and none of it is over the fill
  await key(app, "v");
  await click(app, 487, 400); // picked on the line outside the edge
  expect(await picked()).toBe(1);
  await key(app, "Escape");
  await click(app, 470, 400); // 30 px out: past the line
  expect(await picked()).toBe(0);

  // the selected shape: inside, then centred; one undo step each
  await click(app, 650, 400);
  await p.click("[data-outline-options]");
  await pop.locator('[data-align="inside"]').click();
  await key(app, "Escape");
  expect(((await last(app)) as Obj & { align?: string }).align).toBe("inside");
  await app.frame();
  expect(dark(await px(510, 400))).toBe(true); // now it is over the fill
  expect(dark(await px(490, 400))).toBe(false);
  await p.click("[data-outline-options]");
  await pop.locator('[data-align="centre"]').click();
  await key(app, "Escape");
  expect(((await last(app)) as Obj & { align?: string }).align).toBeUndefined();
  await click(app, 200, 650); // (the selection's own frame is drawn on the edge: look at the shape alone)
  expect(dark(await px(494, 400))).toBe(true); // half a width each side of the edge
  expect(dark(await px(506, 400))).toBe(true);
  await p.keyboard.press("Control+z");
  expect(((await last(app)) as Obj & { align?: string }).align).toBe("inside");

  // corners: round
  await click(app, 650, 400);
  await p.click("[data-outline-options]");
  await pop.locator('[data-join="round"]').click();
  await key(app, "Escape");
  expect((await last(app)).join).toBeUndefined();

  // a width of 0 is no outline (its width is kept); a width on a shape without one turns one on
  const w0 = (await last(app)).width;
  await p.click("[data-outline-options]");
  await pop.locator(".op-width").fill("0");
  await pop.locator(".op-width").press("Enter");
  await key(app, "Escape");
  expect((await last(app)).stroke).toBeNull();
  expect((await last(app)).width).toBe(w0);
  await p.click("[data-outline-options]");
  await pop.locator(".op-width").fill("6");
  await pop.locator(".op-width").press("Enter");
  await key(app, "Escape");
  expect((await last(app)).stroke).toBe("#1f2329");
  await reload(app);
  expect(((await last(app)) as Obj & { align?: string }).align).toBe("inside");
  // what the next shape gets is remembered too (it was set to Outside, Sharp corners were then left alone), but not the outline itself:
  // a new session starts with none, so its width reads 0
  await key(app, "u");
  await p.click("[data-outline-options]");
  await expect(pop.locator('[data-align="outside"]')).toHaveAttribute("aria-checked", "true");
  await expect(pop.locator("#op-width")).toHaveValue("0");
});

test("a boolean group's gradient is moved with its handles on the canvas, picked whole, as a single shape's is", async ({ app }) => {
  const p = app.page;
  const pop = p.locator(".colour-pop");
  type Grad = { x0: number; x1: number; stops: Array<{ c: string }> };
  const result = async () => (await objs(app)).find((o) => (o as Obj & { result?: string }).result !== undefined)!;
  await key(app, "u");
  await p.click('[data-paint="stroke"]');
  await pop.locator(".colour-none").click();
  await key(app, "Escape");
  await drag(app, [500, 300], [760, 400]);
  await key(app, "v");
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="linear"]').click();
  await pop.locator(".cg [data-angle]").fill("0");
  await key(app, "Escape");
  await key(app, "u");
  await drag(app, [640, 340], [900, 460]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await p.mouse.move(300, 650); // (a button under the pointer names itself in the hint line)
  await app.frame();
  const r = await result();
  expect((r.fill as unknown as Grad).x1).toBe(1);
  await expect(p.getByTestId("tool-hint")).toContainText("round handles");
  const box = await screenBox(app, r.id);
  const mid = (box.minY + box.maxY) / 2;
  await drag(app, [box.maxX - 1, mid], [(box.minX + box.maxX) / 2, mid]); // the group is picked whole: its gradient end is dragged
  const g = (await result()).fill as unknown as Grad;
  expect(g.x1).toBeGreaterThan(0.4);
  expect(g.x1).toBeLessThan(0.6);
});

test("shapes stay editable after drawing: a polygon's sides, a star's points and ratio, a corner radius; one undo each; saved; nodes edited by hand end it", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  const nodes = async () => ((await last(app)).sub[0]!.n.length / 6);
  const set = async (sel: string, v: string) => {
    await p.locator(sel).fill(v);
    await p.locator(sel).press("Enter");
    await p.locator(sel).blur(); // (the keys go to the canvas again)
    await app.frame();
  };
  await key(app, "u");
  await p.click('[data-shape-kind="polygon"]');
  await drag(app, [500, 300], [700, 460]);
  await key(app, "v");
  await click(app, 600, 400);
  await expect(p.locator("[data-sel-sides]")).toBeVisible();
  await expect(p.locator("[data-sel-sides]")).toHaveValue("6");
  await set("[data-sel-sides]", "8");
  expect(await nodes()).toBe(8);
  await key(app, "Control+z");
  expect(await nodes()).toBe(6);
  await key(app, "Control+Shift+z");
  expect(await nodes()).toBe(8);
  await set("[data-sel-radius]", "12");
  expect(await nodes()).toBe(16); // every corner is two nodes now
  await reload(app);
  await click(app, 600, 400);
  await expect(p.locator("[data-sel-sides]")).toHaveValue("8");
  await expect(p.locator("[data-sel-radius]")).toHaveValue("12");

  // a star: points and ratio
  await key(app, "u");
  await p.click('[data-shape-kind="star"]');
  await drag(app, [800, 300], [960, 460]);
  await key(app, "v");
  await click(app, 880, 390);
  await set("[data-sel-tips]", "7");
  expect(await nodes()).toBe(14);
  await set("[data-sel-inner]", "20");
  const n = (await last(app)).sub[0]!.n;
  const cx = n.filter((_, i) => i % 6 === 0).reduce((a, b) => a + b, 0) / 14;
  const cy = n.filter((_, i) => i % 6 === 1).reduce((a, b) => a + b, 0) / 14;
  const radius = (k: number) => Math.hypot(n[k * 6]! - cx, n[k * 6 + 1]! - cy);
  expect(radius(1) / radius(0)).toBeCloseTo(0.2, 1); // an inner corner sits at 20% of the outer radius

  // a rectangle: the corner is cut away (the pixel just inside the old corner is no longer the fill)
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [300, 520], [500, 640]);
  await key(app, "v");
  await click(app, 400, 580);
  await expect(p.locator("[data-sel-sides]")).toBeHidden();
  await p.click("[data-paint=\"stroke\"]");
  await p.locator(".colour-pop .colour-none").click();
  await key(app, "Escape");
  await set("[data-sel-radius]", "30");
  await click(app, 900, 300); // look at the shape alone (empty canvas; the selection options stand beside the Actions bar at the bottom)
  expect(await px(304, 524)).not.toEqual([37, 99, 235]); // the corner is gone
  expect(await px(330, 550)).toEqual([37, 99, 235]); // the middle is not

  // moving a node by hand makes it an ordinary path: the sides and points go, the radius stays (the nodes shown are its sharp ones)
  await click(app, 400, 580);
  await key(app, "Enter"); // Edit nodes
  const box = await screenBox(app, (await last(app)).id);
  await drag(app, [box.minX + 70, box.minY + 0.5], [box.minX + 70, box.minY - 20]);
  await key(app, "Escape");
  await click(app, 400, 600);
  await expect(p.locator("[data-sel-radius]")).toBeVisible();
  await expect(p.locator("[data-sel-radius]")).toHaveValue("30");
});

test("corner radius on every kind of shape: one value or four on a rectangle, any path with sharp corners, a boolean group's result (the shapes keep theirs)", async ({ app }) => {
  const p = app.page;
  const nodes = async (o?: Obj) => ((o ?? (await last(app))).sub.reduce((a, s) => a + s.n.length / 6, 0));
  const set = async (v: string) => {
    await p.locator("[data-sel-radius]").fill(v);
    await p.locator("[data-sel-radius]").press("Enter");
    await p.locator("[data-sel-radius]").blur();
    await app.frame();
  };
  // a rectangle: four values, one per corner
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await key(app, "v");
  await click(app, 600, 360);
  await set("40 0 40 0");
  expect(await nodes()).toBe(6);
  await set("0");
  expect(await nodes()).toBe(4);
  // an ellipse has no corners: no field
  await key(app, "u");
  await p.click('[data-shape-kind="ellipse"]');
  await drag(app, [800, 300], [960, 420]);
  await key(app, "v");
  await click(app, 880, 360);
  await expect(p.locator("[data-sel-radius]")).toBeHidden();
  // a triangle drawn with the Path tool: any path with sharp corners
  await key(app, "b");
  await click(app, 300, 520);
  await click(app, 460, 520);
  await click(app, 380, 640);
  await click(app, 300, 520);
  await key(app, "v");
  await click(app, 380, 560);
  await set("12");
  expect(await nodes()).toBe(6);
  // Edit nodes shows its three sharp corners, not the six rounded ones, and keeps the rounding when one is moved
  await key(app, "Enter");
  const tri = await last(app);
  const box = await screenBox(app, tri.id);
  await drag(app, [box.maxX - 3, box.maxY - 3], [box.maxX + 30, box.maxY + 20]);
  await key(app, "Escape");
  expect(await nodes()).toBe(6);
  // a boolean group: its own radius rounds the result, the shapes inside keep their sharp corners
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [700, 520], [860, 620]);
  await drag(app, [780, 560], [940, 660]);
  await key(app, "v");
  await click(app, 720, 540);
  await click(app, 920, 640, ["Shift"]);
  await boolWith(p, "op:union");
  await app.frame();
  const before = (await objs(app)).find((o) => (o as Obj & { result?: string }).result !== undefined)!;
  expect(await nodes(before)).toBe(8);
  await set("14");
  const after = (await objs(app)).find((o) => (o as Obj & { result?: string }).result !== undefined)!;
  expect(await nodes(after)).toBe(16);
  const members = (await objs(app)).filter((o) => (o as Obj & { result?: string }).result === undefined && (o as Obj & { groups?: string[] }).groups);
  expect(members.every((m) => m.sub[0]!.n.length / 6 === 4)).toBe(true); // the shapes are as they were
  await p.keyboard.press("Control+z");
  expect(await nodes((await objs(app)).find((o) => (o as Obj & { result?: string }).result !== undefined)!)).toBe(8);
});

test("numbers without typing: drag the field (Radius, Points, Ratio) or a dot on the canvas; live, one undo step", async ({ app }) => {
  const p = app.page;
  type P = Obj & { radius?: number | number[]; params?: { inner?: number; tips?: number } };
  const lastP = async () => (await last(app)) as P;
  const labelBox = async (name: string) => (await p.locator(`[data-scrub="${name}"] input`).boundingBox())!; // (the field scrubs: its name is only a label)
  // a rectangle: drag the Radius name to the right
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await key(app, "v");
  await click(app, 600, 360);
  const lb = await labelBox("radius");
  await p.mouse.move(lb.x + 8, lb.y + lb.height / 2);
  await p.mouse.down();
  await p.mouse.move(lb.x + 8 + 20, lb.y + lb.height / 2, { steps: 4 });
  expect((await lastP()).radius).toBeUndefined(); // shown while dragging, not stored yet
  await p.mouse.move(lb.x + 8 + 30, lb.y + lb.height / 2, { steps: 4 });
  await p.mouse.up();
  await app.frame();
  expect((await lastP()).radius as number).toBeGreaterThan(20);
  expect(await p.locator("[data-sel-radius]").inputValue()).toMatch(/^\d+(\.\d+)?$/);
  await key(app, "Control+z");
  expect((await lastP()).radius).toBeUndefined(); // one step
  await key(app, "Control+Shift+z");

  // the dot inside the corner: drag it towards the middle
  const before = (await lastP()).radius as number;
  await drag(app, [500 + before, 300 + before], [530 + before, 330 + before]); // (the dot is at the middle of the corner's arc)
  expect((await lastP()).radius as number).toBeGreaterThan(before + 5);
  await key(app, "Control+z");
  expect((await lastP()).radius as number).toBeCloseTo(before, 6);

  // a star: the Points name, and the handle on its first inner corner
  await key(app, "u");
  await p.click('[data-shape-kind="star"]');
  await drag(app, [800, 300], [960, 460]);
  await key(app, "v");
  await click(app, 880, 390);
  const pb = await labelBox("tips");
  await p.mouse.move(pb.x + 8, pb.y + pb.height / 2);
  await p.mouse.down();
  await p.mouse.move(pb.x + 8 + 48, pb.y + pb.height / 2, { steps: 6 });
  await p.mouse.up();
  await app.frame();
  expect((await lastP()).params!.tips).toBe(9); // 4 more at 12 px each
  const star = await lastP();
  const box = await screenBox(app, star.id);
  const w = box.maxX - box.minX;
  // inner corner 1 sits at -90 + 180/9 = -70 degrees from the top, at the ratio of the radius, about the middle of the box
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  const inner0 = star.params!.inner!;
  const R = w / 2;
  const hx = cx + Math.cos((-70 * Math.PI) / 180) * R * inner0;
  const hy = cy + Math.sin((-70 * Math.PI) / 180) * R * inner0;
  await drag(app, [hx, hy], [cx + (hx - cx) * 0.4, cy + (hy - cy) * 0.4]);
  expect((await lastP()).params!.inner!).toBeLessThan(inner0 - 0.1);
});

test("corner radius dots: a radius pushed to its limit comes back; one dot per corner (double-click or hold the main dot); a star's every corner", async ({ app }) => {
  const p = app.page;
  type P = Obj & { radius?: number | number[] };
  const lastP = async () => (await last(app)) as P;
  const nodes = async () => (await last(app)).sub[0]!.n.length / 6;
  await key(app, "u");
  await p.click('[data-shape-kind="star"]');
  await drag(app, [500, 300], [700, 500]);
  await key(app, "v");
  await click(app, 600, 420);
  // the main dot is inside the first corner (the top tip); push it as far as it goes
  const dot = async () => (await p.evaluate(() => window.__canvastDebug.cornerDots()))!.main;
  const radiusAt = async () => (await lastP()).radius as number;
  const d0 = await dot();
  await drag(app, [d0[0], d0[1]], [d0[0], d0[1] + 200]);
  const big = await radiusAt();
  expect(big).toBeGreaterThan(5);
  await click(app, 900, 650); // away, and back
  await click(app, 600, 420);
  // the dot sits at the limit, not beyond it: pulling it back changes the radius at once
  const d1 = await dot();
  await drag(app, [d1[0], d1[1]], [d1[0], d1[1] - 12]);
  expect(await radiusAt()).toBeLessThan(big - 2);
  // and the typed value cannot go past it either
  await p.locator("[data-sel-radius]").fill("100000");
  await p.locator("[data-sel-radius]").press("Enter");
  await p.locator("[data-sel-radius]").blur();
  expect(await radiusAt()).toBeLessThan(200);

  // a rectangle: open the corners out with a double-click on the main dot, and set one corner alone
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [300, 440], [500, 560]); // (clear of the Actions bar along the bottom)
  await key(app, "v");
  await click(app, 400, 500);
  const main0 = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!.main;
  // the handle names its value while the pointer is over it, not only while it is dragged
  await p.mouse.move(main0[0], main0[1]);
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.handleLabel())).toMatch(/^Radius /);
  const guide = (await p.evaluate(() => window.__canvastDebug.handleGuide()))!; // the way it slides is drawn: a line with ends, through the dot
  expect(Math.hypot(guide.x1 - guide.x0, guide.y1 - guide.y0)).toBeGreaterThan(20);
  await p.mouse.move(main0[0] + 150, main0[1] + 60);
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.handleLabel())).toBeNull();
  await p.mouse.dblclick(main0[0], main0[1]);
  await app.frame();
  expect(await tool(app)).toBe("select"); // (not Edit nodes)
  // each corner has a dot at the middle of its arc: the bottom right one
  const dots = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!;
  expect(dots.corners).toHaveLength(4);
  const br = dots.corners[2]!; // (nodes run clockwise from the top left)
  await drag(app, [br[0], br[1]], [br[0] - 20, br[1] - 20]);
  const r = (await lastP()).radius as number[];
  expect(Array.isArray(r)).toBe(true);
  expect(r.filter((v) => v > 0)).toHaveLength(1);
  expect(r[2]!).toBeGreaterThan(10);
  expect(await nodes()).toBe(5); // one corner rounded: five nodes
  await key(app, "Control+z");
  expect((await lastP()).radius).toBeUndefined();
  await key(app, "Control+Shift+z");
  // the main dot, now in the middle, sets them all (dragging right is more)
  const mid = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!.main;
  await drag(app, [mid[0], mid[1]], [mid[0] + 25, mid[1]]);
  const all = (await lastP()).radius;
  expect(typeof all).toBe("number");
  expect(all as number).toBeGreaterThan(15);
  expect(await nodes()).toBe(8);
  // held still, the main dot closes the corners again
  const mid2 = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!;
  await p.mouse.move(mid2.main[0], mid2.main[1]);
  await p.mouse.down();
  await p.waitForTimeout(650);
  await p.mouse.up();
  await app.frame();
  expect(await nodes()).toBe(8); // (a hold changes no number)
  expect((await p.evaluate(() => window.__canvastDebug.cornerDots()))!.corners.length).toBe(4); // it opened or closed: either way the dots are asked for
  const held = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!;
  expect(held.main[0]).not.toBeCloseTo(mid2.main[0], 0); // the main dot is back inside the first corner
});

test("a boolean group turns with its shapes: its box stays turned instead of snapping upright, and it goes on from there", async ({ app }) => {
  const p = app.page;
  const angle = async () => (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!.angle;
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await drag(app, [600, 360], [800, 480]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  const turn = async (deg: number) => {
    const f = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
    const c = f.corners;
    const cx = (c[0]![0] + c[2]![0]) / 2, cy = (c[0]![1] + c[2]![1]) / 2;
    const top = [(c[0]![0] + c[1]![0]) / 2, (c[0]![1] + c[1]![1]) / 2];
    const start = Math.atan2(top[1]! - 26 * Math.cos(f.angle) - cy, top[0]! + 26 * Math.sin(f.angle) - cx);
    const r = Math.hypot(top[0]! - cx, top[1]! - cy) + 26;
    await p.mouse.move(cx + Math.cos(start) * r, cy + Math.sin(start) * r);
    await p.mouse.down();
    for (let k = 1; k <= 5; k++) {
      const a = start + (((deg * k) / 5) * Math.PI) / 180;
      await p.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    await p.mouse.up();
    await app.frame();
  };
  expect(await angle()).toBe(0);
  await turn(30);
  expect((await angle()) * (180 / Math.PI)).toBeCloseTo(30, 0);
  await turn(20);
  expect((await angle()) * (180 / Math.PI)).toBeCloseTo(50, 0);
  await key(app, "Control+z");
  expect((await angle()) * (180 / Math.PI)).toBeCloseTo(30, 0);
});

test("nested boolean groups: a group inside a group; moving, turning, rounding and undoing reach both levels; saved", async ({ app }) => {
  const p = app.page;
  type G = Obj & { result?: string; groups?: string[]; radius?: number; rot?: number };
  const all = async () => (await objs(app)) as unknown as G[];
  const results = async () => (await all()).filter((o) => o.result !== undefined);
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await drag(app, [640, 340], [840, 460]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  // a third shape, subtracted from the group as a whole
  await key(app, "u");
  await drag(app, [560, 380], [660, 440]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:subtract");
  await app.frame();
  expect(await all()).toHaveLength(5); // three shapes and two results
  const rs = await results();
  expect(rs).toHaveLength(2);
  const outer = rs.find((o) => o.groups!.length === 1)!;
  const inner = rs.find((o) => o.groups!.length === 2)!;
  expect(outer.sub.length).toBeGreaterThan(inner.sub.length - 1); // the hole is another loop
  // round the outer one; the inner result and the shapes are as they were
  await p.locator("[data-sel-radius]").fill("10");
  await p.locator("[data-sel-radius]").press("Enter");
  await p.locator("[data-sel-radius]").blur();
  await app.frame();
  const after = await results();
  expect(after.find((o) => o.groups!.length === 1)!.radius as number).toBeGreaterThan(0);
  expect(after.find((o) => o.groups!.length === 2)!.radius).toBeUndefined();
  const nodesOf = (o: G) => o.sub.reduce((n, s) => n + s.n.length / 6, 0);
  expect(nodesOf(after.find((o) => o.groups!.length === 1)!)).toBeGreaterThan(nodesOf(outer));
  // turn the whole thing: every level turns with it
  const f = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
  const c = f.corners;
  const cx = (c[0]![0] + c[2]![0]) / 2, cy = (c[0]![1] + c[2]![1]) / 2;
  const hx = (c[0]![0] + c[1]![0]) / 2, hy = (c[0]![1] + c[1]![1]) / 2 - 26;
  await p.mouse.move(hx, hy);
  await p.mouse.down();
  await p.mouse.move(cx + (cy - hy), cy - (hx - cx) * 0 + 0, { steps: 6 });
  await p.mouse.up();
  await app.frame();
  const turned = await results();
  expect(turned.every((o) => (o.rot ?? 0) > 0)).toBe(true);
  expect(new Set((await all()).map((o) => o.rot)).size).toBe(1); // every object turned by the same angle
  await key(app, "Control+z");
  expect((await results()).every((o) => !o.rot)).toBe(true);
  await key(app, "Control+z"); // the radius
  expect((await results()).find((o) => o.groups!.length === 1)!.radius).toBeUndefined();
  await key(app, "Control+Shift+z");
  await key(app, "Control+Shift+z");
  await reload(app);
  expect((await results()).every((o) => (o.rot ?? 0) > 0)).toBe(true);
  expect((await results()).find((o) => o.groups!.length === 1)!.radius as number).toBeGreaterThan(0);
});

test("selection colours: the colours of several picked shapes as chips; one change reaches every shape that uses it, a gradient too; one undo step", async ({ app }) => {
  const p = app.page;
  await outlineShapes(p);
  const pop = p.locator(".colour-pop");
  const chips = p.locator("[data-sel-colour]");
  type G = { type: string; x0: number; y0: number; x1: number; y1: number; stops: Array<{ c: string }> };
  const fills = async () => (await objs(app)).map((o) => o.fill as unknown as string | G);
  await key(app, "u");
  await drag(app, [300, 330], [420, 410]); // (below the dev panel, which is taller in Firefox)
  await drag(app, [500, 300], [620, 380]);
  await drag(app, [700, 300], [820, 380]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await app.frame();
  // two paints: the blue of the fills and the dark of the outlines (shown as a ring); the Fill and Outline chips make way for them
  await expect(chips).toHaveCount(2);
  await expect(p.locator('[data-paint="fill"]')).toBeHidden();
  await expect(chips.nth(1)).toHaveAttribute("data-ring", "");
  await chips.first().click();
  await pop.locator("[data-hex]").fill("e11d48");
  await pop.locator("[data-hex]").press("Enter");
  await key(app, "Escape");
  expect(await fills()).toEqual(["#e11d48", "#e11d48", "#e11d48"]);
  await p.keyboard.press("Control+z");
  expect(await fills()).toEqual(["#2563eb", "#2563eb", "#2563eb"]); // one step for the three shapes
  await p.keyboard.press("Control+Shift+z");

  // a gradient on two of them: it is one chip, and editing it edits both (each keeps its own box)
  await click(app, 360, 340);
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="linear"]').click();
  await key(app, "Escape");
  await click(app, 560, 340);
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="linear"]').click();
  await key(app, "Escape");
  await p.keyboard.press("Control+a");
  await app.frame();
  await expect(chips).toHaveCount(3); // the red, the gradient the two share (one chip), the dark of the outlines
  const before = (await fills())[0] as G;
  expect(before.type).toBe("linear");
  await chips.nth(1).click(); // (the most used first: the dark of the three outlines, then the gradient of two fills, then the red)
  await pop.locator(".cg [data-angle]").fill("90");
  await key(app, "Escape");
  const now = await fills();
  expect((now[0] as G).y1).not.toBe(before.y1); // turned
  expect(now[1]).toEqual(now[0]); // both, the same
  expect(now[2]).toBe("#e11d48"); // the plain one untouched
  await p.keyboard.press("Control+z");
  expect((await fills())[0]).toEqual(before);
  expect((await fills())[1]).toEqual(before);
});

test("resizing a rounded shape: the radius goes with it, and stays the same size with the radius lock", async ({ app }) => {
  const p = app.page;
  type R = Obj & { radius?: number };
  const world = async () => {
    const o = (await last(app)) as R;
    return { r: o.radius! * 2 ** o.unit, w: size(o).w * 2 ** o.unit };
  };
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await key(app, "v");
  await click(app, 600, 360);
  await p.locator("[data-sel-radius]").fill("20");
  await p.locator("[data-sel-radius]").press("Enter");
  await p.locator("[data-sel-radius]").blur();
  await app.frame();
  const a = await world();
  expect(a.r).toBeCloseTo(20, 4);
  // the bottom right handle, to twice the size
  await drag(app, [700, 420], [900, 540]);
  const b = await world();
  expect(b.w / a.w).toBeCloseTo(2, 1);
  expect(b.r / a.r).toBeCloseTo(b.w / a.w, 1); // it keeps its look: the radius grew as the shape did
  // with the radius lock on, the corner keeps its size
  await p.click("[data-lock-radius]");
  await key(app, "Escape");
  await click(app, 700, 480);
  const box = await screenBox(app, (await last(app)).id);
  await drag(app, [box.maxX, box.maxY], [box.maxX + 200, box.maxY + 120]);
  const c = await world();
  expect(c.w / b.w).toBeGreaterThan(1.3);
  expect(c.r / b.r).toBeCloseTo(1, 3);
});

test("a rounded star's box fits the shape as drawn (it shrinks with a big radius, no empty space left), and it resizes like any shape", async ({ app }) => {
  const p = app.page;
  const frame = async () => {
    const f = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
    return { w: f.corners[1]![0] - f.corners[0]![0], h: f.corners[2]![1] - f.corners[1]![1], x: f.corners[0]![0], y: f.corners[0]![1] };
  };
  const set = async (sel: string, v: string) => {
    await p.locator(sel).fill(v);
    await p.locator(sel).press("Enter");
    await p.locator(sel).blur();
    await app.frame();
  };
  await key(app, "u");
  await p.click('[data-shape-kind="star"]');
  await drag(app, [400, 200], [800, 600]); // (clear of the Actions bar along the bottom)
  await key(app, "v");
  await click(app, 600, 420);
  const plain = await frame();
  await set("[data-sel-radius]", "60");
  expect((await frame()).w, "rounded: the box follows the shape in").toBeLessThan(plain.w - 20);
  await set("[data-sel-radius]", "0");
  expect(Math.abs((await frame()).w - plain.w), "sharp again: the same box").toBeLessThan(8);
  // resized with a handle, it is the shape that is resized: half the size, half the radius
  await set("[data-sel-inner]", "40");
  await set("[data-sel-radius]", "30");
  const before = await frame();
  const radius0 = parseFloat(await p.locator("[data-sel-radius]").inputValue());
  await drag(app, [before.x + before.w, before.y + before.h], [before.x + before.w / 2, before.y + before.h / 2]);
  const after = await frame();
  expect(after.w / before.w).toBeCloseTo(0.5, 1);
  expect(parseFloat(await p.locator("[data-sel-radius]").inputValue()) / radius0).toBeCloseTo(0.5, 1);
});

test("polygon and star: a triangle handle on the shape sets how many; a label says what is being changed; one undo step", async ({ app }) => {
  const p = app.page;
  type P = Obj & { params?: { sides?: number; tips?: number } };
  await key(app, "u");
  await p.click('[data-shape-kind="star"]');
  await drag(app, [500, 300], [740, 540]);
  await key(app, "v");
  await click(app, 620, 420);
  const f = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!;
  expect(f.count).not.toBeNull();
  const [hx, hy] = f.count!;
  const [cx, cy] = f.countCentre!;
  // from the first tip (the top) to the second: turning further round makes fewer, nearer makes more
  const at = (deg: number) => [cx + Math.sin((deg * Math.PI) / 180) * 120, cy - Math.cos((deg * Math.PI) / 180) * 120] as const;
  await p.mouse.move(hx, hy);
  await p.mouse.down();
  await p.mouse.move(...at(60), { steps: 6 }); // 360 / 60 = 6 points
  await app.frame();
  expect(await p.evaluate(() => window.__canvastDebug.handleLabel())).toBe("Count 6");
  const arc = (await p.evaluate(() => window.__canvastDebug.handleGuide()))?.arc; // the way it slides is drawn, as the radius and ratio handles do: an arc round the middle
  expect(arc, "the count handle shows the arc it goes along").toBeTruthy();
  expect(arc!.a1 - arc!.a0, "from 24 corners to 3").toBeCloseTo((2 * Math.PI) / 3 - (2 * Math.PI) / 24, 5);
  await p.mouse.up();
  await app.frame();
  expect(await p.evaluate(() => window.__canvastDebug.handleLabel())).toBeNull();
  expect(((await last(app)) as P).params!.tips).toBe(6);
  await key(app, "Control+z");
  expect(((await last(app)) as P).params!.tips).toBe(5);
});

test("the interface around the vector tools: the hint floats at the bottom (and can be turned off), buttons name themselves, seldom-used options are in a menu, dividers in the selection bar, many colours do not push any out of reach", async ({ app }) => {
  const p = app.page;
  await outlineShapes(p);
  const pop = p.locator(".colour-pop");
  const hint = p.getByTestId("tool-hint");
  await p.mouse.move(300, 650);
  await key(app, "u");
  await expect(hint).toContainText("rectangle"); // floating at the bottom, not in the options bar
  await expect(p.locator(".toolbar [data-testid=tool-hint]")).toHaveCount(0);
  // seven shapes of seven colours
  const hexes = ["e11d48", "f59e0b", "84cc16", "14b8a6", "3b82f6", "8b5cf6", "ec4899"];
  for (const [n, hex] of hexes.entries()) {
    await p.click('[data-paint="fill"]');
    await pop.locator("[data-hex]").fill(hex);
    await pop.locator("[data-hex]").press("Enter");
    await key(app, "Escape");
    await drag(app, [300 + n * 90, 330], [370 + n * 90, 390]);
  }
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await app.frame();
  // seven chips, and the others in one button that opens them as a list: the seven fills and the dark outline are eight colours
  await expect(p.locator("[data-sel-colour]")).toHaveCount(7);
  await expect(p.locator("[data-sel-more]")).toHaveText("+1");
  await p.locator("[data-sel-more]").click();
  await expect(p.getByRole("menuitem")).toHaveCount(1);
  await p.keyboard.press("Escape");
  await expect(p.locator(".pop-menu")).toHaveCount(0);
  // dividers between the groups of the selection bar, a button names itself in the hint
  expect(await p.locator(".ctx-bar .tb-group:not([hidden])").count()).toBeGreaterThan(1);
  await p.hover('[data-ctx="duplicate"]');
  await expect(hint).toHaveText("Duplicate");
  await p.mouse.move(300, 650);
  // the options of the Select tool are buttons of the Properties bar, none in a menu
  await key(app, "Escape");
  await click(app, 300, 650); // (nothing picked)
  await expect(p.getByRole("button", { name: "Show all hidden" }), "Show all and Unlock all are in the context menu, not the bar").toHaveCount(0);
  await expect(p.getByRole("toolbar", { name: "Selection options" }), "with nothing selected there is no bar of selection options").toBeHidden();
  await expect(p.getByRole("button", { name: /^Ignore the object that fills the view/ }), "the fill-select guard stays in the options bar: it is for when nothing is selected").toBeVisible();
  // the rest are a bar of their own beside the Actions bar (with something picked), not in the options bar at the top
  for (const name of [/^Axis-aligned selection box/, /^Snap to other objects/, /^Lock corner radius/]) expect(await p.getByRole("toolbar", { name: "Tool options" }).getByRole("button", { name }).count(), `${name} is not in the options bar`).toBe(0);
  await expect(p.locator("[data-select-more]")).toHaveCount(0);
  // the hint line never runs under the controls at the bottom right: it takes the room they leave
  const hintBox = await p.locator(".hint-float").boundingBox();
  const controlsBox = (await p.locator(".hud-controls").boundingBox())!;
  if (hintBox && hintBox.y + hintBox.height > controlsBox.y) expect(hintBox.x + hintBox.width, "the hint ends before the controls").toBeLessThanOrEqual(controlsBox.x);
  // Settings > Hints and tooltips: none
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Appearance" }).click();
  await p.locator('select[data-set="ui.hints"]').selectOption("off");
  await p.getByRole("button", { name: /Back to canvas/ }).click();
  await app.frame();
  await key(app, "u");
  await expect(hint).toBeHidden();
});

test("initial shape: set it, change the shape any way, reset to it (after a reload too); update it; one undo step each", async ({ app }) => {
  const p = app.page;
  type P = Obj & { params?: { inner?: number; tips?: number; box?: number[] }; initial?: unknown; radius?: number };
  const lastP = async () => (await last(app)) as P;
  const world = (o: P) => ({ w: o.params!.box![2]! * 2 ** o.unit, nodes: o.sub[0]!.n.length / 6 }); // (the box the shape fills: rounding does not change it)
  const menu = async (name: RegExp) => {
    await p.getByRole("button", { name }).click();
    await app.frame();
  };
  await key(app, "u");
  await p.click('[data-shape-kind="star"]');
  await drag(app, [500, 300], [740, 540]);
  await key(app, "v");
  await click(app, 620, 420);
  // nothing saved yet: only "Set initial shape" is there (the update and reset buttons come once a shape is saved)
  await p.locator('[data-ctx="statemenu"]').click();
  await expect(p.locator('.pop-menu [data-id="stateset"]')).toBeVisible();
  await expect(p.locator('.pop-menu [data-id="statereset"]')).toHaveCount(0);
  await expect(p.locator('.pop-menu [data-id="stateupdate"]')).toHaveCount(0);
  await key(app, "Escape");
  await stateWith(p, "stateset");
  const first = world(await lastP());
  expect((await lastP()).initial).toBeDefined();
  // change it: ratio, points, radius, a move and a resize
  const set = async (sel: string, v: string) => {
    await p.locator(sel).fill(v);
    await p.locator(sel).press("Enter");
    await p.locator(sel).blur();
    await app.frame();
  };
  await set("[data-sel-inner]", "15");
  await set("[data-sel-tips]", "9");
  await set("[data-sel-radius]", "20");
  await drag(app, [620, 430], [700, 450]);
  const f = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
  await drag(app, [f.corners[2]![0], f.corners[2]![1]], [f.corners[2]![0] + 90, f.corners[2]![1] + 60]);
  expect(world(await lastP()).w / first.w).toBeGreaterThan(1.2);
  const edited = await lastP();
  await reload(app);
  await p.keyboard.press("Control+a");
  await app.frame();
  // back to the initial shape: its size, its points, its ratio, no radius; where the middle was
  const middle = async () => {
    const b = await screenBox(app, (await lastP()).id);
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  };
  const m0 = await middle();
  await stateWith(p, "statereset");
  const back = await lastP();
  expect(world(back).w / first.w).toBeCloseTo(1, 6);
  expect(back.params!.tips).toBe(5);
  expect(back.params!.inner).toBeCloseTo(0.45, 6);
  expect(back.radius).toBeUndefined();
  const m1 = await middle();
  expect(Math.abs(m1[0]! - m0[0]!)).toBeLessThan(2);
  expect(Math.abs(m1[1]! - m0[1]!)).toBeLessThan(2);
  expect(back.fill).toBe(edited.fill); // only the shape goes back
  await key(app, "Control+z"); // one step
  expect(((await lastP()) as P).params!.tips).toBe(9);
  await key(app, "Control+Shift+z");
  // update it to something else, change again, reset: to the updated one
  await set("[data-sel-tips]", "7");
  await stateWith(p, "stateupdate");
  await set("[data-sel-tips]", "12");
  await stateWith(p, "statereset");
  expect(((await lastP()) as P).params!.tips).toBe(7);
});

test("stepping with W A S D reaches an item that is in view even when it is much bigger than the selected one", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [520, 520], [540, 535]); // a small one
  await drag(app, [440, 160], [700, 330]); // a big one above it, a few hundred px away
  await key(app, "v");
  const [small, big] = (await objs(app)).map((o) => o.id);
  await click(app, 530, 527);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([small]);
  await key(app, "w");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.selection())).toEqual([big]);
});

test("a boolean group takes more shapes and gives them back: Add to the group, Take out of the group", async ({ app }) => {
  const p = app.page;
  type G = Obj & { groups?: string[]; boolOps?: Record<string, string>; result?: string };
  const all = async () => (await objs(app)) as unknown as G[];
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await drag(app, [640, 340], [840, 460]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  await key(app, "u");
  await drag(app, [300, 330], [440, 450]); // a third shape, apart from the group (below the dev panel, which is taller in Firefox)
  await key(app, "v");
  await click(app, 560, 330); // the group
  await click(app, 370, 390, ["Shift"]); // and the shape beside it
  await boolWith(p, "addgroup");
  await app.frame();
  let list = await all();
  const third = list.find((o) => o.result === undefined && size(o).w === 140)!;
  expect(third.groups).toHaveLength(1);
  expect(third.boolOps).toBeDefined();
  expect(list.find((o) => o.result !== undefined)!.sub).toHaveLength(2); // the group's result is the union and the new shape apart
  // out again: enter the group, pick that shape, take it out
  await p.mouse.dblclick(560, 330);
  await app.frame();
  await click(app, 370, 360);
  await boolWith(p, "takeout");
  await app.frame();
  list = await all();
  expect(list.find((o) => o.id === third.id)!.groups).toBeUndefined();
  expect(list.find((o) => o.result !== undefined)!.sub).toHaveLength(1);
  await key(app, "Control+z");
  expect((await all()).find((o) => o.id === third.id)!.groups).toHaveLength(1);
});

test("a turned shape can be stretched along its own sides: the side handles stay when it is turned", async ({ app }) => {
  const p = app.page;
  type T = Obj & { rot?: number };
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await key(app, "v");
  await click(app, 600, 360);
  let f = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
  const c0 = f.corners;
  const cx = (c0[0]![0] + c0[2]![0]) / 2, cy = (c0[0]![1] + c0[2]![1]) / 2;
  const top = [(c0[0]![0] + c0[1]![0]) / 2, (c0[0]![1] + c0[1]![1]) / 2 - 26];
  await p.mouse.move(top[0]!, top[1]!);
  await p.mouse.down();
  await p.mouse.move(cx + 140, cy - 60, { steps: 6 }); // turned about 30 degrees
  await p.mouse.up();
  await app.frame();
  f = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
  expect(Math.abs(f.angle)).toBeGreaterThan(0.2);
  // drawn: the four corners and the middle of each side, also when it is turned
  const shown = await p.evaluate(() => window.__canvastDebug.drawnHandles());
  expect(shown).toHaveLength(8);
  const mids = [[0, 1], [1, 2], [2, 3], [3, 0]].map(([a, b]) => [(f.corners[a!]![0] + f.corners[b!]![0]) / 2, (f.corners[a!]![1] + f.corners[b!]![1]) / 2]);
  for (const m of mids) expect(shown.some((h) => Math.hypot(h[0] - m[0]!, h[1] - m[1]!) < 1)).toBe(true);
  const before = (await last(app)) as T;
  const w0 = size(before).w, h0 = size(before).h;
  const c = f.corners;
  const right = [(c[1]![0] + c[2]![0]) / 2, (c[1]![1] + c[2]![1]) / 2];
  const ax = [c[1]![0] - c[0]![0], c[1]![1] - c[0]![1]];
  const len = Math.hypot(ax[0]!, ax[1]!);
  await drag(app, [right[0]!, right[1]!], [right[0]! + (ax[0]! / len) * 80, right[1]! + (ax[1]! / len) * 80]);
  const after = (await last(app)) as T;
  expect(after.rot).toBe(before.rot); // still turned the same
  expect(size(after).w / w0).toBeGreaterThan(1.25); // longer along its own axis
  expect(size(after).h / h0).toBeCloseTo(1, 2); // and no higher
});

test("a boolean group's corner radius updates live while it is dragged, like a plain shape's", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  await key(app, "u");
  await p.click('[data-paint="stroke"]');
  await p.locator(".colour-pop .colour-none").click();
  await key(app, "Escape");
  await drag(app, [500, 300], [700, 420]);
  await drag(app, [640, 340], [840, 460]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  const corner = await px(507, 307); // (inside the sharp corner)
  const lb = (await p.locator('[data-scrub="radius"] input').boundingBox())!;
  await p.mouse.move(lb.x + 8, lb.y + lb.height / 2);
  await p.mouse.down();
  await p.mouse.move(lb.x + 8 + 40, lb.y + lb.height / 2, { steps: 6 });
  await app.frame();
  expect(await px(507, 307), "rounded while the name is still held").not.toEqual(corner);
  expect((await objs(app)).find((o) => (o as Obj & { result?: string }).result !== undefined)!.sub[0]!.n.length / 6).toBe(8); // not stored yet
  await p.mouse.up();
  await app.frame();
  expect(await px(507, 307)).not.toEqual(corner);
  expect((await objs(app)).find((o) => (o as Obj & { result?: string }).result !== undefined)!.sub[0]!.n.length / 6).toBeGreaterThan(8);
});

test("align works on the shapes of a boolean group, and menus keep off the selected items", async ({ app }) => {
  const p = app.page;
  type G = Obj & { result?: string };
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await drag(app, [640, 340], [840, 460]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  const members = async () => ((await objs(app)) as unknown as G[]).filter((o) => o.result === undefined);
  const centreX = (o: G) => (o.sub[0]!.n[0]! + o.sub[0]!.n[6]!) / 2 * 2 ** o.unit + parseFloat(o.ax.replace("p", "e")) * 0; // (local, in the object's own units)
  void centreX;
  const before = (await members()).map((o) => o.ax);
  expect(new Set(before).size).toBe(2);
  // the Actions bar is at a fixed place and does not cover the selection
  const bar = (await p.getByTestId("context-bar").boundingBox())!;
  const f = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
  const xs = f.corners.map((c) => c[0]), ys = f.corners.map((c) => c[1]);
  const overlaps = bar.x < Math.max(...xs) && bar.x + bar.width > Math.min(...xs) && bar.y < Math.max(...ys) && bar.y + bar.height > Math.min(...ys);
  expect(overlaps, "the bar is off the selected shapes").toBe(false);
  // The whole group is one thing: Align has nothing to line up in it (it is not split into its shapes) ...
  await alignWith(p, "align:centre");
  await app.frame();
  expect((await members()).map((o) => o.ax), "a whole boolean group is not split by Align").toEqual(before);
  // ... the shapes are lined up with each other once they are picked as shapes: the group is entered and they are picked.
  await p.mouse.dblclick(620, 380);
  await app.frame();
  await p.keyboard.press("Control+a");
  await alignWith(p, "align:centre");
  await app.frame();
  const after = await members();
  // each member now has its middle at the same x on the screen
  const boxes = await Promise.all(after.map((o) => screenBox(app, o.id)));
  expect(Math.abs((boxes[0]!.minX + boxes[0]!.maxX) / 2 - (boxes[1]!.minX + boxes[1]!.maxX) / 2)).toBeLessThan(1);
});

test("the colour picker and the outline options keep off the selected shape", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [380, 330], [820, 640]); // (the outline options grew a row, Line, so this shape sits lower to leave them room above it)
  await key(app, "v");
  await click(app, 600, 480);
  const frame = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
  const xs = frame.corners.map((c) => c[0]), ys = frame.corners.map((c) => c[1]);
  const covers = async (sel: string) => {
    const r = (await p.locator(sel).boundingBox())!;
    return r.x < Math.max(...xs) && r.x + r.width > Math.min(...xs) && r.y < Math.max(...ys) && r.y + r.height > Math.min(...ys);
  };
  await p.click('[data-paint="fill"]');
  expect(await covers(".colour-pop"), "the colour picker is off the shape").toBe(false);
  await key(app, "Escape");
  await p.click("[data-outline-options]");
  expect(await covers(".outline-pop"), "the outline options are off the shape").toBe(false);
});

test("Shift snaps a turned boolean group to steps of 15 degrees of its whole turn, so it can get back to 0", async ({ app }) => {
  const p = app.page;
  const deg = async () => ((await p.evaluate(() => window.__canvastDebug.selectionFrame()))!.angle * 180) / Math.PI;
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await drag(app, [640, 340], [840, 460]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  const turn = async (to: number, shift: boolean) => {
    // grab the rotate handle and move the pointer round the middle until the box shows about `to` degrees
    const f = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
    const c = f.corners;
    const cx = (c[0]![0] + c[2]![0]) / 2, cy = (c[0]![1] + c[2]![1]) / 2;
    const top = [(c[0]![0] + c[1]![0]) / 2, (c[0]![1] + c[1]![1]) / 2];
    const r = Math.hypot(top[0]! - cx, top[1]! - cy) + 26;
    const a0 = f.angle;
    await p.mouse.move(cx + Math.sin(a0) * r, cy - Math.cos(a0) * r);
    if (shift) await p.keyboard.down("Shift");
    await p.mouse.down();
    const a1 = (to * Math.PI) / 180;
    for (let k = 1; k <= 6; k++) {
      const a = a0 + ((a1 - a0) * k) / 6;
      await p.mouse.move(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
    }
    await p.mouse.up();
    if (shift) await p.keyboard.up("Shift");
    await app.frame();
  };
  await turn(37, false); // somewhere that is not a step
  expect(Math.abs((await deg()) - 37)).toBeLessThan(2);
  await turn(3, true); // near 0, with Shift: snaps to exactly 0
  expect(Math.abs(await deg())).toBeLessThan(0.01);
  await turn(52, true); // and to steps of 15 from there
  const d = await deg();
  expect(Math.abs(d / 15 - Math.round(d / 15))).toBeLessThan(0.01);
});

test("a boolean group goes through the ordinary edits as one shape: stretch (turned too), move, duplicate, hide, undo; the result always follows its shapes", async ({ app }) => {
  const p = app.page;
  type G = Obj & { result?: string; opacity?: number; hidden?: boolean };
  const all = async () => (await objs(app)) as unknown as G[];
  const frame = async () => (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await drag(app, [640, 340], [840, 460]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  const widthOf = async () => { const f = await frame(); return Math.hypot(f.corners[1]![0] - f.corners[0]![0], f.corners[1]![1] - f.corners[0]![1]); };
  const w0 = await widthOf();
  // stretched by a side handle (unturned): the result is the union of the stretched shapes
  let f = await frame();
  let mid = [(f.corners[1]![0] + f.corners[2]![0]) / 2, (f.corners[1]![1] + f.corners[2]![1]) / 2];
  await drag(app, [mid[0]!, mid[1]!], [mid[0]! + 100, mid[1]!]);
  expect((await widthOf()) / w0).toBeGreaterThan(1.25);
  expect((await all()).filter((o) => o.result !== undefined)).toHaveLength(1);
  // turned, then stretched by a side handle again
  const c = (await frame()).corners;
  const cx = (c[0]![0] + c[2]![0]) / 2, cy = (c[0]![1] + c[2]![1]) / 2;
  await p.mouse.move((c[0]![0] + c[1]![0]) / 2, (c[0]![1] + c[1]![1]) / 2 - 26);
  await p.mouse.down();
  await p.mouse.move(cx + 200, cy - 60, { steps: 6 });
  await p.mouse.up();
  await app.frame();
  const turned = (await frame()).angle;
  expect(Math.abs(turned)).toBeGreaterThan(0.2);
  f = await frame();
  const w1 = await widthOf();
  mid = [(f.corners[1]![0] + f.corners[2]![0]) / 2, (f.corners[1]![1] + f.corners[2]![1]) / 2];
  const ax = [f.corners[1]![0] - f.corners[0]![0], f.corners[1]![1] - f.corners[0]![1]];
  const len = Math.hypot(ax[0]!, ax[1]!);
  await drag(app, [mid[0]!, mid[1]!], [mid[0]! + (ax[0]! / len) * 70, mid[1]! + (ax[1]! / len) * 70]);
  expect((await frame()).angle).toBeCloseTo(turned, 3); // still turned the same
  expect((await widthOf()) / w1).toBeGreaterThan(1.15);
  // moved, duplicated, made see-through, hidden, deleted
  await drag(app, [cx, cy], [cx - 60, cy + 40]);
  expect((await all()).length).toBe(3);
  await p.keyboard.press("Control+d");
  await app.frame();
  expect((await all()).length).toBe(6);
  expect((await all()).filter((o) => o.result !== undefined)).toHaveLength(2);
  await p.locator('[data-ctx="hide"]').click();
  await app.frame();
  expect((await all()).filter((o) => o.hidden).length).toBeGreaterThan(0);
  await key(app, "Control+z");
  await key(app, "Control+z");
  expect((await all()).length).toBe(3);
});

test("one shape inside a group aligns with the group, as in any design tool", async ({ app }) => {
  const p = app.page;
  type G = Obj & { result?: string; groups?: string[] };
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await drag(app, [640, 340], [840, 460]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  const shapes = ((await objs(app)) as unknown as G[]).filter((o) => o.result === undefined);
  const [a, b] = shapes;
  await p.mouse.dblclick(560, 330); // into the group
  await app.frame();
  await click(app, 800, 440); // the back/front shape's own area: one shape picked
  const sel = await p.evaluate(() => window.__canvastDebug.selection());
  expect(sel).toHaveLength(1);
  await alignWith(p, "align:left"); // the align buttons are there for a single shape in a group
  await app.frame();
  const left = async (id: string) => (await screenBox(app, id)).minX;
  const moved = sel[0]!;
  const other = [a!.id, b!.id].find((id) => id !== moved)!;
  expect(Math.abs((await left(moved)) - (await left(other)))).toBeLessThan(1); // its left edge is the group's left edge
});

test("initial shape of a boolean group: its shapes, where each is in it, its operation and its radius come back; after a reload too", async ({ app }) => {
  const p = app.page;
  type G = Obj & { result?: string; boolOps?: Record<string, string>; radius?: number; groups?: string[] };
  const all = async () => (await objs(app)) as unknown as G[];
  const members = async () => (await all()).filter((o) => o.result === undefined);
  const gap = async () => {
    const [a, b] = await members();
    const ba = await screenBox(app, a!.id), bb = await screenBox(app, b!.id);
    return [(bb.minX + bb.maxX) / 2 - (ba.minX + ba.maxX) / 2, (bb.minY + bb.maxY) / 2 - (ba.minY + ba.maxY) / 2];
  };
  const menu = async (name: RegExp) => {
    await p.getByRole("button", { name }).click();
    await app.frame();
  };
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await drag(app, [640, 340], [840, 460]);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  await stateWith(p, "stateset"); // the group picked whole
  const saved = await gap();
  // change it: one shape moved inside the group, another operation, a radius
  await p.mouse.dblclick(560, 330);
  await app.frame();
  await click(app, 800, 440);
  await app.page.mouse.move(800, 440);
  await p.mouse.down();
  await p.mouse.move(920, 520, { steps: 6 });
  await p.mouse.up();
  await app.frame();
  expect(Math.abs((await gap())[0]! - saved[0]!)).toBeGreaterThan(50);
  await key(app, "Escape");
  await key(app, "Escape");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:subtract");
  await app.frame();
  await p.locator("[data-sel-radius]").fill("12");
  await p.locator("[data-sel-radius]").press("Enter");
  await p.locator("[data-sel-radius]").blur();
  await app.frame();
  await reload(app);
  await p.keyboard.press("Control+a");
  await app.frame();
  await stateWith(p, "statereset");
  const back = await gap();
  expect(Math.abs(back[0]! - saved[0]!)).toBeLessThan(1.5);
  expect(Math.abs(back[1]! - saved[1]!)).toBeLessThan(1.5);
  const list = await all();
  const res = list.find((o) => o.result !== undefined)!;
  expect(res.boolOps![res.result!]).toBe("union");
  expect(res.radius).toBeUndefined();
  await key(app, "Control+z"); // one step
  expect(((await all()).find((o) => o.result !== undefined)!.boolOps![res.result!])).toBe("subtract");
});

test("the line under the tool options says what to do: per tool, with a shape picked, with a group entered; Enter edits nodes and finishes", async ({ app }) => {
  const p = app.page;
  const hint = p.getByTestId("tool-hint");
  await p.mouse.move(300, 650); // (a hint also names the button the pointer is on: keep it on the canvas)
  await key(app, "u");
  await expect(hint).toContainText("rectangle");
  await p.click('[data-shape-kind="star"]');
  await expect(hint).toContainText("star");
  await p.locator('[role=radiogroup][aria-label="Shape or path"] [data-tool="path"]').click(); // the Path tool is chosen beside the shapes
  await p.mouse.move(300, 650); // (the bar moves under a pointer that stays: keep it off the buttons, a hint also names the button it is on)
  expect(await tool(app)).toBe("path");
  await expect(hint).toContainText("Click to place a corner");
  await p.click('[data-shape-kind="rect"]');
  expect(await tool(app)).toBe("shape");
  await key(app, "b");
  expect(await tool(app)).toBe("path");
  await key(app, "v");
  await expect(hint).toBeHidden(); // nothing selected, nothing to say
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [500, 300], [700, 400]);
  await drag(app, [640, 350], [840, 450]);
  await key(app, "v");
  await click(app, 560, 330);
  await expect(hint).toContainText("Enter or double-click edits its nodes");
  await key(app, "Enter");
  expect(await tool(app)).toBe("node");
  await expect(hint).toContainText("click a line to add a node");
  await key(app, "Enter");
  expect(await tool(app)).toBe("select");
  // a boolean group, and inside it
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await p.mouse.move(300, 650); // (a button under the pointer names itself in the hint line)
  await app.frame();
  await expect(hint).toContainText("Boolean group");
  await p.locator('[data-ctx="boolmenu"]').click();
  await expect(p.locator('.pop-menu [data-id="flatten"]')).toBeVisible(); // Flatten is in the Shapes menu, not only in the palette
  await p.keyboard.press("Escape");
  await p.mouse.dblclick(560, 330);
  await app.frame();
  await expect(hint).toContainText("Inside a boolean group");
  await key(app, "Escape");
  await expect(hint).not.toContainText("Inside a boolean group");
  // the line belongs to the canvas: it does not stay over the Settings view
  await p.mouse.move(300, 650);
  await expect(hint).toBeVisible();
  await p.getByTestId("view-settings").click();
  await expect(hint).toBeHidden();
});

test("Boolean groups across zoom levels: a shape drawn 30 levels in, inside a big one, subtracts as a hole of its own size, however small", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  type G = Obj & { result?: string };
  const all = async () => (await objs(app)) as unknown as G[];
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await p.click('[data-paint="stroke"]');
  await p.locator(".colour-pop .colour-none").click(); // fill only: a 2 unit wide outline would cover a hole this small
  await key(app, "Escape");
  await drag(app, [420, 260], [860, 540]); // the big one, at home, centred on the view's middle (640, 400)
  await p.evaluate(() => window.__canvastDebug.jump(30));
  await app.frame();
  await drag(app, [600, 370], [680, 430]); // a small one in the middle of the view, 2^-30 the size: about 10^-10 of the big one
  await p.evaluate(() => window.__canvastDebug.jump(-30));
  await app.frame();
  expect(await objs(app)).toHaveLength(2);
  await key(app, "v");
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:subtract");
  await app.frame();
  let list = await all();
  expect(list).toHaveLength(3);
  expect(list.find((o) => o.result !== undefined)!.sub).toHaveLength(2); // the outer loop and the hole, however small
  await p.evaluate(() => window.__canvastDebug.jump(30));
  await app.frame();
  // 30 levels in the hole is the 80 px box the shape was drawn as; inside it (off the axes through the middle) it is the background
  expect(await px(5, 5)).toEqual([37, 99, 235]);
  const hole = await px(615, 385);
  expect(hole).not.toEqual([37, 99, 235]);
  expect(await px(665, 415)).toEqual(hole);
  await p.evaluate(() => window.__canvastDebug.jump(-30));
  await app.frame();
  expect(await px(500, 300)).toEqual([37, 99, 235]); // and the big shape is filled round it

  // the small shape is still its own: enter the group and the 30-level shape is there to be moved; the hole follows it
  await p.keyboard.press("Control+z");
  expect(await all()).toHaveLength(2);
  await p.keyboard.press("Control+a");
  await boolWith(p, "op:union");
  await app.frame();
  list = await all();
  expect(list.find((o) => o.result !== undefined)!.sub).toHaveLength(1); // a union with a shape inside it is the big one alone
  expect(await px(640, 400)).toEqual([37, 99, 235]);
});

test("numbers are live: dragging the outline width's field (not its name) changes the shape while the pointer is still down, and stores one undo step on release", async ({ app }) => {
  const p = app.page;
  await outlineShapes(p);
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  const dark = (c: number[] | null) => !!c && Math.abs(c[0]! - 31) < 14 && Math.abs(c[1]! - 35) < 14 && Math.abs(c[2]! - 41) < 14;
  await key(app, "u");
  await drag(app, [500, 300], [800, 500]);
  await key(app, "v");
  await click(app, 650, 400);
  await p.click("[data-outline-options]");
  const width = p.locator(".outline-pop .op-width");
  const start = Number(await width.inputValue());
  const before = (await objs(app)).length;
  expect(dark(await px(494, 400)), "a thin outline does not reach 6 px outside the edge").toBe(false);
  // the name is only a label: dragging it changes nothing
  const nameBox = (await p.locator(".outline-pop label[for=op-width]").boundingBox())!;
  await p.mouse.move(nameBox.x + nameBox.width / 2, nameBox.y + nameBox.height / 2);
  await p.mouse.down();
  await p.mouse.move(nameBox.x + nameBox.width / 2 + 80, nameBox.y + nameBox.height / 2, { steps: 6 });
  await p.mouse.up();
  expect(Number(await width.inputValue()), "dragging the name does not change the number").toBe(start);
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const grab of ["field"] as const) {
    if (!(await width.isVisible())) await p.click("[data-outline-options]"); // (an undo closes the pop-up)
    const box = (await width.boundingBox())!;
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 8 });
    await app.frame();
    // (still down: nothing is stored yet, and the canvas already shows it)
    expect(dark(await px(494, 400)), `${grab}: the outline is wider while the pointer is down`).toBe(true);
    await p.mouse.up();
    await app.frame();
    expect(Number(await width.inputValue()), `${grab}: the field says the new width`).toBeGreaterThan(start + 5);
    await p.keyboard.press("Control+z"); // one undo step for the whole drag
    await app.frame();
    expect(dark(await px(494, 400)), `${grab}: one undo takes the whole drag back`).toBe(false);
  }
  expect((await objs(app)).length).toBe(before);
  expect(app.consoleErrors).toEqual([]);
});

test("outline ends (flat, round, square) show on a dashed outline inside, centred and outside the edge alike", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [500, 300], [700, 420]);
  await key(app, "v");
  await click(app, 600, 360);
  await p.click("[data-outline-options]");
  await p.locator(".outline-pop .op-width").fill("14");
  await p.locator(".outline-pop .op-width").press("Enter");
  await p.click('.outline-pop [data-dash="dashed"]');
  // (the picture of the shape, with the selection box cropped away by looking at the inside of it only)
  const look = async (cap: string, pos: string): Promise<Buffer> => {
    await p.click(`.outline-pop [data-align="${pos}"]`);
    await p.click(`.outline-pop [data-cap="${cap}"]`);
    await app.frame();
    const o = (await objs(app)).at(-1) as unknown as { cap?: string; align?: string; dash?: number[] };
    expect([o.cap ?? "round", o.align ?? "centre", o.dash?.[0]], `${cap} ${pos}`).toEqual([cap, pos, 3]);
    return p.screenshot({ clip: { x: 480, y: 280, width: 240, height: 160 } });
  };
  for (const pos of ["centre", "inside", "outside"]) {
    const flat = await look("butt", pos);
    const round = await look("round", pos);
    const square = await look("square", pos);
    expect(flat.equals(round), `${pos}: round ends differ from flat`).toBe(false);
    expect(round.equals(square), `${pos}: square ends differ from round`).toBe(false);
  }
  expect(app.consoleErrors).toEqual([]);
});

test("only a picked shape moves (a press-and-slide on another draws the selection box); dashes from Outline options; a node snaps to another shape's node", async ({ app }) => {
  const p = app.page;
  await outlineShapes(p);
  await key(app, "u");
  await drag(app, [400, 300], [500, 400]); // A
  await drag(app, [700, 300], [800, 400]); // B
  const [a, b] = (await objs(app)).slice(-2) as [Obj, Obj];
  await key(app, "v");
  await click(app, 300, 600); // nothing picked
  const before = await screenBox(app, b.id);
  await drag(app, [750, 350], [780, 450]); // slide on B, which is not picked
  expect((await screenBox(app, b.id)).minX, "B did not move").toBe(before.minX);
  await click(app, 300, 600); // (the selection box picked it: clear that)
  await click(app, 750, 350);
  await drag(app, [750, 350], [750, 450]);
  expect((await screenBox(app, b.id)).minY, "picked, it moves").toBeGreaterThan(before.minY + 90);
  await key(app, "Control+z");

  // dashes: one undo each; dotted needs round ends, which are the default
  await p.click("[data-outline-options]");
  await p.click('.outline-pop [data-dash="dashed"]');
  expect(((await objs(app)).find((o) => o.id === b.id) as unknown as { dash?: number[] }).dash).toEqual([3, 2]);
  await p.click('.outline-pop [data-dash="dotted"]');
  expect(((await objs(app)).find((o) => o.id === b.id) as unknown as { dash?: number[] }).dash).toEqual([0, 2]);
  // dash numbers: length, gap and where the pattern starts, in widths of the outline
  await p.click('.outline-pop [data-dash="dashed"]');
  const dashed = async (): Promise<{ dash?: number[]; dashOffset?: number }> => (await objs(app)).find((o) => o.id === b.id) as unknown as { dash?: number[]; dashOffset?: number };
  await p.fill('.outline-pop [data-dash="len"]', "5");
  await p.fill('.outline-pop [data-dash="gap"]', "1.5");
  await p.fill('.outline-pop [data-dash="offset"]', "2");
  await p.locator('.outline-pop [data-dash="offset"]').blur();
  expect(await dashed()).toMatchObject({ dash: [5, 1.5], dashOffset: 2 });
  await p.click('.outline-pop [data-dash="dashed"]');
  expect((await dashed()).dashOffset, "a preset starts its own pattern at 0").toBeUndefined();
  await p.click('.outline-pop [data-dash="solid"]');
  expect((await dashed()).dash, "solid is no pattern").toBeUndefined();
  await key(app, "Escape");
  await key(app, "Control+z");
  expect((await dashed()).dash, "one undo brings the pattern back").toEqual([3, 2]);

  // node snapping: B's top-left node, dragged to 3 px beside A's right edge, lands exactly on it
  await click(app, 750, 350);
  await key(app, "n");
  const boxA = await screenBox(app, a.id);
  const x0 = (await screenBox(app, b.id)).minX;
  await drag(app, [700, 300], [boxA.maxX - 1 + 3, 343]);
  const x1 = (await screenBox(app, b.id)).minX;
  expect(x1 - x0, "the node moved by the whole distance to A's edge, not 3 px short").toBeCloseTo(boxA.maxX - 1 - 700, 0);

  // the field of the Width of Outline options (its name is tied to it with `for`) scrubs too
  await key(app, "v");
  await p.click("[data-outline-options]");
  const w0 = Number(await p.locator(".outline-pop .op-width").inputValue());
  const lb = (await p.locator(".outline-pop .op-width").boundingBox())!;
  await p.mouse.move(lb.x + 4, lb.y + lb.height / 2);
  await p.mouse.down();
  await p.mouse.move(lb.x + 4 + 20, lb.y + lb.height / 2, { steps: 5 });
  await p.mouse.up();
  expect(Number(await p.locator(".outline-pop .op-width").inputValue())).toBeCloseTo(w0 + 5, 5); // 2 px per 0.5
});

test("a number's field can be dragged to change it (Sides before drawing a polygon), and SVG text pasted on the canvas becomes shapes", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await p.click('[data-shape-kind="polygon"]');
  const sides = p.locator("[data-sides]");
  await expect(sides).toHaveValue("6");
  const r = (await sides.boundingBox())!;
  await p.mouse.move(r.x + 6, r.y + r.height / 2);
  await p.mouse.down();
  await p.mouse.move(r.x + 6 + 40, r.y + r.height / 2, { steps: 6 });
  await p.mouse.up();
  await expect(sides).toHaveValue("11"); // 8 px a step
  await key(app, "v");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="40" height="40" fill="#ff0000"/><circle cx="70" cy="70" r="20" fill="none" stroke="#0000ff" stroke-width="4" stroke-dasharray="8 4"/><path d="M10 90 L40 60 L50 90 Z" fill="url(#g)"/><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs></svg>';
  const n0 = (await objs(app)).length;
  await p.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, svg);
  await app.frame();
  // (Firefox does not hand a constructed paste event its data: the pasted-text path is checked in Chromium)
  if (test.info().project.name === "firefox") return;
  const made = (await objs(app)).slice(n0) as unknown as Array<Obj & { dash?: number[] }>;
  expect(made.length).toBe(3);
  expect(made[0]!.fill).toBe("#ff0000");
  expect(made[1]!.fill).toBeNull();
  expect(made[1]!.stroke).toBe("#0000ff");
  expect(made[1]!.dash![0]! / made[1]!.dash![1]!).toBeCloseTo(2, 5);
  expect(typeof made[2]!.fill).toBe("object"); // a gradient
  expect((await p.evaluate(() => window.__canvastDebug.selection())).length).toBe(3);
});

test("Simplify: a path of six collinear nodes becomes two; a pen stroke becomes an open path with the stroke's colour and width; one undo each", async ({ app }) => {
  const p = app.page;
  await key(app, "b");
  for (const x of [400, 460, 520, 580, 640, 700]) await click(app, x, 300);
  await key(app, "Enter");
  const path = await last(app);
  expect(path.sub[0]!.n.length / 6).toBe(6);
  await key(app, "v");
  await click(app, 550, 300);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([path.id]);
  await pathWith(p, "simplify");
  expect((await last(app)).sub[0]!.n.length / 6, "collinear nodes are all but the ends").toBe(2);
  await key(app, "Control+z");
  expect((await last(app)).sub[0]!.n.length / 6).toBe(6);

  await key(app, "p");
  await p.mouse.move(400, 500);
  await p.mouse.down();
  for (let i = 1; i <= 60; i++) await p.mouse.move(400 + i * 5, 500 + Math.sin(i / 8) * 40);
  await p.mouse.up();
  await app.frame();
  const stroke = await last(app);
  expect(stroke.kind).toBe("stroke");
  await key(app, "v");
  await drag(app, [380, 420], [740, 600]); // a selection box round the stroke
  await pathWith(p, "strokepath");
  const made = await last(app);
  expect(made).toMatchObject({ kind: "path", fill: null, id: stroke.id });
  expect(made.sub[0]!.n.length / 6, "a few nodes, not sixty").toBeLessThan(20);
  expect(made.sub[0]!.closed).toBe(false);
  await key(app, "Control+z");
  expect((await last(app)).kind).toBe("stroke");
});

test("arrow heads: set at the start and end of an open line from Outline options, drawn, kept by undo and a reload, and written to SVG; none on a closed shape", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await p.click('[data-shape-kind="line"]');
  await drag(app, [400, 400], [700, 400]);
  const line = await last(app);
  const boxBefore = await screenBox(app, line.id);
  await key(app, "v");
  await click(app, 550, 400);
  await p.click("[data-outline-options]");
  await p.click('.outline-pop [data-arrow-end="triangle"]');
  expect(await last(app)).toMatchObject({ arrowEnd: "triangle" });
  await p.click('.outline-pop [data-arrow-start="dot"]');
  expect(await last(app)).toMatchObject({ arrowEnd: "triangle", arrowStart: "dot" });
  await key(app, "Escape");
  const boxAfter = await screenBox(app, line.id);
  expect(boxAfter.maxX - boxAfter.minX, "the heads are part of what it covers").toBeGreaterThan(boxBefore.maxX - boxBefore.minX + 4);
  // the head is drawn at the end: a stroke-coloured pixel above the line, near its end, where the bare line has none
  const ink = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  const wide = (await last(app)).width * 4; // (the head's length in px at this zoom is 4 widths)
  expect(await ink(698 - wide / 2, 400 - Math.max(2, wide / 4))).not.toEqual(await ink(450, 340));
  await key(app, "Control+z");
  expect(await last(app)).toMatchObject({ arrowEnd: "triangle" });
  expect(await last(app), "one undo takes back the last head only").not.toHaveProperty("arrowStart");
  await key(app, "Control+Shift+z");
  expect(await last(app)).toMatchObject({ arrowEnd: "triangle", arrowStart: "dot" });
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await reload(app);
  expect(await last(app)).toMatchObject({ arrowEnd: "triangle", arrowStart: "dot" });
  // a closed shape has no ends: the options do not offer heads
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 500], [500, 560]);
  await p.click("[data-outline-options]");
  await expect(p.locator(".outline-pop [data-arrow-end]")).toHaveCount(0);
});

test("sharp corner limit: a corner of 18° is cut by default, comes to its point when the limit is lowered below it, and goes back with one undo", async ({ app }) => {
  const p = app.page;
  await key(app, "b");
  await click(app, 400, 500);
  await click(app, 700, 500);
  await click(app, 400, 600);
  await key(app, "Enter");
  await key(app, "v");
  await click(app, 550, 500);
  await p.click("[data-outline-options]");
  await p.click('.outline-pop [data-join="miter"]');
  await expect(p.locator(".outline-pop [data-miter]")).toBeVisible();
  const o = await last(app);
  const cut = await screenBox(app, o.id);
  await p.locator(".outline-pop [data-miter]").fill("10");
  await p.locator(".outline-pop [data-miter]").press("Enter");
  await expect.poll(async () => ((await last(app)) as unknown as { miterAngle?: number }).miterAngle).toBe(10);
  expect((await screenBox(app, o.id)).maxX, "the point reaches further than the cut corner").toBeGreaterThan(cut.maxX + 3);
  await p.click('.outline-pop [data-join="round"]');
  await expect(p.locator(".outline-pop [data-miter-row]")).toBeHidden();
  await key(app, "Escape");
  await key(app, "Control+z");
  await key(app, "Control+z");
  expect(((await last(app)) as unknown as { miterAngle?: number }).miterAngle, "undone").toBeUndefined();
});

test("pasted SVG text with <use> and a symbol becomes shapes (the used shape drawn again where the use is); copy as SVG puts the same text on the clipboard", async ({ app, browserName }) => {
  test.skip(browserName === "firefox", "a synthetic paste event carries no data in Firefox");
  const p = app.page;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"><defs><path id="a" d="M0 0h10v10z"/><symbol id="s"><rect width="5" height="5"/></symbol></defs><use href="#a" x="20" y="5"/><use xlink:href="#s" x="50" y="50"/><g id="g"><use href="#g"/></g></svg>';
  await p.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, svg);
  await expect.poll(async () => (await objs(app)).length).toBe(2);
  const [a, b] = await objs(app);
  const wa = size(a!), wb = size(b!);
  expect(wa.w / wb.w, "the triangle is twice as wide as the square").toBeCloseTo(2, 1);
  // copy the picked shapes as SVG text
  await key(app, "v");
  await key(app, "Control+a");
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })));
  await p.keyboard.type("Copy the selection as SVG");
  await key(app, "Enter");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.lastCopied())).toMatch(/^<svg[\s\S]*<path/);
});

test("Outline stroke makes the line a shape of its own; a shape with a fill keeps it and gets the outline above; Taper is thin at the ends; one undo each", async ({ app }) => {
  const p = app.page;
  await outlineShapes(p);
  await key(app, "u");
  await p.click('[data-shape-kind="line"]');
  await drag(app, [400, 400], [700, 400]);
  const line = await last(app);
  await key(app, "v");
  await click(app, 550, 400);
  await pathWith(p, "outlinestroke");
  const o = (await last(app)) as unknown as Obj & { stroke: string | null; fill: string };
  expect(o).toMatchObject({ id: line.id, kind: "path", stroke: null, fill: line.stroke });
  expect(o.sub.length, "the pieces of the stroke").toBeGreaterThan(1);
  await key(app, "Control+z");
  expect(((await last(app)) as unknown as { stroke: string | null }).stroke).toBe(line.stroke);
  // Taper: full in the middle, thin at the end
  await key(app, "v");
  await click(app, 550, 400);
  await pathWith(p, "taper");
  expect(await last(app), "Taper stays live: the path is kept with a profile").toMatchObject({ id: line.id, profile: "taper", stroke: line.stroke });
  await pathWith(p, "outlinestroke");
  const t = await last(app);
  expect(t, "Outline stroke bakes it").not.toHaveProperty("profile");
  const ys = (x: number) => t.sub.flatMap((s) => s.n.filter((_, i) => i % 6 === 0).map((v, k) => [v, s.n[k * 6 + 1]!] as const)).filter(([vx]) => Math.abs(vx - x) < 3).map(([, y]) => Math.abs(y));
  expect(Math.max(...ys(150)), "wide in the middle").toBeGreaterThan(Math.max(...ys(5)) + 0.2);
  // a rectangle with a fill and an outline: the fill stays, the outline is a new shape above it
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 500], [560, 580]);
  const rect = await last(app);
  await key(app, "v");
  await click(app, 480, 540);
  await pathWith(p, "outlinestroke");
  const all = await objs(app);
  expect(all.find((x) => x.id === rect.id)).toMatchObject({ stroke: null, fill: rect.fill });
  expect(all.length).toBe(all.filter((x) => x.kind === "path").length);
  expect((await last(app)).id).not.toBe(rect.id);
});

test("Corner smoothing: the Smooth number starts the rounded corners farther out; kept by undo and a reload", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [700, 500]);
  await key(app, "v");
  await click(app, 550, 400);
  const radius = p.getByLabel("Corner radius (px)");
  await radius.fill("30");
  await radius.press("Enter");
  const smooth = p.getByLabel("Corner smoothing (%)");
  await expect(smooth).toBeVisible();
  const firstX = async () => ((await last(app)).sub[0]!.n as number[])[0]!;
  const before = JSON.stringify((await last(app)).sub);
  await smooth.fill("100");
  await smooth.press("Enter");
  await expect.poll(async () => JSON.stringify((await last(app)).sub)).not.toBe(before);
  expect(((await last(app)) as unknown as { smoothing?: number }).smoothing).toBe(1);
  void firstX;
  await smooth.blur();
  await key(app, "Control+z");
  expect(JSON.stringify((await last(app)).sub)).toBe(before);
  await key(app, "Control+Shift+z");
  await reload(app);
  expect(((await last(app)) as unknown as { smoothing?: number }).smoothing).toBe(1);
});

test("Angular gradient: chosen in the paint chooser, goes round its centre, its angle handle turns it; kept by undo and a reload", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [700, 500]);
  await key(app, "v");
  await click(app, 550, 400);
  const fillOf = async () => ((await last(app)) as unknown as { fill: { type: string; cx: number; cy: number; angle: number; stops: Array<{ c: string }> } }).fill;
  await p.click('[data-paint="fill"]');
  const pop = p.locator(".colour-pop");
  await pop.locator('[data-mode="angular"]').click();
  expect(await fillOf()).toMatchObject({ type: "angular", cx: 0.5, cy: 0.5, angle: 0 });
  await pop.locator(".cg-stop").nth(0).click();
  await pop.locator(".cg [data-hex]").fill("ff0000");
  await pop.locator(".cg [data-hex]").press("Enter");
  await pop.locator(".cg-stop").nth(1).click();
  await pop.locator(".cg [data-hex]").fill("0000ffff");
  await pop.locator(".cg [data-hex]").press("Enter");
  await key(app, "Escape");
  await key(app, "Escape");
  await app.frame();
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  const near = (c: number[], r: number, b: number) => Math.abs(c[0]! - r) + Math.abs(c[1]!) + Math.abs(c[2]! - b) <= 24;
  expect(near(await px(550 + 120, 403), 253, 2), "just below the first edge: the first stop").toBe(true);
  expect(near(await px(550 - 120, 400), 128, 128), "opposite: half way").toBe(true);
  expect(near(await px(550, 400 + 80), 191, 64), "a quarter of the turn on").toBe(true);
  // its angle handle at 0.3 of the longer side from the centre: drag it down a quarter turn
  await click(app, 550, 400);
  await drag(app, [550 + 90, 400], [550, 400 + 90]);
  expect((await fillOf()).angle).toBeGreaterThan(80);
  expect((await fillOf()).angle).toBeLessThan(100);
  await key(app, "Control+z");
  expect((await fillOf()).angle).toBe(0);
  await key(app, "Control+Shift+z");
  await reload(app);
  expect((await fillOf()).type).toBe("angular");
});

test("Edit nodes on several paths: Shift-click picks nodes together, a lasso picks the nodes inside it, they move and are deleted as one (one undo step), across paths", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [500, 400]); // A
  await drag(app, [600, 300], [700, 400]); // B
  const [a, b] = (await objs(app)).slice(-2) as [Obj, Obj];
  await key(app, "v");
  await key(app, "Control+a");
  await key(app, "n");
  const picked = () => p.evaluate(() => window.__canvastDebug.pickedNodes());
  const lasso = async (pts: Array<[number, number]>) => {
    await p.mouse.move(...pts[0]!);
    await p.mouse.down();
    for (const q of [...pts.slice(1), pts[0]!]) await p.mouse.move(q[0], q[1], { steps: 4 });
    await p.mouse.up();
    await app.frame();
  };
  // from empty ground a lasso round A's top right corner and B's top left corner picks the two
  await lasso([[470, 270], [640, 270], [640, 340], [470, 340]]);
  expect((await picked()).map(([, n]) => n).sort()).toEqual([1, 1]);
  // dragging one moves both, in one undo step
  const ys = async () => { const [pa, pb] = (await objs(app)).slice(-2); return [pa!.sub[0]!.n[7]!, pb!.sub[0]!.n[1]!]; }; // (A's top right corner, B's top left corner)
  const y0 = await ys();
  await drag(app, [500, 300], [500, 330]);
  const y1 = await ys();
  expect(y1[0]! - y0[0]!).toBeCloseTo(30, 0);
  expect(y1[1]! - y0[1]!).toBeCloseTo(30, 0);
  await key(app, "Control+z");
  expect(await ys()).toEqual(y0);
  // Shift-click adds a node to the set and takes it away again
  await click(app, 400, 300, ["Shift"]);
  expect((await picked()).reduce((s, [, n]) => s + n, 0)).toBe(3);
  await click(app, 400, 300, ["Shift"]);
  expect((await picked()).reduce((s, [, n]) => s + n, 0)).toBe(2);
  // Delete takes the picked nodes from both paths at once
  await key(app, "Delete");
  const after = (await objs(app)).slice(-2);
  expect(after.map((o) => o.sub[0]!.n.length / 6)).toEqual([3, 3]);
  expect(after.map((o) => o.id)).toEqual([a.id, b.id]);
  await key(app, "Control+z");
  expect((await objs(app)).slice(-2).map((o) => o.sub[0]!.n.length / 6)).toEqual([4, 4]);
});

test("Fill gaps fills the place four shapes close in, under them; Fill a gap fills the one clicked and ignores a click elsewhere; one undo each (ADR 0172)", async ({ app }) => {
  const p = app.page;
  const px = () => p.evaluate(() => window.__canvastDebug.pixelAt(520, 380));
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  // four bars round a hole from (440, 340) to (600, 420)
  for (const [a, b] of [[[400, 300], [640, 340]], [[400, 420], [640, 460]], [[400, 300], [440, 460]], [[600, 300], [640, 460]]] as Array<[[number, number], [number, number]]>) await drag(app, a, b);
  await key(app, "v");
  const empty = await px();
  await key(app, "Control+a");
  await pathWith(p, "fillgaps");
  let all = await objs(app);
  expect(all).toHaveLength(5);
  const named = (o: Obj): string | undefined => (o as Obj & { name?: string }).name;
  const gap = all.find((o) => named(o) === "Gap")!;
  expect(all.indexOf(gap), "under the shapes round it").toBe(0);
  expect(size(gap).w).toBeCloseTo(160, 0);
  expect(size(gap).h).toBeCloseTo(80, 0);
  await key(app, "Escape");
  await app.frame();
  expect(await px()).toEqual([37, 99, 235]);
  await key(app, "Control+z");
  expect(await objs(app)).toHaveLength(4);
  expect(await px()).toEqual(empty);
  // one at a time: a click outside every gap does nothing, a click in one fills it (the last gap ends the mode)
  await key(app, "Control+a");
  await pathWith(p, "fillgap");
  await click(app, 700, 520);
  expect(await objs(app)).toHaveLength(4);
  await click(app, 520, 380);
  all = await objs(app);
  expect(all).toHaveLength(5);
  expect(named(all[0]!)).toBe("Gap");
  await key(app, "Control+z");
  expect(await objs(app)).toHaveLength(4);
  // a slit of 2 px (the right bar moved off): within the 4 px a gap is closed by, so the place is still filled, up to the slit
  await key(app, "Control+a");
  await key(app, "Delete");
  await key(app, "u");
  for (const [a, b] of [[[400, 300], [598, 340]], [[400, 420], [598, 460]], [[400, 300], [440, 460]], [[600, 300], [640, 460]]] as Array<[[number, number], [number, number]]>) await drag(app, a, b);
  await key(app, "v");
  await key(app, "Control+a");
  await pathWith(p, "fillgaps");
  expect((await objs(app)).filter((o) => named(o) === "Gap").length).toBeGreaterThan(0);
  await key(app, "Escape");
  await app.frame();
  expect(await px()).toEqual([37, 99, 235]);
});

test("Divide cuts overlapping shapes into their regions; the Shape builder merges regions dragged across and deletes them with Alt; one undo each", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [560, 420]); // A
  await drag(app, [500, 340], [660, 460]); // B
  await key(app, "v");
  await key(app, "Control+a");
  await pathWith(p, "divide");
  const parts = await objs(app);
  expect(parts.filter((o) => o.kind === "path")).toHaveLength(3);
  await key(app, "Control+z");
  expect(await objs(app)).toHaveLength(2);
  // the Shape builder: a stroke from the left region over the middle to the right one merges all three into one shape
  await key(app, "Control+a");
  await pathWith(p, "shapebuilder");
  await drag(app, [420, 360], [640, 440]);
  await key(app, "Enter");
  const merged = await objs(app);
  expect(merged).toHaveLength(1);
  const b = size(merged[0]!);
  expect(b.w).toBeCloseTo(260, 0);
  await key(app, "Control+z");
  expect(await objs(app)).toHaveLength(2);
  // Alt-drag over the overlap deletes it; the two others stay
  await key(app, "Control+a");
  await pathWith(p, "shapebuilder");
  await p.keyboard.down("Alt");
  await drag(app, [525, 380], [535, 390]);
  await p.keyboard.up("Alt");
  await key(app, "Enter");
  expect((await objs(app)).filter((o) => o.kind === "path")).toHaveLength(2);
});

test("Masks: a clipping mask cuts to the shape's outline; a mask by opacity cuts the same and can be inverted and released; undo takes each back", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [700, 500]); // blue 300 x 200
  await p.click('[data-shape-kind="ellipse"]');
  await drag(app, [500, 340], [600, 460]); // the mask: an ellipse in the middle
  await key(app, "v");
  await key(app, "Control+a");
  const blue = await px(410, 310);
  const bg = await px(100, 650);
  expect(blue).not.toEqual(bg);
  await maskWith(p, "clipmask");
  await click(app, 120, 650);
  await app.frame();
  expect(await px(410, 310), "outside the ellipse the rectangle is cut away").toEqual(bg);
  expect(await px(530, 375), "inside it, shown").toEqual(blue);
  await key(app, "Control+z");
  await app.frame();
  expect(await px(410, 310)).toEqual(blue);
  // by opacity
  await key(app, "Control+a");
  await maskWith(p, "maskalpha");
  await click(app, 120, 650);
  await app.frame();
  expect(await px(410, 310)).toEqual(bg);
  expect(await px(530, 375)).toEqual(blue);
  await click(app, 410, 310);
  expect(await p.evaluate(() => window.__canvastDebug.selection()), "where the mask cuts it away it cannot be picked").toHaveLength(0);
  // Reveal shows the mask's own shape, which a click cannot pick (ADR 0153)
  await p.mouse.move(550, 400);
  await p.keyboard.down("Control");
  await p.mouse.move(551, 401);
  await expect(p.getByTestId("tool-hint")).toContainText("(part of a mask)");
  await p.keyboard.up("Control");
  await click(app, 550, 400);
  expect(await p.evaluate(() => window.__canvastDebug.selection()).then((a) => a.length), "where it shows it can").toBeGreaterThan(0);
  await p.locator('[data-ctx="maskmenu"]').click();
  await expect(p.locator('.pop-menu [data-id="releasemask"]')).toBeVisible();
  await expect(p.locator('.pop-menu [data-id="clipmask"]'), "what is masked is offered no new mask").toHaveCount(0);
  await p.keyboard.press("Escape");
  await maskWith(p, "invertmask");
  await click(app, 120, 650);
  await app.frame();
  expect(await px(410, 310), "inverted: what was cut shows").toEqual(blue);
  expect(await px(530, 375), "and the middle is gone").toEqual(bg);
  await click(app, 410, 310);
  await maskWith(p, "releasemask");
  await click(app, 120, 650);
  await app.frame();
  expect(await px(410, 310), "released: the rectangle is whole").toEqual(blue);
  expect(await objs(app)).toHaveLength(2);
});

test("Vector network: two rectangles that share a side become one network with a shared vertex that moves both; the regions are filled; Alt joins two ends; Release goes back to a path", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [560, 420]);
  await drag(app, [560, 300], [720, 420]);
  const bg = await px(100, 650);
  await key(app, "v");
  await key(app, "Control+a");
  await pathWith(p, "makenet");
  const net = (await objs(app)) as unknown as Array<Obj & { net?: boolean }>;
  expect(net).toHaveLength(1);
  expect(net[0]!.net).toBe(true);
  expect(net[0]!.sub.length, "7 edges: the shared side is one").toBe(7);
  const ends = (o: Obj) => new Set(o.sub.flatMap((s) => [`${s.n[0]},${s.n[1]}`, `${s.n[s.n.length - 6]},${s.n[s.n.length - 5]}`]));
  expect(ends(net[0]!).size).toBe(6);
  await app.frame();
  const inside = await px(480, 360);
  expect(inside, "the region is filled").not.toEqual(bg);
  expect(await px(640, 360)).toEqual(inside);
  // a click inside one region in Edit nodes picks it: the fill then colours it alone, and a reload keeps it (ADR 0150)
  await key(app, "n");
  await click(app, 480, 360);
  await p.click('[data-paint="fill"]');
  await p.locator(".colour-pop [data-hex]").fill("e11d48");
  await p.locator(".colour-pop [data-hex]").press("Enter");
  await key(app, "Escape");
  await app.frame();
  const red = await px(480, 360);
  expect(red, "the picked region has its own fill").not.toEqual(inside);
  expect(await px(640, 360), "the other keeps the path's").toEqual(inside);
  expect(((await objs(app))[0] as unknown as { regions: { fills: unknown[] } }).regions.fills).toHaveLength(1);
  // the shared top vertex dragged up moves the ends of three edges together
  await drag(app, [560, 300], [560, 250]);
  const after = (await objs(app))[0]!;
  expect(ends(after).size, "still six vertices").toBe(6);
  expect(after.sub.filter((s) => s.n[1] === after.sub[0]!.n[1] || true).length).toBe(7);
  await key(app, "Control+z");
  expect(ends((await objs(app))[0]!).size).toBe(6);
  // Release: an ordinary path again, with the same edges
  await key(app, "v");
  await click(app, 480, 360);
  await pathWith(p, "releasenet");
  const back = ((await objs(app)) as unknown as Array<Obj & { net?: boolean }>)[0]!;
  expect(back.net).toBeUndefined();
  expect(back.sub).toHaveLength(7);
});

test("Brush mask: started from the palette over a picked shape, the Pen paints black to hide (white to show), the strokes are the mask, Done ends it; copies follow", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [700, 500]);
  await key(app, "v");
  await click(app, 450, 350);
  const blue = await px(430, 330);
  await p.keyboard.press("Control+k");
  await p.keyboard.type("Brush mask: show everything");
  await p.keyboard.press("Enter");
  expect(await tool(app)).toBe("pen");
  await expect(p.locator('[data-mask-ink="done"]')).toBeVisible();
  // a wide black stroke hides what it crosses (the pen is at its default width: draw a thick band by several passes)
  for (const y of [350, 358, 366, 374, 382, 390]) await drag(app, [420, y], [680, y]);
  await app.frame();
  const strokes = (await objs(app)) as unknown as Array<Obj & { isMask?: boolean; color?: string }>;
  expect(strokes.filter((o) => o.kind === "stroke").every((o) => o.isMask && o.color === "#000000")).toBe(true);
  expect(await px(550, 366), "hidden under the strokes").not.toEqual(blue);
  expect(await px(430, 330), "shown elsewhere").toEqual(blue);
  await p.click('[data-mask-ink="show"]');
  await drag(app, [500, 358], [600, 358]);
  await p.click('[data-mask-ink="done"]');
  await expect(p.locator('[data-mask-ink="done"]')).toBeHidden();
  expect((await objs(app)).filter((o) => o.kind === "stroke").length).toBeGreaterThan(6);
});

test("Clipping mask as one unit: a click on its output picks the whole mask (and the box is the mask's), dragging it moves the output, a double click goes in to pick what it cuts, Escape comes out", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [700, 500]);
  await p.click('[data-shape-kind="ellipse"]');
  await drag(app, [500, 340], [600, 460]);
  await key(app, "v");
  await key(app, "Control+a");
  await maskWith(p, "clipmask");
  await click(app, 120, 650);
  const all = (await objs(app)) as unknown as Array<Obj & { container?: { mask?: boolean }; parent?: string }>;
  const sheet = all.find((o) => o.container)!;
  const rect = all.find((o) => o.parent === sheet.id && !o.container)!;
  expect(sheet.container!.mask, "marked as a mask").toBe(true);
  const sel = () => p.evaluate(() => window.__canvastDebug.selection());
  const box = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
  // a click on the output (the ellipse's middle, where the rectangle shows) picks the mask whole
  await click(app, 550, 400);
  expect([...(await sel())].sort()).toEqual([sheet.id, rect.id].sort());
  // its outline is the mask's, not the rectangle's (which reaches far beyond the ellipse): only the mask's box has handles
  const handles = await p.evaluate(() => window.__canvastDebug.drawnHandles());
  const sb = await box(sheet.id);
  const xs = handles.map((h) => h[0]);
  expect(Math.min(...xs)).toBeGreaterThan(sb.minX - 6);
  expect(Math.max(...xs)).toBeLessThan(sb.maxX + 6);
  // dragging the output moves the mask and what it cuts together
  const r0 = await box(rect.id);
  await drag(app, [550, 400], [650, 400]);
  expect((await box(rect.id)).minX - r0.minX).toBeCloseTo(100, 0);
  expect((await box(sheet.id)).minX - sb.minX).toBeCloseTo(100, 0);
  // a double click goes in: the rectangle alone is picked, and stays pickable one by one
  await p.mouse.dblclick(650, 400);
  await app.frame();
  expect(await sel()).toEqual([rect.id]);
  await click(app, 120, 650);
  expect(await sel()).toEqual([]);
  await click(app, 650, 400);
  expect([...(await sel())].sort(), "outside again, the mask is one unit again").toEqual([sheet.id, rect.id].sort());
  await p.mouse.dblclick(650, 400);
  await app.frame();
  await key(app, "Escape");
  expect([...(await sel())].sort(), "Escape comes out: the mask whole").toEqual([sheet.id, rect.id].sort());
  expect(app.consoleErrors).toEqual([]);
});

test("Releasing a clipping mask gives the shape back as an ordinary shape, with the fill and outline it had, and what it cut stays", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [700, 500]);
  await p.click('[data-shape-kind="ellipse"]');
  await drag(app, [500, 340], [600, 460]);
  const ellipse = (await objs(app)).at(-1)! as Obj & { fill: unknown; stroke: unknown };
  await key(app, "v");
  await key(app, "Control+a");
  await maskWith(p, "clipmask");
  await click(app, 120, 650);
  const made = (await objs(app)) as unknown as Array<Obj & { container?: unknown; fill: unknown; stroke: unknown }>;
  expect(made.find((o) => o.container)!.fill, "the mask has no fill of its own").toBeNull();
  await click(app, 550, 400);
  await maskWith(p, "releasemask");
  await click(app, 120, 650);
  const back = (await objs(app)) as unknown as Array<Obj & { container?: unknown; parent?: string; fill: unknown; stroke: unknown }>;
  expect(back, "nothing was lost").toHaveLength(2);
  expect(back.some((o) => o.container), "no sheet is left").toBe(false);
  expect(back.every((o) => o.parent === undefined)).toBe(true);
  const shape = back.find((o) => o.id === ellipse.id)!;
  expect(shape.fill, "the fill it had").toEqual(ellipse.fill);
  expect(shape.stroke).toEqual(ellipse.stroke);
  expect(app.consoleErrors).toEqual([]);
});

test("a long press with a finger lists everything under it; tapping a row picks that thing, the first row adds to the pick (ADR 0151)", async ({ app, browserName }) => {
  test.skip(browserName !== "chromium", "a held touch is sent through the DevTools protocol");
  const p = app.page;
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [700, 500]);
  await p.click('[data-shape-kind="ellipse"]');
  await drag(app, [500, 340], [600, 460]);
  await key(app, "v");
  await click(app, 120, 650);
  const [back, front] = (await objs(app)).map((o) => o.id);
  const hold = async (x: number, y: number) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await p.waitForTimeout(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await hold(550, 400);
  const rows = p.locator('.pop-menu[aria-label="Under your finger"] [data-i]');
  await expect.poll(() => rows.count(), "the pick-several row, the two things under the finger, then the context menu's actions").toBeGreaterThanOrEqual(4);
  await expect(rows.nth(3), "a long touch is the context menu: its actions follow the list").toHaveClass(/has-sep/);
  await rows.nth(2).click(); // the one at the back
  await expect(p.locator(".pop-menu")).toHaveCount(0);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([back]);
  // pick several: the first row stays ticked, each tap adds
  await click(app, 120, 650);
  await hold(550, 400);
  await p.locator('.pop-menu [data-id="reveal-add"]').click();
  await rows.nth(1).click();
  await rows.nth(2).click();
  expect([...(await p.evaluate(() => window.__canvastDebug.selection()))].sort()).toEqual([back, front].sort());
  await expect(rows.nth(1), "what is selected is ticked").toHaveAttribute("aria-checked", "true");
  await rows.nth(1).click(); // a tap on a picked one takes it out
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([back]);
  await rows.nth(1).click();
  // a press outside ends the list and does nothing else: what was picked stays picked
  await p.mouse.click(120, 650);
  await expect(p.locator(".pop-menu")).toHaveCount(0);
  expect([...(await p.evaluate(() => window.__canvastDebug.selection()))].sort()).toEqual([back, front].sort());
});

test("a mixed pick has one set of chips, at the start of the Properties bar (All, Shape, Stroke): a kind shows only its tools in both bars, All shows everything (ADR 0152)", async ({ app }) => {
  const p = app.page;
  const chips = p.locator(".tb-subject");
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [550, 400]);
  await key(app, "v");
  await expect(chips, "one kind: no chips").toBeHidden();
  await expect(p.locator("[data-kinds-bar]"), "and none in the Actions bar: the chips are only at the top").toHaveCount(0);
  await key(app, "p");
  await drag(app, [600, 300], [760, 420]);
  await key(app, "v");
  await key(app, "Control+a");
  await expect(chips.locator("button")).toHaveText(["All", "Shape", "Stroke"]);
  const bool = p.locator('[data-ctx="boolmenu"]');
  await expect(bool, "none chosen: every tool").not.toHaveAttribute("data-off", "");
  await chips.locator('[data-subject="stroke"]').click();
  await expect(bool, "Stroke: the shapes' tools are off").toHaveAttribute("data-off", "");
  await expect(chips.locator('[data-subject="stroke"]')).toHaveAttribute("aria-checked", "true");
  await chips.locator('[data-subject="all"]').click();
  await expect(bool).not.toHaveAttribute("data-off", "");
  await expect(chips.locator('[data-subject="all"]')).toHaveAttribute("aria-checked", "true");
});

test("touch: a quick two-finger tap is undo and a three-finger tap is redo (the view stays); a finger held still while resizing is Shift; a second finger resting is Alt (ADR 0152)", async ({ app, browserName }) => {
  test.skip(browserName !== "chromium", "touch is sent through the DevTools protocol");
  const p = app.page;
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", pts: Array<[number, number]>) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 300], [600, 400]);
  expect(await objs(app)).toHaveLength(1);
  const cam = await p.evaluate(() => JSON.stringify(window.__canvastDebug.camera()));
  await touch("touchStart", [[700, 500], [760, 520]]);
  await touch("touchEnd", []);
  await expect.poll(async () => (await objs(app)).length, { message: "two fingers: undo" }).toBe(0);
  await touch("touchStart", [[700, 500], [760, 520], [820, 540]]);
  await touch("touchEnd", []);
  await expect.poll(async () => (await objs(app)).length, { message: "three fingers: redo" }).toBe(1);
  expect(await p.evaluate(() => JSON.stringify(window.__canvastDebug.camera())), "a tap does not move or zoom the view").toBe(cam);
  // after the view has been panned and zoomed with two fingers (undo, then move the view, then redo)
  await touch("touchStart", [[700, 500], [760, 520]]);
  await touch("touchEnd", []);
  await expect.poll(async () => (await objs(app)).length).toBe(0);
  await touch("touchStart", [[600, 500], [700, 500]]);
  await touch("touchMove", [[560, 460], [760, 540]]);
  await touch("touchMove", [[500, 420], [820, 580]]);
  await touch("touchEnd", []);
  expect(await p.evaluate(() => JSON.stringify(window.__canvastDebug.camera()))).not.toBe(cam);
  await touch("touchStart", [[700, 500], [760, 520], [820, 540]]);
  await touch("touchEnd", []);
  await expect.poll(async () => (await objs(app)).length, { message: "redo after a pan and zoom" }).toBe(1);
  await p.evaluate((c) => window.__canvastDebug.setCamera(JSON.parse(c)), cam);
  // fingers land and lift one after the other, as a hand does: three take longer than two
  await touch("touchStart", [[700, 500], [760, 520]]);
  await touch("touchEnd", []);
  await expect.poll(async () => (await objs(app)).length).toBe(0);
  await touch("touchStart", [[700, 500]]);
  await p.waitForTimeout(150);
  await touch("touchStart", [[700, 500], [760, 520]]);
  await p.waitForTimeout(150);
  await touch("touchStart", [[700, 500], [760, 520], [820, 540]]);
  await p.waitForTimeout(100);
  await touch("touchEnd", []);
  await expect.poll(async () => (await objs(app)).length, { message: "redo with fingers landing one by one" }).toBe(1);
  for (let i = 0; i < 3; i++) {
    // and again and again: no tap leaves a finger behind that spoils the next
    await touch("touchStart", [[700, 500], [760, 520]]);
    await touch("touchEnd", []);
    await expect.poll(async () => (await objs(app)).length, { message: `undo again (${i})` }).toBe(0);
    await touch("touchStart", [[700, 500], [760, 520], [820, 540]]);
    await touch("touchEnd", []);
    await expect.poll(async () => (await objs(app)).length, { message: `redo again (${i})` }).toBe(1);
  }
  // Shift and Alt are fingers: while one finger drags a corner, one more finger resting is Shift (the proportions are kept), two more are Alt (from the centre)
  await key(app, "v");
  await click(app, 500, 350);
  const id = (await last(app)).id;
  const b = await screenBox(app, id);
  const w0 = b.maxX - b.minX, h0 = b.maxY - b.minY;
  const ratio = async () => { const x = await screenBox(app, id); return [(x.maxX - x.minX) / (x.maxY - x.minY), x] as const; };
  await p.waitForTimeout(450); // (a lone finger right after a tap waits for a second one)
  await touch("touchStart", [[b.maxX, b.maxY]]);
  await touch("touchMove", [[b.maxX + 120, b.maxY + 10]]);
  await touch("touchMove", [[b.maxX + 120, b.maxY + 10], [200, 600]]); // (a second finger comes down away from the shape)
  await p.waitForTimeout(500);
  expect((await ratio())[0], "one resting finger: Shift keeps the shape's proportions").toBeCloseTo(w0 / h0, 1);
  await touch("touchMove", [[b.maxX + 120, b.maxY + 10], [200, 600], [260, 600]]);
  await p.waitForTimeout(500);
  const [, mid] = await ratio();
  expect((mid.minX + mid.maxX) / 2, "two resting fingers: Alt resizes about the centre").toBeCloseTo((b.minX + b.maxX) / 2, 0);
  await touch("touchEnd", []);
  expect((await ratio())[1].maxX - b.minX, "the corner followed the finger").toBeGreaterThan(w0 + 20);
  // the same keys while a shape is drawn: a rectangle dragged out with one finger and a second resting comes out square
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await p.waitForTimeout(450);
  await touch("touchStart", [[700, 450]]);
  await touch("touchMove", [[860, 520]]);
  await touch("touchMove", [[860, 520], [200, 650]]);
  await p.waitForTimeout(500);
  await touch("touchEnd", []);
  const made = size(await last(app));
  expect(made.w / made.h, "Shift while drawing: square").toBeCloseTo(1, 1);
});

test("while a handle is dragged the turn shows in degrees and the size as a ratio (1 : 1, 16 : 9) beside the pointer, and both go when it is let go", async ({ app }) => {
  const p = app.page;
  const label = () => p.evaluate(() => window.__canvastDebug.handleLabel());
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 400], [600, 500]);
  await key(app, "v");
  const id = (await last(app)).id;
  await click(app, 500, 450);
  const b = await screenBox(app, id);
  // resize the corner so the box is 2 : 1 then 1 : 1 (without Shift a rectangle is free)
  await p.mouse.move(b.maxX, b.maxY);
  await p.mouse.down();
  await p.mouse.move(b.minX + 300, b.minY + 150, { steps: 4 });
  expect(await label()).toBe("2 : 1");
  await p.mouse.move(b.minX + 150, b.minY + 150, { steps: 4 });
  expect(await label()).toBe("1 : 1");
  await p.mouse.up();
  expect(await label(), "gone with the drag").toBeNull();
  // turn it: the label is the angle in degrees
  const c = await screenBox(app, id);
  const cx = (c.minX + c.maxX) / 2, cy = (c.minY + c.maxY) / 2;
  await p.mouse.move(c.maxX + 12, c.maxY + 12);
  await p.mouse.down();
  await p.mouse.move(cx - 80, cy + 150, { steps: 6 });
  expect(await label()).toMatch(/^-?\d+(\.\d)?°$/);
  await p.mouse.up();
  expect(await label()).toBeNull();
});

test("touch undo and redo on the pen tool: lines drawn, then undo undo redo redo undo redo redo undo each step by one (a tap leaves no stroke behind)", async ({ app, browserName }) => {
  test.skip(browserName !== "chromium", "touch is sent through the DevTools protocol");
  const p = app.page;
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", pts: Array<[number, number]>) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const count = async () => (await objs(app)).length;
  await key(app, "p");
  for (const y of [300, 360, 420, 480]) await drag(app, [450, y], [700, y + 20]);
  expect(await count()).toBe(4);
  const tap = async (fingers: 2 | 3) => {
    // as a hand taps: the fingers land one after the other and lift one after the other
    const pts: Array<[number, number]> = [[900, 500], [960, 520], [1020, 540]];
    for (let i = 1; i <= fingers; i++) {
      await touch("touchStart", pts.slice(0, i));
      await p.waitForTimeout(70);
    }
    for (let i = fingers - 1; i >= 0; i--) {
      await touch("touchEnd", pts.slice(0, i));
      await p.waitForTimeout(50);
    }
    await p.waitForTimeout(100);
  };
  let n = 4;
  for (const step of ["u", "u", "r", "u", "r", "r", "u", "u", "u", "r", "r", "r"] as const) {
    await tap(step === "u" ? 2 : 3);
    n += step === "u" ? -1 : 1;
    expect(await count(), `after ${step}`).toBe(n);
  }
  // a finger that lands right after a tap (a stray one, as a hand makes) draws no dot with the pen: it would be an edit, and an edit clears redo
  await tap(2);
  n -= 1;
  await touch("touchStart", [[1000, 300]]);
  await p.waitForTimeout(40);
  await touch("touchEnd", []);
  await p.waitForTimeout(300);
  expect(await count(), "no stray stroke").toBe(n);
  await tap(3);
  expect(await count(), "and redo still has its step").toBe(n + 1);
});

test("pasted SVG with a clip-path becomes a clipping mask holding what it cuts: nothing is drawn outside the clip", async ({ app, browserName }) => {
  test.skip(browserName === "firefox", "a synthetic paste event carries no data in Firefox");
  const p = app.page;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"><defs><rect id="r" width="100" height="100" fill="#ff0000"/><clipPath id="c"><circle cx="50" cy="50" r="20"/></clipPath></defs><g clip-path="url(#c)"><use xlink:href="#r"/></g></svg>';
  await p.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, svg);
  await expect.poll(async () => (await objs(app)).length).toBe(2);
  const all = (await p.evaluate(() => window.__canvastDebug.objects())) as unknown as Array<{ id: string; parent?: string; container?: { mask?: boolean } }>;
  const mask = all.find((o) => o.container?.mask)!;
  expect(mask, "a clipping mask").toBeTruthy();
  expect(all.find((o) => !o.container)!.parent, "holds the rectangle").toBe(mask.id);
  await key(app, "Escape");
  await app.frame();
  const vp = p.viewportSize()!;
  const [cx, cy, side] = [Math.round(vp.width / 2), Math.round(vp.height / 2), 0.5 * Math.min(vp.width, vp.height)];
  const red = (c: number[]) => c[0]! > 200 && c[1]! < 60 && c[2]! < 60;
  expect(red(await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x!, y!), [cx, cy] as const)), "inside the circle: the rectangle").toBe(true);
  expect(red(await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x!, y!), [Math.round(cx - side * 0.45), Math.round(cy - side * 0.45)] as const)), "inside the rectangle but outside the circle: cut").toBe(false);
});

test("Save to library puts the picked shapes in the library as an SVG picture", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [500, 300], [700, 400]);
  await key(app, "v");
  await key(app, "Control+a");
  await exportWith(p, "svglibrary");
  await p.getByTestId("view-assets").click();
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  await expect(p.getByTestId("asset-card")).toContainText("canvast-shapes");
});

test("Make vector copy replaces an SVG picture with its shapes in the same place and size, in one undo step", async ({ app }) => {
  const p = app.page;
  // A drawing whose rect fills its viewBox, so the shapes' box is the picture's box.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 200 100"><rect width="200" height="100" fill="#2563eb"/><circle cx="100" cy="50" r="30" fill="#dc2626"/></svg>`;
  await p.getByTestId("import-input").setInputFiles({ name: "d.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect.poll(async () => (await objs(app)).filter((o) => o.kind === "image").length).toBe(1);
  const img = (await objs(app)).find((o) => o.kind === "image")!;
  await app.frame();
  const before = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), img.id))!.box;
  await key(app, "v");
  await click(app, (before.minX + before.maxX) / 2, (before.minY + before.maxY) / 2);
  await p.locator('[data-ctx="vectorise"]').click();
  await expect.poll(async () => (await objs(app)).map((o) => o.kind).sort()).toEqual(["path", "path"]);
  await app.frame();
  const boxes = await p.evaluate((ids) => ids.map((id) => window.__canvastDebug.objectScreen(id)!.box), (await objs(app)).map((o) => o.id));
  const after = { minX: Math.min(...boxes.map((b) => b.minX)), minY: Math.min(...boxes.map((b) => b.minY)), maxX: Math.max(...boxes.map((b) => b.maxX)), maxY: Math.max(...boxes.map((b) => b.maxY)) };
  for (const k of ["minX", "minY", "maxX", "maxY"] as const) expect(Math.abs(after[k] - before[k]), `${k}: where the picture was`).toBeLessThan(1.5);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await objs(app)).map((o) => o.kind)).toEqual(["image"]);
});

test("WYSIWYG colours: a new shape's default outline is a real colour chosen for the canvas it is drawn on, and the canvas, a picture and an SVG all show exactly what is stored", async ({ app }) => {
  const p = app.page;
  await outlineShapes(p);
  const exported = async (format: "svg" | "png"): Promise<Buffer> => {
    await exportWith(p, "exportpic");
    const dlg = p.getByTestId("export-dialog");
    await dlg.locator(`[data-format="${format}"]`).click();
    const [download] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
    const bytes = (await import("node:fs")).readFileSync((await download.path())!);
    await dlg.locator('[data-ex="close"]').click();
    return bytes;
  };
  const draw = async (from: [number, number], to: [number, number]) => {
    await key(app, "u");
    await drag(app, from, to);
    await key(app, "v");
    await click(app, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  };
  // a dark canvas: the outline is made light, and stored light
  await p.emulateMedia({ colorScheme: "dark" });
  await app.frame();
  await draw([500, 300], [700, 400]);
  const dark = (await last(app)).stroke as string;
  expect(dark, "a real colour, not the near-black the dark canvas cannot show").toMatch(/^#[0-9a-f]{6}$/);
  expect(dark).not.toBe("#1f2329");
  // the canvas shows it too: the pixel on the outline is the stored colour
  await key(app, "Escape"); // (the selection box is not part of the drawing)
  await app.frame();
  const edge = await p.evaluate(() => [window.__canvastDebug.pixelAt(500, 350), window.__canvastDebug.pixelAt(499, 350), window.__canvastDebug.pixelAt(501, 350)]);
  const want = [1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16));
  expect(edge.some((px) => px.every((v, i) => Math.abs(v - want[i]!) <= 3)), `the canvas draws ${dark}`).toBe(true);
  await click(app, 600, 350); // (picked again to be exported)
  const svg = (await exported("svg")).toString("utf8");
  expect(/stroke="(#[0-9a-f]{6})"/.exec(svg)![1], "the SVG holds exactly what is stored").toBe(dark);
  // a light canvas: the near-black, as before
  await p.emulateMedia({ colorScheme: "light" });
  await app.frame();
  await key(app, "Escape");
  await draw([800, 300], [1000, 400]);
  expect((await last(app)).stroke).toBe("#1f2329");
  // the dark shape did not change when the canvas became light: what is stored is what is seen
  expect((await objs(app))[0]!.stroke).toBe(dark);
  // an old drawing (the near-black stored) on a dark canvas is drawn as stored; one command gives it the canvas's ink, as one undo step
  await p.emulateMedia({ colorScheme: "dark" });
  await app.frame();
  await key(app, "Escape");
  await key(app, "Control+k");
  await p.locator(".palette-input").fill("old default ink");
  await key(app, "Enter");
  await expect.poll(async () => (await last(app)).stroke).toBe(dark);
  expect((await objs(app)).every((o) => o.stroke === dark)).toBe(true);
  await key(app, "Control+z");
  expect((await last(app)).stroke).toBe("#1f2329");
});

test("an angular gradient (SVG has none) is written as a picture inside the SVG, with a warning where it is exported and saved", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [500, 300], [760, 460]);
  await key(app, "v");
  await click(app, 630, 380);
  await p.click('[data-paint="fill"]');
  await p.locator(".colour-pop").locator('[data-mode="angular"]').click();
  await key(app, "Escape");
  expect(((await last(app)).fill as unknown as { type: string }).type).toBe("angular");
  await exportWith(p, "exportpic");
  const dlg = p.getByTestId("export-dialog");
  await expect(dlg.locator("[data-ex-warn]")).toBeHidden(); // (a picture: nothing is lost)
  await dlg.locator('[data-format="svg"]').click();
  await expect(dlg.locator("[data-ex-warn]")).toContainText("The angular gradient of 1 shape is saved as a picture inside the SVG");
  const [download] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
  const svg = (await import("node:fs")).readFileSync((await download.path())!, "utf8");
  expect(svg).toMatch(/<g[^>]* clip-path="url\(#v\d+\)"><image xlink:href="data:image\/png;base64,/);
  expect(svg, "not a linear stand-in").not.toContain("<linearGradient");
  await dlg.locator('[data-ex="close"]').click();
  // the file can be made editable again: pasted back, the shape has the real angular gradient (not the picture, which is no shape)
  if (p.context().browser()?.browserType().name() === "chromium") { // (Firefox ignores the text of a made-up paste event: the app reads real pastes there)
    const before = (await last(app)).fill as unknown as { type: string; stops: unknown[]; angle: number; cx: number; cy: number };
    const count = (await objs(app)).length;
    await p.evaluate((t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, svg);
    await expect.poll(async () => (await objs(app)).length).toBe(count + 1);
    const back = (await last(app)).fill as unknown as typeof before;
    expect(back.type).toBe("angular");
    expect(back).toEqual(before);
  }
  // Save to library as SVG says so too
  await exportWith(p, "svglibrary");
  await expect(p.getByTestId("toast")).toContainText("saved as a picture inside the SVG");
});

test("a vector network with an angular fill is written as a picture too (its regions are filled one by one)", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [500, 250], [760, 500]);
  await key(app, "Escape");
  await key(app, "u");
  await drag(app, [650, 350], [900, 560]);
  await key(app, "v");
  await key(app, "Control+a");
  await key(app, "Control+k");
  await p.locator(".palette-input").fill("vector network");
  await key(app, "Enter");
  expect((await last(app) as Obj & { net?: boolean }).net).toBe(true);
  await p.click('[data-paint="fill"]');
  await p.locator(".colour-pop").locator('[data-mode="angular"]').click();
  await key(app, "Escape");
  await exportWith(p, "exportpic");
  const dlg = p.getByTestId("export-dialog");
  await dlg.locator('[data-format="svg"]').click();
  const [download] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
  const svg = (await import("node:fs")).readFileSync((await download.path())!, "utf8");
  expect(svg).toContain("<image xlink:href=\"data:image/png;base64,");
  expect(svg, "not a linear stand-in").not.toContain("<linearGradient");
});

test("fill and outline both gradients: the hint line and the handle names say whose gradient the handles on the shape are and of what kind, and Outline switches them", async ({ app }) => {
  const p = app.page;
  const pop = p.locator(".colour-pop");
  const hint = p.getByTestId("tool-hint");
  await key(app, "u");
  await drag(app, [500, 300], [760, 460]);
  await key(app, "v");
  await click(app, 630, 380);
  await expect(p.getByTestId("tool-hint")).not.toContainText("gradient"); // (none yet)
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="linear"]').click();
  await key(app, "Escape");
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // the focused picker button would show its own hint
  await p.mouse.move(300, 600);
  await expect(hint).toContainText("its fill's linear gradient");
  await expect(hint, "one gradient: nothing to choose").not.toContainText("instead");
  await p.click('[data-paint="stroke"]');
  await pop.locator('[data-mode="radial"]').click(); // (this also puts the handles on the outline's gradient)
  await key(app, "Escape");
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await p.mouse.move(300, 600);
  // both are gradients: the hint names the ones the handles are on, and the way to the other
  await expect(hint).toContainText("its outline's radial gradient");
  await expect(hint).toContainText("Press Fill in the bar above to edit its linear gradient instead");
  const handleNames = async (): Promise<string[]> => {
    const names: string[] = [];
    for (const [x, y] of await p.evaluate(() => window.__canvastDebug.drawnHandles())) {
      await p.mouse.move(x, y);
      await app.frame();
      const t = await p.evaluate(() => window.__canvastDebug.handleLabel());
      if (t?.includes("gradient")) names.push(t);
    }
    return names;
  };
  expect((await handleNames()).every((t) => t.startsWith("Outline · radial gradient · "))).toBe(true);
  // the fill's: press Fill, and the handles and the hint follow
  await p.click('[data-paint="fill"]');
  await key(app, "Escape");
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // the focused picker button would show its own hint
  await p.mouse.move(300, 600);
  await expect(hint).toContainText("its fill's linear gradient");
  const fillNames = await handleNames();
  expect(fillNames.length).toBeGreaterThan(0);
  expect(fillNames.every((t) => /^Fill · linear gradient · (start|end)$/.test(t))).toBe(true);
  // another shape picked starts with its fill again
  await key(app, "Escape");
  await click(app, 630, 380);
  await expect(hint).toContainText("its fill's linear gradient");
});

test("gradients written by another design tool are read: a radial one sized by its own transform, an angular one written as a CSS conic gradient box, a diamond one as clipped gradient rectangles", async ({ app }) => {
  test.skip(app.page.context().browser()?.browserType().name() !== "chromium", "Firefox ignores the text of a made-up paste event");
  const p = app.page;
  const shape = "M20 10H160Q176 10 176 26V150Q176 168 158 168H28Q10 168 10 150V26Q10 10 20 10Z";
  const paste = async (svg: string) => {
    const n = (await objs(app)).length;
    await p.evaluate((t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, svg);
    await expect.poll(async () => (await objs(app)).length).toBeGreaterThan(n);
    await key(app, "Escape");
  };
  const stops = `<stop stop-color="#FF0000"/><stop offset="0.269231" stop-color="#FFBF00"/><stop offset="0.533654" stop-color="#00FF15"/><stop offset="0.6875" stop-color="#AA00FF"/>`;
  type G = { type: string; r?: number; cx: number; cy: number; angle?: number; stops: Array<{ o: number; c: string }> };
  // radial: r="1" and the size in gradientTransform (here a scale of 143.5 on a shape 186 wide)
  await paste(`<svg width="186" height="179" viewBox="0 0 186 179" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="${shape}" fill="url(#r)"/><defs><radialGradient id="r" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(92.8855 96.5426) rotate(90) scale(143.5)">${stops}</radialGradient></defs></svg>`);
  const radial = (await last(app)).fill as unknown as G;
  expect(radial.type).toBe("radial");
  expect(radial.r!).toBeGreaterThan(0.7);
  expect(radial.r!).toBeLessThan(0.9); // 143.5 over the shape's 166 wide
  expect(radial.cx).toBeCloseTo(0.5, 1);
  // angular: a clipped group with a box holding a CSS conic gradient, turned a quarter
  await paste(`<svg width="186" height="179" viewBox="0 0 186 179" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#c)"><g transform="matrix(0 0.1435 -0.1435 0 92.8855 96.5426)"><foreignObject x="-1006.97" y="-1006.97" width="2013.94" height="2013.94"><div xmlns="http://www.w3.org/1999/xhtml" style="background:conic-gradient(from 90deg,rgba(255, 0, 0, 1) 0deg,rgba(255, 191, 0, 1) 96.9231deg,rgba(0, 255, 21, 1) 192.115deg,rgba(170, 0, 255, 1) 252.692deg,rgba(255, 0, 0, 1) 360deg);height:100%;width:100%;opacity:1"></div></foreignObject></g></g><path d="${shape}" fill="none"/><defs><clipPath id="c"><path d="${shape}"/></clipPath></defs></svg>`);
  const angular = (await last(app)).fill as unknown as G;
  expect(angular.type).toBe("angular");
  expect(angular.angle).toBeCloseTo(90, 0); // the first edge points down after the quarter turn
  expect(angular.stops.map((q) => Math.round(q.o * 1000) / 1000)).toEqual([0, 0.269, 0.534, 0.702, 1]);
  expect(angular.stops[0]!.c.slice(0, 7)).toBe("#ff0000");
  expect(angular.cx).toBeCloseTo(0.5, 1);
  // diamond: four mirrored rectangles with a linear gradient, cut by the shape: kept as what it is, a clipped group (there is no diamond gradient here)
  const before = (await objs(app)).length;
  await paste(`<svg width="186" height="179" viewBox="0 0 186 179" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#c)"><g transform="matrix(0 0.1435 -0.1435 0 92.8855 96.5426)"><rect x="0" y="0" width="1006.97" height="1006.97" fill="url(#d)"/><rect x="0" y="0" width="1006.97" height="1006.97" transform="scale(1 -1)" fill="url(#d)"/></g></g><defs><clipPath id="c"><path d="${shape}"/></clipPath><linearGradient id="d" x1="0" y1="0" x2="1006.97" y2="0" gradientUnits="userSpaceOnUse">${stops}</linearGradient></defs></svg>`);
  expect((await objs(app)).length).toBeGreaterThan(before);
});

test("initial shape with the setting on keeps the fill and outline, and Reset puts them back", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => localStorage.setItem("canvast.settings", JSON.stringify({ "shape.initialPaint": true })));
  await reload(app);
  await key(app, "u");
  await drag(app, [500, 300], [740, 440]);
  await key(app, "v");
  await click(app, 620, 370);
  const pop = p.locator(".colour-pop");
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="radial"]').click();
  await key(app, "Escape");
  const before = await last(app);
  expect(typeof before.fill).toBe("object");
  await stateWith(p, "stateset");
  await reload(app); // what was saved survives a reload
  await key(app, "Control+a");
  expect(((await last(app)) as Obj & { initial?: { paint?: unknown } }).initial?.paint).toBeDefined();
  await p.click('[data-paint="fill"]');
  await pop.locator("[data-hex]").fill("e11d48");
  await pop.locator("[data-hex]").press("Enter");
  await key(app, "Escape");
  expect((await last(app)).fill).not.toEqual(before.fill);
  await stateWith(p, "statereset");
  await app.frame();
  const back = await last(app);
  expect(back.fill).toEqual(before.fill);
  expect(back.stroke).toEqual(before.stroke);
  expect(back.width).toBe(before.width);
});

test("the selection options (radius lock, snap, axis box) are a bar of their own beside the Actions bar, under the same parent so they line up, and they follow it", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="rect"]').click();
  await app.drag({ x: 500, y: 300 }, { x: 640, y: 400 }, 6);
  await p.keyboard.press("v");
  const ctx = p.locator(".ctx-bar:not([hidden])");
  await expect(ctx).toBeVisible();
  const pick = p.getByRole("toolbar", { name: "Selection options" });
  await expect(pick).toBeVisible();
  expect(await pick.evaluate((e) => e.parentElement === document.querySelector(".ctx-bar")!.parentElement && e.previousElementSibling === document.querySelector(".ctx-bar")), "the same parent, next to the Actions bar").toBe(true);
  const [a, b] = [(await ctx.boundingBox())!, (await pick.boundingBox())!];
  expect(b.x - (a.x + a.width), "a gap, not inside").toBeGreaterThan(0);
  expect(b.x - (a.x + a.width), "close").toBeLessThan(24);
  const line = async () => {
    const [c, d] = [(await ctx.boundingBox())!, (await pick.boundingBox())!];
    return Math.abs(d.y + d.height / 2 - (c.y + c.height / 2));
  };
  expect(await line(), "on the bar's line").toBeLessThan(2);
  // Settings > Actions bar: follows the selection; the options go with it
  await p.getByTestId("view-settings").click();
  await p.locator("#settings-view").getByRole("tab", { name: "Appearance" }).click();
  await p.locator("#settings-view").getByLabel("Actions bar", { exact: true }).selectOption("follow");
  await p.getByTestId("view-canvas").click();
  await expect(ctx).toHaveClass(/is-following/);
  await expect(pick).toBeVisible();
  expect(await line(), "still on the bar's line").toBeLessThan(2);
  expect(app.consoleErrors).toEqual([]);
});

test("corners opened out one by one: a lasso on empty ground picks several, dragging one moves them all in one undo step", async ({ app }) => {
  const p = app.page;
  type P = Obj & { radius?: number | number[] };
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [300, 300], [560, 440]);
  await key(app, "v");
  await click(app, 430, 370);
  const main0 = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!.main;
  await p.mouse.dblclick(main0[0], main0[1]);
  await app.frame();
  const dots = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!;
  expect(dots.corners).toHaveLength(4);
  const [bl, br] = [dots.corners[3]!, dots.corners[2]!];
  // a lasso from empty ground below the shape, round the two bottom corners
  const path: Array<[number, number]> = [[bl[0] - 40, br[1] + 40], [br[0] + 40, br[1] + 40], [br[0] + 40, br[1] - 25], [bl[0] - 40, br[1] - 25], [bl[0] - 40, br[1] + 35]];
  await p.mouse.move(...path[0]!);
  await p.mouse.down();
  for (const pt of path.slice(1)) await p.mouse.move(pt[0], pt[1], { steps: 4 });
  await p.mouse.up();
  await app.frame();
  const before = ((await last(app)) as P).radius;
  await drag(app, [br[0], br[1]], [br[0] - 20, br[1] - 20]);
  const r = ((await last(app)) as P).radius as number[];
  expect(Array.isArray(r)).toBe(true);
  expect(r.filter((v) => v > 0), "the two picked corners moved together").toHaveLength(2);
  expect(r[2]!).toBeCloseTo(r[3]!, 1);
  await key(app, "Control+z");
  expect(((await last(app)) as P).radius, "one undo step").toEqual(before);
});

test("Apply rotation: the turn of a shape becomes its own, the new zero; it looks the same, its box fits it, one undo step", async ({ app }) => {
  const p = app.page;
  type T = Obj & { rot?: number };
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 250], [600, 330]);
  await key(app, "v");
  await click(app, 500, 290);
  const apply = p.getByRole("button", { name: /^Apply rotation/ });
  await expect(apply, "nothing is turned yet").toBeHidden();
  const frame = async () => (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!;
  const c0 = (await frame()).corners[0]!;
  await p.mouse.move(c0[0] - 16, c0[1] - 16);
  await p.mouse.down();
  await p.mouse.move(c0[0] - 60, c0[1] + 10, { steps: 6 });
  await p.mouse.up();
  await app.frame();
  expect(((await last(app)) as T).rot, "turned").toBeGreaterThan(0);
  expect(Math.abs((await frame()).angle), "its box is turned with it").toBeGreaterThan(0.05);
  await expect(apply).toBeVisible();
  await key(app, "Escape");
  const ink = async () => p.evaluate(() => window.__canvastDebug.inkedPixels(2));
  const before = await ink();
  await click(app, 500, 290);
  await apply.click();
  await app.frame();
  await key(app, "Escape");
  await app.frame();
  expect(((await last(app)) as T).rot, "no turn left").toBeUndefined();
  expect(Math.abs((await ink()) - before) / before, "it looks the same").toBeLessThan(0.02);
  await click(app, 500, 290);
  expect(Math.abs((await frame()).angle), "its box is straight and fits it").toBeLessThan(1e-6);
  await expect(apply).toBeHidden();
  await expect(p.getByRole("button", { name: "Reset rotation" })).toBeHidden();
  await key(app, "Control+z");
  expect(((await last(app)) as T).rot, "one undo step brings the turn back").toBeGreaterThan(0);
  expect(app.consoleErrors).toEqual([]);
});

test("Edit nodes: a plus cursor where a click adds a node, and a label that names what the keys do over a node or an edge", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [400, 250], [640, 400]);
  await key(app, "v");
  await click(app, 520, 320);
  await key(app, "n");
  const canvas = p.locator("#canvas");
  const label = () => p.evaluate(() => window.__canvastDebug.handleLabel());
  await p.mouse.move(520, 250); // the middle of the top edge
  await expect(canvas).toHaveClass(/is-add/);
  await expect.poll(label).toMatch(/Add node/);
  await p.mouse.move(400, 250); // a corner node: a move cursor, not the lasso's or the plus
  await expect(canvas).not.toHaveClass(/is-add/);
  await expect(canvas).toHaveClass(/is-node/);
  await expect.poll(label).toMatch(/Alt: smooth.*Del/);
  await p.mouse.move(520, 340); // inside the shape, off every edge and node: a drag here is a lasso, not a move
  await expect(canvas).not.toHaveClass(/is-add/);
  await expect.poll(label).toMatch(/Lasso nodes/);
  const before = ((await last(app)) as Obj & { ax?: unknown }).ax;
  await drag(app, [500, 320], [560, 360]);
  expect(((await last(app)) as Obj & { ax?: unknown }).ax, "the shape did not move").toEqual(before);
  await p.mouse.move(800, 600); // empty ground
  await expect.poll(label).toBeNull();
});

test("Edit nodes and the corners one by one end by themselves when the shape is let go", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await p.click('[data-shape-kind="rect"]');
  await drag(app, [500, 300], [560, 340]); // (a small shape, so that focusing it changes the view)
  await key(app, "v");
  await click(app, 530, 320);
  // Edit nodes: a click on empty ground leaves the mode
  await key(app, "n");
  expect(await tool(app)).toBe("node");
  await click(app, 900, 600);
  expect(await tool(app), "back to Select when nothing is picked").toBe("select");
  // the corners opened out: closed again when the shape is let go
  await click(app, 530, 320);
  const main = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!.main;
  await p.mouse.dblclick(main[0], main[1]);
  await app.frame();
  // (opened out, the main dot is in the middle of the shape; closed, it sits inside the first corner)
  expect(Math.abs((await p.evaluate(() => window.__canvastDebug.cornerDots()))!.main[0] - 530), "the corners are opened out").toBeLessThan(8);
  await click(app, 900, 600);
  await click(app, 530, 320);
  expect(Math.abs((await p.evaluate(() => window.__canvastDebug.cornerDots()))!.main[0] - 530), "closed after the shape was let go").toBeGreaterThan(15);
});

test("on a phone the Actions bar stands above the bottom controls, and the colours of the selection share the row of the Properties bar (one row less at the top)", async ({ app }) => {
  const p = app.page;
  await p.setViewportSize({ width: 390, height: 780 });
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="rect"]').click();
  await app.drag({ x: 120, y: 300 }, { x: 260, y: 400 }, 5);
  await p.keyboard.press("v");
  await p.mouse.click(190, 350);
  const ctx = p.locator(".ctx-wrap");
  await expect(ctx).toBeVisible();
  const [a, c] = [(await ctx.boundingBox())!, (await p.locator(".hud-controls").boundingBox())!];
  expect(a.y + a.height, "the Actions bar ends above the controls").toBeLessThanOrEqual(c.y + 1);
  // (the colours' own bar is a .toolbar too: the Properties bar is the other one)
  const row = p.locator('#toolbar > .toolbar:not([aria-label="Colours of the selection"]) .tb-options-row');
  await expect(row.locator("[data-sel-colours]"), "the colours are in the Properties bar's row").toHaveCount(1);
  await p.setViewportSize({ width: 1280, height: 800 });
  await expect(row.locator("[data-sel-colours]"), "wider, they are a bar of their own again").toHaveCount(0);
  await expect(p.locator('#toolbar > .toolbar[aria-label="Colours of the selection"] [data-sel-colours]')).toHaveCount(1);
  expect(app.consoleErrors).toEqual([]);
});

test("a pen stroke picked alone is recoloured from its colour chip", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await p.mouse.move(500, 300); await p.mouse.down(); await p.mouse.move(600, 360, { steps: 8 }); await p.mouse.up();
  await p.keyboard.press("v");
  await p.mouse.click(550, 330);
  await p.locator("[data-sel-colour]").first().click();
  const f = p.locator(".colour-pop [data-hex]");
  await f.fill("ff0000"); await f.press("Enter"); await p.keyboard.press("Escape");
  expect(await p.evaluate(() => window.__canvastDebug.objects().map((o: any) => o.color))).toEqual(["#ff0000"]);
});

test("a pen stroke's colour chip offers a flat colour only, no gradient modes", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await p.mouse.move(500, 300); await p.mouse.down(); await p.mouse.move(600, 360, { steps: 8 }); await p.mouse.up();
  await p.keyboard.press("v");
  await p.mouse.click(550, 330);
  await p.locator("[data-sel-colour]").first().click();
  await expect(p.locator(".colour-pop [data-hex]")).toBeVisible();
  await expect(p.locator('.colour-pop [data-mode="linear"]')).toHaveCount(0);
});

test("CSS text pasted with a shape picked becomes its fill: a gradient (linear, radial, conic; a repeating or unreadable one is left alone) or a colour in any notation", async ({ app }) => {
  test.skip(app.page.context().browser()?.browserType().name() !== "chromium", "Firefox ignores the text of a made-up paste event");
  const p = app.page;
  await key(app, "u");
  await drag(app, [500, 300], [760, 460]);
  await key(app, "v");
  await click(app, 630, 380);
  const paste = (t: string) => p.evaluate((x) => { const dt = new DataTransfer(); dt.setData("text/plain", x); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, t);
  type G = { type: string; x0?: number; x1?: number; y0?: number; y1?: number; cx?: number; r?: number; angle?: number; stops: Array<{ o: number; c: string }> };
  const fill = async (): Promise<G> => (await last(app)).fill as unknown as G;
  await paste("background: linear-gradient(90deg, #ff0000 0%, #0000ff 100%);");
  await expect.poll(async () => (await fill())?.type).toBe("linear");
  let g = await fill();
  expect(g.x0).toBeCloseTo(0, 2); expect(g.x1).toBeCloseTo(1, 2); expect(g.y0).toBeCloseTo(0.5, 2);
  expect(g.stops.map((s) => s.c)).toEqual(["#ff0000", "#0000ff"]);
  await paste("radial-gradient(circle at 30% 40%, #00ff00, #000000 80%)");
  await expect.poll(async () => (await fill())?.type).toBe("radial");
  g = await fill();
  expect(g.cx).toBeCloseTo(0.3, 2);
  expect(g.stops.map((s) => s.o)).toEqual([0, 0.8]);
  await paste("conic-gradient(from 90deg at 50% 50%, #ff0000 0deg, #0000ff 180deg)");
  await expect.poll(async () => (await fill())?.type).toBe("angular");
  g = await fill();
  expect(g.angle).toBeCloseTo(0, 1); // (CSS counts from the top: 90deg is pointing right)
  expect(g.stops.map((s) => s.o)).toEqual([0, 0.5]);
  // a solid colour in any CSS notation is a fill too
  for (const [t, hex] of [["#71DDD3", "#71ddd3"], ["rgb(255 0 0)", "#ff0000"], ["hsl(120 100% 50%)", "#00ff00"], ["oklch(0.628 0.2577 29.23)", "#ff0000"], ["fill: #0000ff80;", "#0000ff80"], ["rebeccapurple", "#663399"]] as const) {
    await paste(t);
    await expect.poll(async () => String((await last(app)).fill), t).toBe(hex);
  }
  await paste("hello"); // (a word that is no colour name changes nothing)
  await app.frame();
  expect(String((await last(app)).fill)).toBe("#663399");
  await paste("conic-gradient(from 90deg at 50% 50%, #ff0000 0deg, #0000ff 180deg)");
  await expect.poll(async () => ((await fill()) as G).type).toBe("angular");
  for (const t of ["repeating-linear-gradient(red, blue 20%)", "linear-gradient(red, nonsense)", "linear-gradient(red 10px, blue 90px)"]) {
    await paste(t);
    await app.frame();
    expect((await fill()).type, t).toBe("angular");
  }
  expect(app.consoleErrors).toEqual([]);
});

test("Ctrl+C puts the shape on the system clipboard as a PNG picture alone, \"Copy the selection as SVG\" puts its SVG text, and Ctrl+V here still pastes the shape itself (not an SVG import)", async ({ app }) => {
  test.skip(app.page.context().browser()?.browserType().name() !== "chromium", "the clipboard picture is read back in Chromium");
  const p = app.page;
  await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await key(app, "u");
  await p.click('[data-shape-kind="ellipse"]');
  await drag(app, [500, 300], [700, 400]);
  await key(app, "v");
  await p.keyboard.press("Control+c");
  await expect.poll(() => p.evaluate(async () => (await navigator.clipboard.read())[0]?.types.join(",") ?? ""), "the picture is there, alone (text beside it would be pasted instead)").toBe("image/png");
  const png = await p.evaluate(async () => (await (await navigator.clipboard.read())[0]!.getType("image/png")).size);
  expect(png).toBeGreaterThan(100);
  await p.keyboard.press("Control+v");
  await app.frame();
  const all = await objs(app);
  expect(all).toHaveLength(2);
  expect(all.every((o) => o.shape === "ellipse"), "the shape itself, not a vector copy").toBe(true);
  // The SVG text is its own row of the right-click menu
  await p.mouse.click(600, 350, { button: "right" });
  await p.getByRole("menu", { name: "Canvas actions" }).getByRole("menuitem", { name: "Copy the selection as SVG" }).click();
  await expect.poll(() => p.evaluate(() => navigator.clipboard.readText())).toMatch(/^<svg[\s>]/);
  expect(app.consoleErrors).toEqual([]);
});

test("Ctrl+C writes the picture to the clipboard in every browser (Firefox refuses a ClipboardItem that holds a promise, so the picture is made first)", async ({ app, browserName }) => {
  const p = app.page;
  if (browserName === "chromium") await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await p.evaluate(() => {
    const w = window as unknown as { __clip: string[] };
    w.__clip = [];
    const orig = navigator.clipboard.write.bind(navigator.clipboard);
    navigator.clipboard.write = async (items) => {
      try {
        await orig(items);
        w.__clip.push(`ok ${items.map((i) => i.types.join("+")).join(";")}`);
      } catch (e) {
        w.__clip.push(`refused ${String(e)}`);
        throw e;
      }
    };
  });
  await key(app, "u");
  await p.click('[data-shape-kind="ellipse"]');
  await drag(app, [500, 300], [700, 400]);
  await key(app, "v");
  await p.keyboard.press("Control+c");
  await expect.poll(() => p.evaluate(() => (window as unknown as { __clip: string[] }).__clip)).toEqual(["ok image/png"]);
});

test("adjustments on a shape: drawn on what it looks like, blur spreads past its edge, one undo step, kept over a reload", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  await key(app, "u");
  await drag(app, [560, 300], [760, 400]);
  const id = (await last(app)).id;
  await key(app, "v");
  await click(app, 660, 350);
  const before = await px(660, 350);
  await p.getByRole("button", { name: /^Adjust the picture/ }).click();
  await p.getByTestId("adjust-panel").locator(".adjust-pop").waitFor();
  await p.locator('.adjust-pop [data-adj-num="exposure"]').fill("60");
  await p.locator('.adjust-pop [data-adj-num="exposure"]').blur();
  await app.frame();
  expect((await last(app) as Obj & { adjust?: unknown }).adjust).toEqual({ exposure: 60 });
  expect(await px(660, 350), "the fill is brighter").not.toEqual(before);
  await p.locator('.adjust-pop [data-adj-num="blur"]').fill("100");
  await p.locator('.adjust-pop [data-adj-num="blur"]').blur();
  await app.frame();
  const box = await screenBox(app, id);
  const outside = await px(Math.round(box.maxX) + 3, 350);
  expect(await px(Math.round(box.maxX) + 60, 350), "far outside is the background").not.toEqual(outside);
  expect(await px(Math.round(box.maxX) + 3, 350), "the blur reaches past the edge").not.toEqual(await px(Math.round(box.maxX) + 60, 350));
  // a blur needs what lies beyond a tile's edge: with the tile cache on, the picture is the same as without it (no seams)
  await key(app, "=");
  await key(app, "=");
  await app.frame();
  const row = () => p.evaluate(() => Array.from({ length: 60 }, (_, i) => window.__canvastDebug.pixelAt(300 + i * 12, 350)));
  await p.evaluate(() => window.__canvastDebug.setTileCache(true));
  await app.frame();
  const tiled = await row();
  await p.evaluate(() => window.__canvastDebug.setTileCache(false));
  await app.frame();
  expect(tiled).toEqual(await row());
  await p.evaluate(() => window.__canvastDebug.setTileCache(true));
  await key(app, "-");
  await key(app, "-");
  await app.frame();
  // the SVG written for it carries the adjustments as a filter
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })));
  await p.keyboard.type("Copy the selection as SVG");
  await key(app, "Enter");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.lastCopied())).toMatch(/<filter[\s\S]*<feComponentTransfer[\s\S]*<g filter="url\(#/);
  // the blur is not cut by the file's box (it is wider than the shape), and pasting the text back gives a shape with the same adjustments
  const svgText = await p.evaluate(() => window.__canvastDebug.lastCopied());
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svgText)!;
  expect(Number(vb[1]), "room round the shape for the blur").toBeGreaterThan(0);
  expect(svgText).toMatch(/<g transform="translate\(/);
  if (test.info().project.name === "chromium") {
    const n0 = (await objs(app)).length;
    await p.evaluate((text) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, svgText);
    await app.frame();
    const back = (await objs(app)).slice(n0) as unknown as Array<{ adjust?: unknown }>;
    expect(back.at(-1)?.adjust).toEqual({ exposure: 60, blur: 100 });
    await key(app, "Control+z"); // (the paste first, then the blur)
  }
  await key(app, "Control+z");
  expect((await objs(app)).find((o) => o.id === id) as unknown as { adjust?: unknown }).toMatchObject({ adjust: { exposure: 60 } });
  await reload(app);
  expect(((await objs(app)).find((o) => o.id === id) as unknown as { adjust?: unknown }).adjust).toEqual({ exposure: 60 });
});

test("shadows in the Adjust panel: a drop shadow is drawn below the shape (starting soft), an inner shadow darkens inside its edge, and both are in the SVG", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  await key(app, "u");
  await drag(app, [560, 300], [760, 400]);
  const id = (await last(app)).id;
  await key(app, "v");
  await click(app, 660, 350);
  const box = await screenBox(app, id);
  const below = [660, Math.round(box.maxY) + 6] as const;
  const inside = [660, Math.round(box.minY) + 6] as const; // (the shadow goes down, so the inner one gathers at the top edge)
  const bg = await px(below[0], below[1]);
  const fill = await px(inside[0], inside[1]);
  await p.getByRole("button", { name: /^Adjust the picture/ }).click();
  await p.getByTestId("adjust-panel").locator(".adjust-pop").waitFor();
  await p.locator('.adjust-pop [data-adj-num="dropOpacity"]').fill("100");
  await p.locator('.adjust-pop [data-adj-num="dropOpacity"]').blur();
  await app.frame();
  const adj = ((await last(app)) as unknown as { adjust: Record<string, number> }).adjust;
  expect(adj.dropOpacity).toBe(100);
  expect(adj.dropY, "turned on soft, a little below").toBeGreaterThan(0);
  expect(await px(below[0], below[1]), "the shadow is under the shape").not.toEqual(bg);
  // centred on the shape (no offset, no blur) a shadow is hidden behind it: its Spread grows it into a glow all round
  const above = [610, Math.round(box.minY) - 6] as const; // (off the handle and the turn stalk at the middle)
  const bgAbove = await px(above[0], above[1]);
  for (const k of ["dropY", "dropBlur"]) {
    await p.locator(`.adjust-pop [data-adj-num="${k}"]`).fill("0");
    await p.locator(`.adjust-pop [data-adj-num="${k}"]`).blur();
  }
  await app.frame();
  expect(await px(above[0], above[1]), "behind the shape, nothing shows").toEqual(bgAbove);
  await p.locator('.adjust-pop [data-adj-num="dropSpread"]').fill("100");
  await p.locator('.adjust-pop [data-adj-num="dropSpread"]').blur();
  await app.frame();
    expect(await px(above[0], above[1]), "the spread shows it all round").not.toEqual(bgAbove);
  await p.locator('.adjust-pop [data-adj-num="innerOpacity"]').fill("100");
  await p.locator('.adjust-pop [data-adj-num="innerOpacity"]').blur();
  await app.frame();
  expect(await px(inside[0], inside[1]), "the inner shadow changes the edge of the fill").not.toEqual(fill);
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })));
  await p.keyboard.type("Copy the selection as SVG");
  await key(app, "Enter");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.lastCopied())).toMatch(/<filter[\s\S]*feOffset[\s\S]*feFlood[\s\S]*<g filter="url\(#/);
  // every change was its own undo step: undoing them one by one takes the adjustments off
  for (let i = 0; i < 8 && ((await last(app)) as unknown as { adjust?: unknown }).adjust !== undefined; i++) {
    await key(app, "Control+z");
    await app.frame();
  }
  expect(((await last(app)) as unknown as { adjust?: unknown }).adjust, "undone").toBeUndefined();
});

test("adjusted shapes at any zoom and in a picture file: deep inside a blurred shape it is the shape's colour (no sharp fallback, no vignette), and Export leaves room for the blur", async ({ app }) => {
  const p = app.page;
  const px = (x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  const vp = p.viewportSize()!;
  const cx = Math.round(vp.width / 2), cy = Math.round(vp.height / 2);
  await key(app, "u");
  await drag(app, [cx - 100, cy - 50], [cx + 100, cy + 50]);
  await key(app, "v");
  await click(app, cx, cy);
  // Export: the shape of the picture is the shape's box; a blur makes it wider (the halo is not cut)
  const ratio = async () => {
    await p.getByTestId("context-bar").getByRole("button", { name: /^Export and copy out/ }).click();
    await p.getByRole("menuitem").filter({ hasText: /picture/i }).first().click();
    const t = await p.getByTestId("export-shape").innerText();
    await p.getByTestId("export-dialog").locator('[data-ex="close"]').click();
    return t;
  };
  const before = await ratio();
  await p.getByRole("button", { name: /^Adjust the picture/ }).click();
  await p.getByTestId("adjust-panel").locator(".adjust-pop").waitFor();
  const centre0 = await px(cx, cy);
  await p.locator('.adjust-pop [data-adj-num="blur"]').fill("100");
  await p.locator('.adjust-pop [data-adj-num="blur"]').blur();
  await app.frame();
  expect(await ratio(), "room for the blur in the picture").not.toBe(before);
  // far inside it, the blur has nothing to blur: the colour of the fill, at the middle and at the corners alike
  await p.evaluate(() => {
    const h = window.__canvastDebug;
    const c = h.camera();
    h.setCamera({ ...c, zi: c.zi + 14, pz: c.zi + 14 });
  });
  await app.frame();
  const mid = await px(cx, cy);
  const corner = await px(cx - Math.round(vp.width / 2) + 80, cy - Math.round(vp.height / 2) + 120);
  for (let i = 0; i < 3; i++) expect(Math.abs(mid[i]! - centre0[i]!), "the colour inside").toBeLessThan(20);
  for (let i = 0; i < 3; i++) expect(Math.abs(corner[i]! - mid[i]!), "no vignette at the corners").toBeLessThan(20);
  // a great deal deeper, where the object is drawn as one colour: still its colour, not a vignette or the unadjusted one
  await p.evaluate(() => {
    const h = window.__canvastDebug;
    const c = h.camera();
    h.setCamera({ ...c, zi: c.zi + 40, pz: c.zi + 40 });
  });
  await app.frame();
  const deep = [await px(cx, cy), await px(30, vp.height - 30)];
  for (const d of deep) for (let i = 0; i < 3; i++) expect(Math.abs(d[i]! - centre0[i]!), "deep inside: the colour").toBeLessThan(25);
});

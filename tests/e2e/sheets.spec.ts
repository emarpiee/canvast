import { expect, test } from "./harness";
import type { App } from "./harness";

/**
 * Sheets (ADR 0108): fixed areas of the canvas that hold what is drawn or moved onto them and cut it at their edge. Real mouse and
 * keyboard input; assertions read the stored objects and the painted pixels.
 */
type Obj = { id: string; kind: string; parent?: string; name?: string; container?: { clip: boolean }; fill: unknown; stroke: unknown };
const objs = async (app: App): Promise<Obj[]> => (await app.page.evaluate(() => window.__canvastDebug.objects())) as unknown as Obj[];
const key = (app: App, k: string) => app.page.keyboard.press(k);
const drag = async (app: App, a: [number, number], b: [number, number]) => {
  await app.drag({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, 8);
  await app.frame();
};
const click = async (app: App, x: number, y: number) => {
  await app.page.mouse.click(x, y);
  await app.frame();
};
const px = (app: App, x: number, y: number) => app.page.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
const selection = (app: App) => app.page.evaluate(() => window.__canvastDebug.selection());

test("a sheet holds what is drawn on it and cuts it at its edge; the Layers clip button shows what is outside", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  const sheet = (await objs(app)).at(-1)!;
  expect(sheet.container).toEqual({ clip: true });
  expect(sheet.name).toBe("Sheet 1");
  await key(app, "u");
  await drag(app, [550, 400], [850, 450]); // starts on the sheet, ends past its right edge
  const rect = (await objs(app)).at(-1)!;
  expect(rect.parent).toBe(sheet.id);
  await key(app, "v");
  await click(app, 150, 650); // nothing picked: a selection paints over the pixels
  const blue = await px(app, 600, 425);
  const bg = await px(app, 150, 650);
  expect(blue, "on the sheet").not.toEqual(bg);
  expect(await px(app, 800, 425), "the part past the sheet is cut").not.toEqual(blue); // (the grid shows there)
  await click(app, 800, 425);
  expect(await selection(app), "what is cut away cannot be picked").toEqual([]);
  await click(app, 600, 425);
  expect(await selection(app)).toEqual([rect.id]);

  // the Layers panel: the sheet is a row holding the rectangle, with a clip button
  await p.locator("[data-layers]").click();
  await expect(p.locator(".layers-panel [data-clip]")).toHaveCount(1);
  await p.locator(".layers-panel [data-clip]").click();
  await app.frame();
  await click(app, 150, 650);
  expect((await objs(app)).find((o) => o.id === sheet.id)!.container).toEqual({ clip: false });
  expect(await px(app, 800, 425), "no longer cut").toEqual(blue);
  await key(app, "Control+z");
  await app.frame();
  expect(await px(app, 800, 425)).not.toEqual(blue);
});

test("moving onto and off a sheet changes what holds it; Ctrl+Alt+G puts picked objects on a new sheet and Release takes it away; a sheet moves with what is on it", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  const sheet = (await objs(app)).at(-1)!;
  await key(app, "u");
  await drag(app, [800, 300], [900, 400]);
  const a = (await objs(app)).at(-1)!;
  expect(a.parent).toBeUndefined();
  await key(app, "v");
  await click(app, 850, 350);
  await drag(app, [850, 350], [550, 400]); // let go on the sheet
  expect((await objs(app)).find((o) => o.id === a.id)!.parent).toBe(sheet.id);
  await drag(app, [550, 400], [850, 350]); // and off it again
  expect((await objs(app)).find((o) => o.id === a.id)!.parent).toBeUndefined();

  // a sheet around the picked object
  const n0 = (await objs(app)).length;
  await click(app, 850, 350);
  await key(app, "Control+Alt+g");
  const all = await objs(app);
  expect(all.length).toBe(n0 + 1);
  const made = all.find((o) => o.container && o.id !== sheet.id)!;
  expect(made.name).toBe("Sheet 2");
  expect(all.find((o) => o.id === a.id)!.parent).toBe(made.id);
  // releasing (the new sheet and what is on it are picked) keeps the object and takes the sheet away
  expect(await selection(app)).toContain(made.id);
  await p.locator('[data-ctx="unsheet"]').click();
  const after = await objs(app);
  expect(after.length).toBe(n0);
  expect(after.find((o) => o.id === a.id)!.parent).toBeUndefined();
});

test("the name above a sheet picks it with what is on it, and dragging the name moves them together", async ({ app }) => {
  const p = app.page;
  const top = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box.minY;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  const sheet = (await objs(app)).at(-1)!;
  await key(app, "u");
  await drag(app, [450, 350], [550, 450]);
  const inner = (await objs(app)).at(-1)!;
  await key(app, "v");
  await click(app, 150, 650);
  const [s0, i0] = [await top(sheet.id), await top(inner.id)];
  await drag(app, [410, 291], [410, 341]); // on the name, which sits just above the top-left corner
  expect((await selection(app)).sort()).toEqual([sheet.id, inner.id].sort());
  expect((await top(sheet.id)) - s0).toBeCloseTo(50, 0);
  expect((await top(inner.id)) - i0).toBeCloseTo(50, 0);
});

test("resizing a sheet moves and stretches what is on it by its pin; Fit to contents takes the sheet in to what is on it", async ({ app }) => {
  const p = app.page;
  const box = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  const sheet = (await objs(app)).at(-1)!;
  await key(app, "u");
  await drag(app, [420, 350], [480, 450]); // B: keeps its left (the default pin)
  const b = (await objs(app)).at(-1)!;
  await drag(app, [610, 350], [670, 450]); // A: pinned to the right
  const a = (await objs(app)).at(-1)!;
  await key(app, "v");
  await click(app, 640, 400);
  await expect(p.locator("[data-pin-wrap]")).toBeVisible();
  await p.locator("[data-pin-h]").selectOption("right");
  expect((await objs(app)).find((o) => o.id === a.id)).toMatchObject({ constraint: { h: "right", v: "top" } });
  await click(app, 150, 650);

  const [a0, b0] = [await box(a.id), await box(b.id)];
  await click(app, 410, 291); // the sheet's name picks the sheet with what is on it
  await drag(app, [700, 400], [800, 400]); // its right side handle, 100 px out
  const sh = await box(sheet.id);
  expect(sh.maxX - sh.minX).toBeCloseTo(400, 0);
  expect((await box(b.id)).minX - b0.minX, "B stays by the left edge").toBeCloseTo(0, 0);
  expect((await box(a.id)).minX - a0.minX, "A follows the right edge").toBeCloseTo(100, 0);
  expect((await box(a.id)).maxX - (await box(a.id)).minX, "and keeps its size").toBeCloseTo(a0.maxX - a0.minX, 0);
  await key(app, "Control+z");
  expect((await box(a.id)).minX - a0.minX).toBeCloseTo(0, 0);

  // both: A stretches with the sheet
  await click(app, 640, 400);
  await p.locator("[data-pin-h]").selectOption("both");
  await click(app, 410, 291);
  await drag(app, [700, 400], [800, 400]);
  const stretched = (await box(a.id)).maxX - (await box(a.id)).minX;
  expect(Math.abs(stretched - (a0.maxX - a0.minX + 100)), "A stretched by about 100 (its outline is not stretched)").toBeLessThan(4);

  // fit: the sheet shrinks to what is on it
  await click(app, 410, 291);
  await p.locator('[data-ctx=\"fitsheet\"]').click();
  await app.frame();
  const fit = await box(sheet.id);
  const [ba, bb] = [await box(a.id), await box(b.id)];
  expect(fit.minX).toBeCloseTo(Math.min(ba.minX, bb.minX), 0);
  expect(fit.maxX).toBeCloseTo(Math.max(ba.maxX, bb.maxX), 0);
});

test("Attach: the picked objects follow the object clicked next when it moves; Detach lets them go (ADR 0109)", async ({ app }) => {
  const p = app.page;
  const left = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box.minX;
  await key(app, "u");
  await drag(app, [400, 300], [480, 380]);
  const a = (await objs(app)).at(-1)!;
  await drag(app, [600, 300], [680, 380]);
  const b = (await objs(app)).at(-1)!;
  await key(app, "v");
  await click(app, 440, 340); // A
  await p.locator('[data-ctx=\"attach\"]').click();
  await expect(p.getByText("Click the object to attach", { exact: false })).toBeVisible();
  await click(app, 640, 340); // B is the target
  expect((await objs(app)).find((o) => o.id === a.id)).toMatchObject({ attachmentTargetId: b.id });
  await click(app, 150, 650);
  const [a0, b0] = [await left(a.id), await left(b.id)];
  await click(app, 640, 340);
  expect((await selection(app)).sort(), "picking the target picks what follows it").toEqual([a.id, b.id].sort());
  await drag(app, [640, 340], [700, 440]);
  expect((await left(b.id)) - b0).toBeCloseTo(60, 0);
  expect((await left(a.id)) - a0, "A went along").toBeCloseTo(60, 0);
  await key(app, "Control+z");
  // detach: A alone, then moving B leaves it
  await click(app, 150, 650);
  await click(app, 440, 340);
  await p.locator('[data-ctx=\"detach\"]').click();
  expect(((await objs(app)).find((o) => o.id === a.id) as unknown as { attachmentTargetId: string | null }).attachmentTargetId).toBeNull();
  await click(app, 150, 650);
  await click(app, 640, 340);
  expect(await selection(app)).toEqual([b.id]);
});

test("a picked sheet shows its size in px, in, mm and cm; typing another size changes only the sheet (what is on it keeps its size), in one undo step (ADR 0121)", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  await key(app, "u");
  await drag(app, [420, 320], [500, 380]);
  const rect = (await objs(app)).at(-1)!;
  await key(app, "v");
  await click(app, 600, 450); // the sheet (not the rectangle)
  const w = p.locator("[data-sheet-w]"), h = p.locator("[data-sheet-h]"), unit = p.locator("[data-sheet-unit]");
  await expect(w).toBeVisible();
  const w0 = Number(await w.inputValue());
  expect(w0).toBeGreaterThan(0);
  await unit.selectOption({ label: "in" });
  expect(Number(await w.inputValue())).toBeCloseTo(w0 / 96, 2);
  await unit.selectOption({ label: "px" });
  await w.fill(String(w0 * 2));
  await w.blur();
  await app.frame();
  expect(Number(await w.inputValue())).toBeCloseTo(w0 * 2, 0);
  const boxes = await p.evaluate(() => window.__canvastDebug.objects()) as unknown as Array<{ id: string; kind: string }>;
  expect(boxes.length, "nothing was added or lost").toBe(2);
  const kept = (await objs(app)).find((o) => o.id === rect.id)!;
  expect(JSON.stringify(kept), "what is on the sheet keeps its place and size").toBe(JSON.stringify(rect));
  await key(app, "Control+z");
  await app.frame();
  expect(Number(await w.inputValue())).toBeCloseTo(w0, 0);
  expect(app.consoleErrors).toEqual([]);
});

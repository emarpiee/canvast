import fs from "node:fs";
import { alignWith, exportWith, expect, sheetWith, test } from "./harness";
import type { App } from "./harness";

/**
 * Sheets (ADR 0108): fixed areas of the canvas that hold what is drawn or moved onto them and cut it at their edge. Real mouse and
 * keyboard input; assertions read the stored objects and the painted pixels.
 */
type Obj = { id: string; kind: string; parent?: string; name?: string; container?: { clip: boolean; scale?: boolean }; fill: unknown; stroke: unknown };
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
/** The sheet at (400, 300) is picked by its name above its corner: the empty body of a sheet with things on it is ground, not the sheet. */
const pickSheet = async (app: App) => {
  await expect.poll(() => app.page.evaluate(() => window.__canvastDebug.itemLabels().length)).toBeGreaterThan(0);
  await click(app, 410, 291);
};
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
  await sheetWith(p, "unsheet");
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
  await pickSheet(app); // the sheet's name picks the sheet with what is on it
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
  await pickSheet(app);
  await drag(app, [700, 400], [800, 400]);
  const stretched = (await box(a.id)).maxX - (await box(a.id)).minX;
  expect(Math.abs(stretched - (a0.maxX - a0.minX + 100)), "A stretched by about 100 (its outline is not stretched)").toBeLessThan(4);

  // fit: the sheet shrinks to what is on it
  await pickSheet(app);
  await sheetWith(p, "fitsheet");
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

test("a sheet has a shape, not a size: the Ratio field shows it (3 : 2), typing 16:9 or A4 portrait, a preset or Turn changes only the sheet, keeping its area, in one undo step (ADR 0147)", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  await key(app, "u");
  await drag(app, [420, 320], [500, 380]);
  const [sheet, rect] = (await objs(app)).slice(-2) as [Obj, Obj];
  await key(app, "v");
  await pickSheet(app); // the sheet (not the rectangle)
  const ratio = p.locator("[data-sheet-ratio]");
  await expect(ratio).toBeVisible();
  await expect(ratio).toHaveValue("3 : 2");
  const sb = async () => (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), sheet.id))!.box;
  const shape = async () => { const b = await sb(); return { r: (b.maxX - b.minX) / (b.maxY - b.minY), area: (b.maxX - b.minX) * (b.maxY - b.minY) }; };
  const a0 = (await shape()).area;
  await ratio.fill("16:9");
  await ratio.press("Enter");
  await app.frame();
  await expect(ratio).toHaveValue("16 : 9");
  const s1 = await shape();
  expect(s1.r).toBeCloseTo(16 / 9, 1);
  expect(Math.abs(s1.area / a0 - 1), "the area is kept").toBeLessThan(0.02);
  expect((await objs(app)).length, "nothing was added or lost").toBe(2);
  expect(JSON.stringify((await objs(app)).find((o) => o.id === rect.id)), "what is on the sheet keeps its place and size").toBe(JSON.stringify(rect));
  await key(app, "Control+z");
  await app.frame();
  await expect(ratio).toHaveValue("3 : 2");
  // words work too, with the way up
  await ratio.fill("A4 portrait");
  await ratio.press("Enter");
  await app.frame();
  await expect(ratio).toHaveValue("1 : 1.414");
  // Turn: the same area on its side; a preset on a sheet that is upright stays upright
  await p.locator("[data-sheet-turn]").click();
  await app.frame();
  await expect(ratio).toHaveValue("1.414 : 1");
  await p.locator("[data-sheet-turn]").click();
  await p.locator("[data-sheet-preset]").selectOption({ label: "Video 16 : 9" });
  await app.frame();
  await expect(ratio).toHaveValue("9 : 16");
  expect(await p.locator("[data-sheet-preset]").inputValue()).toBe(""); // (ready for the next pick)
  // not a shape: the field goes back and says so
  await ratio.fill("nonsense");
  await ratio.press("Enter");
  await expect(p.getByTestId("toast")).toContainText("is not a shape");
  await expect(ratio).toHaveValue("9 : 16");
  expect(app.consoleErrors).toEqual([]);
});

test("Scale contents makes what is on a sheet grow with it, whatever its pins say, by the ratio and by the handles, and belongs to its sheet (ADR 0133)", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  await key(app, "u");
  await drag(app, [420, 320], [500, 380]);
  const rect = (await objs(app)).at(-1)!;
  await key(app, "v");
  await pickSheet(app);
  const ratio = p.locator("[data-sheet-ratio]");
  await expect(ratio).toBeVisible();
  const width = async () => {
    const b = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), rect.id))!.box;
    return b.maxX - b.minX;
  };
  const w0 = await width();
  // without it, a new shape leaves what is on the sheet as it is
  await ratio.fill("3:1");
  await ratio.press("Enter");
  await app.frame();
  expect(await width()).toBeCloseTo(w0, 1);
  await key(app, "Control+z");
  await app.frame();
  // Scale contents: the same change grows what is on the sheet in the same proportion (3 : 1 at the same area: 1.414 times as wide)
  await p.locator("[data-sheet-scale]").click();
  await expect(p.locator("[data-sheet-scale]")).toHaveAttribute("aria-pressed", "true");
  expect((await objs(app)).find((o) => o.container)!.container, "kept with the sheet").toEqual({ clip: true, scale: true });
  await ratio.fill("3:1");
  await ratio.press("Enter");
  await app.frame();
  expect(Math.abs((await width()) - w0 * Math.SQRT2)).toBeLessThan(3); // (the outline of the shape keeps its own width)
  await key(app, "Control+z");
  await app.frame();
  expect(await width()).toBeCloseTo(w0, 1);
  // the same with the resize handle: dragging the right edge out by a third grows what is on the sheet by a third (Scale contents is still on)
  await drag(app, [700, 400], [800, 400]);
  await app.frame();
  expect(Math.abs((await width()) - (w0 * 4) / 3)).toBeLessThan(3);
  // it belongs to this sheet: another sheet starts without it, and the button shows the state of the sheet that is picked
  await key(app, "c");
  await drag(app, [900, 100], [1000, 160]);
  await key(app, "v");
  await expect(p.locator("[data-sheet-scale]")).toHaveAttribute("aria-pressed", "false");
  expect((await objs(app)).filter((o) => o.container).map((o) => o.container!.scale)).toEqual([true, undefined]);
  expect(app.consoleErrors).toEqual([]);
});

test("a sheet resized with its handle takes what is on it along when deep in a zoom, where near objects are filed in different frames (Scale contents)", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 16, zf: 0, pz: 16 }));
  await app.frame();
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  await key(app, "u");
  await drag(app, [420, 320], [500, 380]);
  const rect = (await objs(app)).at(-1)!;
  await key(app, "v");
  await pickSheet(app);
  await p.locator("[data-sheet-scale]").click();
  const width = async () => {
    const b = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), rect.id))!.box;
    return b.maxX - b.minX;
  };
  const w0 = await width();
  await drag(app, [700, 400], [800, 400]);
  expect(Math.abs((await width()) - (w0 * 4) / 3)).toBeLessThan(3);
  await key(app, "Control+z");
  await app.frame();
  expect(await width()).toBeCloseTo(w0, 1);
  // the shape and the place on the sheet are the same at any depth: a ratio, and per cent of the sheet
  const box = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
  const sheet = (await objs(app)).at(-2)!;
  await expect(p.locator("[data-sheet-ratio]")).toHaveValue("3 : 2");
  await click(app, 450, 350);
  const x = p.locator("[data-on-x]");
  const sbox = await box(sheet.id);
  expect(Number(await x.inputValue()), "where it is, per cent of the sheet's width").toBeCloseTo((((await box(rect.id)).minX - sbox.minX) / (sbox.maxX - sbox.minX)) * 100, 0);
  const x0 = (await box(rect.id)).minX;
  const label = (await x.boundingBox())!; // (the field scrubs; its name is only a label)
  await p.mouse.move(label.x + 4, label.y + label.height / 2);
  await p.mouse.down();
  await p.mouse.move(label.x + 44, label.y + label.height / 2, { steps: 8 });
  await p.mouse.up();
  await app.frame();
  expect((await box(rect.id)).minX - x0, "40 dragged px move it 4 per cent of the sheet's 300 px").toBeGreaterThan(9);
  expect((await box(rect.id)).minX - x0).toBeLessThan(15);
  expect(app.consoleErrors).toEqual([]);
});

test("objects filed in different frames (one drawn deep in a zoom, one at home) can be put on one sheet, and the sheet can be fitted to them", async ({ app }) => {
  const p = app.page;
  await key(app, "u");
  await drag(app, [400, 300], [500, 380]); // at home
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "3p-5", cy: "1p-5", zi: 20, zf: 0, pz: 20 }));
  await app.frame();
  await drag(app, [400, 300], [500, 380]); // deep: another size, another frame
  await key(app, "v");
  await key(app, "Control+a");
  await key(app, "Control+Alt+g");
  await app.frame();
  const all = await objs(app);
  const sheet = all.find((o) => o.container);
  expect(sheet, "a sheet was made, not a message about spaces").toBeDefined();
  expect(all.filter((o) => o.parent === sheet!.id)).toHaveLength(2);
  expect(app.consoleErrors).toEqual([]);
});

test("an object on a sheet shows where it is from the sheet's corner, and X, Y, W and H change it, in per cent of the sheet (ADR 0147)", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [400, 300], [800, 560]);
  const sheet = (await objs(app)).at(-1)!;
  await key(app, "u");
  await drag(app, [440, 340], [540, 400]);
  const rect = (await objs(app)).at(-1)!;
  await key(app, "v");
  await click(app, 490, 370);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([rect.id]);
  const box = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
  const [sb, rb] = [await box(sheet.id), await box(rect.id)];
  const x = p.locator("[data-on-x]"), y = p.locator("[data-on-y]"), w = p.locator("[data-on-w]"), h = p.locator("[data-on-h]");
  await expect(x).toBeVisible();
  const [sw, sh] = [sb.maxX - sb.minX, sb.maxY - sb.minY];
  // the fields are per cent of the sheet: where it is from the corner, and how big
  expect(Number(await x.inputValue())).toBeCloseTo(((rb.minX - sb.minX) / sw) * 100, 0);
  expect(Number(await y.inputValue())).toBeCloseTo(((rb.minY - sb.minY) / sh) * 100, 0);
  expect(Number(await w.inputValue())).toBeCloseTo(((rb.maxX - rb.minX) / sw) * 100, 0);
  // X moves it (one undo step), W resizes it about its corner
  await x.fill("25");
  await x.press("Enter");
  await app.frame();
  expect(((await box(rect.id)).minX - sb.minX) / sw).toBeCloseTo(0.25, 2);
  expect((await box(rect.id)).minY).toBeCloseTo(rb.minY, 0);
  await w.fill("40");
  await w.press("Enter");
  await w.blur();
  await app.frame();
  const after = await box(rect.id);
  expect(Math.abs((after.maxX - after.minX) / sw - 0.4)).toBeLessThan(0.01); // (the box includes the outline)
  expect((after.minX - sb.minX) / sw).toBeCloseTo(0.25, 2);
  await key(app, "Control+z");
  await key(app, "Control+z");
  await app.frame();
  expect((await box(rect.id)).minX).toBeCloseTo(rb.minX, 0);
  // the fields X, Y, W and H scrub like the other numbers: drag the field to the right and the field grows (and the object moves)
  const x0 = Number(await x.inputValue());
  const label = (await x.locator("xpath=..").boundingBox())!;
  await p.mouse.move(label.x + 4, label.y + label.height / 2);
  await p.mouse.down();
  await p.mouse.move(label.x + 44, label.y + label.height / 2, { steps: 8 });
  await p.mouse.up();
  await app.frame();
  expect(Number(await x.inputValue())).toBeGreaterThan(x0 + 2);
  expect(((await box(rect.id)).minX - sb.minX) / sw * 100).toBeCloseTo(Number(await x.inputValue()), 0);
  await key(app, "Control+z");
  await app.frame();
  // a sheet itself, or an object that is on none, has no such fields
  await click(app, 700, 520);
  await expect(x).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

test("Export…: a sheet's shape becomes a size here (px, in, cm, mm at a resolution), the sides follow the ratio, and the file is exactly that size (ADR 0147)", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  await key(app, "u");
  await drag(app, [420, 320], [500, 380]);
  await key(app, "v");
  await pickSheet(app);
  await p.locator("[data-sheet-export]").click();
  const dlg = p.getByTestId("export-dialog");
  await expect(dlg).toBeVisible();
  await expect(p.getByTestId("export-shape")).toContainText("3 : 2");
  const w = dlg.locator('[data-ex="w"]'), h = dlg.locator('[data-ex="h"]');
  // it begins at the first size the shape is made for; typing one side makes the other follow the ratio
  await expect(w).toHaveValue("1800"); // (3 : 2 is the shape of a 4 × 6 in photo: that size is first)
  await expect(h).toHaveValue("1200");
  await w.fill("900");
  await expect(h).toHaveValue("600");
  await h.fill("400");
  await expect(w).toHaveValue("600");
  // inches at 300 ppi: 600 px is 2 in; typing 5 in gives 1500 px, and the other side follows
  await dlg.locator('[data-unit="in"]').click();
  await expect(w).toHaveValue("2");
  await w.fill("5");
  await expect(h).toHaveValue("3.33");
  await expect(dlg.locator("[data-ex-readout]")).toContainText("1500 × 1000 px");
  await expect(dlg.locator("[data-ex-readout]")).toContainText("12.7 × 8.5 cm");
  // a resolution change keeps 5 in and changes the pixels
  await dlg.locator('[data-ex="dpi"]').selectOption("150");
  await expect(dlg.locator("[data-ex-readout]")).toContainText("750 × 500 px");
  // a size chip takes its pixels (and its resolution)
  await dlg.locator("[data-chip]", { hasText: "1080 px wide" }).click();
  await dlg.locator('[data-unit="px"]').click();
  await expect(w).toHaveValue("1080");
  await expect(h).toHaveValue("720");
  // the file is exactly that size
  const [download] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
  expect(download.suggestedFilename()).toMatch(/^sheet_\d+-1080x720\.png$/);
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.readUInt32BE(16), "the width in the PNG header").toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(720);
  const phys = bytes.indexOf("pHYs");
  expect(phys, "the resolution is written in the file").toBeGreaterThan(0);
  expect(bytes.readUInt32BE(phys + 4), "150 ppi in pixels per metre").toBe(5906);
  // and it is the sheet: the rectangle where it is on it (a fifth across, a quarter down), the rest of the sheet white
  const at = await p.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" })); // (no fetch: the page may not make requests)
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext("2d")!;
    x.drawImage(bmp, 0, 0);
    return { rect: [...x.getImageData(216, 180, 1, 1).data], blank: [...x.getImageData(900, 600, 1, 1).data] };
  }, bytes.toString("base64"));
  expect(at.rect[2]!, "blue where the rectangle is").toBeGreaterThan(at.rect[0]! + 60);
  expect(at.blank.slice(0, 3), "white elsewhere on the sheet").toEqual([255, 255, 255]);
  await expect(dlg.locator("[data-ex-note]")).toContainText("1080 × 720 px");
  // SVG is there when everything is vector, sized in the unit chosen
  await dlg.locator('[data-format="svg"]').click();
  await dlg.locator('[data-unit="in"]').click();
  const [svgDownload] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
  const svg = fs.readFileSync(await svgDownload.path(), "utf8");
  expect(svg, "1080 × 720 px at 150 ppi is 7.2 × 4.8 in").toContain('width="7.2in" height="4.8in"');
  await key(app, "Escape");
  await expect(dlg).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

test("Export… of picked shapes uses their box (with the outline) as the shape, and of a sheet deep in a zoom is as sharp and as right as at home", async ({ app }) => {
  const p = app.page;
  const dlg = p.getByTestId("export-dialog");
  const px = async (x: number, y: number, bytes: Buffer) =>
    p.evaluate(async ([b64, a, b]) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      return [...g.getImageData(a as number, b as number, 1, 1).data];
    }, [bytes.toString("base64"), x, y] as const);
  const exportPng = async (): Promise<Buffer> => {
    const [d] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
    return fs.readFileSync(await d.path());
  };
  // shapes: a 200 × 100 rectangle (2 : 1 and a bit for its outline) offers SVG, and the file has no sheet or canvas around it
  await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: 20, zf: 0, pz: 20 }));
  await app.frame();
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  await key(app, "u");
  await drag(app, [420, 320], [500, 380]);
  await key(app, "v");
  await pickSheet(app);
  await p.locator("[data-sheet-export]").click();
  await expect(p.getByTestId("export-shape")).toContainText("3 : 2");
  await dlg.locator('[data-ex="w"]').fill("1200");
  const deep = await exportPng();
  expect(deep.readUInt32BE(16)).toBe(1200);
  expect(deep.readUInt32BE(20)).toBe(800);
  expect((await px(240, 200, deep)).slice(0, 3), "the rectangle, a fifth across and a quarter down").not.toEqual([255, 255, 255]);
  expect((await px(1000, 700, deep)).slice(0, 3)).toEqual([255, 255, 255]);
  await key(app, "Escape");
  // the rectangle alone: its own box, SVG offered
  await click(app, 450, 350);
  await exportWith(p, "exportpic");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-format="svg"]')).toBeVisible();
  const shape = await p.getByTestId("export-shape").innerText();
  expect(shape).toMatch(/Shape \d/);
  // the same shape as a PDF is drawn by its paths, not a picture of them (ADR 0153); a WebP carries its resolution (EXIF)
  await dlg.locator('[data-format="pdf"]').click();
  const pdf = (await exportPng()).toString("latin1");
  expect(pdf.startsWith("%PDF-1.4")).toBe(true);
  expect(pdf, "paths, no picture").toContain(" cm");
  expect(pdf).toMatch(/ c\n|\d l\n/);
  expect(pdf).not.toContain("/Subtype /Image");
  await dlg.locator('[data-format="webp"]').click();
  const webp = (await exportPng()).toString("latin1");
  expect(webp.slice(0, 4) + webp.slice(8, 16)).toBe("RIFFWEBPVP8X");
  expect(webp).toContain("EXIF");
  await key(app, "Escape");
  expect(app.consoleErrors).toEqual([]);
});

test("Alt+drag of a picked thing on a sheet drags a copy (the sheet under it is not picked instead); a click with Alt goes on to what is under it", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  const sheet = (await objs(app)).at(-1)!;
  await key(app, "u");
  await drag(app, [420, 320], [500, 380]);
  const rect = (await objs(app)).at(-1)!;
  await key(app, "v");
  await click(app, 460, 350);
  expect(await selection(app)).toEqual([rect.id]);
  const box = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
  const r0 = await box(rect.id);
  await p.keyboard.down("Alt");
  await p.mouse.move(460, 350);
  await p.mouse.down();
  await p.mouse.move(560, 440, { steps: 8 });
  await p.mouse.up();
  await p.keyboard.up("Alt");
  await app.frame();
  const all = await objs(app);
  expect(all, "a copy was made").toHaveLength(3);
  const copy = all.find((o) => o.id !== sheet.id && o.id !== rect.id)!;
  expect((await box(rect.id)).minX, "the original stays").toBeCloseTo(r0.minX, 0);
  expect((await box(copy.id)).minX - r0.minX, "the copy moved with the drag").toBeCloseTo(100, 0);
  expect(await selection(app)).toEqual([copy.id]);
  // a click with Alt that does not move picks what is under the pointer
  await pickSheet(app);
  await p.keyboard.down("Alt");
  await p.mouse.click(540, 400);
  await p.keyboard.up("Alt");
  await app.frame();
  expect(await selection(app), "the copy was picked; Alt+click goes down to the sheet under it").not.toEqual([rect.id]);
  expect(app.consoleErrors).toEqual([]);
});

test("one thing on a sheet is aligned with its sheet (its parent), by the align buttons", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  const sheet = (await objs(app)).at(-1)!;
  await key(app, "u");
  await drag(app, [420, 320], [500, 380]);
  const rect = (await objs(app)).at(-1)!;
  await key(app, "v");
  await click(app, 150, 650);
  await click(app, 460, 350);
  expect(await selection(app)).toEqual([rect.id]);
  const box = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
  const r0 = await box(rect.id);
  await alignWith(p, "align:centre");
  await app.frame();
  const [s, r] = [await box(sheet.id), await box(rect.id)];
  expect((r.minX + r.maxX) / 2, "centred across the sheet").toBeCloseTo((s.minX + s.maxX) / 2, 0);
  expect(r.minY, "and not moved up or down").toBeCloseTo(r0.minY, 0);
  await alignWith(p, "align:right");
  await app.frame();
  expect((await box(rect.id)).maxX, "the right edge on the sheet's").toBeCloseTo(s.maxX, 0);
  await key(app, "Control+z");
  await key(app, "Control+z");
  await app.frame();
  expect((await box(rect.id)).minX, "two undos: where it was").toBeCloseTo(r0.minX, 0);
  expect(app.consoleErrors).toEqual([]);
});

test("Export… of several sheets: each at the width chosen with its own shape, together as a ZIP or as the pages of one PDF", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [420, 300], [720, 500]); // 3 : 2
  await key(app, "c");
  await drag(app, [800, 300], [1000, 700]); // 1 : 2
  await key(app, "v");
  await key(app, "Control+a");
  await exportWith(p, "exportpic");
  const dlg = p.getByTestId("export-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator(".ex-what")).toHaveText("2 sheets");
  await expect(dlg.locator('[data-ex="h"]')).toBeHidden(); // (each sheet has its own height)
  await dlg.locator('[data-ex="w"]').fill("600");
  await expect(dlg.locator("[data-ex-readout]")).toContainText("600 × 400 px");
  await expect(dlg.locator("[data-ex-readout]")).toContainText("600 × 1200 px");
  const [zip] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
  expect(zip.suggestedFilename()).toMatch(/\.zip$/);
  const z = fs.readFileSync(await zip.path());
  const names = [...z.toString("latin1").matchAll(/(\d-sheet_\d+-\d+x\d+\.png)/g)].map((m) => m[1]);
  expect(new Set(names).size, "a file for each sheet, named with its size").toBe(2);
  expect(names.some((n) => n!.endsWith("600x400.png")) && names.some((n) => n!.endsWith("600x1200.png"))).toBe(true);
  // the same sheets as one PDF: a page each, at the physical size (600 px at 300 ppi is 2 in = 144 pt)
  await dlg.locator('[data-format="pdf"]').click();
  await expect(dlg.locator('[data-ex="copy"]')).toBeDisabled();
  // the pages follow the order shown: the first sheet moved later goes second
  await dlg.locator('[data-mini="0"] [data-move="1"]').click();
  await expect(dlg.locator('[data-mini="1"] .ex-page')).toHaveText("2");
  // and a picture can be dragged to where it should go: back to the front
  await dlg.locator('[data-mini="1"]').dragTo(dlg.locator('[data-mini="0"]'));
  await dlg.locator('[data-mini="0"] [data-move="1"]').click(); // (one more later again, so the PDF below is the other way round)
  const [pdf] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const text = fs.readFileSync(await pdf.path()).toString("latin1");
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text).toContain("/Count 2");
  expect(text).toContain("/MediaBox [0 0 144 96]");
  expect(text).toContain("/MediaBox [0 0 144 288]");
  expect(text.indexOf("/MediaBox [0 0 144 288]"), "the tall sheet is now the first page").toBeLessThan(text.indexOf("/MediaBox [0 0 144 96]"));
  await key(app, "Escape");
  expect(app.consoleErrors).toEqual([]);
});

test("Ctrl+click on the empty body of a sheet picks the sheet alone (not what is on it), and moving it carries what is on it", async ({ app }) => {
  const p = app.page;
  await key(app, "c");
  await drag(app, [400, 300], [700, 500]);
  const sheet = (await objs(app)).at(-1)!;
  await key(app, "u");
  await drag(app, [420, 320], [500, 380]);
  const rect = (await objs(app)).at(-1)!;
  await key(app, "v");
  await click(app, 150, 650);
  await p.keyboard.down("Control");
  await p.mouse.click(600, 450);
  await p.keyboard.up("Control");
  expect(await selection(app), "the sheet, and only it").toEqual([sheet.id]);
  const box = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
  const r0 = await box(rect.id);
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.itemLabels().length)).toBeGreaterThan(0);
  await drag(app, [412, 291], [512, 291]); // by its name
  expect((await box(rect.id)).minX - r0.minX, "what is on it went with it").toBeCloseTo(100, 0);
  expect(app.consoleErrors).toEqual([]);
});

test("Export… of many sheets lists every one of them for ordering, each with a small preview drawn when it is on screen", async ({ app }) => {
  const p = app.page;
  // 26 small sheets: more than get a drawn preview
  await key(app, "c");
  for (let i = 0; i < 26; i++) await drag(app, [420 + (i % 13) * 50, 300 + Math.floor(i / 13) * 120], [450 + (i % 13) * 50, 380 + Math.floor(i / 13) * 120]);
  await key(app, "v");
  await key(app, "Control+a");
  await exportWith(p, "exportpic");
  const dlg = p.getByTestId("export-dialog");
  await expect(dlg.locator("[data-mini]")).toHaveCount(26);
  await expect(dlg.locator("[data-ex-thumb]"), "a picture for every one").toHaveCount(26);
  await expect(dlg.locator('[data-mini="0"] [data-ex-thumb][data-ready]')).toHaveCount(1); // (those on screen are drawn first)
  const last = dlg.locator('[data-mini="25"]');
  await expect(last.locator("[data-ex-thumb][data-ready]"), "not drawn until it is on screen").toHaveCount(0);
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator("[data-ex-thumb][data-ready]"), "drawn when it scrolls into view").toHaveCount(1);
  await last.locator('[data-move="-1"]').click(); // the last one moves earlier: it can be reached and moved
  await expect(dlg.locator('[data-mini="24"] .ex-page')).toHaveText("25");
  await key(app, "Escape");
  expect(app.consoleErrors).toEqual([]);
});

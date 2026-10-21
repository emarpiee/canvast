import { readFile } from "node:fs/promises";
import { expect, setPenColour, test } from "./harness";
import type { Page } from "@playwright/test";

/**
 * The Painting view (ADR 0164, 0165): real mouse and keyboard input on the page; assertions read the layers' own pixels (what the
 * engine painted and what is stored) and, where it matters, the pixels on screen.
 */
type State = NonNullable<Awaited<ReturnType<Window["__canvastDebug"]["paint"]["state"]>>>;
const state = (p: Page): Promise<State> => p.evaluate(() => window.__canvastDebug.paint.state()!);
const settled = (p: Page): Promise<void> => p.evaluate(() => window.__canvastDebug.paint.settled());
const px = (p: Page, layer: string, x: number, y: number) => p.evaluate(([l, a, b]) => window.__canvastDebug.paint.layerPixel(l as string, a as number, b as number), [layer, x, y] as const);
const at = (p: Page, x: number, y: number) => p.evaluate(([a, b]) => window.__canvastDebug.paint.screenOf(a!, b!)!, [x, y]);
/** The view's own pixel (r, g, b, a) over page px (x, y). */
const screenPx = async (p: Page, x: number, y: number): Promise<number[]> => {
  const s = await at(p, x, y);
  return p.evaluate(([sx, sy]) => {
    const c = document.querySelector<HTMLCanvasElement>(".paint-canvas")!;
    const r = c.getBoundingClientRect();
    return [...c.getContext("2d")!.getImageData(Math.round((sx! - r.left) * devicePixelRatio), Math.round((sy! - r.top) * devicePixelRatio), 1, 1).data];
  }, [s.x, s.y]);
};
/** A stroke from page px a to page px b (real mouse input), then wait for it to be made and stored. */
async function stroke(p: Page, a: [number, number], b: [number, number]): Promise<void> {
  const s = await at(p, ...a), e = await at(p, ...b);
  await p.mouse.move(s.x, s.y);
  await p.mouse.down();
  await p.mouse.move(e.x, e.y, { steps: 16 });
  await p.mouse.up();
  await settled(p);
}
async function newPainting(p: Page, fill?: (p: Page) => Promise<void>): Promise<State> {
  await p.getByTestId("view-paint").click();
  await p.getByTestId("paint-new").click();
  await fill?.(p);
  await p.getByTestId("page-dialog-ok").click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.paint.state()?.layers.length ?? 0)).toBe(1);
  return state(p);
}
/** The paint colour is the Properties bar's colour, as on the canvas (ADR 0168). */
const setColour = setPenColour;
/** A choice of the painting's menu (the pill beside the view tabs). */
const fromPaintingMenu = async (p: Page, id: string): Promise<void> => {
  await p.getByTestId("painting-menu").click();
  await p.locator(`.pop-menu [data-id="${id}"]`).click();
};
const row = (p: Page, name: string) => p.locator(".paint-layer", { hasText: name });

test("a new painting is a page in px with a layer; a stroke paints the layer and the screen, undoes and redoes in one step, and survives a reload", async ({ app }) => {
  const p = app.page;
  const s0 = await newPainting(p);
  expect(s0.pages).toEqual([expect.objectContaining({ w: 1920, h: 1080, bg: "#ffffff" })]);
  const id = s0.layers[0]!.id;
  await stroke(p, [400, 500], [1500, 500]);
  expect((await px(p, id, 950, 500))![3], "painted under the stroke").toBe(255);
  expect((await px(p, id, 950, 900))![3], "and nowhere else").toBe(0);
  expect((await screenPx(p, 950, 500)).slice(0, 3), "the view shows it").toEqual([31, 35, 41]);
  expect((await state(p)).layers[0]!.tiles).toBeGreaterThan(0);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await px(p, id, 950, 500))![3]).toBe(0);
  await p.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await px(p, id, 950, 500))![3]).toBe(255);
  await settled(p);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  // (a reload opens the Paint view again, on its list)
  const list = await p.evaluate(() => window.__canvastDebug.paint.list());
  expect(list.map((x) => x.name)).toEqual(["Painting 1"]);
  await p.evaluate((i) => window.__canvastDebug.paint.open(i), list[0]!.id);
  await expect.poll(async () => (await px(p, id, 950, 500))?.[3] ?? -1, { message: "the paint is still there after a reload" }).toBe(255);
  expect(app.consoleErrors).toEqual([]);
});

test("a layer clipped to the one below shows only where that one has paint; alpha lock colours only paint; the Eraser takes paint away", async ({ app }) => {
  const p = app.page;
  const s = await newPainting(p);
  const base = s.layers[0]!.id;
  await setColour(p, "#dd2222");
  await stroke(p, [200, 500], [1700, 500]); // red line across, on Layer 1
  await p.locator('[data-paint-layers] [data-act="new-layer"]').click();
  await p.locator('.pop-menu [data-id="paint"]').click();
  await expect.poll(async () => (await state(p)).layers.length).toBe(2);
  const top = (await state(p)).activeId!;
  await row(p, "Layer 2").locator("[data-clip]").click();
  await setColour(p, "#2222dd");
  await stroke(p, [950, 100], [950, 950]); // blue line down, on Layer 2, clipped to the red one
  expect((await px(p, top, 950, 200))![3], "the clipped layer keeps its whole stroke").toBe(255);
  const both = await screenPx(p, 950, 500);
  expect(both[2]!, "where both are, the blue shows").toBeGreaterThan(both[0]!);
  expect((await screenPx(p, 950, 200)).slice(0, 3), "outside the red line: the page").toEqual([255, 255, 255]);
  await row(p, "Layer 1").locator("[data-eye]").click();
  expect((await screenPx(p, 950, 500)).slice(0, 3), "a hidden base hides what is clipped to it").toEqual([255, 255, 255]);
  await row(p, "Layer 1").locator("[data-eye]").click();

  // Alpha lock on Layer 1: a green line down colours the red line only.
  await row(p, "Layer 1").locator(".layer-name").click();
  await row(p, "Layer 1").locator("[data-alpha]").click();
  expect((await state(p)).layers.find((l) => l.id === base)!.alphaLock).toBe(true);
  await setColour(p, "#22aa22");
  await stroke(p, [600, 100], [600, 950]);
  expect((await px(p, base, 600, 500))!.slice(0, 3), "the red under the green stroke is green now").toEqual([34, 170, 34]);
  expect((await px(p, base, 600, 200))![3], "and nothing was added where the layer was empty").toBe(0);

  await p.keyboard.press("e");
  await stroke(p, [1300, 400], [1300, 600]);
  expect((await px(p, base, 1300, 500))![3], "with alpha lock on, the Eraser keeps the layer's paint").toBe(255);
  await row(p, "Layer 1").locator("[data-alpha]").click();
  await stroke(p, [1300, 400], [1300, 600]);
  expect((await px(p, base, 1300, 500))![3], "without it, the Eraser takes the paint away").toBe(0);
  expect(app.consoleErrors).toEqual([]);
});

test("pages: a size in mm at a DPI is whole px; a new page has its own layer; a resize keeps the pixels; a page exports as PNG and is placed on the canvas as a picture", async ({ app }) => {
  const p = app.page;
  await newPainting(p, async (d) => {
    await d.locator('[data-f="unit"]').selectOption("mm");
    await d.locator('[data-f="dpi"]').fill("300");
    await d.locator('[data-f="w"]').fill("100");
    await d.locator('[data-f="h"]').fill("50");
    await d.locator('[data-f="bg"]').selectOption("none");
  });
  let s = await state(p);
  expect(s.pages[0]).toMatchObject({ w: 1181, h: 591, bg: null }); // (100 mm and 50 mm at 300 DPI)
  await stroke(p, [100, 300], [1000, 300]);
  await p.locator('#paint-view [data-act="new-page"]').click();
  await expect.poll(async () => (await state(p)).pages.length).toBe(2);
  s = await state(p);
  expect(s.pageId).toBe(s.pages[1]!.id);
  expect(s.layers.filter((l) => l.pageId === s.pageId)).toHaveLength(1);
  await p.locator(".paint-page button", { hasText: "Page 1" }).click();
  await expect.poll(async () => (await state(p)).pageId).toBe(s.pages[0]!.id);

  // A larger page keeps the pixels where they are, with empty room on the right; undo gives the old size back.
  const layer1 = s.layers.find((l) => l.pageId === s.pages[0]!.id)!.id;
  await fromPaintingMenu(p, "page-size");
  await p.locator('[data-f="unit"]').selectOption("px");
  await p.locator('[data-f="w"]').fill("1500");
  await p.getByTestId("page-dialog-ok").click();
  await expect.poll(async () => (await state(p)).pages[0]!.w).toBe(1500);
  await expect.poll(async () => (await px(p, layer1, 500, 300))?.[3] ?? -1).toBe(255);
  expect((await px(p, layer1, 1400, 300))![3]).toBe(0);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await state(p)).pages[0]!.w).toBe(1181);
  await expect.poll(async () => (await px(p, layer1, 500, 300))?.[3] ?? -1).toBe(255);

  const [dl] = await Promise.all([p.waitForEvent("download"), fromPaintingMenu(p, "export")]);
  const png = await readFile((await dl.path())!);
  expect(png.readUInt32BE(16), "the PNG is the page's width").toBe(1181);
  expect(png.readUInt32BE(20)).toBe(591);

  await fromPaintingMenu(p, "place");
  await expect(p.locator("body")).toHaveAttribute("data-view", "canvas");
  await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.objects())).filter((o) => o["kind"] === "image").length).toBe(1);
  const img = (await p.evaluate(() => window.__canvastDebug.objects())).find((o) => o["kind"] === "image")!;
  expect([img["pixelW"], img["pixelH"]]).toEqual([1181, 591]);
  expect(app.consoleErrors).toEqual([]);
});

test("vector layers (ADR 0167): the canvas's Shape and Pen draw into one vector layer; its Select moves one shape alone, its keys work, undo is the painting's; Rasterize makes it a paint layer", async ({ app }) => {
  const p = app.page;
  await newPainting(p);
  const ink = [0x25, 0x63, 0xeb], white = [255, 255, 255]; // (the canvas's Shape tool and its fill: one tool for both views, ADR 0168)
  await p.keyboard.press("u");
  await stroke(p, [400, 300], [800, 600]);
  await stroke(p, [1200, 300], [1500, 600]);
  const layers = (await state(p)).layers;
  expect(layers.map((l) => [l.name, l.kind]), "both on one new vector layer").toEqual([["Layer 1", "raster"], ["Vector 1", "object"]]);
  const vec = layers[1]!;
  await expect.poll(async () => (await screenPx(p, 600, 450)).slice(0, 3), { message: "filled as the canvas fills a new shape" }).toEqual(ink);
  expect((await screenPx(p, 1350, 450)).slice(0, 3)).toEqual(ink);
  await p.keyboard.press("v");
  await stroke(p, [600, 450], [600, 450]); // (as on the canvas: a click picks, then a drag moves what is picked)
  await stroke(p, [600, 450], [600, 750]);
  await expect.poll(async () => (await screenPx(p, 600, 850)).slice(0, 3), { message: "the first moved down 300 px" }).toEqual(ink);
  expect((await screenPx(p, 600, 350)).slice(0, 3)).toEqual(white);
  expect((await screenPx(p, 1350, 450)).slice(0, 3), "the other stayed").toEqual(ink);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await screenPx(p, 600, 350)).slice(0, 3), { message: "one undo puts it back" }).toEqual(ink);
  await p.keyboard.press("Delete"); // (the canvas's keys: Delete takes the picked shape away)
  await expect.poll(async () => (await screenPx(p, 600, 450)).slice(0, 3), { message: "Delete" }).toEqual(white);
  await p.keyboard.press("Control+z");
  await p.keyboard.press("p"); // the canvas's Pen, into the same layer
  await stroke(p, [300, 900], [1600, 900]);
  await expect.poll(async () => (await state(p)).layers.map((l) => l.objs ?? null), { message: "the stroke is a third object of the one vector layer" }).toEqual([null, 3]);
  await p.locator(`[data-layer-more="${vec.id}"]`).click();
  await p.locator('.pop-menu [data-id="rasterize"]').click();
  await expect.poll(async () => (await state(p)).layers.find((l) => l.id === vec.id)?.kind).toBe("raster");
  await settled(p);
  expect((await px(p, vec.id, 600, 450))![3], "its pixels are the shapes").toBe(255);
  expect((await px(p, vec.id, 1350, 450))![3]).toBe(255);
  expect((await px(p, vec.id, 1000, 450))![3]).toBe(0);
  // (the pen line is 4 px; Firefox gives the pointer in whole CSS px, about 2 page px at this zoom, so the column round it is read)
  expect(Math.max(...(await Promise.all([896, 898, 900, 902, 904].map(async (y) => (await px(p, vec.id, 950, y))![3]))))).toBe(255);
  expect(app.consoleErrors).toEqual([]);
});

test("brush presets (ADR 0169): the built-in ones, a pick paints with its tip, Brush settings change the tool's brush, Save, export and import (.json and .abr), kept over a reload", async ({ app }) => {
  const p = app.page;
  const s = await newPainting(p);
  const id = s.layers[0]!.id;
  const brushes = () => p.evaluate(() => window.__canvastDebug.paint.brushes());
  await p.locator('[data-brush-panel="brushes"]').click();
  const panel = p.getByTestId("brushes-panel");
  await expect(panel).toBeVisible();
  const b0 = await brushes();
  expect(b0.presets.length, "the engine's built-in presets, the first time").toBeGreaterThanOrEqual(30);
  // a preset with a sampled tip: picked, named in the bar, and it paints (its bitmap comes from storage into the engine)
  const sampled = b0.presets.find((x) => x.tips > 0)!;
  await panel.locator(`[data-brush="${sampled.id}"]`).click();
  expect((await brushes()).tool?.preset).toBe(sampled.id);
  await expect(p.locator('[data-brush-panel="brushes"]')).toHaveAttribute("aria-label", `Brushes: ${sampled.name}`);
  await p.locator('[data-paint-options] input[data-opt="size"]').fill("80");
  await p.locator('[data-paint-options] input[data-opt="size"]').press("Enter");
  await stroke(p, [900, 400], [1700, 400]); // (right of the Brushes panel, which docks on the left)
  const alphas = await Promise.all([1000, 1100, 1200, 1300, 1400, 1500, 1600].map(async (x) => (await px(p, id, x, 400))?.[3] ?? 0));
  expect(Math.max(...alphas), "the sampled tip painted").toBeGreaterThan(0);
  // Brush settings: a section switched on, a dynamic setting, and a Tip setting that is the bar's own value
  await p.locator('[data-brush-panel="settings"]').click();
  const set = p.getByTestId("brush-settings-panel");
  await set.getByLabel("Scattering on").check();
  await set.locator('[data-k="shapeDynamics.size.jitter"] input[type="number"]').fill("40");
  await set.locator('[data-k="shapeDynamics.size.jitter"] input[type="number"]').press("Enter");
  await set.locator('[data-k="size"] input[type="number"]').fill("33");
  await set.locator('[data-k="size"] input[type="number"]').press("Enter");
  await expect.poll(async () => (await brushes()).tool?.brush).toMatchObject({ scattering: { enabled: true }, shapeDynamics: { size: { jitter: 0.4 } } });
  expect((await brushes()).tool?.values["size"], "the Tip's size is the bar's").toBe(33);
  await expect(p.locator('[data-paint-options] input[data-opt="size"]')).toHaveValue("33");
  // the brush's blend mode, a pinned section, and a dynamic's response curve (shown once something controls it)
  await set.locator('[data-k="mode"] select').selectOption("Multiply");
  await set.getByLabel("Keep scattering").click();
  const curve = set.locator('[data-curve-of="shapeDynamics.size"]');
  await expect(curve).toBeHidden();
  await set.locator('[data-k="shapeDynamics.size.control"] select').selectOption("penPressure");
  await curve.locator("summary").click();
  await curve.locator("canvas").click({ position: { x: 96, y: 150 } }); // (a point under the straight line)
  await expect.poll(async () => (await brushes()).tool?.brush).toMatchObject({ mode: "Multiply", locks: { scattering: true }, shapeDynamics: { size: { control: "penPressure" } } });
  const pts = (await brushes()).tool?.brush["shapeDynamics"] as { size: { curve: number[][] } };
  expect(pts.size.curve.length, "a point added to the curve").toBe(3);
  expect(pts.size.curve[1]![1]!, "under the line").toBeLessThan(pts.size.curve[1]![0]!);
  // picking a preset again keeps only what is pinned
  await panel.locator(`[data-brush="${sampled.id}"]`).click();
  await expect.poll(async () => (await brushes()).tool?.brush["mode"]).not.toBe("Multiply");
  expect((await brushes()).tool?.brush, "the pinned section stays").toMatchObject({ scattering: { enabled: true }, locks: { scattering: true } });
  // a tip and a texture chosen from the presets' pictures and the procedural patterns
  const tips = set.locator('[data-pick="tip"]');
  await tips.locator("summary").click();
  await tips.getByRole("button", { name: "Round" }).click();
  await expect.poll(async () => (await brushes()).tool?.brush["tip"]).toBe("round");
  await tips.locator('[data-pick-i="1"]').click();
  await expect.poll(async () => typeof (await brushes()).tool?.brush["tip"]).toBe("object");
  await expect(tips.locator('[data-pick-i="1"]')).toHaveAttribute("aria-pressed", "true");
  const pats = set.locator('[data-pick="texture.pattern"]');
  await pats.locator("summary").click();
  await pats.getByRole("button", { name: "Dots" }).click();
  await expect.poll(async () => (await brushes()).tool?.brush).toMatchObject({ texture: { pattern: { procedural: { style: "dots" } } } });
  // Save: a new preset in Saved, now the tool's
  await panel.locator('[data-act="save"]').click();
  await p.getByTestId("prompt-input").fill("Mine");
  await p.getByTestId("prompt-ok").click();
  await expect.poll(async () => (await brushes()).presets.filter((x) => x.name === "Mine").map((x) => x.group)).toEqual(["Saved"]);
  const mine = (await brushes()).presets.find((x) => x.name === "Mine")!;
  expect((await brushes()).tool?.preset).toBe(mine.id);
  // export the Saved group both ways, and import both files back
  const exported = async (item: string): Promise<{ name: string; buffer: Buffer }> => {
    const dl = p.waitForEvent("download");
    await panel.locator('[data-group-more="Saved"]').click();
    await p.locator(`.pop-menu [data-id="${item}"]`).click();
    const d = await dl;
    return { name: d.suggestedFilename(), buffer: await readFile((await d.path())!) };
  };
  const json = await exported("export-json"), abr = await exported("export-abr");
  expect([json.name, abr.name]).toEqual(["Saved.json", "Saved.abr"]);
  const before = (await brushes()).presets.length;
  await panel.getByTestId("brushes-import-input").setInputFiles([{ name: json.name, mimeType: "application/json", buffer: json.buffer }, { name: "From abr.abr", mimeType: "application/octet-stream", buffer: abr.buffer }]);
  await expect.poll(async () => (await brushes()).presets.length).toBe(before + 2);
  const after = (await brushes()).presets;
  expect(after.filter((x) => x.name === "Mine" && x.group === "Saved"), "the canvast file keeps the name, group and tip").toHaveLength(2);
  expect(after.find((x) => x.group === "From abr")?.tips, "the .abr keeps the sampled tip").toBe(1);
  // kept over a reload, with the tool's brush
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate((i) => window.__canvastDebug.paint.open(i), s.paintingId);
  await expect.poll(async () => (await brushes()).presets.length).toBe(before + 2);
  expect((await brushes()).tool).toMatchObject({ preset: mine.id, brush: { scattering: { enabled: true } } });
  expect(app.consoleErrors).toEqual([]);
});

test("a plain wheel over a bar's row that is wider than the window scrolls it sideways (every bar: bar.ts syncScroll), not the page", async ({ app }) => {
  const p = app.page;
  await newPainting(p);
  await p.setViewportSize({ width: 600, height: 800 });
  const row = p.locator("[data-paint-options]").locator("xpath=ancestor-or-self::*[contains(@class,'tb-options-row')][1]");
  await expect(row).toHaveAttribute("data-scroll", "");
  const at = () => p.evaluate(() => window.__canvastDebug.paint.screenOf(1000, 500));
  const before = await at();
  const b = (await row.boundingBox())!;
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.wheel(0, 200);
  await expect.poll(() => row.evaluate((r) => r.scrollLeft)).toBeGreaterThan(0);
  expect(await at(), "the page did not move or zoom").toEqual(before);
  expect(app.consoleErrors).toEqual([]);
});

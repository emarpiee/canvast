import { readFile } from "node:fs/promises";
import { LIMITS, expect, reps, setPenColour, test } from "./harness";
import type { Page } from "@playwright/test";
import { makePng } from "./png";

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

test("pages: a size in mm at a DPI is whole px; a new page has its own layer; canvas size, image size and crop to the selection; a page exports as PNG and is placed on the canvas as a picture", async ({ app }) => {
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

  // A larger page (canvas size, anchored top left) keeps the pixels where they are, with empty room on the right; undo gives the old size back.
  const layer1 = s.layers.find((l) => l.pageId === s.pages[0]!.id)!.id;
  await fromPaintingMenu(p, "page-size");
  await p.locator('[data-f="unit"]').selectOption("px");
  await p.locator('[data-f="w"]').fill("1500");
  await p.locator('[data-f="anchor"]').selectOption({ label: "Top left" });
  await p.getByTestId("page-dialog-ok").click();
  await expect.poll(async () => (await state(p)).pages[0]!.w).toBe(1500);
  await expect.poll(async () => (await px(p, layer1, 500, 300))?.[3] ?? -1).toBe(255);
  expect((await px(p, layer1, 1400, 300))![3]).toBe(0);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await state(p)).pages[0]!.w).toBe(1181);
  // Image size scales the pixels with the page; anchored in the middle, a canvas size moves them by half the room.
  await fromPaintingMenu(p, "page-size");
  await p.locator('[data-f="unit"]').selectOption("px");
  await p.locator('[data-f="how"]').selectOption("image");
  await p.locator('[data-f="w"]').fill("590");
  await p.locator('[data-f="h"]').fill("295");
  await p.getByTestId("page-dialog-ok").click();
  await expect.poll(async () => (await px(p, layer1, 250, 150))?.[3] ?? -1, { message: "image size: the stroke at half the size" }).toBe(255);
  expect((await px(p, layer1, 560, 150))![3]).toBe(0);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await state(p)).pages[0]!.w).toBe(1181);
  await fromPaintingMenu(p, "page-size");
  await p.locator('[data-f="unit"]').selectOption("px");
  await p.locator('[data-f="w"]').fill("1381");
  await p.getByTestId("page-dialog-ok").click();
  await expect.poll(async () => (await px(p, layer1, 150, 300))?.[3] ?? -1, { message: "canvas size, middle: moved 100 px right" }).toBe(0);
  expect((await px(p, layer1, 1100, 300))![3]).toBe(255);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await state(p)).pages[0]!.w).toBe(1181);
  // Crop to the selection: the page is the selection's box, the pixels moved with it.
  await p.keyboard.press("m");
  await stroke(p, [400, 250], [700, 350]);
  await p.locator('[data-paint-options] [data-act="selection-menu"]').click();
  await p.locator('.pop-menu [data-id="crop"]').click();
  // (Firefox gives the pointer in whole CSS px: the box may be a page px larger or smaller)
  await expect.poll(async () => { const g = (await state(p)).pages[0]!; return Math.abs(g.w - 300) <= 1 && Math.abs(g.h - 100) <= 1; }, { message: "cropped to 300 x 100" }).toBe(true);
  expect((await px(p, layer1, 150, 50))![3], "the stroke at y 300 is at y 50 now").toBe(255);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await state(p)).pages[0]!.w).toBe(1181);
  await p.keyboard.press("b");
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

test("vector layers (ADR 0167): the canvas's Shape and Pen draw into one vector layer; its Select moves one shape alone, its keys and Actions bar work, undo is the painting's; Rasterize makes it a paint layer", async ({ app }) => {
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
  await p.locator('.ctx-bar [data-ctx="delete"]').click(); // (the canvas's Actions bar takes the pointer over the page)
  await expect.poll(async () => (await screenPx(p, 600, 450)).slice(0, 3), { message: "Delete on the Actions bar" }).toEqual(white);
  await p.keyboard.press("Control+z");
  await stroke(p, [600, 450], [600, 450]); // (picked again: an undone delete brings the shape back unpicked)
  await p.keyboard.press("Delete"); // (the canvas's keys: Delete takes the picked shape away)
  await expect.poll(async () => (await screenPx(p, 600, 450)).slice(0, 3), { message: "Delete" }).toEqual(white);
  await p.keyboard.press("Control+z");
  const del = p.locator('.ctx-bar [data-ctx="delete"]');
  for (let i = 0; i < 2; i++) { // (a pick of a layer is followed at once, every time: once it was only on the next change of the painting)
    await row(p, "Layer 1").locator(".layer-name").click();
    await stroke(p, [600, 450], [600, 450]);
    await expect(del, "on a paint layer the shapes are not picked").toBeHidden();
    await row(p, "Vector 1").locator(".layer-name").click();
    await stroke(p, [600, 450], [600, 450]);
    await expect(del, "back on the vector layer they are").toBeVisible();
    await p.keyboard.press("Escape");
  }
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

test("the Pencil (Shift+B, in the Brush flyout) paints whole pixels only; with Auto erase a stroke that starts on the paint colour erases", async ({ app }) => {
  const p = app.page;
  const { layers } = await newPainting(p);
  const id = layers[0]!.id;
  await p.keyboard.press("Shift+B");
  await expect(p.locator('.rail-fly[data-fly="brush"] [data-tool="pencil"]')).toHaveAttribute("aria-checked", "true");
  await expect(p.locator('.rail-tools [data-tool="brush"]'), "the rail's Brush button stands for its flyout").toHaveAttribute("aria-checked", "true");
  const size = p.locator('[data-paint-options] input[data-opt="size"]');
  await expect(size, "one pixel at first").toHaveValue("1");
  await size.fill("9");
  await size.press("Enter");
  await stroke(p, [950, 300], [1400, 340]);
  const column = await Promise.all([...Array(30).keys()].map(async (i) => (await px(p, id, 1100, 305 + i))![3]));
  expect(column.some((a) => a === 255), "it painted").toBe(true);
  expect(column.filter((a) => a !== 0 && a !== 255), "no soft edge").toEqual([]);
  await p.locator('[data-paint-options] [data-opt="autoErase"]').click();
  await stroke(p, [1175, 320], [1175, 320]); // (on the line: erased)
  expect((await px(p, id, 1175, 320))![3]).toBe(0);
  await stroke(p, [1200, 600], [1300, 600]); // (off it: painted)
  expect((await px(p, id, 1250, 600))![3]).toBe(255);
  expect(app.consoleErrors).toEqual([]);
});

test("the Eyedropper (I, one tool for both views) picks the colour under it: the page or the picked layer alone, one pixel or a mean; Alt-click with a painting tool is the same pick", async ({ app }) => {
  const p = app.page;
  const colourNow = async (): Promise<string> => {
    await p.locator("[data-colour-open]").click();
    const v = (await p.locator(".colour-pop [data-hex]").inputValue()).toLowerCase();
    await p.keyboard.press("Escape");
    return v;
  };
  const pick = async (x: number, y: number): Promise<void> => {
    const s = await at(p, x, y);
    await p.mouse.click(s.x, s.y);
  };
  await newPainting(p);
  await setColour(p, "#ff0000");
  await p.locator('[data-paint-options] input[data-opt="size"]').fill("80");
  await p.locator('[data-paint-options] input[data-opt="size"]').press("Enter");
  await stroke(p, [1000, 500], [1300, 500]);
  await setColour(p, "#00ff00");
  await stroke(p, [1000, 800], [1000, 800]); // (a green dab, for Alt-click)
  await p.keyboard.press("i");
  await pick(1150, 500);
  expect(await colourNow(), "the page's colour there").toBe("ff0000");
  await p.keyboard.press("b");
  const g = await at(p, 1000, 800);
  await p.keyboard.down("Alt");
  await p.mouse.click(g.x, g.y);
  await p.keyboard.up("Alt");
  expect(await colourNow(), "Alt-click with the Brush").toBe("00ff00");
  await p.locator('[data-paint-layers] [data-act="new-layer"]').click();
  await p.locator('.pop-menu [data-id="paint"]').click();
  await p.keyboard.press("i");
  await p.locator('[data-sample-layer="layer"]').click();
  await pick(1150, 500);
  expect(await colourNow(), "the new layer is clear there: nothing picked").toBe("00ff00");
  await p.locator('[data-sample-layer="all"]').click();
  await p.locator("[data-sample-size]").selectOption("101");
  await pick(1150, 560); // (just past the stroke's edge: the square takes in some of it)
  const mean = await colourNow();
  expect(mean === "ff0000" || mean === "00ff00", `a mean, not one pixel (${mean})`).toBe(false);
  await p.getByTestId("view-canvas").click(); // one tool: on the canvas it reads the screen
  await expect(p.locator('.rail-tools [data-tool="eyedropper"]')).toBeVisible();
  await p.keyboard.press("u");
  await app.drag({ x: 500, y: 300 }, { x: 700, y: 450 });
  await p.keyboard.press("i");
  await p.locator("[data-sample-size]").selectOption("1");
  await p.mouse.click(600, 375);
  expect(await colourNow(), "the new shape's fill").toBe("2563eb");
  expect(app.consoleErrors).toEqual([]);
});

test("view rotate and mirror (4, 6, 5 and the View rotation menu): the screen, the brush, the wheel, the canvas's tools and Fit follow the turn; Reset puts it back", async ({ app }) => {
  const p = app.page;
  /** The window's own pixel at a point (what the browser shows of the turned box): checks the forward mapping against the real rendering. */
  const shot = async (q: { x: number; y: number }): Promise<number[]> => {
    const b = await p.screenshot({ clip: { x: Math.round(q.x), y: Math.round(q.y), width: 1, height: 1 } });
    return p.evaluate(async (s) => {
      const img = new Image();
      img.src = `data:image/png;base64,${s}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      return [...g.getImageData(0, 0, 1, 1).data];
    }, b.toString("base64"));
  };
  const red = (c: number[]): boolean => c[0]! > 200 && c[1]! < 80 && c[2]! < 80;
  const { layers } = await newPainting(p);
  const id = layers[0]!.id;
  await setColour(p, "#ff0000");
  await p.locator('[data-paint-options] input[data-opt="size"]').fill("40");
  await p.locator('[data-paint-options] input[data-opt="size"]').press("Enter");
  const turnBtn = p.locator('.hud-controls [data-action="view-turn"]');
  await p.locator(".paint-canvas").focus(); // (the keys are the view's, not the size field's)
  // both directions, then the mirror on top of a turn
  for (const [keys, label, y] of [[["6", "6", "6"], "45°", 470], [["4", "4", "4", "4", "4", "4", "4", "4"], "-75°", 520], [["mirror"], "-75° ⇋", 570]] as const) {
    for (const k of keys) {
      if (k !== "mirror") await p.keyboard.press(k);
      else {
        await turnBtn.click(); // (the mirror is in the View rotation menu)
        await p.locator('.pop-menu [data-id="mirror"]').click();
        await p.keyboard.press("Escape");
      }
    }
    await expect(turnBtn).toHaveText(label);
    await stroke(p, [960, y], [1100, y]);
    expect((await px(p, id, 1030, y))![3], `${label}: the stroke is where the pointer was on the page`).toBe(255);
    expect(red(await shot(await at(p, 1030, y))), `${label}: and it shows there on screen`).toBe(true);
  }
  // the wheel zooms about the pointer, through the turn: a dab off the middle stays under it
  await stroke(p, [1150, 650], [1150, 650]);
  const q = await at(p, 1150, 650);
  await p.mouse.move(q.x, q.y);
  for (let i = 0; i < 3; i++) await p.mouse.wheel(0, -100);
  await settled(p);
  expect(red(await shot(q)), "the wheel zooms about the pointer").toBe(true);
  await p.keyboard.press("Control+0");
  const r = (await p.locator(".paint-stage").boundingBox())!;
  for (const [x, y] of [[0, 0], [1920, 0], [0, 1080], [1920, 1080]] as const) {
    const c = await at(p, x, y);
    expect(c.x >= r.x && c.x <= r.x + r.width && c.y >= r.y && c.y <= r.y + r.height, `Fit: corner ${x},${y} in view`).toBe(true);
  }
  // the canvas's tools on a vector layer, turned and mirrored
  await p.keyboard.press("u");
  await stroke(p, [980, 600], [1080, 700]);
  await expect.poll(async () => (await state(p)).layers.map((l) => l.objs ?? null)).toEqual([null, 1]);
  expect(await shot(await at(p, 1030, 650)), "the shape is drawn where it was dragged").toEqual(expect.arrayContaining([0x25, 0x63, 0xeb]));
  await p.keyboard.press("v");
  await stroke(p, [1030, 650], [1030, 650]);
  await expect(p.locator('.ctx-bar [data-ctx="delete"]'), "a click on it picks it").toBeVisible();
  await p.keyboard.press("Escape");
  await turnBtn.click();
  await p.locator('.pop-menu [data-id="reset"]').click();
  await p.keyboard.press("Escape");
  await expect(turnBtn).toHaveText("0°");
  await expect(p.locator(".paint-turn")).toHaveAttribute("style", /transform: ;|^(?!.*transform: rotate)/);
  expect(app.consoleErrors).toEqual([]);
});

test("a layer mask: black hides, white or the Eraser shows, undo, off and on, the layer painted again from its row, kept over a reload", async ({ app }) => {
  const p = app.page;
  const { layers } = await newPainting(p);
  const id = layers[0]!.id;
  const red = async (x: number, y: number): Promise<boolean> => {
    const c = await screenPx(p, x, y);
    return c[0]! > 200 && c[1]! < 80;
  };
  await setColour(p, "#ff0000");
  await p.locator('[data-paint-options] input[data-opt="size"]').fill("80");
  await p.locator('[data-paint-options] input[data-opt="size"]').press("Enter");
  await stroke(p, [950, 500], [1400, 500]);
  await p.locator(`[data-layer-more="${id}"]`).click();
  await p.locator('.pop-menu [data-id="mask-add"]').click();
  await expect(row(p, "Layer 1").locator("[data-mask]"), "the new mask is what is painted").toHaveAttribute("aria-pressed", "true");
  await setColour(p, "#000000");
  await stroke(p, [1150, 420], [1150, 580]);
  await expect.poll(() => red(1150, 500), { message: "black hides" }).toBe(false);
  expect(await red(1300, 500), "only there").toBe(true);
  expect((await px(p, id, 1150, 500))![3], "the layer's own pixels are kept").toBe(255);
  await setColour(p, "#ffffff");
  await stroke(p, [1150, 420], [1150, 580]);
  await expect.poll(() => red(1150, 500), { message: "white shows again" }).toBe(true);
  await p.keyboard.press("Control+z");
  await expect.poll(() => red(1150, 500), { message: "undo: hidden again" }).toBe(false);
  await p.keyboard.press("e");
  await stroke(p, [1150, 420], [1150, 580]);
  await expect.poll(() => red(1150, 500), { message: "the Eraser on a mask shows" }).toBe(true);
  await p.keyboard.press("Control+z");
  await p.keyboard.press("b");
  await p.locator(`[data-layer-more="${id}"]`).click();
  await p.locator('.pop-menu [data-id="mask-off"]').click();
  await expect.poll(() => red(1150, 500), { message: "turned off: all shows" }).toBe(true);
  await p.locator(`[data-layer-more="${id}"]`).click();
  await p.locator('.pop-menu [data-id="mask-off"]').click();
  await expect.poll(() => red(1150, 500), { message: "on again" }).toBe(false);
  await row(p, "Layer 1").locator(".layer-name").click(); // (the row's name: the layer, not its mask)
  await expect(row(p, "Layer 1").locator("[data-mask]")).toHaveAttribute("aria-pressed", "false");
  await stroke(p, [1000, 750], [1000, 750]);
  expect((await px(p, id, 1000, 750))!.slice(0, 4), "white paint on the layer").toEqual([255, 255, 255, 255]);
  await settled(p);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  const list = await p.evaluate(() => window.__canvastDebug.paint.list());
  await p.evaluate((i) => window.__canvastDebug.paint.open(i), list[0]!.id);
  await expect.poll(async () => (await state(p)).layers[0]!.mask ?? -1, { message: "the mask is kept" }).toBeGreaterThan(0);
  await expect.poll(() => red(1150, 500), { message: "and still hides" }).toBe(false);
  expect(await red(1300, 500)).toBe(true);
  expect(app.consoleErrors).toEqual([]);
});

test("selections (M, Shift+M, L, Shift+L, W): marquees, lassos and the wand, with add, take away and the menu; painting stays inside", async ({ app }) => {
  const p = app.page;
  const { layers } = await newPainting(p);
  const id = layers[0]!.id;
  const selected = (): Promise<number> => p.evaluate(() => window.__canvastDebug.paint.selected());
  const drag = async (a: [number, number], b: [number, number], mods: string[] = []): Promise<void> => {
    for (const m of mods) await p.keyboard.down(m);
    await stroke(p, a, b);
    for (const m of mods) await p.keyboard.up(m);
  };
  const clickAt = async (x: number, y: number): Promise<void> => {
    const q = await at(p, x, y);
    await p.mouse.click(q.x, q.y);
  };
  const ALL = 1920 * 1080;
  await p.locator(".paint-canvas").focus();
  await p.keyboard.press("m");
  await expect(p.locator('.rail-fly[data-fly="select"] [data-tool="marquee"]')).toHaveAttribute("aria-checked", "true");
  await drag([1000, 400], [1200, 600]);
  const rect = await selected();
  expect(Math.abs(rect - 200 * 200), `a 200 px square (${rect})`).toBeLessThan(2 * 200 * 4);
  await p.keyboard.press("b");
  await setColour(p, "#ff0000");
  await p.locator('[data-paint-options] input[data-opt="size"]').fill("60");
  await p.locator('[data-paint-options] input[data-opt="size"]').press("Enter");
  await stroke(p, [950, 500], [1300, 500]);
  expect((await px(p, id, 1100, 500))![3], "painted inside").toBe(255);
  expect((await px(p, id, 980, 500))![3], "not left of it").toBe(0);
  expect((await px(p, id, 1250, 500))![3], "not right of it").toBe(0);
  await p.locator(".paint-canvas").focus();
  await p.keyboard.press("Shift+M");
  await drag([1300, 400], [1400, 500], ["Shift"]); // (Shift at the press adds)
  const both = await selected();
  expect(Math.abs(both - rect - Math.PI * 50 * 50), `an ellipse added (${both - rect})`).toBeLessThan(600);
  await p.keyboard.press("Shift+L");
  await p.keyboard.down("Alt");
  await clickAt(1000, 400); // (Alt at the first corner takes away)
  await p.keyboard.up("Alt");
  await clickAt(1100, 400);
  await clickAt(1000, 500);
  await clickAt(1000, 400);
  const less = await selected();
  expect(Math.abs(both - less - 5000), `a triangle taken away (${both - less})`).toBeLessThan(600);
  await p.keyboard.press("Control+d");
  expect(await selected()).toBe(0);
  await p.keyboard.press("l"); // the Lasso selects pixels on a paint layer
  const pts = await Promise.all([[1000, 700], [1200, 700], [1100, 900], [1000, 700]].map(([x, y]) => at(p, x!, y!)));
  await p.mouse.move(pts[0]!.x, pts[0]!.y);
  await p.mouse.down();
  for (const q of pts.slice(1)) await p.mouse.move(q.x, q.y, { steps: 8 });
  await p.mouse.up();
  const tri = await selected();
  expect(Math.abs(tri - 20000), `a lasso triangle (${tri})`).toBeLessThan(1500);
  await p.keyboard.press("w");
  await clickAt(1100, 500); // (the wand on the red, inside the first square)
  const red = await selected();
  expect(red > 5000 && red < 20000, `the wand takes the red joined to it (${red})`).toBe(true);
  await p.keyboard.press("Control+Shift+I");
  expect(await selected(), "invert").toBe(ALL - red);
  await p.keyboard.press("Control+a");
  expect(await selected(), "select all").toBe(ALL);
  await p.keyboard.press("m");
  await drag([500, 300], [600, 400]);
  await p.locator('[data-paint-options] [data-act="selection-menu"]').click();
  await p.locator('.pop-menu [data-id="grow"]').click();
  await p.getByRole("dialog").locator("input").fill("4");
  await p.getByRole("dialog").locator("input").press("Enter");
  await expect.poll(selected, { message: "grown by 4 px on each side" }).toBeGreaterThan(104 * 104);
  expect(await selected()).toBeLessThan(110 * 110);
  expect(app.consoleErrors).toEqual([]);
});

test("the fill bucket (G) fills the region joined to the click, inside a selection; the gradient (Shift+G) goes from the colour to clear; Delete clears the selection", async ({ app }) => {
  const p = app.page;
  const { layers } = await newPainting(p);
  const id = layers[0]!.id;
  const clickAt = async (x: number, y: number): Promise<void> => {
    const q = await at(p, x, y);
    await p.mouse.click(q.x, q.y);
  };
  await setColour(p, "#ff0000");
  await p.locator('[data-paint-options] input[data-opt="size"]').fill("20");
  await p.locator('[data-paint-options] input[data-opt="size"]').press("Enter");
  await stroke(p, [1000, 0], [1000, 1080]); // (a wall from top to bottom)
  await setColour(p, "#0000ff");
  await p.keyboard.press("g");
  await expect(p.locator('[data-paint-options] input[data-opt="tolerance"]')).toBeVisible();
  await clickAt(500, 500);
  await settled(p);
  expect((await px(p, id, 500, 500))!, "filled left of the wall").toEqual([0, 0, 255, 255]);
  expect((await px(p, id, 1500, 500))![3], "not past it").toBe(0);
  await p.keyboard.press("Control+z");
  await settled(p);
  await p.keyboard.press("m");
  await stroke(p, [1200, 300], [1400, 500]);
  await p.keyboard.press("g");
  await clickAt(1300, 400);
  await settled(p);
  expect((await px(p, id, 1300, 400))![3], "inside the selection").toBe(255);
  expect((await px(p, id, 1500, 400))![3], "outside it, though joined").toBe(0);
  await p.keyboard.press("Delete");
  await settled(p);
  expect((await px(p, id, 1300, 400))![3], "Delete clears what is selected").toBe(0);
  await p.keyboard.press("Control+d");
  await p.keyboard.press("Shift+G");
  await stroke(p, [1100, 800], [1900, 800]);
  const a0 = (await px(p, id, 1150, 800))![3]!, a1 = (await px(p, id, 1850, 800))![3]!;
  expect(a0 > 200 && a1 < 40, `strong at the start, clear at the end (${a0}, ${a1})`).toBe(true);
  expect(app.consoleErrors).toEqual([]);
});

test("free transform with the Select tool on pixels: move, a side scales, Ctrl on a corner distorts, Escape puts back, Enter applies; with a selection only it moves", async ({ app }) => {
  const p = app.page;
  const { layers } = await newPainting(p);
  const id = layers[0]!.id;
  const alpha = async (x: number, y: number): Promise<number> => (await px(p, id, x, y))![3]!;
  await setColour(p, "#ff0000");
  await p.locator('[data-paint-options] input[data-opt="size"]').fill("200");
  await p.locator('[data-paint-options] input[data-opt="size"]').press("Enter");
  await p.locator('[data-paint-options] input[data-opt="hardness"]').fill("100");
  await p.locator('[data-paint-options] input[data-opt="hardness"]').press("Enter");
  await stroke(p, [1000, 500], [1000, 500]); // (a hard disc, 900 to 1100 by 400 to 600: its box's corners are where they are pressed)
  await p.locator(".paint-canvas").focus();
  await p.keyboard.press("v");
  await stroke(p, [1000, 500], [1200, 500]); // (inside the box: a move)
  expect(await alpha(1000, 500), "shown moved, not yet applied").toBe(255);
  await expect(p.locator('[data-paint-options] [data-act="transform-apply"]')).toBeVisible();
  await p.keyboard.press("Enter");
  await settled(p);
  expect(await alpha(1200, 500), "applied: moved 200 px").toBe(255);
  expect(await alpha(950, 500)).toBe(0);
  await p.keyboard.press("Control+z");
  await settled(p);
  expect(await alpha(1000, 500), "one undo puts it back").toBe(255);
  await stroke(p, [1100, 500], [1300, 500]); // (the right side's handle: twice as wide)
  await p.keyboard.press("Enter");
  await settled(p);
  expect(await alpha(1250, 500), "stretched to the right").toBe(255);
  expect(await alpha(1000, 380), "not taller").toBe(0);
  await p.keyboard.press("Control+z");
  await settled(p);
  await p.keyboard.down("Control");
  await stroke(p, [900, 400], [700, 250]); // (Ctrl on the top left corner: that corner alone moves)
  await p.keyboard.up("Control");
  await p.keyboard.press("Enter");
  await settled(p);
  // (by the square-to-quad map, the disc's point at 950, 450 goes to about 891, 417, where nothing was; 1060, 560 stays inside)
  expect(await alpha(891, 417), "pulled out toward the corner (resampled)").toBeGreaterThan(200);
  expect(await alpha(1066, 571), "the far corner stays").toBeGreaterThan(200);
  await p.keyboard.press("Control+z");
  await settled(p);
  await stroke(p, [1000, 500], [1000, 800]);
  await p.keyboard.press("Escape");
  await settled(p);
  expect(await alpha(1000, 800), "Escape: nothing moved").toBe(0);
  expect(await alpha(1000, 500)).toBe(255);
  await p.keyboard.press("m");
  await stroke(p, [850, 350], [1000, 650]); // (the left half)
  const half = await p.evaluate(() => window.__canvastDebug.paint.selected());
  await p.keyboard.press("v");
  await stroke(p, [950, 500], [950, 750]);
  await p.keyboard.press("Enter");
  await settled(p);
  expect(await alpha(950, 750), "the selected half moved down").toBe(255);
  expect(await alpha(1050, 500), "the other half stayed").toBe(255);
  expect(await alpha(950, 500), "and left room").toBe(0);
  expect(await p.evaluate(() => window.__canvastDebug.paint.selected()), "the selection went with it").toBe(half);
  expect(app.consoleErrors).toEqual([]);
});

test("a new brush from the selection: its pixels become the tip of a preset in Saved, which the Brush paints with", async ({ app }) => {
  const p = app.page;
  const { layers } = await newPainting(p);
  const id = layers[0]!.id;
  await setColour(p, "#000000");
  for (const [k, v] of [["size", "40"], ["hardness", "100"]] as const) {
    await p.locator(`[data-paint-options] input[data-opt="${k}"]`).fill(v);
    await p.locator(`[data-paint-options] input[data-opt="${k}"]`).press("Enter");
  }
  await stroke(p, [1000, 420], [1000, 580]); // (a bar, 40 wide and 200 tall)
  await p.locator(".paint-canvas").focus();
  await p.keyboard.press("m");
  await stroke(p, [900, 390], [1100, 610]);
  await p.locator('[data-paint-options] [data-act="selection-menu"]').click();
  await p.locator('.pop-menu [data-id="brush-from"]').click();
  await p.getByRole("dialog").locator("input").fill("Bar");
  await p.getByRole("dialog").locator("input").press("Enter");
  await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.paint.brushes())).tool?.preset ?? "", { message: "the Brush has the new preset" }).not.toBe("");
  const b = await p.evaluate(() => window.__canvastDebug.paint.brushes());
  expect(b.tool!.tool).toBe("brush");
  expect(b.presets.find((x) => x.id === b.tool!.preset), "kept in Saved, with its tip").toMatchObject({ name: "Bar", group: "Saved", tips: 1 });
  await p.keyboard.press("Control+d");
  await stroke(p, [500, 500], [500, 500]);
  expect((await px(p, id, 500, 500))![3], "the tip's bar paints").toBeGreaterThan(200);
  expect((await px(p, id, 560, 500))![3], "beside the bar the tip is clear").toBeLessThan(30);
  expect(app.consoleErrors).toEqual([]);
});

test("symmetry: a stroke is painted again across the page's middle (left and right, four ways, diagonal), as one stroke", async ({ app }) => {
  const p = app.page;
  const { layers } = await newPainting(p);
  const id = layers[0]!.id;
  const a = async (x: number, y: number): Promise<number> => (await px(p, id, x, y))![3]!;
  await p.locator('[data-paint-options] input[data-opt="size"]').fill("40");
  await p.locator('[data-paint-options] input[data-opt="size"]').press("Enter");
  await p.locator("[data-paint-options] [data-sym]").selectOption("vertical");
  await stroke(p, [500, 300], [500, 300]);
  expect(await a(1420, 300), "left and right: the mirror across x = 960").toBe(255);
  expect(await a(500, 780), "not top and bottom").toBe(0);
  await p.locator("[data-paint-options] [data-sym]").selectOption("dual");
  await stroke(p, [1100, 200], [1100, 200]);
  for (const [x, y] of [[820, 200], [1100, 880], [820, 880]] as const) expect(await a(x, y), `four ways: ${x}, ${y}`).toBe(255);
  await p.locator("[data-paint-options] [data-sym]").selectOption("diagonal");
  await stroke(p, [600, 700], [600, 700]); // (across the line through the middle from top left to bottom right: dx -360, dy 160 -> 1120, 180)
  expect(await a(1120, 180), "diagonal").toBe(255);
  await p.locator("[data-paint-options] [data-sym]").selectOption("off");
  await stroke(p, [300, 900], [300, 900]);
  expect(await a(1620, 900), "off: one stroke").toBe(0);
  expect(app.consoleErrors).toEqual([]);
});

test("reference pictures: a library picture floats over the view (not a layer), moves, fades, is kept over a reload where it was, and goes", async ({ app }) => {
  const p = app.page;
  await newPainting(p);
  await p.getByTestId("paint-picture-input").setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: makePng(64, 32, (x) => (x < 32 ? [255, 0, 0, 255] : [0, 0, 255, 255])) });
  await expect.poll(async () => (await state(p)).layers.length, { message: "the import made a picture layer (and put the picture in the library)" }).toBe(2);
  await fromPaintingMenu(p, "reference");
  await p.locator(".lib-pick .lib-item").first().click();
  const ref = p.getByTestId("paint-ref");
  await expect(ref).toHaveCount(1);
  expect((await state(p)).layers.length, "not a layer of the page").toBe(2);
  await expect.poll(async () => (await ref.locator("canvas").boundingBox())?.height ?? 0, { message: "drawn, as wide as twice its height" }).toBeGreaterThan(0);
  const b0 = (await ref.boundingBox())!;
  expect(Math.round(b0.width / b0.height)).toBe(2);
  await p.mouse.move(b0.x + 20, b0.y + b0.height / 2);
  await p.mouse.down();
  await p.mouse.move(b0.x + 120, b0.y + b0.height / 2 + 60, { steps: 6 });
  await p.mouse.up();
  const b1 = (await ref.boundingBox())!;
  expect([Math.round(b1.x - b0.x), Math.round(b1.y - b0.y)], "moved").toEqual([100, 60]);
  await ref.locator("[data-ref-more]").click();
  await p.locator('.pop-menu [data-id="opacity-50"]').click();
  await expect(ref).toHaveCSS("opacity", "0.5");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  const list = await p.evaluate(() => window.__canvastDebug.paint.list());
  await p.evaluate((i) => window.__canvastDebug.paint.open(i), list[0]!.id);
  await expect(p.getByTestId("paint-ref"), "kept over a reload").toHaveCount(1);
  const b2 = (await p.getByTestId("paint-ref").boundingBox())!;
  expect([Math.round(b2.x), Math.round(b2.y)], "where it was").toEqual([Math.round(b1.x), Math.round(b1.y)]);
  await p.getByTestId("paint-ref").locator("[data-ref-more]").click();
  await p.locator('.pop-menu [data-id="remove"]').click();
  await expect(p.getByTestId("paint-ref")).toHaveCount(0);
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

/** An ABR v2 file (the format's own layout, big-endian): `n` sampled brushes, each a `size` px tip of seeded noise in a round fade. */
/** A `.pat` file of grey 8-bit patterns (as the engine writes them, samples raw): name and grey value 0 to 255 at (x, y). */
function makePat(pats: ReadonlyArray<{ name: string; w: number; h: number; grey: (x: number, y: number) => number }>): Buffer {
  const u32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
  const u16 = (v: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
  const parts: Buffer[] = [Buffer.from("8BPT"), u16(1), u32(pats.length)];
  for (const p of pats) {
    const units = [...p.name].map((c) => c.charCodeAt(0)).concat(0);
    const plane = Buffer.alloc(p.w * p.h);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) plane[y * p.w + x] = p.grey(x, y);
    const rect = Buffer.concat([u32(0), u32(0), u32(p.h), u32(p.w)]);
    const channel = Buffer.concat([u32(1), u32(23 + plane.length), u32(8), rect, u16(8), Buffer.from([0]), plane]);
    const body = Buffer.concat([rect, u32(24), channel, ...Array.from({ length: 23 }, () => u32(0)), u32(0), u32(0)]);
    parts.push(u32(1), u32(1), u16(p.h), u16(p.w), u32(units.length), ...units.map(u16), Buffer.from([2]), Buffer.from("id"), u32(3), u32(body.length), body);
  }
  return Buffer.concat(parts);
}

test("patterns (.pat): each becomes a preset with it as its texture, in a group named after the file, and paints; a right-click on a thumbnail opens its actions", async ({ app }) => {
  const p = app.page;
  const { layers } = await newPainting(p);
  const brushes = () => p.evaluate(() => window.__canvastDebug.paint.brushes());
  await p.locator('[data-brush-panel="brushes"]').click();
  const panel = p.getByTestId("brushes-panel");
  const pat = makePat([
    { name: "Stripes", w: 16, h: 16, grey: (x) => (x < 8 ? 0 : 255) },
    { name: "$$$/Patterns/Water=Water", w: 8, h: 8, grey: (x, y) => ((x + y) % 2 ? 40 : 200) },
  ]);
  await panel.getByTestId("brushes-import-input").setInputFiles({ name: "Patterns.pat", mimeType: "application/octet-stream", buffer: pat });
  await expect.poll(async () => (await brushes()).presets.filter((x) => x.group === "Patterns").map((x) => [x.name, x.tips])).toEqual([["Stripes", 1], ["Water", 1]]);
  await panel.locator(".brush-row, [data-brush]", { hasText: "Stripes" }).first().click();
  await expect.poll(async () => (await brushes()).tool?.preset ?? "").not.toBe("");
  await stroke(p, [1000, 500], [1300, 500]);
  expect((await px(p, layers[0]!.id, 1150, 500))![3], "it paints").toBeGreaterThan(0);
  // the Thumbnails view has no ⋯ buttons: a right-click on a preset opens its actions
  await panel.locator('[data-brush-view="grid"]').click();
  await panel.locator('.brush-cell[aria-label="Water"]').click({ button: "right" });
  await p.locator('.pop-menu [data-id="delete"]').click();
  await expect.poll(async () => (await brushes()).presets.filter((x) => x.group === "Patterns").map((x) => x.name)).toEqual(["Stripes"]);
  expect(app.consoleErrors).toEqual([]);
});

function makeAbr(n: number, size: number): Buffer {
  const parts: Buffer[] = [];
  const head = Buffer.alloc(4);
  head.writeUInt16BE(2, 0);
  head.writeUInt16BE(n, 2);
  parts.push(head);
  let seed = 1;
  for (let i = 0; i < n; i++) {
    const name = `Big ${i + 1}`;
    const body = Buffer.alloc(4 + 2 + 4 + name.length * 2 + 1 + 8 + 16 + 2 + 1 + size * size);
    let o = body.writeUInt32BE(0, 0); // misc
    o = body.writeUInt16BE(25, o); // spacing
    o = body.writeUInt32BE(name.length, o);
    for (const ch of name) o = body.writeUInt16BE(ch.charCodeAt(0), o);
    o = body.writeUInt8(1, o); // anti-alias
    o += 8; // short bounds
    for (const v of [0, 0, size, size]) o = body.writeInt32BE(v, o); // top, left, bottom, right
    o = body.writeUInt16BE(8, o); // depth
    o = body.writeUInt8(0, o); // raw
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const r = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
      body[o++] = r >= 1 ? 0 : Math.round((1 - r) * (128 + (seed >>> 25)));
    }
    const h = Buffer.alloc(6);
    h.writeUInt16BE(2, 0);
    h.writeUInt32BE(body.length, 2);
    parts.push(h, body);
  }
  return Buffer.concat(parts);
}

test("a large .abr (hundreds of sampled brushes) imports within its time budget, and the Thumbnails view lists them quickly", async ({ app }, info) => {
  test.skip(info.project.name !== "chromium", "a timing test: one project");
  const p = app.page;
  await newPainting(p);
  const brushes = () => p.evaluate(() => window.__canvastDebug.paint.brushes());
  await p.locator('[data-brush-panel="brushes"]').click();
  const panel = p.getByTestId("brushes-panel");
  const before = (await brushes()).presets.length;
  const n = reps(400, 200);
  const abr = makeAbr(n, 128);
  const t0 = Date.now();
  await panel.getByTestId("brushes-import-input").setInputFiles({ name: "Big.abr", mimeType: "application/octet-stream", buffer: abr });
  await expect.poll(async () => (await brushes()).presets.length, { timeout: n * LIMITS.abrImportPerBrushMs + 5000 }).toBe(before + n);
  const perBrush = (Date.now() - t0) / n;
  console.log(`abr import: ${n} brushes, ${(abr.length / 1e6).toFixed(1)} MB, ${perBrush.toFixed(1)} ms per brush`);
  expect(perBrush).toBeLessThanOrEqual(LIMITS.abrImportPerBrushMs);
  const t1 = Date.now();
  await panel.locator('[data-brush-view="grid"]').click();
  await expect(panel.locator('[data-group="Big"] .brush-cell')).toHaveCount(n);
  const grid = Date.now() - t1;
  console.log(`thumbnails view: ${grid} ms`);
  expect(grid).toBeLessThanOrEqual(LIMITS.brushGridMs);
  expect(app.consoleErrors).toEqual([]);
});

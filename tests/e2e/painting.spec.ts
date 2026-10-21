import { readFile } from "node:fs/promises";
import { expect, test } from "./harness";
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
const setColour = async (p: Page, hex: string): Promise<void> => {
  await p.locator('.paint-rail [data-act="colour"]').click();
  const field = p.locator(".colour-pop [data-hex]");
  await field.fill(hex.replace("#", ""));
  await field.press("Enter");
  await p.keyboard.press("Escape");
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
  await p.locator('#paint-view [data-act="new-layer"]').click();
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
  await p.locator('#paint-view [data-act="page-size"]').click();
  await p.locator('[data-f="unit"]').selectOption("px");
  await p.locator('[data-f="w"]').fill("1500");
  await p.getByTestId("page-dialog-ok").click();
  await expect.poll(async () => (await state(p)).pages[0]!.w).toBe(1500);
  await expect.poll(async () => (await px(p, layer1, 500, 300))?.[3] ?? -1).toBe(255);
  expect((await px(p, layer1, 1400, 300))![3]).toBe(0);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await state(p)).pages[0]!.w).toBe(1181);
  await expect.poll(async () => (await px(p, layer1, 500, 300))?.[3] ?? -1).toBe(255);

  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator('#paint-view [data-act="export"]').click()]);
  const png = await readFile((await dl.path())!);
  expect(png.readUInt32BE(16), "the PNG is the page's width").toBe(1181);
  expect(png.readUInt32BE(20)).toBe(591);

  await p.locator('#paint-view [data-act="place"]').click();
  await expect(p.locator("body")).toHaveAttribute("data-view", "canvas");
  await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.objects())).filter((o) => o["kind"] === "image").length).toBe(1);
  const img = (await p.evaluate(() => window.__canvastDebug.objects())).find((o) => o["kind"] === "image")!;
  expect([img["pixelW"], img["pixelH"]]).toEqual([1181, 591]);
  expect(app.consoleErrors).toEqual([]);
});

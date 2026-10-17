import { expect, test } from "./harness";
import type { App } from "./harness";
import { makePng } from "./png";

/**
 * Pictures on the canvas (ADR 0118): crop, and non-destructive adjustments. Real input; assertions read the stored objects and pixels.
 */
type Pic = { id: string; kind: string; w: number; h: number; crop?: { x: number; y: number; w: number; h: number }; adjust?: Record<string, number> };
const objs = async (app: App): Promise<Pic[]> => (await app.page.evaluate(() => window.__canvastDebug.objects())) as unknown as Pic[];
const boxOf = async (app: App, id: string) => (await app.page.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
const px = (app: App, x: number, y: number) => app.page.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
const PIC = makePng(120, 80, (x, y) => [x * 2, y * 3, 100, 255]);

async function place(app: App, name = "pic.png", buffer = PIC): Promise<Pic> {
  const before = (await objs(app)).length;
  await app.page.getByTestId("import-input").setInputFiles({ name, mimeType: "image/png", buffer });
  await expect.poll(async () => (await objs(app)).length).toBe(before + 1);
  await app.frame();
  return (await objs(app)).at(-1)!;
}

test("crop: the picture's handles move its window, what stays does not move, pulling back out restores it, one undo each", async ({ app }) => {
  const p = app.page;
  const pic = await place(app);
  await p.keyboard.press("v");
  const b0 = await boxOf(app, pic.id);
  await p.mouse.click(Math.round((b0.minX + b0.maxX) / 2), Math.round((b0.minY + b0.maxY) / 2));
  await p.getByRole("button", { name: "Crop the picture" }).click();
  await expect(p.getByRole("button", { name: "Crop the picture" })).toHaveAttribute("aria-pressed", "true");
  const midY = Math.round((b0.minY + b0.maxY) / 2);
  await app.drag({ x: Math.round(b0.maxX), y: midY }, { x: Math.round(b0.maxX) - 80, y: midY }, 6);
  const c1 = (await objs(app)).find((o) => o.id === pic.id)!;
  expect(c1.crop, "cut in from the right").toBeTruthy();
  expect(c1.crop!.w).toBeLessThan(120);
  expect(c1.crop!.x).toBe(0);
  const b1 = await boxOf(app, pic.id);
  expect(b1.minX, "what is left has not moved").toBeCloseTo(b0.minX, 0);
  expect(b0.maxX - b1.maxX, "and the box follows the cut").toBeGreaterThan(70);
  // from the left too: the picture's own left edge stays where the cut leaves it
  const leftNow = Math.round(b1.minX);
  await app.drag({ x: leftNow, y: midY }, { x: leftNow + 40, y: midY }, 6);
  const c2 = (await objs(app)).find((o) => o.id === pic.id)!;
  expect(c2.crop!.x).toBeGreaterThan(0);
  const b2 = await boxOf(app, pic.id);
  expect(b2.minX - b1.minX).toBeGreaterThan(30);
  // the pixel at the middle of what is left is the one it was before the cut
  await p.keyboard.press("Enter");
  await expect(p.getByRole("button", { name: "Crop the picture" })).toHaveAttribute("aria-pressed", "false");
  await p.mouse.click(60, 650);
  // undo the two crops one by one, then crop and show the whole picture with the button
  await p.keyboard.press("Control+z");
  expect((await objs(app)).find((o) => o.id === pic.id)!.crop!.x).toBe(0);
  await p.keyboard.press("Control+z");
  expect((await objs(app)).find((o) => o.id === pic.id)!.crop).toBeUndefined();
  await p.keyboard.press("Control+Shift+z");
  await p.mouse.click(Math.round(b1.minX + 10), midY);
  await p.getByRole("button", { name: "Show the whole picture" }).click();
  const whole = (await objs(app)).find((o) => o.id === pic.id)!;
  expect(whole.crop).toBeUndefined();
  const bw = await boxOf(app, pic.id);
  expect(bw.maxX - bw.minX).toBeCloseTo(b0.maxX - b0.minX, 0);
  expect(bw.minX).toBeCloseTo(b0.minX, 0);
  expect(app.consoleErrors).toEqual([]);
});

test("adjustments: kept on the picture, drawn live, one undo step, copied to another, reset", async ({ app }) => {
  const p = app.page;
  const a = await place(app, "a.png");
  const ba = await boxOf(app, a.id);
  const at = [Math.round(ba.minX + (ba.maxX - ba.minX) * 0.25), Math.round(ba.minY + (ba.maxY - ba.minY) * 0.5)] as const;
  await p.keyboard.press("v");
  await p.mouse.click(60, 650);
  const dark = await px(app, ...at);
  await p.mouse.click(Math.round((ba.minX + ba.maxX) / 2), Math.round((ba.minY + ba.maxY) / 2));
  await p.getByRole("button", { name: "Adjust the picture" }).click();
  const pop = p.locator(".adjust-pop");
  await pop.locator('[data-adj-num="exposure"]').fill("70");
  await pop.locator('[data-adj-num="exposure"]').blur();
  expect((await objs(app)).find((o) => o.id === a.id)!.adjust).toEqual({ exposure: 70 });
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await app.frame();
  const bright = await px(app, ...at);
  expect(bright[0] + bright[1] + bright[2], "brighter than the original").toBeGreaterThan(dark[0] + dark[1] + dark[2] + 30);
  // a second picture takes the same adjustments by Copy and Paste
  const b = await place(app, "b.png", makePng(60, 60, () => [30, 80, 160, 255]));
  const bb = await boxOf(app, b.id);
  // (the second one is placed over the first: take the first by a point of its own, outside the second)
  const edge = [Math.round(ba.minX + 6), Math.round((ba.minY + ba.maxY) / 2)] as const;
  expect(edge[0] < bb.minX || edge[0] > bb.maxX || edge[1] < bb.minY || edge[1] > bb.maxY).toBe(true);
  await p.mouse.click(60, 650);
  await p.mouse.click(...edge);
  await p.getByRole("button", { name: "Adjust the picture" }).click();
  await pop.getByRole("button", { name: "Copy adjustments" }).click();
  await p.keyboard.press("Escape");
  await p.mouse.click(Math.round((bb.minX + bb.maxX) / 2), Math.round((bb.minY + bb.maxY) / 2));
  await p.getByRole("button", { name: "Adjust the picture" }).click();
  await pop.getByRole("button", { name: "Paste adjustments" }).click();
  expect((await objs(app)).find((o) => o.id === b.id)!.adjust).toEqual({ exposure: 70 });
  await p.keyboard.press("Control+z");
  expect((await objs(app)).find((o) => o.id === b.id)!.adjust, "one undo step").toBeUndefined();
  // reset
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await p.mouse.click(...edge);
  await p.getByRole("button", { name: "Adjust the picture" }).click();
  await pop.getByRole("button", { name: "Reset" }).click();
  expect((await objs(app)).find((o) => o.id === a.id)!.adjust).toBeUndefined();
  expect(app.consoleErrors).toEqual([]);
});

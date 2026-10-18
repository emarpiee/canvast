import { expect, test } from "./harness";
import type { App } from "./harness";
import { makePng } from "./png";
import { makeWebm } from "./video";

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

/** The Adjust panel is a dock panel: the button shows it, and it stays (ADR 0123). */
async function openAdjust(p: App["page"]): Promise<void> {
  if (!(await p.getByTestId("adjust-panel").isVisible())) await p.getByRole("button", { name: /^Adjust the picture/ }).click();
  await p.getByTestId("adjust-panel").locator(".adjust-pop").waitFor();
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
  // crop mode looks unlike resizing: what is cut away shows faintly beside the window, and is gone when cropping ends
  const ghostAt = [Math.round(b1.maxX) + 30, Math.round(b1.minY) + 15] as const;
  const bg = await px(app, 60, 650);
  expect(await px(app, ghostAt[0], ghostAt[1]), "the cut-away part shows").not.toEqual(bg);
  await expect(p.locator(".rail"), "the floating bars step aside while cropping").toBeHidden();
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
  await expect(p.locator(".rail")).toBeVisible();
  await p.mouse.click(60, 650);
  expect(await px(app, ghostAt[0], ghostAt[1]), "and is gone when cropping ends").toEqual(await px(app, 60, 650));
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
  await openAdjust(p);
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
  await p.getByTestId("context-bar").getByRole("button", { name: "Copy the adjustments of the picture" }).click(); // (on the bar under the picture)
  await p.mouse.click(Math.round((bb.minX + bb.maxX) / 2), Math.round((bb.minY + bb.maxY) / 2));
  await p.getByTestId("context-bar").getByRole("button", { name: "Paste the copied adjustments on the picked pictures" }).click();
  expect((await objs(app)).find((o) => o.id === b.id)!.adjust).toEqual({ exposure: 70 });
  await p.keyboard.press("Control+z");
  expect((await objs(app)).find((o) => o.id === b.id)!.adjust, "one undo step").toBeUndefined();
  // reset
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await p.mouse.click(...edge);
  await openAdjust(p);
  await pop.getByRole("button", { name: "Reset", exact: true }).click();
  expect((await objs(app)).find((o) => o.id === a.id)!.adjust).toBeUndefined();
  expect(app.consoleErrors).toEqual([]);
});

test("an adjusted picture too big to be decoded whole is still drawn whole when zoomed out (a reduced copy is adjusted at its own size)", async ({ app }) => {
  const p = app.page;
  const big = makePng(2400, 1600, (x, y) => [x % 256, y % 256, 120, 255]);
  const pic = await place(app, "big.png", big);
  await p.keyboard.press("v");
  const b = await boxOf(app, pic.id);
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await openAdjust(p);
  const pop = p.locator(".adjust-pop");
  await pop.locator('[data-adj-num="contrast"]').fill("30");
  await pop.locator('[data-adj-num="contrast"]').blur();
  await p.mouse.click(40, 700);
  await p.evaluate(() => window.__canvastDebug.jump(-3)); // far enough out that a reduced copy is used
  await app.frame();
  const s = await boxOf(app, pic.id);
  const bg = await px(app, 40, 700);
  // the far corner of the picture is the picture, not the empty page
  const corner = await px(app, Math.round(s.maxX - 3), Math.round(s.maxY - 3));
  expect(corner).not.toEqual(bg);
  expect(app.consoleErrors).toEqual([]);
});

test("Make a new picture files it as an edited picture: its own folder, name and tag, not those of extracted frames (ADR 0118)", async ({ app }) => {
  const p = app.page;
  const pic = await place(app, "holiday.png");
  await p.keyboard.press("v");
  const b = await boxOf(app, pic.id);
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await openAdjust(p);
  await p.locator('.adjust-pop [data-adj-num="exposure"]').fill("40");
  await p.locator('.adjust-pop [data-adj-num="exposure"]').blur();
  await p.getByTestId("context-bar").getByRole("button", { name: "Make a new picture of it as it looks now, beside it" }).click();
  await expect.poll(async () => (await objs(app)).length).toBe(2);
  const listing = await p.evaluate(() => window.__canvastDebug.assetListing());
  const made = listing.entries.find((e) => e.name.startsWith("holiday-edited"));
  expect(made, "named from the original and the edited name").toBeTruthy();
  expect(made!.tags).toContain("edited-picture");
  expect(made!.tags).not.toContain("extracted-frame");
  expect(listing.folders.map((f) => f.name)).toContain("Edited pictures");
  expect(listing.folders.map((f) => f.name)).not.toContain("Extracted frames");
  expect(app.consoleErrors).toEqual([]);
});

test("Download: an edited still comes with its original, named as edited pictures are; a plain one comes alone; a video's adjustments are said to stay on the canvas", async ({ app }) => {
  const p = app.page;
  const pic = await place(app, "trip.png");
  await p.keyboard.press("v");
  const b = await boxOf(app, pic.id);
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  // plain: the file as it is, under its own name
  const plain = p.waitForEvent("download");
  await p.getByTestId("context-bar").getByRole("button", { name: /^Download the original file/ }).click();
  expect((await plain).suggestedFilename()).toBe("trip.png");
  // adjusted: the original and the edited picture, in one ZIP
  await openAdjust(p);
  await p.locator('.adjust-pop [data-adj-num="contrast"]').fill("30");
  await p.locator('.adjust-pop [data-adj-num="contrast"]').blur();
  const both = p.waitForEvent("download");
  await p.getByTestId("context-bar").getByRole("button", { name: /^Download the original file/ }).click();
  const dl = await both;
  expect(dl.suggestedFilename()).toMatch(/\.zip$/);
  const text = (await import("node:fs")).readFileSync((await dl.path())!).toString("latin1");
  expect(text).toContain("trip.png");
  expect(text).toContain("trip-edited.png");
  expect(app.consoleErrors).toEqual([]);
});

test("Reset beside Adjust takes the adjustments off at once, and is there only while there are some", async ({ app }) => {
  const p = app.page;
  const pic = await place(app);
  await p.keyboard.press("v");
  const b = await boxOf(app, pic.id);
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  const reset = p.getByRole("button", { name: "Reset the adjustments" });
  await expect(reset).toBeHidden();
  await openAdjust(p);
  await p.locator('.adjust-pop [data-adj-num="exposure"]').fill("25");
  await p.locator('.adjust-pop [data-adj-num="exposure"]').blur();
  await expect(reset).toBeVisible();
  await reset.click();
  expect((await objs(app)).find((o) => o.id === pic.id)!.adjust).toBeUndefined();
  await expect(reset).toBeHidden();
  await p.keyboard.press("Control+z");
  expect((await objs(app)).find((o) => o.id === pic.id)!.adjust).toEqual({ exposure: 25 });
});

test("a video has every adjustment: highlights, shadows, tint, sharpen and grain too, through a filter the player and the canvas share", async ({ app }) => {
  const slow = expect.configure({ timeout: 20_000 });
  const p = app.page;
  const webm = await makeWebm(p, 2);
  await p.getByTestId("import-input").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: webm });
  await slow.poll(async () => (await objs(app)).length).toBe(1);
  const [v] = await objs(app);
  await p.keyboard.press("v");
  const b = await boxOf(app, v!.id);
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await slow(p.getByTestId("media-bar")).toBeVisible();
  await openAdjust(p);
  const pop = p.locator(".adjust-pop");
  for (const key of ["exposure", "highlights", "shadows", "tint", "sharpen", "grain"]) {
    await expect(pop.locator(`[data-adj-num="${key}"]`), `${key} is offered for a video`).toBeVisible();
  }
  for (const [key, val] of [["shadows", "40"], ["tint", "-20"], ["grain", "30"]] as const) {
    await pop.locator(`[data-adj-num="${key}"]`).fill(val);
    await pop.locator(`[data-adj-num="${key}"]`).blur();
  }
  expect((await objs(app)).find((o) => o.id === v!.id)!.adjust).toEqual({ shadows: 40, tint: -20, grain: 30 });
  // the player shows it through a filter that exists in the page and holds those steps
  await expect.poll(() => p.evaluate(() => document.querySelector<HTMLElement>("video.media-video")?.style.filter ?? "")).toMatch(/^url\("?#adj-/);
  const parts = await p.evaluate(() => {
    const url = document.querySelector<HTMLElement>("video.media-video")!.style.filter;
    const id = /#([^")]+)/.exec(url)![1]!;
    const f = document.getElementById(id)!;
    return [...f.children].map((c) => c.localName);
  });
  expect(parts).toContain("feComponentTransfer"); // shadows
  expect(parts).toContain("feColorMatrix"); // tint (and the grain's)
  expect(parts).toContain("feTurbulence"); // grain
  expect(app.consoleErrors).toEqual([]);
});

test("Styles: an adjustment is saved from the Adjust panel into the library's Styles card, applied from there to another picture, renamed, kept over a reload and deleted (ADR 0120)", async ({ app }) => {
  const p = app.page;
  const first = await place(app, "one.png");
  await p.keyboard.press("v");
  const b = await boxOf(app, first.id);
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await openAdjust(p);
  const pop = p.locator(".adjust-pop");
  await pop.locator('[data-adj-num="contrast"]').fill("30");
  await pop.locator('[data-adj-num="contrast"]').blur();
  await pop.locator("[data-adj-name]").fill("Punchy");
  await pop.getByRole("button", { name: "Save", exact: true }).click();
  await expect(pop.locator("[data-adj-name]")).toHaveAttribute("placeholder", /Saved/);
  // double-clicking a name takes that one number off
  await pop.locator('[data-adj-row="contrast"] label').dblclick();
  await expect(pop.locator('[data-adj-num="contrast"]')).toHaveValue("0");

  // the Styles panel lists it, with what it does, and renames it
  await p.getByRole("button", { name: "Styles panel", exact: true }).click();
  const panel = p.getByTestId("styles-panel");
  const card = (name: string) => panel.locator(".style-card", { hasText: name });
  await expect(card("Punchy")).toContainText("Contrast +30");
  await panel.getByRole("button", { name: /^More actions for style Punchy/ }).click();
  await p.getByRole("menuitem", { name: /^Rename style Punchy/ }).click();
  await p.locator(".style-rename").fill("Punchy 2");
  await p.keyboard.press("Enter");
  await expect(card("Punchy 2")).toBeVisible();
  // kept over a reload
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  if (!(await panel.isVisible())) await p.getByRole("button", { name: "Styles panel", exact: true }).click();
  await expect(card("Punchy 2")).toBeVisible();

  const second = await place(app, "two.png", makePng(60, 60, () => [30, 80, 160, 255]));
  await p.keyboard.press("v");
  const sb = await boxOf(app, second.id);
  await p.mouse.click(Math.round((sb.minX + sb.maxX) / 2), Math.round((sb.minY + sb.maxY) / 2));

  // ... and from the Styles panel: disabled with nothing selected, searchable, one undo step
  await p.mouse.click(1100, 700); // empty canvas: nothing selected
  await expect(card("Punchy 2")).toBeDisabled();
  await panel.getByRole("searchbox").fill("zzz");
  await expect(panel.getByText("No adjustments match.")).toBeVisible();
  await panel.getByRole("searchbox").fill("punchy");
  await p.mouse.click(Math.round((sb.minX + sb.maxX) / 2), Math.round((sb.minY + sb.maxY) / 2));
  await card("Punchy 2").click();
  expect((await objs(app)).find((o) => o.id === second.id)!.adjust).toEqual({ contrast: 30 });
  await p.keyboard.press("Control+z");
  expect((await objs(app)).find((o) => o.id === second.id)!.adjust).toBeUndefined();
  await panel.getByRole("tab", { name: /^Gradients/ }).click(); // another tab shows other styles
  await expect(card("Punchy 2")).toHaveCount(0);

  // deleted from the panel
  await panel.getByRole("tab", { name: /^Adjustments/ }).click();
  await panel.getByRole("button", { name: /^More actions for style Punchy 2/ }).click();
  await p.getByRole("menuitem", { name: /^Delete style Punchy 2/ }).click();
  await p.getByTestId("confirm-ok").click();
  await expect(panel).toContainText("Save an adjustment from the Adjust panel");
  expect(app.consoleErrors).toEqual([]);
});

test("Styles: a colour is saved from the colour picker, offered as Saved in the picker", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await p.locator("[data-colour-open]").click();
  await p.getByRole("button", { name: "Save colour" }).click();
  await p.keyboard.press("Escape");
  await p.locator("[data-colour-open]").click();
  await expect(p.locator(".colour-pop").getByText("Saved", { exact: true })).toBeVisible();
  expect(app.consoleErrors).toEqual([]);
});

test("adjustments: red, green and blue, levels, a curve and a stack of layers are kept on the picture, drawn, and each layer is edited on its own (ADR 0136)", async ({ app }) => {
  const p = app.page;
  const grey = makePng(80, 60, () => [100, 100, 100, 255]);
  const pic = await place(app, "grey.png", grey);
  const b = await boxOf(app, pic.id);
  const at = [Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2)] as const;
  await p.keyboard.press("v");
  await p.mouse.click(...at);
  await openAdjust(p);
  const pop = p.locator(".adjust-pop");
  const adjust = async () => (await objs(app)).find((o) => o.id === pic.id)!.adjust as Record<string, unknown> | undefined;
  // red: a stop of red added
  await pop.locator('[data-adj-num="red"]').fill("100");
  await pop.locator('[data-adj-num="red"]').blur();
  expect(await adjust()).toEqual({ red: 100 });
  await app.frame();
  const lit = await px(app, ...at);
  expect(lit[0]).toBeGreaterThan(lit[1] + 60);
  // levels of the red channel: its white point at 100 makes red full
  await pop.locator("[data-lv-ch]").selectOption("r");
  await pop.locator('[data-lv="white"]').fill("120");
  await pop.locator('[data-lv="white"]').blur();
  expect((await adjust())!["levels"]).toEqual({ r: { white: 120 } });
  // a curve of the blue channel: a point added by a click on the curve, then moved down with the keyboard
  await pop.locator("[data-cv-ch]").selectOption("b");
  const curve = pop.locator("[data-curve]");
  await curve.scrollIntoViewIfNeeded();
  const cb = (await curve.boundingBox())!;
  await p.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await curve.press("ArrowDown");
  await curve.press("Shift+ArrowDown");
  const blue = ((await adjust())!["curves"] as { b: number[][] }).b;
  expect(blue).toHaveLength(3);
  expect(blue[1]![1]).toBeLessThan(blue[1]![0]! - 5);
  // a second layer: its own numbers, applied to the result of the first
  await pop.getByRole("button", { name: "Add a layer of adjustments after this one" }).click();
  await expect(pop.locator("[data-layer]")).toHaveCount(2);
  await pop.locator('[data-adj-num="exposure"]').fill("30");
  await pop.locator('[data-adj-num="exposure"]').blur();
  const a2 = (await adjust())!;
  expect(a2["red"]).toBe(100);
  expect((a2["next"] as Record<string, unknown>)["exposure"]).toBe(30);
  // the first layer is still as it was, and the second is only what it has
  await pop.locator('[data-layer="0"]').click();
  await expect(pop.locator('[data-adj-num="red"]')).toHaveValue("100");
  await expect(pop.locator('[data-adj-num="exposure"]')).toHaveValue("0");
  await pop.locator('[data-layer="1"]').click();
  await expect(pop.locator('[data-adj-num="exposure"]')).toHaveValue("30");
  // removing the second layer leaves the first
  await pop.getByRole("button", { name: "Remove this layer" }).click();
  expect((await adjust())!["next"]).toBeUndefined();
  expect((await adjust())!["red"]).toBe(100);
  // reset takes everything off, one undo brings it back
  await pop.getByRole("button", { name: "Reset", exact: true }).click();
  expect(await adjust()).toBeUndefined();
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await p.mouse.click(...at);
  await p.keyboard.press("Control+z");
  expect((await adjust())!["red"]).toBe(100);
  expect(app.consoleErrors).toEqual([]);
});

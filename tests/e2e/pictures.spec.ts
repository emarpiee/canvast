import { exportWith, expect, outlineShapes, test } from "./harness";
import type { App } from "./harness";
import { makePng } from "./png";
import { encodeGif } from "./gif";
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
  await p.getByTestId("adjust-panel").getByRole("button", { name: "Reset the adjustments" }).click();
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
  await exportWith(p, "download"); // (an entry of the Actions bar's Export menu)
  expect((await plain).suggestedFilename()).toBe("trip.png");
  // adjusted: the original and the edited picture, in one ZIP
  await openAdjust(p);
  await p.locator('.adjust-pop [data-adj-num="contrast"]').fill("30");
  await p.locator('.adjust-pop [data-adj-num="contrast"]').blur();
  const both = p.waitForEvent("download");
  await exportWith(p, "download"); // (an entry of the Actions bar's Export menu)
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
  const reset = p.getByRole("toolbar", { name: "Tool options" }).getByRole("button", { name: "Reset the adjustments" });
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

test("the player stays right under its video, whatever else is on screen; the Actions bar (set to follow) goes above the video, or under the player when there is no room above", async ({ app }) => {
  const slow = expect.configure({ timeout: 20_000 });
  const p = app.page;
  await p.evaluate(() => localStorage.setItem("canvast.settings", JSON.stringify({ "ui.actions": "follow" })));
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("import-input").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: await makeWebm(p, 2) });
  await slow.poll(async () => (await objs(app)).length).toBe(1);
  const [v] = await objs(app);
  await p.keyboard.press("v");
  const rects = async () => {
    const b = await boxOf(app, v!.id);
    await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
    const player = (await p.getByTestId("media-bar").boundingBox())!;
    const actions = (await p.getByTestId("context-bar").boundingBox())!;
    return { b: await boxOf(app, v!.id), player, actions };
  };
  await slow(p.getByTestId("media-bar")).toBeHidden();
  let r = await rects();
  await slow(p.getByTestId("media-bar")).toBeVisible();
  r = await rects();
  expect(r.player.y, "the player is under the video").toBeGreaterThanOrEqual(r.b.maxY);
  expect(r.player.y - r.b.maxY, "right under it").toBeLessThan(40);
  expect(r.actions.y + r.actions.height, "the Actions bar is above the video when there is room").toBeLessThanOrEqual(r.b.minY);
  // No room above: the video is moved to the top of the view; the Actions bar goes under the player, the player stays under the video.
  const top = async () => (await boxOf(app, v!.id)).minY;
  const y0 = await top();
  await p.keyboard.press("ArrowUp");
  await app.frame();
  const toTop = (await top()) < y0 ? "ArrowUp" : "ArrowDown";
  for (let i = 0; i < 80 && (await top()) > 60; i++) await p.keyboard.press(toTop);
  r = await rects();
  expect(r.b.minY, "the video is at the top of the view").toBeLessThan(100);
  expect(r.player.y - r.b.maxY, "the player is still right under the video").toBeLessThan(40);
  expect(r.actions.y, "the Actions bar is under the player").toBeGreaterThanOrEqual(r.player.y + r.player.height);
  // Worst case: the video fills the view (and goes past it). The player is pulled up to stay on screen, the Actions bar stays on screen and off the player.
  const vh = p.viewportSize()!.height;
  for (let i = 0; i < 30; i++) {
    const b = await boxOf(app, v!.id);
    if (b.maxY - b.minY > vh * 0.9) break;
    await app.wheel(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2), -100);
  }
  r = await rects();
  expect(r.player.y + r.player.height, "the player is inside the view").toBeLessThanOrEqual(vh);
  expect(r.actions.y + r.actions.height, "the Actions bar is inside the view").toBeLessThanOrEqual(vh);
  expect(r.actions.y, "the Actions bar is inside the view").toBeGreaterThanOrEqual(0);
  expect(r.actions.y + r.actions.height <= r.player.y || r.actions.y >= r.player.y + r.player.height, "the two bars do not overlap").toBe(true);
});

test("Actions bar at the bottom (the default): when a low video brings its player down onto it, the bar stands above the player", async ({ app }) => {
  const slow = expect.configure({ timeout: 20_000 });
  const p = app.page;
  await p.getByTestId("import-input").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: await makeWebm(p, 2) });
  await slow.poll(async () => (await objs(app)).length).toBe(1);
  const [v] = await objs(app);
  await p.keyboard.press("v");
  const vh = p.viewportSize()!.height;
  const bottom = async () => (await boxOf(app, v!.id)).maxY;
  const y0 = await bottom();
  await p.keyboard.press("ArrowUp");
  await app.frame();
  const toBottom = (await bottom()) > y0 ? "ArrowUp" : "ArrowDown";
  for (let i = 0; i < 120 && (await bottom()) < vh - 110; i++) await p.keyboard.press(toBottom);
  const b = await boxOf(app, v!.id);
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await slow(p.getByTestId("media-bar")).toBeVisible();
  const player = (await p.getByTestId("media-bar").boundingBox())!;
  const actions = (await p.getByTestId("context-bar").boundingBox())!;
  expect(player.y - (await bottom()), "the player is under the video").toBeLessThan(40);
  expect(actions.y + actions.height <= player.y || actions.y >= player.y + player.height, "the two bars do not overlap").toBe(true);
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
  await expect.poll(async () => (await objs(app)).find((o) => o.id === v!.id)!.adjust).toEqual({ shadows: 40, tint: -20, grain: 30 });
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
  const foot = p.getByTestId("adjust-panel").locator(".panel-foot"); // (the save row stays under the numbers: ADR 0156)
  await foot.locator("[data-adj-name]").fill("Punchy");
  await foot.getByRole("button", { name: "Save", exact: true }).click();
  await expect(foot.locator("[data-adj-name]")).toHaveAttribute("placeholder", /Saved/);
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
  // a picture that follows the style changes with it: the style is updated from the first picture, and the second one follows (ADR 0157)
  await card("Punchy 2").click();
  expect((await objs(app)).find((o) => o.id === second.id)!.adjust).toEqual({ contrast: 30 });
  const fb = await boxOf(app, first.id);
  await p.mouse.click(Math.round((fb.minX + fb.maxX) / 2), Math.round((fb.minY + fb.maxY) / 2));
  await openAdjust(p);
  await pop.locator('[data-adj-num="contrast"]').fill("50");
  await pop.locator('[data-adj-num="contrast"]').blur();
  await panel.getByRole("button", { name: /^More actions for style Punchy 2/ }).click();
  await p.getByRole("menuitem", { name: /^Replace Punchy 2 with the adjustments/ }).click();
  await expect.poll(async () => (await objs(app)).find((o) => o.id === second.id)!.adjust).toEqual({ contrast: 50 });
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
  await expect(p.locator(".colour-pop").getByText("Saved colours", { exact: true })).toBeVisible();
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
  const layers = p.getByTestId("adjust-panel").locator(".panel-sub"); // (the layer row stays under the header: ADR 0156)
  await layers.getByRole("button", { name: "Add a layer of adjustments after this one" }).click();
  await expect(layers.locator("[data-layer]")).toHaveCount(2);
  await pop.locator('[data-adj-num="exposure"]').fill("30");
  await pop.locator('[data-adj-num="exposure"]').blur();
  const a2 = (await adjust())!;
  expect(a2["red"]).toBe(100);
  expect((a2["next"] as Record<string, unknown>)["exposure"]).toBe(30);
  // the first layer is still as it was, and the second is only what it has
  await layers.locator('[data-layer="0"]').click();
  await expect(pop.locator('[data-adj-num="red"]')).toHaveValue("100");
  await expect(pop.locator('[data-adj-num="exposure"]')).toHaveValue("0");
  await layers.locator('[data-layer="1"]').click();
  await expect(pop.locator('[data-adj-num="exposure"]')).toHaveValue("30");
  // removing the second layer leaves the first
  await layers.getByRole("button", { name: "Remove this layer" }).click();
  expect((await adjust())!["next"]).toBeUndefined();
  expect((await adjust())!["red"]).toBe(100);
  // reset takes everything off, one undo brings it back
  await p.getByTestId("adjust-panel").getByRole("button", { name: "Reset the adjustments" }).click();
  expect(await adjust()).toBeUndefined();
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await p.mouse.click(...at);
  await p.keyboard.press("Control+z");
  expect((await adjust())!["red"]).toBe(100);
  expect(app.consoleErrors).toEqual([]);
});

test("a video plays at the speed set for it and can be cropped: the player shows only the window of every frame (ADR 0137)", async ({ app }) => {
  const slow = expect.configure({ timeout: 20_000 });
  const p = app.page;
  const webm = await makeWebm(p, 2);
  await p.getByTestId("import-input").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: webm });
  await slow.poll(async () => (await objs(app)).length).toBe(1);
  const [v] = await objs(app);
  await p.keyboard.press("v");
  const b0 = await boxOf(app, v!.id);
  await p.mouse.click(Math.round((b0.minX + b0.maxX) / 2), Math.round((b0.minY + b0.maxY) / 2));
  await slow(p.getByTestId("media-bar")).toBeVisible();
  // speed: kept on the instance and given to the player
  await p.getByTestId("media-bar").getByRole("button", { name: "Media & Playback settings" }).click();
  await p.getByRole("combobox", { name: "Playing speed" }).selectOption("2");
  const media = async () => ((await objs(app)).find((o) => o.id === v!.id) as unknown as { media: { speed?: number } }).media;
  expect((await media()).speed).toBe(2);
  await expect.poll(() => p.evaluate(() => document.querySelector<HTMLVideoElement>("video.media-video")?.playbackRate)).toBe(2);
  await p.getByRole("combobox", { name: "Playing speed" }).selectOption("1");
  expect((await media()).speed).toBeUndefined(); // (1 is the default: not stored)
  // crop: cut in from the right; the window is smaller, the player is clipped to it
  await p.getByTestId("media-bar").getByRole("button", { name: "Media & Playback settings" }).click(); // (the settings are over the picture: closed)
  await p.getByRole("button", { name: "Crop the picture" }).click();
  const midY = Math.round((b0.minY + b0.maxY) / 2);
  await app.drag({ x: Math.round(b0.maxX), y: midY }, { x: Math.round(b0.maxX) - 60, y: midY }, 6);
  const c = (await objs(app)).find((o) => o.id === v!.id)!;
  expect(c.crop, "cut in from the right").toBeTruthy();
  await p.keyboard.press("Enter");
  await expect.poll(() => p.evaluate(() => document.querySelector<HTMLElement>("video.media-video")?.style.clipPath ?? "")).toMatch(/^inset\(/);
  const el = await p.evaluate(() => {
    const e = document.querySelector<HTMLElement>("video.media-video")!;
    const r = e.getBoundingClientRect();
    return { w: r.width, clip: e.style.clipPath };
  });
  const b1 = await boxOf(app, v!.id);
  expect(b1.maxX - b1.minX).toBeLessThan(b0.maxX - b0.minX - 40); // the object is narrower
  expect(el.w).toBeGreaterThan(b1.maxX - b1.minX); // the player is the whole picture, clipped
  expect(app.consoleErrors).toEqual([]);
});

test("a picture gets rounded corners and an outline with the same controls as a shape (ADR 0148): Radius, and the Outline options (width, position); one undo each, and they survive a reload", async ({ app }) => {
  const p = app.page;
  const pic = await place(app);
  await p.keyboard.press("v");
  const b0 = await boxOf(app, pic.id);
  const mid = Math.round((b0.minY + b0.maxY) / 2);
  await p.mouse.click(Math.round((b0.minX + b0.maxX) / 2), mid);
  const radius = p.locator("[data-sel-radius]");
  await expect(radius, "the shape's own Radius field").toBeVisible();
  await expect(p.locator('[data-paint="fill"]'), "a picture has no fill").toBeHidden();
  await expect(p.locator('[data-paint="stroke"]')).toBeVisible();
  const corner = [Math.round(b0.minX) + 3, Math.round(b0.minY) + 3] as const;
  const away = async () => { await p.mouse.click(60, 650); await app.frame(); }; // (no selection box over what is read)
  const pickAgain = async () => { await p.mouse.click(Math.round((b0.minX + b0.maxX) / 2), mid); await app.frame(); };
  await away();
  const inside = await px(app, corner[0], corner[1]);
  const behind = await px(app, corner[0], Math.round(b0.minY) - 4); // (the ground just above the corner)
  expect(inside, "a square corner shows the picture").not.toEqual(behind);
  await pickAgain();
  await radius.fill("40");
  await radius.press("Enter");
  await app.frame();
  const rounded = (await objs(app)).find((o) => o.id === pic.id) as unknown as { radius?: number };
  expect(rounded.radius).toBeCloseTo(40, 0);
  await away();
  expect(await px(app, corner[0], corner[1]), "a rounded corner shows what is behind it").toEqual(behind);
  await pickAgain();
  // the outline: the shape's popover, a width and a position
  await p.click("[data-outline-options]");
  const width = p.locator(".op-width").first();
  await expect(width).toBeVisible();
  await width.fill("6");
  await width.press("Enter");
  await p.locator('[data-align="outside"]').click();
  await key2(app, "Escape");
  await app.frame();
  const look = (await objs(app)).find((o) => o.id === pic.id) as unknown as { stroke?: string; width?: number; align?: string };
  expect(look.stroke, "white to begin with, as a shape's first outline").toBe("#ffffff");
  expect(look.width).toBeCloseTo(6, 0);
  expect(look.align).toBe("outside");
  await away();
  expect(await px(app, Math.round(b0.minX) - 3, mid), "the line is outside the edge").toEqual([255, 255, 255]);
  expect(await px(app, Math.round(b0.minX) + 3, mid), "and none of it over the picture").not.toEqual([255, 255, 255]);
  await pickAgain();
  for (let i = 0; i < 3; i++) await key2(app, "Control+z");
  const bare = (await objs(app)).find((o) => o.id === pic.id) as unknown as { radius?: number; stroke?: string; align?: string };
  expect([bare.radius, bare.stroke, bare.align], "three undo steps take all of it away").toEqual([undefined, undefined, undefined]);
  for (let i = 0; i < 3; i++) await key2(app, "Control+y");
  await app.frame();
  await expect(p.getByTestId("save-status")).toContainText("Saved"); // (the debounced save has landed)
  await p.reload();
  await p.waitForFunction(() => window.__canvastDebug !== undefined);
  await expect.poll(async () => (await objs(app)).length).toBe(1);
  const again = (await objs(app)).find((o) => o.id === pic.id) as unknown as { radius?: number; stroke?: string; align?: string };
  expect(again.radius).toBeCloseTo(40, 0);
  expect(again.stroke).toBe("#ffffff");
  expect(again.align).toBe("outside");
  expect(app.consoleErrors).toEqual([]);
});
test("a picture's corner radius has a dot on the canvas, a click in a cut corner does not pick it, and its outline can be a gradient with handles (ADR 0153)", async ({ app }) => {
  const p = app.page;
  const pic = await place(app);
  await p.keyboard.press("v");
  const b0 = await boxOf(app, pic.id);
  const mid = Math.round((b0.minY + b0.maxY) / 2);
  const centre = Math.round((b0.minX + b0.maxX) / 2);
  const away = async () => { await p.mouse.click(60, 650); await app.frame(); };
  await p.mouse.click(centre, mid);
  // the dot: drag it along the corner's diagonal and the radius follows, live
  const d0 = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!.main;
  expect(d0, "a picked picture has the dot").toBeTruthy();
  await app.drag({ x: d0[0], y: d0[1] }, { x: d0[0] + 40, y: d0[1] + 40 });
  const r1 = ((await objs(app)).find((o) => o.id === pic.id) as unknown as { radius?: number | number[] }).radius as number;
  expect(r1).toBeGreaterThan(5);
  await p.keyboard.press("Control+z");
  expect(((await objs(app)).find((o) => o.id === pic.id) as unknown as { radius?: number }).radius, "one undo step").toBeUndefined();
  await p.keyboard.press("Control+y");
  // a click in the cut corner picks what is behind it (nothing), a click just inside picks the picture
  await p.locator("[data-sel-radius]").fill("60");
  await p.locator("[data-sel-radius]").press("Enter");
  await away();
  await p.mouse.click(Math.round(b0.minX) + 3, Math.round(b0.minY) + 3);
  expect(await p.evaluate(() => window.__canvastDebug.selection()), "the cut corner is not the picture").toHaveLength(0);
  await p.mouse.click(centre, mid);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toHaveLength(1);
  // the outline: white first, then a gradient from white to nothing, left to right
  await p.click("[data-outline-options]");
  const width = p.locator(".op-width").first();
  await width.fill("8");
  await width.press("Enter");
  await p.keyboard.press("Escape");
  const pop = p.locator(".colour-pop");
  await p.click('[data-paint="stroke"]');
  await pop.locator('[data-mode="linear"]').click();
  await p.keyboard.press("Escape");
  type Grad = { type: string; x0: number; x1: number };
  const strokeOf = async () => ((await objs(app)).find((o) => o.id === pic.id) as unknown as { stroke?: Grad | string }).stroke;
  expect(await strokeOf(), "the outline is a gradient").toMatchObject({ type: "linear", x0: 0, x1: 1 });
  await away();
  const white = (c: number[]) => c[0]! > 240 && c[1]! > 240 && c[2]! > 240;
  expect(white(await px(app, Math.round(b0.minX) + 1, mid)), "the start of the gradient is white").toBe(true);
  expect(white(await px(app, Math.round(b0.maxX) - 2, mid)), "the end of the line is gone").toBe(false);
  // its handle on the canvas: the end dragged to the middle
  await p.mouse.click(centre, mid);
  await app.drag({ x: Math.round(b0.maxX) - 1, y: mid }, { x: centre, y: mid });
  const g = (await strokeOf()) as Grad;
  expect(g.x1).toBeGreaterThan(0.4);
  expect(g.x1).toBeLessThan(0.6);
  await p.keyboard.press("Control+z");
  expect(((await strokeOf()) as Grad).x1, "one undo step").toBe(1);
  // turned a quarter: the dot is on the turned picture, and still sets the radius
  await app.drag({ x: centre, y: Math.round(b0.minY) - 26 }, { x: centre + Math.round(mid - b0.minY) + 26, y: mid }, 8);
  const b1 = await boxOf(app, pic.id);
  const d1 = (await p.evaluate(() => window.__canvastDebug.cornerDots()))!.main;
  expect(d1[0]).toBeGreaterThan(b1.minX - 2);
  expect(d1[0]).toBeLessThan(b1.maxX + 2);
  expect(d1[1]).toBeGreaterThan(b1.minY - 2);
  expect(d1[1]).toBeLessThan(b1.maxY + 2);
  const radiusNow = async () => ((await objs(app)).find((o) => o.id === pic.id) as unknown as { radius?: number }).radius;
  const before = await radiusNow();
  const cx1 = (b1.minX + b1.maxX) / 2, cy1 = (b1.minY + b1.maxY) / 2;
  const dx = Math.sign(cx1 - d1[0]) * 25, dy = Math.sign(cy1 - d1[1]) * 25; // (inwards: a bigger radius)
  await app.drag({ x: d1[0], y: d1[1] }, { x: d1[0] + dx, y: d1[1] + dy });
  expect(await radiusNow(), "the dot on a turned picture sets the radius").not.toBe(before);
  expect(app.consoleErrors).toEqual([]);
});
const key2 = (app: App, k: string) => app.page.keyboard.press(k);

test("a curve's points are dragged with the mouse: a point added by a click, an end point moved, kept as one undo step each (the panel is not rebuilt under the drag)", async ({ app }) => {
  const p = app.page;
  const pic = await place(app, "grey.png", makePng(80, 60, () => [100, 100, 100, 255]));
  const b = await boxOf(app, pic.id);
  await p.keyboard.press("v");
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await openAdjust(p);
  const curve = p.locator(".adjust-pop [data-curve]");
  await curve.scrollIntoViewIfNeeded();
  const cb = (await curve.boundingBox())!;
  const master = async () => (((await objs(app)).find((o) => o.id === pic.id)!.adjust as { curves?: { master: number[][] } } | undefined)?.curves?.master);
  const mx = cb.x + cb.width / 2, my = cb.y + cb.height / 2;
  await p.mouse.move(mx, my);
  await p.mouse.down();
  await p.mouse.move(mx + 20, my - 30, { steps: 8 }); // (a point is added where it is pressed, then dragged up and right)
  await p.mouse.up();
  const dragged = (await master())!;
  expect(dragged).toHaveLength(3);
  expect(dragged[1]![1], "the middle point went up").toBeGreaterThan(dragged[1]![0]! + 8);
  await p.mouse.move(cb.x + 6, cb.y + cb.height - 6); // the black end
  await p.mouse.down();
  await p.mouse.move(cb.x + 6, cb.y + cb.height - 60, { steps: 8 });
  await p.mouse.up();
  expect((await master())![0]![1], "the end point was lifted").toBeGreaterThan(40);
  await p.keyboard.press("Control+z");
  expect((await master())![0]![1], "one undo step").toBe(0);
  expect(app.consoleErrors).toEqual([]);
});

/** A rectangle drawn with the Shape tool, then the Select tool and the rectangle picked: ready for its Fill to be opened. */
async function pickedRect(app: App, from: readonly [number, number], to: readonly [number, number]): Promise<Pic & { fill?: unknown }> {
  const p = app.page;
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="rect"]').click();
  await app.drag({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, 6);
  const rect = (await objs(app)).at(-1)!;
  await p.keyboard.press("v");
  await p.mouse.click(60, 650);
  await p.mouse.click(Math.round((from[0] + to[0]) / 2), Math.round((from[1] + to[1]) / 2));
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([rect.id]);
  return rect;
}
const fillOf = async (app: App, id: string) => (await objs(app)).find((o) => o.id === id) as unknown as { fill?: { type?: string; src?: { kind: string; hash?: string; ids?: string[] }; mode?: string; spacing?: number[] } | string | null };
const is = (c: number[] | undefined, r: number, g: number, b: number): boolean => !!c && Math.abs(c[0]! - r) < 12 && Math.abs(c[1]! - g) < 12 && Math.abs(c[2]! - b) < 12;

test("a number changed in the fill options never makes the chooser blink: it stays fully shown while the value is changed again and again", async ({ app }) => {
  const p = app.page;
  const picture = await place(app, "halves.png", makePng(40, 40, (x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255])));
  const rect = await pickedRect(app, [400, 450], [600, 550]);
  const pop = p.locator(".colour-pop");
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="image"]').click();
  await pop.locator("[data-tex-pick]").click();
  const pb = await boxOf(app, picture.id);
  await p.mouse.click(Math.round((pb.minX + pb.maxX) / 2), Math.round((pb.minY + pb.maxY) / 2));
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { type?: string } | undefined)?.type).toBe("texture");
  await p.waitForTimeout(500); // (the chooser has finished appearing)
  const dips = await p.evaluate(async () => {
    const pop = document.querySelector<HTMLElement>(".colour-pop")!;
    const num = document.querySelector<HTMLInputElement>('[data-tex-num="scale"]')!;
    const seen: number[] = [];
    for (let v = 30; v <= 90; v += 6) {
      num.value = String(v);
      num.dispatchEvent(new Event("input", { bubbles: true }));
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => requestAnimationFrame(() => r(0)));
        seen.push(Number(getComputedStyle(pop).opacity));
      }
    }
    return seen.filter((o) => o < 0.99);
  });
  expect(dips, "the chooser's opacity never drops").toEqual([]);
  // Randomize: another set of options, in one undo step
  const before = JSON.stringify((await fillOf(app, rect.id)).fill);
  await pop.locator("[data-tex-random]").click();
  await expect.poll(async () => JSON.stringify((await fillOf(app, rect.id)).fill)).not.toBe(before);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Control+z");
  expect(JSON.stringify((await fillOf(app, rect.id)).fill), "one undo step").toBe(before);
});

test("picture and objects fills still show their own colour far inside the shape, where they are no longer drawn as patterns (not their average)", async ({ app }) => {
  const p = app.page;
  const picture = await place(app, "halves.png", makePng(40, 40, (x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255])));
  const vp = p.viewportSize()!;
  const [cx, cy] = [Math.round(vp.width / 2), Math.round(vp.height / 2)];
  const rect = await pickedRect(app, [cx + 160, cy - 60], [cx + 560, cy + 120]); // right of the picture; the view is moved over it below
  const pop = p.locator(".colour-pop");
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="image"]').click();
  await pop.locator("[data-tex-pick]").click();
  const pb = await boxOf(app, picture.id);
  await p.mouse.click(Math.round((pb.minX + pb.maxX) / 2), Math.round((pb.minY + pb.maxY) / 2));
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { type?: string } | undefined)?.type).toBe("texture");
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  // move the view until its middle is in the left (red) quarter of the rectangle
  const left = async () => (await boxOf(app, rect.id)).minX;
  const before = await left();
  await p.keyboard.press("ArrowRight");
  await app.frame();
  const key = (await left()) < before ? "ArrowRight" : "ArrowLeft";
  for (let i = 0; i < 60 && (await left()) > cx - 60; i++) await p.keyboard.press(key);
  await app.frame();
  expect(is(await px(app, cx, cy), 255, 0, 0), "in the red half of the picture").toBe(true);
  await p.evaluate(() => window.__canvastDebug.jump(20));
  await app.frame();
  const deep = await px(app, cx, cy);
  expect(is(deep, 255, 0, 0), `deep inside the red half: red, not the purple average (${deep})`).toBe(true);
  await p.evaluate(() => window.__canvastDebug.jump(-20));
  await app.frame();
  expect(is(await px(app, cx, cy), 255, 0, 0), "back out: the picture is drawn again").toBe(true);
});

test("a picture fill can take its picture from the library first: a panel of the library's pictures, searched by name, opens beside the chooser", async ({ app }) => {
  const p = app.page;
  await place(app, "alpha.png", makePng(40, 40, () => [255, 0, 0, 255]));
  const beta = await place(app, "beta.png", makePng(40, 40, () => [0, 0, 255, 255]));
  const rect = await pickedRect(app, [400, 450], [600, 550]);
  const pop = p.locator(".colour-pop");
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="image"]').click();
  const first = await pop.locator(".tex-source button").first().textContent();
  expect(first, "the library is the first way").toContain("library");
  await pop.locator("[data-tex-lib]").click();
  const lib = p.locator(".lib-pick");
  await expect(lib.locator(".lib-item")).toHaveCount(2);
  await lib.locator("[data-lib-search]").fill("bet");
  await expect(lib.locator(".lib-item")).toHaveCount(1);
  await lib.locator(".lib-item").click();
  await expect(lib).toBeHidden();
  await expect(pop, "the chooser stays open").toBeVisible();
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { src?: { hash?: string } } | undefined)?.src?.hash).toBe((await objs(app)).find((o) => o.id === beta.id) && (await fillOf(app, beta.id) as unknown as { assetId: string }).assetId);
});

test("a picture fills a shape (ADR 0154): picked on the canvas, Fill covers it, Tile repeats it, space opens gaps; one undo step, kept after a reload", async ({ app }) => {
  const p = app.page;
  const picture = await place(app, "halves.png", makePng(40, 40, (x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255])));
  const rect = await pickedRect(app, [400, 450], [600, 550]); // 200 × 100, below the picture
  const pop = p.locator(".colour-pop");
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="image"]').click();
  await expect(pop.locator("[data-tex-note]")).toContainText("Choose a picture");
  await pop.locator("[data-tex-pick]").click();
  // a click on something that is not a picture is not a source; the chooser stays open, and Esc ends the pick
  await p.mouse.click(500, 500);
  await expect(pop, "the chooser stays while a source is being picked").toBeVisible();
  expect(typeof (await fillOf(app, rect.id)).fill, "still its own fill").toBe("string");
  const pb = await boxOf(app, picture.id);
  await p.mouse.click(Math.round((pb.minX + pb.maxX) / 2), Math.round((pb.minY + pb.maxY) / 2));
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { type?: string } | undefined)?.type).toBe("texture");
  const t = (await fillOf(app, rect.id)).fill as { src: { kind: string; hash: string }; mode: string };
  expect([t.src.kind, t.mode]).toEqual(["asset", "fill"]);
  await expect(pop.locator("[data-tex-note]")).toContainText("Picture");
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await app.frame();
  // Fill: the picture covers the shape, its red half on the left and its blue half on the right
  expect(is(await px(app, 430, 500), 255, 0, 0), "left: red").toBe(true);
  expect(is(await px(app, 570, 500), 0, 0, 255), "right: blue").toBe(true);
  // Tile: a repeat a quarter of the longer side across (50 px): red, blue, red again 50 px on
  await p.mouse.click(500, 500);
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-tex-sel="mode"]').selectOption("tile");
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await app.frame();
  expect([is(await px(app, 410, 470), 255, 0, 0), is(await px(app, 435, 470), 0, 0, 255), is(await px(app, 460, 470), 255, 0, 0), is(await px(app, 485, 470), 0, 0, 255)], "red, blue, red, blue").toEqual([true, true, true, true]);
  // a tile of space across: the tiles are 50 px in cells of 100, so the first 25 px of each cell is the ground
  await p.mouse.click(500, 500);
  await p.click('[data-paint="fill"]');
  const space = pop.locator('[data-tex-num="sx"]');
  await space.fill("100");
  await space.press("Enter");
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await app.frame();
  const ground = await px(app, 60, 650);
  expect([await px(app, 410, 470), is(await px(app, 435, 470), 255, 0, 0), is(await px(app, 460, 470), 0, 0, 255)], "ground, then the tile").toEqual([ground, true, true]);
  // one undo step each, and it all survives a reload
  await p.mouse.click(500, 500);
  await p.keyboard.press("Control+z");
  expect(((await fillOf(app, rect.id)).fill as { spacing: number[] }).spacing).toEqual([0, 0]);
  await p.keyboard.press("Control+y");
  await app.frame();
  await expect(p.getByTestId("save-status")).toContainText("Saved");
  await p.reload();
  await p.waitForFunction(() => window.__canvastDebug !== undefined);
  await expect.poll(async () => (await objs(app)).length).toBe(2);
  await app.frame();
  const again = (await fillOf(app, rect.id)).fill as { src: { hash: string }; spacing: number[] };
  expect([again.src.hash, again.spacing]).toEqual([t.src.hash, [1, 0]]);
  await expect.poll(async () => is(await px(app, 435, 470), 255, 0, 0)).toBe(true);
  // a picture file chosen in the chooser goes into the library and becomes the source; the placement stays
  await p.mouse.click(500, 500);
  await p.click('[data-paint="fill"]');
  await p.locator(".colour-pop [data-tex-input]").setInputFiles({ name: "green.png", mimeType: "image/png", buffer: makePng(8, 8, () => [0, 200, 0, 255]) });
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { src: { hash: string } }).src.hash).not.toBe(t.src.hash);
  expect(((await fillOf(app, rect.id)).fill as { spacing: number[] }).spacing, "the placement is kept").toEqual([1, 0]);
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await expect.poll(async () => is(await px(app, 435, 470), 0, 200, 0)).toBe(true);
  expect(app.consoleErrors).toEqual([]);
});

test("objects repeat over a shape as a fill (ADR 0154): picked on the canvas, the grid and its rows, and a change to the source changes the fill", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="ellipse"]').click();
  await app.drag({ x: 900, y: 300 }, { x: 960, y: 360 }, 6); // the source: a 60 px ellipse
  const src = (await objs(app)).at(-1)!;
  const rect = await pickedRect(app, [400, 450], [700, 600]); // 300 × 150: the tile is 75 px
  const pop = p.locator(".colour-pop");
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="objects"]').click();
  await pop.locator("[data-tex-pick]").click();
  await p.mouse.click(930, 330);
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { src?: { kind: string; ids: string[] } } | undefined)?.src?.ids).toEqual([src.id]);
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await app.frame();
  const ground = await px(app, 60, 650);
  const blue = await px(app, 930, 330); // the source's own fill
  // the middle of a tile has the ellipse's fill, the corner of it is the ground, and the next tile is the same
  expect([await px(app, 437, 487), await px(app, 512, 487), await px(app, 403, 453)]).toEqual([blue, blue, ground]);
  // brick rows: the second row is half a tile across, so the middle of its first tile is under the seam of the first row
  await p.mouse.click(550, 525);
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-tex-sel="tile"]').selectOption("hex-h");
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await app.frame();
  expect([await px(app, 437, 487), await px(app, 475, 562)], "row one at 37, row two half a tile across").toEqual([blue, blue]);
  // the source is hidden (the usual way to use a shape as a tile): the fill still shows it
  await p.mouse.click(930, 330);
  await p.getByRole("button", { name: "Layers panel", exact: true }).click();
  await p.getByTestId("layers-panel").locator('[data-do="hide"]').click();
  await p.mouse.click(60, 650);
  await app.frame();
  expect(await px(app, 930, 330), "the source itself is gone from the canvas").toEqual(ground);
  expect(await px(app, 437, 487), "and the fill still has it").toEqual(blue);
  await p.keyboard.press("Control+z"); // (shown again)
  await app.frame();
  // the source changes (its fill is taken away): the fill follows
  await p.mouse.click(930, 330);
  await p.click('[data-paint="fill"]');
  await pop.locator(".colour-none").click();
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await app.frame();
  expect(await px(app, 437, 487), "the fill shows the change").not.toEqual(blue);
  // deep in and far out: tiles as big as the screen, then too small to see (their average colour), without a fault
  await app.wheel(550, 525, -6000);
  await app.frame();
  await app.wheel(550, 525, 20000);
  await app.frame();
  expect(app.consoleErrors).toEqual([]);
});

test("an objects fill of an objects fill shows the inner one, follows a change of the innermost source, and a cycle or itself as the source cannot hang or error", async ({ app }) => {
  const p = app.page;
  await outlineShapes(p);
  const pop = p.locator(".colour-pop");
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="ellipse"]').click();
  await app.drag({ x: 950, y: 320 }, { x: 1010, y: 380 }, 6); // S: the source
  const s = (await objs(app)).at(-1)!;
  const t = await pickedRect(app, [400, 320], [700, 470]);
  const setObjects = async (target: [number, number], source: [number, number]) => {
    // (the chooser of the step before may still be open over the shape, or be closed by this Fill: press away, pick the shape, try again until the chooser is open)
    await expect(async () => {
      await p.keyboard.press("Escape");
      await p.mouse.click(60, 650);
      await p.mouse.click(...target);
      await p.click('[data-paint="fill"]', { timeout: 1500 });
      await expect(pop).toBeVisible({ timeout: 1500 }); // (Fill on an open chooser closes it: then try again)
    }).toPass({ timeout: 20000 });
    await pop.locator('[data-mode="objects"]').click();
    await pop.locator("[data-tex-pick]").click();
    await p.mouse.click(...source);
    await p.keyboard.press("Escape");
    await p.mouse.click(60, 650);
    await app.frame();
  };
  // the share of a region's pixels that are the colour of S's middle, and of the ground (a flat average has neither a grid nor gaps)
  const [blue, ground] = [(await px(app, 980, 350)).join(), (await px(app, 60, 650)).join()]; // (before S loses its fill)
  const share = async (x0: number, y0: number, w: number, h: number) => {
    let [nb, ng, n] = [0, 0, 0];
    for (let y = y0 + 4; y < y0 + h; y += 8) for (let x = x0 + 4; x < x0 + w; x += 8, n++) {
      const c = (await px(app, x, y)).join();
      if (c === blue) nb++;
      else if (c === ground) ng++;
    }
    return { blue: nb / n, ground: ng / n };
  };
  await setObjects([670, 440], [980, 350]); // T <- S (clicks on the right of the shapes: the chooser of the step before may still cover their middle)
  await pickedRect(app, [400, 520], [700, 670]); // Q
  await setObjects([670, 640], [670, 440]); // Q <- T
  const inner = await share(400, 520, 300, 150);
  expect(inner.blue, "Q shows the ellipses of T's fill").toBeGreaterThan(0.1);
  expect(inner.ground, "and the gaps between them (not one flat colour)").toBeGreaterThan(0.1);
  // the innermost source loses its fill: Q, two fills away, follows
  await p.mouse.click(60, 650);
  await p.mouse.click(980, 350);
  await p.click('[data-paint="fill"]');
  await pop.locator(".colour-none").click();
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await app.frame();
  expect((await share(400, 520, 300, 150)).blue, "Q follows the change of S").toBeLessThan(inner.blue / 4);
  // a cycle (S uses T, T uses S) and a shape that is its own source: drawn, no error
  await p.keyboard.press("Control+z"); // (S has its fill again, so it can be clicked)
  await setObjects([980, 350], [670, 440]);
  await setObjects([670, 440], [670, 440]);
  await app.wheel(550, 395, -3000);
  await app.frame();
  expect(app.consoleErrors).toEqual([]);
  expect(s.id).not.toBe(t.id);
});

test("a sparse objects fill (small shapes far apart) far out is the colour of its shapes, not pale or white", async ({ app }) => {
  const p = app.page;
  const pop = p.locator(".colour-pop");
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="ellipse"]').click();
  await app.drag({ x: 900, y: 300 }, { x: 960, y: 360 }, 6);
  const rect = await pickedRect(app, [400, 450], [700, 600]);
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="objects"]').click();
  await pop.locator("[data-tex-pick]").click();
  await p.mouse.click(930, 330);
  for (const [k, v] of [["sx", "300"], ["sy", "300"], ["scale", "10"]]) await pop.locator(`[data-tex-num="${k}"]`).fill(v!);
  await pop.locator('[data-tex-num="scale"]').press("Enter");
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { spacing?: number[] } | undefined)?.spacing).toEqual([3, 3]);
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { scale?: number } | undefined)?.scale).toBeCloseTo(0.1, 5);
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  // far out the tiles are below 2 px and the shape is one flat colour: that of the ellipses (blue), whatever little of the tile they cover
  await app.wheel(550, 525, 4500);
  await app.frame();
  const seen = new Set<string>();
  for (let y = 505; y <= 545; y += 4) for (let x = 530; x <= 570; x += 4) seen.add((await px(app, x, y)).join());
  const flat = [...seen].filter((c) => { const [r, , b] = c.split(",").map(Number); return b! > r! + 60; }); // blue, not the grey-green ground
  expect(flat.length, "the shape is still blue far out").toBeGreaterThan(0);
  for (const c of flat) {
    const [r, g, b] = c.split(",").map(Number) as [number, number, number];
    // between the ellipse's outline (31,35,41) and its fill (37,99,235): an average cannot be brighter than anything it averages
    expect([r <= 40 && r >= 28, g <= 102 && g >= 32, b <= 238 && b >= 38].every(Boolean), `${c} lies between the outline and the fill of the ellipses`).toBe(true);
  }
});

test("an SVG export of an objects fill is the tile put where the canvas puts it (as images cut to the shape), not one flat colour", async ({ app }) => {
  const p = app.page;
  const pop = p.locator(".colour-pop");
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="ellipse"]').click();
  await app.drag({ x: 900, y: 300 }, { x: 960, y: 360 }, 6);
  const rect = await pickedRect(app, [400, 450], [700, 600]);
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="objects"]').click();
  await pop.locator("[data-tex-pick]").click();
  await p.mouse.click(930, 330);
  await pop.locator('[data-tex-sel="tile"]').selectOption("hex-h");
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { tile?: string } | undefined)?.tile).toBe("hex-h");
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await p.mouse.click(670, 580);
  await exportWith(p, "exportpic");
  const dlg = p.getByTestId("export-dialog");
  await dlg.locator('[data-format="svg"]').click();
  const [download] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
  const svg = (await import("node:fs")).readFileSync((await download.path())!, "utf8");
  expect(svg, "the tile, put where the canvas puts it, cut to the shape (no <pattern>: Qt's SVG leaves it empty)").toMatch(/<g clip-path="url\(#t\d+c\)"><use xlink:href="#t\d+i"/);
  expect(svg).not.toContain("<pattern");
  expect(svg, "the shapes of the source as vectors (one group, used for each tile), not a picture of them").not.toContain("<image");
  expect(svg).toMatch(/<g id="t\d+i" transform="scale\([^)]+\)">\s*<path /);
  // drawn: the blue ellipses and the clear gaps between them are both there (a flat fill has one or the other)
  const share = await p.evaluate(async (text) => {
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 400;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, 400, 400);
    const d = g.getImageData(0, 0, 400, 400).data;
    let [blue, clear] = [0, 0];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! === 0) clear++;
      else if (d[i + 2]! > 180 && d[i]! < 90) blue++;
    }
    return { blue: blue / (d.length / 4), clear: clear / (d.length / 4) };
  }, svg);
  expect(share.blue, "ellipses of the tile").toBeGreaterThan(0.05);
  expect(share.clear, "gaps between them").toBeGreaterThan(0.05);
});

test("an SVG export of a picture fill is the picture itself, put where the canvas puts it and cut to the shape (not its average colour)", async ({ app }) => {
  const p = app.page;
  const picture = await place(app, "halves.png", makePng(40, 40, (x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255])));
  const rect = await pickedRect(app, [400, 450], [600, 550]);
  const pop = p.locator(".colour-pop");
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="image"]').click();
  await pop.locator("[data-tex-pick]").click();
  const pb = await boxOf(app, picture.id);
  await p.mouse.click(Math.round((pb.minX + pb.maxX) / 2), Math.round((pb.minY + pb.maxY) / 2));
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { type?: string } | undefined)?.type).toBe("texture");
  await p.keyboard.press("Escape");
  await p.mouse.click(60, 650);
  await p.mouse.click(500, 500);
  await exportWith(p, "exportpic");
  const dlg = p.getByTestId("export-dialog");
  await dlg.locator('[data-format="svg"]').click();
  const [download] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
  const svg = (await import("node:fs")).readFileSync((await download.path())!, "utf8");
  expect(svg).toMatch(/<g clip-path="url\(#t\d+c\)"><use xlink:href="#t\d+i"/);
  expect(svg).toMatch(/<image id="t\d+i" xlink:href="data:image\/png;base64,/);
  expect(svg, "design tools leave a <pattern> empty").not.toContain("<pattern");
  const side = await p.evaluate(async (text) => {
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 200;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, 200, 200);
    const at = (x: number, y: number) => [...g.getImageData(x, y, 1, 1).data];
    return { left: at(30, 100), right: at(170, 100) };
  }, svg);
  expect(is(side.left as never, 255, 0, 0), `left half red (${side.left})`).toBe(true);
  expect(is(side.right as never, 0, 0, 255), `right half blue (${side.right})`).toBe(true);
});

test("Ctrl+C on a picture or a GIF puts only the picture on the system clipboard (the still as it looks, a GIF as its current frame), and Ctrl+V here pastes the picture itself", async ({ app }) => {
  test.skip(app.page.context().browser()?.browserType().name() !== "chromium", "the clipboard picture is read back in Chromium");
  const p = app.page;
  await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const clip = () => p.evaluate(async () => {
    const it = (await navigator.clipboard.read())[0]!;
    const bmp = it.types.includes("image/png") ? await createImageBitmap(await it.getType("image/png")) : null;
    return { types: it.types, w: bmp?.width ?? 0, h: bmp?.height ?? 0 };
  });
  const a = await place(app);
  await p.keyboard.press("v");
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Control+c");
  await expect.poll(async () => (await clip()).types.join(",")).toBe("image/png"); // (no "N objects" text: an app that prefers text still gets the picture)
  expect(await clip()).toMatchObject({ w: 120, h: 80 });
  await p.keyboard.press("Control+v");
  await expect.poll(async () => (await objs(app)).length).toBe(2);
  expect((await objs(app)).map((o) => (o as Pic & { assetId?: string }).assetId)).toEqual([(a as Pic & { assetId?: string }).assetId, (a as Pic & { assetId?: string }).assetId]);
  // a GIF goes as the frame it shows
  await p.getByTestId("import-input").setInputFiles({ name: "t.gif", mimeType: "image/gif", buffer: Buffer.from(encodeGif(8, 8, [[255, 0, 0], [0, 0, 255]], [0, 1].map((c) => ({ w: 8, h: 8, pixels: Array(64).fill(c) })))) });
  await expect.poll(async () => (await objs(app)).length).toBe(3);
  await app.frame();
  const g = (await objs(app)).at(-1)!;
  const gb = await boxOf(app, g.id);
  await p.keyboard.press("v");
  await p.mouse.click(Math.round((gb.minX + gb.maxX) / 2), Math.round((gb.minY + gb.maxY) / 2));
  await p.keyboard.press("Control+c");
  await expect.poll(async () => (await clip()).types.join(",")).toBe("image/png");
  expect(await clip()).toMatchObject({ w: 8, h: 8 });
  expect(app.consoleErrors).toEqual([]);
});

test("Ctrl+C on a shape with a picture fill puts the picture of it on the system clipboard, not the megabytes of SVG text an embedded fill would be", async ({ app }) => {
  test.skip(app.page.context().browser()?.browserType().name() !== "chromium", "the clipboard picture is read back in Chromium");
  const p = app.page;
  await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const picture = await place(app, "halves.png", makePng(40, 40, (x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255])));
  const rect = await pickedRect(app, [400, 450], [600, 550]);
  const pop = p.locator(".colour-pop");
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="image"]').click();
  await pop.locator("[data-tex-pick]").click();
  const pb = await boxOf(app, picture.id);
  await p.mouse.click(Math.round((pb.minX + pb.maxX) / 2), Math.round((pb.minY + pb.maxY) / 2));
  await expect.poll(async () => ((await fillOf(app, rect.id)).fill as { type?: string } | undefined)?.type).toBe("texture");
  await p.keyboard.press("Escape");
  await p.mouse.click(500, 500);
  await p.keyboard.press("Control+c");
  await expect.poll(async () => p.evaluate(async () => (await navigator.clipboard.read())[0]?.types.join(",") ?? "")).toBe("image/png");
  await p.keyboard.press("Control+v");
  await expect.poll(async () => (await objs(app)).filter((o) => o.kind === "path").length).toBe(2);
  expect(app.consoleErrors).toEqual([]);
});

test("a picture can have a drop shadow too: it is drawn beside the picture, and the picture's own pixels are not adjusted twice", async ({ app }) => {
  const p = app.page;
  const pic = await place(app);
  await p.keyboard.press("v");
  const b = await boxOf(app, pic.id);
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  const mid = [Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2)] as const;
  const below = [mid[0], Math.round(b.maxY) + 5] as const;
  const bg = await px(app, below[0], below[1]);
  const inside = await px(app, mid[0], mid[1]);
  await openAdjust(p);
  await p.locator('.adjust-pop [data-adj-num="dropOpacity"]').fill("100");
  await p.locator('.adjust-pop [data-adj-num="dropOpacity"]').blur();
  await app.frame();
  expect(await px(app, below[0], below[1]), "a shadow below the picture").not.toEqual(bg);
  expect(await px(app, mid[0], mid[1]), "the picture itself is as it was").toEqual(inside);
});

test("an adjustment's number can be dragged left or right to change it, like the other number fields: one undo step", async ({ app }) => {
  const p = app.page;
  const pic = await place(app);
  await p.keyboard.press("v");
  const b = await boxOf(app, pic.id);
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await openAdjust(p);
  for (const key of ["exposure", "dropBlur"]) {
    const f = p.locator(`.adjust-pop [data-adj-num="${key}"]`);
    await f.scrollIntoViewIfNeeded();
    const r = (await f.boundingBox())!;
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x + 40, y, { steps: 6 });
    await p.mouse.up();
    expect(Number(await f.inputValue()), `${key} follows the drag`).toBeGreaterThan(0);
  }
  // with Shift the value lands on the round steps of its range (a range of 200 has steps of 10; a range of 100, of 5)
  for (const [key, step] of [["contrast", 10], ["sharpen", 5]] as const) {
    const f = p.locator(`.adjust-pop [data-adj-num="${key}"]`);
    await f.scrollIntoViewIfNeeded();
    const r = (await f.boundingBox())!;
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.keyboard.down("Shift");
    await p.mouse.move(x + 27, y, { steps: 9 });
    await p.mouse.up();
    await p.keyboard.up("Shift");
    const v = Number(await f.inputValue());
    expect(v, `${key} moved`).toBeGreaterThan(0);
    expect(v % step, `${key} is on a step of ${step}`).toBe(0);
  }
  const adj = (await objs(app)).find((o) => o.id === pic.id)!.adjust!;
  expect(adj["exposure"]).toBeGreaterThan(0);
  await p.keyboard.press("Control+z");
  expect((await objs(app)).find((o) => o.id === pic.id)!.adjust?.["exposure"], "the first drag is its own undo step").toBeGreaterThan(0);
});

test("every group of adjustments has its own Reset: it takes that group off, one undo step, and is off while the group is untouched", async ({ app }) => {
  const p = app.page;
  const pic = await place(app);
  await p.keyboard.press("v");
  const b = await boxOf(app, pic.id);
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await openAdjust(p);
  const adj = async () => (await objs(app)).find((o) => o.id === pic.id)!.adjust;
  const reset = (name: string) => p.locator(`.adjust-pop [data-group-reset="${name}"]`);
  await expect(reset("Light"), "nothing to reset yet").toBeDisabled();
  for (const [key, v] of [["exposure", "30"], ["saturation", "-20"], ["blur", "10"]] as const) {
    await p.locator(`.adjust-pop [data-adj-num="${key}"]`).fill(v);
    await p.locator(`.adjust-pop [data-adj-num="${key}"]`).blur();
  }
  expect(await adj()).toEqual({ exposure: 30, saturation: -20, blur: 10 });
  await expect(reset("Light")).toBeEnabled();
  await reset("Light").click();
  expect(await adj(), "only the Light group went").toEqual({ saturation: -20, blur: 10 });
  await expect(reset("Light")).toBeDisabled();
  await reset("Colour").click();
  await reset("Detail").click();
  expect(await adj(), "all gone").toBeUndefined();
  await p.keyboard.press("Control+z");
  expect(await adj(), "undo brings back the last group reset").toEqual({ blur: 10 });
});

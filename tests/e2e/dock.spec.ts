import { expect, test } from "./harness";
import type { App } from "./harness";

/**
 * The panel dock (ADR 0123): stacks on both sides, the free layer, folding by the title bar, used order, width limits, and a layout that
 * is remembered. Real mouse input on the title bars and the edge grips.
 */
const item = (app: App, id: string) => app.page.locator(`.dock-item[data-dock="${id}"]`);
const open = async (app: App, name: string) => app.page.getByRole("button", { name, exact: true }).click();
const titleOf = (app: App, id: string) => item(app, id).locator("header h2");

test("panels stack on the two sides in the order they were last used; a title bar folds and unfolds its panel", async ({ app }) => {
  await open(app, "Layers panel");
  await open(app, "Tags panel");
  await open(app, "Bookmarks panel");
  const vw = app.page.viewportSize()!.width;
  expect((await item(app, "layers").boundingBox())!.x, "Layers on the right").toBeGreaterThan(vw / 2);
  expect((await item(app, "tags").boundingBox())!.x, "Tags on the left").toBeLessThan(vw / 2);
  const tags = (await item(app, "tags").boundingBox())!, marks = (await item(app, "bookmarks").boundingBox())!;
  expect(marks.y, "the one used last is on top").toBeLessThan(tags.y);
  // pressing a title bar folds the panel to its bar; again unfolds it
  await titleOf(app, "tags").click();
  await expect(item(app, "tags")).toHaveAttribute("data-folded", "");
  expect((await item(app, "tags").boundingBox())!.height, "only the bar is left").toBeLessThan(60);
  await titleOf(app, "tags").click();
  await expect(item(app, "tags")).not.toHaveAttribute("data-folded", "");
  // the title bar by keyboard: Tab reaches it, Enter folds, Space unfolds
  await titleOf(app, "tags").locator("xpath=..").focus();
  await app.page.keyboard.press("Enter");
  await expect(item(app, "tags")).toHaveAttribute("data-folded", "");
  await app.page.keyboard.press("Space");
  await expect(item(app, "tags")).not.toHaveAttribute("data-folded", "");
  // unfolding counts as use: Tags is now above Bookmarks
  expect((await item(app, "tags").boundingBox())!.y).toBeLessThan((await item(app, "bookmarks").boundingBox())!.y);
  expect(app.consoleErrors).toEqual([]);
});

test("a dragged title bar floats the panel; dropped at an edge it stacks there; the width is limited; the layout is kept over a reload", async ({ app }) => {
  const p = app.page;
  await open(app, "Tags panel");
  const head = titleOf(app, "tags");
  const hb = (await head.boundingBox())!;
  await p.mouse.move(hb.x + 20, hb.y + hb.height / 2);
  await p.mouse.down();
  await p.mouse.move(hb.x + 200, hb.y + 160, { steps: 6 });
  await p.mouse.move(hb.x + 420, hb.y + 240, { steps: 6 });
  await p.mouse.up();
  await expect(item(app, "tags")).toHaveAttribute("data-side", "float");
  const floated = (await item(app, "tags").boundingBox())!;
  expect(floated.x, "moved with the pointer").toBeGreaterThan(hb.x + 300);
  // the width: pulled far out it stops at the limit, pushed far in it stops at the least
  const grip = (await item(app, "tags").locator(".dock-grip").boundingBox())!;
  await p.mouse.move(grip.x + 2, grip.y + 40);
  await p.mouse.down();
  await p.mouse.move(grip.x + 900, grip.y + 40, { steps: 8 });
  await p.mouse.up();
  expect((await item(app, "tags").boundingBox())!.width).toBeLessThanOrEqual(480.5);
  const grip2 = (await item(app, "tags").locator(".dock-grip").boundingBox())!;
  await p.mouse.move(grip2.x + 2, grip2.y + 40);
  await p.mouse.down();
  await p.mouse.move(grip2.x - 900, grip2.y + 40, { steps: 8 });
  await p.mouse.up();
  expect((await item(app, "tags").boundingBox())!.width).toBeGreaterThanOrEqual(239.5);
  // dropped at the right edge: it stacks on the right
  const fb = (await titleOf(app, "tags").boundingBox())!;
  const vw = p.viewportSize()!.width;
  await p.mouse.move(fb.x + 20, fb.y + fb.height / 2);
  await p.mouse.down();
  await p.mouse.move(vw - 30, fb.y + 100, { steps: 8 });
  await p.mouse.up();
  await expect(item(app, "tags")).toHaveAttribute("data-side", "right");
  // kept over a reload
  await p.waitForTimeout(400); // (the layout is written a moment after the last change)
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(item(app, "tags")).toHaveAttribute("data-side", "right");
  expect(app.consoleErrors).toEqual([]);
});

test("the Adjust panel is a dock panel: it follows the picked picture and can be folded like the others", async ({ app }) => {
  const p = app.page;
  const { makePng } = await import("./png");
  await p.getByTestId("import-input").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: makePng(80, 60, () => [90, 120, 150, 255]) });
  await expect.poll(async () => ((await p.evaluate(() => window.__canvastDebug.objects())) as unknown[]).length).toBe(1);
  await app.frame();
  const o = ((await p.evaluate(() => window.__canvastDebug.objects())) as Array<{ id: string }>)[0]!;
  await p.keyboard.press("v");
  const b = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), o.id))!.box;
  await p.mouse.click((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  await p.getByRole("button", { name: /^Adjust the picture/ }).click();
  await expect(item(app, "adjust").locator(".adjust-pop")).toBeVisible();
  await titleOf(app, "adjust").click();
  await expect(item(app, "adjust")).toHaveAttribute("data-folded", "");
  await p.mouse.click(1100, 700); // nothing picked
  await titleOf(app, "adjust").click();
  await expect(item(app, "adjust")).toContainText("Select a picture, video, GIF, shape or text");
  expect(app.consoleErrors).toEqual([]);
});

test("stacked panels share one width per side (the other side keeps its own); a panel let go keeps that width and then has its own; moving and resizing redraw nothing in the page", async ({ app }) => {
  const p = app.page;
  await open(app, "Layers panel");
  await open(app, "Tags panel");
  await open(app, "Bookmarks panel");
  const width = async (id: string) => (await item(app, id).boundingBox())!.width;
  const w0 = await width("tags");
  const sideOf = (id: string) => item(app, id).getAttribute("data-side");
  expect(await sideOf("layers"), "layers and tags are on different sides").not.toBe(await sideOf("tags"));
  expect(await sideOf("bookmarks")).toBe(await sideOf("tags"));
  expect(await width("bookmarks")).toBeCloseTo(w0, 0);
  expect(await width("layers")).toBeCloseTo(w0, 0);
  // widen one stacked panel: the panels of its side follow, the other side does not
  const grip = (await item(app, "tags").locator(".dock-grip").boundingBox())!;
  await p.mouse.move(grip.x + 2, grip.y + 40);
  await p.mouse.down();
  await p.mouse.move(grip.x + 70, grip.y + 40, { steps: 6 });
  await p.mouse.up();
  const w1 = await width("tags");
  expect(w1).toBeGreaterThan(w0 + 40);
  expect(await width("bookmarks")).toBeCloseTo(w1, 0);
  expect(await width("layers"), "the other side is not resized").toBeCloseTo(w0, 0);
  // let go of one: it keeps the shared width, and then resizes on its own
  const hb = (await titleOf(app, "tags").boundingBox())!;
  await p.mouse.move(hb.x + 20, hb.y + hb.height / 2);
  await p.mouse.down();
  await p.mouse.move(hb.x + 300, hb.y + 200, { steps: 6 });
  await p.mouse.up();
  await expect(item(app, "tags")).toHaveAttribute("data-side", "float");
  expect(await width("tags")).toBeCloseTo(w1, 0);
  // dragging a panel moves no node of the page: the other panels are the very same elements (no flicker from re-inserting them)
  await p.evaluate(() => {
    const el = document.querySelector('.dock-item[data-dock="bookmarks"]')!;
    (window as unknown as { __kept: Element }).__kept = el;
    (window as unknown as { __moves: number }).__moves = 0;
    new MutationObserver((l) => ((window as unknown as { __moves: number }).__moves += l.filter((m) => m.type === "childList").length)).observe(el.parentElement!, { childList: true });
  });
  const fb = (await titleOf(app, "tags").boundingBox())!;
  await p.mouse.move(fb.x + 20, fb.y + fb.height / 2);
  await p.mouse.down();
  await p.mouse.move(fb.x + 120, fb.y + 120, { steps: 12 });
  await p.mouse.up();
  expect(await p.evaluate(() => (window as unknown as { __moves: number }).__moves), "moving a floating panel inserts nothing").toBe(0);
  expect(app.consoleErrors).toEqual([]);
});

test("Settings > Panels: minimize all inactive panels keeps only the active one open on each side; keep the latest N keeps that many (ADR 0123)", async ({ app }) => {
  const p = app.page;
  for (const n of ["Layers panel", "Tags panel", "Bookmarks panel", "Styles panel"]) await open(app, n);
  const folded = (id: string) => item(app, id).getAttribute("data-folded");
  expect(await folded("tags"), "off: nothing is folded for the person").toBeNull();
  await p.getByTestId("view-settings").click();
  await p.locator("#set-tab-panels").click();
  const set = (key: string) => p.locator(`[data-set="${key}"]`);
  await expect(set("panel.keep")).toHaveAttribute("max", "5"); // up to the panels the app has
  await set("panel.autoFold").selectOption("all");
  await p.getByTestId("view-canvas").click();
  // left stack, last used first: Styles, Bookmarks, Tags: only the active one (Styles) stays open; the right stack's only panel stays open
  expect(await folded("styles")).toBeNull();
  expect(await folded("bookmarks")).toBe("");
  expect(await folded("tags")).toBe("");
  expect(await folded("layers")).toBeNull();
  // using a folded panel brings it to the top and folds the one that was open
  await titleOf(app, "tags").click();
  expect(await folded("tags")).toBeNull();
  expect(await folded("styles")).toBe("");
  // the latest two stay open
  await p.getByTestId("view-settings").click();
  await p.locator("#set-tab-panels").click();
  await set("panel.autoFold").selectOption("latest");
  await set("panel.keep").fill("2");
  await p.getByTestId("view-canvas").click();
  await titleOf(app, "bookmarks").click(); // Bookmarks is used: Bookmarks and Tags stay open, Styles stays folded
  expect(await folded("bookmarks")).toBeNull();
  expect(await folded("tags")).toBeNull();
  expect(await folded("styles")).toBe("");
  expect(app.consoleErrors).toEqual([]);
});

test("the kinds of the Pen and Shape tools open beside their rail button, centred on it, in every density", async ({ app }) => {
  const p = app.page;
  for (const density of ["dense", "compact", "comfortable"]) {
    await p.evaluate((d) => (d === "compact" ? delete document.documentElement.dataset["density"] : (document.documentElement.dataset["density"] = d)), density);
    for (const [tool, fly] of [["pen", "pen"], ["shape", "shape"]] as const) {
      await p.locator(`.rail [data-tool="${tool}"]`).click();
      const a = (await p.locator(`.rail-fly[data-fly="${fly}"]`).boundingBox())!;
      const b = (await p.locator(`.rail [data-tool="${tool}"]`).boundingBox())!;
      expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)), `${tool} in ${density}: centred on its button`).toBeLessThan(1.5);
      expect(a.x, `${tool} in ${density}: beside it, not over it`).toBeGreaterThanOrEqual(b.x + b.width);
    }
  }
});

test("a plain wheel over a bar's row that is wider than the window scrolls it sideways (every bar: bar.ts syncScroll), not the canvas", async ({ app }) => {
  const p = app.page;
  await p.setViewportSize({ width: 380, height: 800 });
  const row = p.locator(".hud-controls[data-scroll]"); // (the view controls: wider than a narrow window)
  await expect(row).toBeVisible();
  const before = await p.evaluate(() => window.__canvastDebug.camera());
  const b = (await row.boundingBox())!;
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.wheel(0, 200);
  await expect.poll(() => row.evaluate((r) => r.scrollLeft)).toBeGreaterThan(0);
  expect(await p.evaluate(() => window.__canvastDebug.camera()), "the canvas did not move or zoom").toEqual(before);
  expect(app.consoleErrors).toEqual([]);
});

import { expect, test } from "./harness";

/** The colour picker (ADR 0098): the pen colour from the toolbar and from Settings, three models, two layouts, what is remembered. */

test("colour picker: ring, box, hex, models, layouts, recent colours, Settings (ADR 0098)", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  const chip = p.locator("[data-colour-open]");
  await chip.click();
  const pop = p.locator(".colour-pop");
  await expect(pop).toBeVisible();
  const hex = pop.locator("[data-hex]");
  const start = await hex.inputValue();

  // The ring sets the hue, the box the other two channels; the colour is the pen's.
  const ring = await pop.locator("[data-wheel]").boundingBox();
  await p.mouse.click(ring!.x + ring!.width - 8, ring!.y + ring!.height / 2); // the ring, at the east
  const east = await hex.inputValue();
  expect(east).not.toBe(start);
  const area = await pop.locator("[data-area]").boundingBox();
  await p.mouse.move(area!.x + area!.width * 0.5, area!.y + area!.height * 0.5);
  await p.mouse.down();
  await p.mouse.move(area!.x + area!.width * 0.9, area!.y + area!.height * 0.1, { steps: 4 });
  await p.mouse.up();
  const picked = await hex.inputValue();
  expect(picked).not.toBe(east);

  // A stroke drawn now has that colour (the pen follows the picker).
  await p.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await app.drag({ x: 500, y: 400 }, { x: 800, y: 460 }, 6);
  const [stroke] = (await p.evaluate(() => window.__canvastDebug.objects())) as unknown as Array<{ color: string }>;
  expect(stroke!.color).toBe(`#${picked.toLowerCase()}`);

  // Another model keeps the colour; typing a hex sets it; the layouts switch.
  await chip.click();
  await pop.getByRole("radio", { name: "OKHSL" }).click();
  expect(await hex.inputValue()).toBe(picked);
  await pop.locator("[data-view-select]").selectOption("sliders");
  await expect(pop.locator("[data-wheel]")).toBeHidden();
  await pop.locator('[data-slider="1"]').focus();
  await p.keyboard.press("PageDown");
  expect(await hex.inputValue()).not.toBe(picked);
  await hex.fill("ff0000");
  await hex.press("Enter");
  await p.keyboard.press("Escape");

  // Model, layout and the recent colours survive a reload.
  await p.reload();
  await p.waitForFunction(() => !!window.__canvastDebug);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("canvast.settings")!));
  expect(saved["colour.model"]).toBe("okhsl");
  expect(saved["colour.view"]).toBe("sliders");
  expect(String(saved["colour.recent"]).startsWith("#ff0000")).toBe(true);

  // Settings uses the same picker for the pen colour.
  await p.getByTestId("view-settings").click();
  const row = p.locator('#settings-view [data-colour="pen.color"]');
  await expect(row.locator(".set-colour-hex")).toHaveText("#FF0000");
  await row.click();
  await expect(pop).toBeVisible();
  await pop.locator("[data-hex]").fill("00ff00");
  await expect(row.locator(".set-colour-hex")).toHaveText("#00FF00");
  expect(await p.evaluate(() => JSON.parse(localStorage.getItem("canvast.settings")!)["pen.color"])).toBe("#00ff00");
});

test("colour picker: a copied hex takes the #, a pasted one loses it; a long press on a swatch copies it without choosing it (also a right click)", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await p.evaluate(() => { const w = window as unknown as { copied: string }; w.copied = ""; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => { w.copied = t; } }, configurable: true }); });
  const pop = p.locator(".colour-pop");
  const hex = pop.locator("[data-hex]");
  await p.locator("[data-colour-open]").click();
  await hex.fill("123456");
  await hex.press("Enter");
  // copy / cut of the whole field carry the #; a paste with one leaves it out (Chromium: Firefox gives a made-up clipboard event no data)
  const chromium = p.context().browser()?.browserType().name() === "chromium";
  await hex.focus();
  await hex.press("Control+a");
  const out = await hex.evaluate((e) => { const dt = new DataTransfer(); e.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true })); return dt.getData("text/plain"); });
  if (chromium) {
    expect(out).toBe("#123456");
    await hex.press("Control+a");
    await hex.evaluate((e) => { const dt = new DataTransfer(); dt.setData("text/plain", "#00ff7f"); e.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); });
    await expect(hex).toHaveValue("00FF7F");
  }
  await hex.press("Enter");
  await p.keyboard.press("Escape");
  // a swatch (the recent colours): long press copies "#RRGGBB" and leaves the picker's colour alone; a short click still chooses it
  await p.locator("[data-colour-open]").click();
  await hex.fill("abcdef");
  await hex.press("Enter");
  const sw = pop.locator(".cp-swatch[data-c]").first();
  const want = `#${String(await sw.getAttribute("data-c")).replace("#", "").toUpperCase()}`;
  const before = await hex.inputValue();
  const box = (await sw.boundingBox())!;
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(650);
  await p.mouse.up();
  expect(await p.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(want);
  expect(await hex.inputValue(), "a long press does not choose").toBe(before);
  await p.evaluate(() => { (window as unknown as { copied: string }).copied = ""; });
  await sw.click({ button: "right" });
  expect(await p.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(want);
  expect(await hex.inputValue()).toBe(before);
  await sw.click();
  expect(await hex.inputValue(), "a click chooses").toBe(want.slice(1));
  expect(app.consoleErrors).toEqual([]);
});

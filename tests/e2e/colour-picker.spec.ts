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
  await pop.getByRole("radio", { name: "Sliders" }).click();
  await expect(pop.locator("[data-wheel]")).toBeHidden();
  await pop.locator('[data-slider="1"]').focus();
  await p.keyboard.press("PageDown");
  expect(await hex.inputValue()).not.toBe(picked);
  await hex.fill("ff0000");
  await hex.press("Enter");
  await p.keyboard.press("Escape");
  await expect(p.locator('[data-recents] [data-color="#ff0000"]')).toHaveCount(1);

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

import { expect, test } from "./harness";

/** The Settings view (ADR 0048): tabs, rows that write the shared store, scope and reset, theme, and what is remembered. */

test("settings view: tabs, a row reaches the tools, reset, theme and reload (ADR 0048)", async ({ app }) => {
  const p = app.page;
  const view = p.getByTestId("view-settings");
  const panel = p.locator("#settings-view");
  await expect(panel).toBeHidden();
  await view.click();
  await expect(panel).toBeVisible();
  expect(await p.evaluate(() => window.__canvastDebug.appView())).toBe("settings");
  // Canvas shortcuts do not act here (P would pick the pen), and the tabs move with the arrow keys.
  const tool = () => p.evaluate(() => window.__canvastDebug.tool());
  const before = await tool();
  await p.keyboard.press("p");
  expect(await tool()).toBe(before);
  await expect(panel.getByRole("tab", { name: "Drawing and selection" })).toHaveAttribute("aria-selected", "true");
  await p.keyboard.press("ArrowDown");
  await expect(panel.getByRole("tab", { name: "Media and playback" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator("#set-panel-media")).toBeVisible();
  await expect(panel.locator("#set-panel-drawing")).toBeHidden();
  // A row writes the shared store and the tool: the marker is one translucent stroke.
  await panel.getByRole("tab", { name: "Drawing and selection" }).click();
  const pen = panel.getByLabel("Pen", { exact: true });
  await pen.selectOption("marker");
  const reset = panel.getByRole("button", { name: "Reset Pen to its default" });
  await expect(reset).toBeEnabled();
  expect(await p.evaluate(() => JSON.parse(localStorage.getItem("canvast.settings")!)["pen.kind"])).toBe("marker");
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  expect(await p.evaluate(() => window.__canvastDebug.appView())).toBe("canvas");
  await p.keyboard.press("p");
  await app.drag({ x: 400, y: 300 }, { x: 700, y: 360 }, 6);
  const [stroke] = (await p.evaluate(() => window.__canvastDebug.objects())) as unknown as Array<{ opacity: number }>;
  expect(stroke!.opacity).toBeLessThan(1);
  // Reset goes back to the default pen (and a value the row refuses is not stored).
  await view.click();
  await reset.click();
  await expect(pen).toHaveValue("fine");
  await expect(reset).toBeDisabled();
  // Theme: dark and light are applied at once and kept across a reload.
  await panel.getByRole("tab", { name: "Appearance" }).click();
  await panel.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(p.locator("html")).toHaveAttribute("data-theme", "dark");
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  await app.frame();
  const bg = async () => (await p.evaluate(() => window.__canvastDebug.pixelAt(6, 6))).join(",");
  const dark = await bg();
  await view.click();
  await panel.getByLabel("Theme", { exact: true }).selectOption("light");
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  await app.frame();
  expect(await bg(), "the canvas background follows the theme").not.toBe(dark);
  await view.click();
  await panel.getByLabel("Theme", { exact: true }).selectOption("dark");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(p.locator("html")).toHaveAttribute("data-theme", "dark");
  // The Settings view itself is not remembered; the canvas opens.
  expect(await p.evaluate(() => window.__canvastDebug.appView())).toBe("canvas");
  // The Storage tab reports what the browser says.
  await p.getByTestId("view-settings").click();
  await p.locator("#settings-view").getByRole("tab", { name: "Storage" }).click();
  await expect(p.locator("#settings-view [data-used]")).toHaveText(/MB|GB|unknown/);
  expect(app.consoleErrors).toEqual([]);
});

test("shortcuts: tool keys can be changed and are refused when taken; the list opens with ? (ADR 0049)", async ({ app }) => {
  const p = app.page;
  const panel = p.locator("#settings-view");
  const tool = () => p.evaluate(() => window.__canvastDebug.tool());
  // "?" opens the list on the Shortcuts tab; the fixed shortcuts are there.
  await p.keyboard.press("?");
  await expect(panel).toBeVisible();
  await expect(panel.locator("#set-panel-shortcuts")).toBeVisible();
  await expect(panel.locator("#set-panel-shortcuts")).toContainText("Ctrl+Z");
  // Pen to K: K works on the canvas, P no longer does, the button says K. A letter that is taken is refused.
  await panel.getByRole("button", { name: "Change the key for Pen" }).click();
  await p.keyboard.press("k");
  await expect(panel.locator("[data-key-note]")).toContainText("Pen is now K");
  await panel.getByRole("button", { name: "Change the key for Lasso" }).click();
  await p.keyboard.press("k");
  await expect(panel.locator("[data-key-note]")).toContainText("already the key for Pen");
  await panel.getByRole("button", { name: "Change the key for Lasso" }).click();
  await p.keyboard.press("5");
  await expect(panel.locator("[data-key-note]")).toContainText("one plain letter");
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  await expect(p.getByRole("radio", { name: "Pen" })).toHaveAttribute("title", "Pen (K)");
  await p.keyboard.press("v");
  expect(await tool()).toBe("select");
  await p.keyboard.press("p");
  expect(await tool(), "the old key no longer picks the pen").toBe("select");
  await p.keyboard.press("k");
  expect(await tool()).toBe("pen");
  // Kept after a reload; Reset puts P back.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.keyboard.press("v");
  await p.keyboard.press("k");
  expect(await tool()).toBe("pen");
  await p.keyboard.press("?");
  await panel.getByRole("button", { name: "Reset the key for Pen to its default" }).click();
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  await p.keyboard.press("v");
  await p.keyboard.press("p");
  expect(await tool()).toBe("pen");
  expect(app.consoleErrors).toEqual([]);
});

test("appearance: interface size, contrast and motion apply at once, persist, and the tools never sit under the view tabs (ADR 0050)", async ({ app }) => {
  const p = app.page;
  const panel = p.locator("#settings-view");
  const root = p.locator("html");
  const clear = async () => {
    const [nav, tools] = await Promise.all([p.locator("#nav").boundingBox(), p.locator("#toolbar > .toolbar").boundingBox()]);
    return tools!.x >= nav!.x + nav!.width - 1 || tools!.y >= nav!.y + nav!.height - 1;
  };
  expect(await clear(), "100%: the tools are clear of the view tabs").toBe(true);
  await p.getByTestId("view-settings").click();
  await panel.getByRole("tab", { name: "Appearance" }).click();
  await panel.getByLabel("Interface size", { exact: true }).selectOption("150");
  await panel.getByLabel("Contrast", { exact: true }).selectOption("high");
  await panel.getByLabel("Motion", { exact: true }).selectOption("reduce");
  await expect(root).toHaveAttribute("data-contrast", "high");
  await expect(root).toHaveAttribute("data-motion", "reduce");
  expect(await root.evaluate((e) => e.style.getPropertyValue("--ui-scale"))).toBe("1.5");
  // The whole view grows (the tab list is wider than at 100%).
  expect((await panel.locator(".set-tabs").boundingBox())!.width).toBeGreaterThan(250);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(root).toHaveAttribute("data-contrast", "high");
  expect(await root.evaluate((e) => e.style.getPropertyValue("--ui-scale"))).toBe("1.5");
  expect(await clear(), "150%: the tools are clear of the view tabs").toBe(true);
  // Back to the defaults leaves no attribute behind.
  await p.getByTestId("view-settings").click();
  await panel.getByRole("tab", { name: "Appearance" }).click();
  for (const key of ["ui.textScale", "ui.contrast", "ui.motion"]) await panel.getByRole("button", { name: new RegExp(`Reset ${{ "ui.textScale": "Interface size", "ui.contrast": "Contrast", "ui.motion": "Motion" }[key]} `) }).click();
  await expect(root).not.toHaveAttribute("data-contrast", /.*/);
  await expect(root).not.toHaveAttribute("data-motion", /.*/);
  expect(app.consoleErrors).toEqual([]);
});

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

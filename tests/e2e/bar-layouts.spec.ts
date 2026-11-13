import { expect, test } from "./harness";
import type { App } from "./harness";

/**
 * The ways the Properties bar and the Actions bar show (ADR 0198): value chips at the top or above the selection, the Properties panel, and the
 * Actions bar's groups as chips. The controls are the bar's own, moved: these check the moving, the values the chips read, and the places.
 * (Every other spec uses the bar at the top and the buttons, the defaults.)
 */
const set = (app: App, key: string, value: unknown) => app.page.evaluate(([k, v]) => window.__canvastDebug.setSetting(k, v), [key, value] as const);
const shape = async (app: App) => {
  await app.page.keyboard.press("u");
  await app.drag({ x: 500, y: 330 }, { x: 680, y: 470 }, 6);
  await app.page.keyboard.press("v");
};

test("value chips name each section with its values; a chip opens its controls, a change shows on the chip; the palette opens a closed one", async ({ app }) => {
  const p = app.page;
  await set(app, "ui.properties", "chips");
  await shape(app);
  const chips = p.locator(".props-chips [data-vchip]");
  await expect(chips).toHaveText([/^Look/, /^Shape/, /^Size/]);
  await expect(p.locator(".toolbar[data-parked]"), "the bar itself is out of sight").toBeHidden();
  const chip = p.locator('.props-chips [data-vchip="shape"]');
  await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  const radius = p.locator(".vchip-pop").getByLabel("Corner radius (px)");
  await expect(p.locator(".vchip-pop").getByLabel("Fill", { exact: true }), "only the Shape section").toBeHidden();
  await radius.fill("12");
  await radius.press("Enter");
  await expect(chip, "the chip reads the new value, its popover still open").toContainText("12 px");
  await expect(p.locator(".vchip-pop")).toHaveCount(1);
  await p.keyboard.press("Escape");
  await expect(p.locator(".vchip-pop")).toHaveCount(0);
  // the command palette offers a control of a closed chip, and opens it to run it
  await p.keyboard.press("Control+k");
  await p.keyboard.type("Turn it on its side");
  await p.getByRole("option").filter({ hasText: "Properties" }).first().click();
  await expect(p.locator('.props-chips [data-vchip="size"]')).toHaveAttribute("aria-expanded", "true");
  // back to the bar: the controls are in it again, in their own order
  await set(app, "ui.properties", "bar");
  await expect(p.locator(".vchip-pop")).toHaveCount(0);
  await expect(p.getByRole("toolbar", { name: "Tool options" }).getByLabel("Corner radius (px)")).toBeVisible();
  expect(app.consoleErrors).toEqual([]);
});

test("the Properties panel opens by itself with a selection and closes without one; the anchor keeps it; a folded section shows its values", async ({ app }) => {
  const p = app.page;
  await set(app, "ui.properties", "panel");
  const panel = p.getByTestId("properties-panel");
  await expect(panel).toBeHidden();
  await shape(app);
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Corner radius (px)")).toBeVisible();
  const look = panel.locator('[data-ps-head="look"]');
  await look.click();
  await expect(look).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByLabel("Fill", { exact: true })).toBeHidden();
  await expect(look.locator(".vchip-sw"), "the folded section shows its colours").toHaveCount(2);
  await p.keyboard.press("Escape"); // (nothing selected: nothing to show)
  await expect(panel).toBeHidden();
  await p.locator(".props-chips [data-props-toggle]").click();
  await expect(panel, "the switch opens it, kept open").toBeVisible();
  await expect(panel.getByRole("button", { name: "Keep the panel open" })).toHaveAttribute("aria-pressed", "true");
  expect(app.consoleErrors).toEqual([]);
});

test("near the selection the chips stand above it and the following Actions bar under it; the Actions bar's groups as chips list their actions", async ({ app }) => {
  const p = app.page;
  await set(app, "ui.properties", "near");
  await set(app, "ui.actions", "follow");
  await shape(app);
  const near = p.locator(".props-near");
  await expect(near).toBeVisible();
  await expect(p.locator(".props-chips")).toBeHidden();
  // (the shape was drawn from y 330 to 470 on the screen)
  const chipsBox = (await near.boundingBox())!;
  const actions = (await p.getByTestId("context-bar").boundingBox())!;
  expect(chipsBox.y + chipsBox.height, "the chips above the shape").toBeLessThanOrEqual(330);
  expect(actions.y, "the actions under it").toBeGreaterThanOrEqual(470);
  // the Actions bar as chips: a group's chip lists its actions, and one runs as its button
  await set(app, "ui.actionsView", "chips");
  const items = p.getByTestId("context-bar").locator('[data-vchip="Items"]');
  await expect(items).toBeVisible();
  await expect(p.getByTestId("context-bar").locator('[data-ctx="duplicate"]')).toBeHidden();
  await items.click();
  await p.locator(".pop-menu").getByRole("menuitem", { name: /Duplicate/ }).click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(2);
  expect(app.consoleErrors).toEqual([]);
});

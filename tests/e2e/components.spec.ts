import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import { blockyFixture } from "./png";

/** The component audit on the real thing: every menu that opens has rows with an icon, a name and a short line; dialogs come from the one shell. */

/** Every row of the open menu has its three parts. */
async function menuIsWhole(p: Page, what: string): Promise<void> {
  const menu = p.locator(".pop-menu");
  await expect(menu, what).toBeVisible();
  const rows = await menu.locator("button").evaluateAll((all) => all.map((b) => ({ text: b.textContent?.trim() ?? "", icon: !!b.querySelector("svg, .menu-swatch, .menu-gap"), hint: b.querySelector(".menu-hint")?.textContent?.trim() ?? "" })));
  expect(rows.length, what).toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.icon, `${what}: ${r.text} has an icon`).toBe(true);
    expect(r.hint.length, `${what}: ${r.text} has a short line`).toBeGreaterThan(0);
    expect(r.hint.length, `${what}: "${r.hint}" is very short`).toBeLessThanOrEqual(44);
  }
  await p.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

test("menus of the library, the sidebar, the workspace and the canvas: an icon, a name and a short line on every row", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("import-input").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: blockyFixture() });
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  await p.keyboard.press("Control+a");
  await p.mouse.click(640, 400, { button: "right" });
  await menuIsWhole(p, "canvas, on a thing");
  await p.getByTestId("workspace-chevron").click();
  await p.getByRole("button", { name: /^More actions for canvas/ }).first().click();
  await menuIsWhole(p, "workspace, a canvas's More");
  await p.keyboard.press("Escape");
  await p.getByTestId("view-assets").click();
  await p.getByTestId("asset-card").first().click({ button: "right" });
  await menuIsWhole(p, "library, on a card");
  await p.locator(".assets-scroll").click({ button: "right", position: { x: 4, y: 4 } });
  await menuIsWhole(p, "library, on empty ground");
  await p.getByTestId("folder-new").click();
  await p.getByTestId("folder-name-input").fill("Ink");
  await p.getByTestId("folder-name-input").press("Enter");
  await p.getByRole("button", { name: "More actions for folder Ink", exact: true }).click();
  await menuIsWhole(p, "sidebar, a folder's More");
  await p.getByTestId("assets-side").getByRole("button", { name: /^Ink/ }).click({ button: "right" });
  await menuIsWhole(p, "sidebar, a right click on a folder");
  expect(app.consoleErrors).toEqual([]);
});

test("a folder folds, stays folded after a reload, and Organize moves to a folder and sets tags, tree or row, with search, at one Apply", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: blockyFixture() });
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  const name = async (words: string): Promise<void> => {
    await p.getByTestId("folder-name-input").fill(words);
    await p.getByTestId("folder-name-input").press("Enter");
  };
  await p.getByTestId("folder-new").click();
  await name("Art");
  await p.getByRole("button", { name: "More actions for folder Art", exact: true }).click();
  await p.getByRole("menuitem", { name: "New folder inside Art", exact: true }).click();
  await name("Ink");
  const tree = p.getByTestId("folder-tree");
  await expect(tree.getByText("Ink")).toBeVisible();
  await tree.getByRole("button", { name: "Collapse", exact: true }).click();
  await expect(tree.getByText("Ink")).toHaveCount(0);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("view-assets").click();
  await expect(tree.getByText("Art")).toBeVisible();
  await expect(tree.getByText("Ink")).toHaveCount(0);

  // Organize: nothing until Apply; a tag with a path is a branch of the tree
  await p.getByTestId("asset-card").first().click();
  await p.getByTestId("asset-organize").click();
  const dlg = p.getByTestId("tree-chooser");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator(".choice-row")).toHaveCount(3); // (No folder, Art, Ink)
  await p.getByTestId("choice-search").fill("ink");
  await expect(dlg.locator(".choice-row")).toHaveCount(2); // (what matches and what leads to it)
  await dlg.getByRole("radio", { name: "Ink" }).check();
  await p.getByTestId("choice-search").fill("");
  await dlg.getByRole("tab", { name: "Tags" }).click();
  await p.getByTestId("choice-search").fill("style/ink");
  await p.getByTestId("choice-make").click();
  await expect(dlg.locator(".choice-row")).toHaveCount(2); // (style, ink under it)
  await dlg.getByRole("button", { name: "Show in a row" }).click();
  await expect(dlg.locator(".choice-chip")).toHaveCount(1); // (a parent nothing stands for is no choice)
  await expect(dlg.locator(".choice-chip")).toContainText("style / ink");
  await p.getByTestId("choice-cancel").click();
  await expect(p.getByTestId("asset-tags")).not.toContainText("style/ink"); // (cancelled: nothing)
  await p.getByTestId("asset-organize").click();
  await dlg.getByRole("radio", { name: "Ink" }).check();
  await dlg.getByRole("tab", { name: "Tags" }).click();
  await p.getByTestId("choice-search").fill("style/ink");
  await p.getByTestId("choice-search").press("Enter");
  await p.getByTestId("choice-ok").click();
  await expect(dlg).toHaveCount(0);
  await expect(p.getByTestId("asset-tags")).toContainText("style/ink");
  await expect(p.getByTestId("asset-folders").getByRole("radio", { name: /Ink/ })).toBeChecked();
  expect(app.consoleErrors).toEqual([]);
});

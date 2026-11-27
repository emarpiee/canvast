import { expect, test } from "./harness";

/**
 * The workspace (B39): the ribbon, the sidebars and their panes, the Files pane, the tabs with their own Back and Forward, a new tab's start
 * page. The other specs run in the layout they were written for (`data-shell="legacy"`, tests/e2e/harness.ts): this one takes it away.
 */
test("the workspace: ribbon, sidebars and panes, the Files pane, and tabs with their own history", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => sessionStorage.setItem("harness.shell", "1"));
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(p.locator("html")).not.toHaveAttribute("data-shell", "legacy");
  await expect(p.getByTestId("ribbon-library")).toBeVisible();
  // the sidebars (the specs start with both hidden): shown from the palette's commands, their panes by tab
  const run = (id: string, o: Record<string, unknown> = {}) => p.evaluate(([i, opts]) => window.__canvastDebug.runCommand(i as string, opts as Record<string, unknown>), [id, o] as const);
  await run("layout.leftSidebar");
  await run("layout.rightSidebar");
  await expect(p.locator("#sidebar-left")).toBeVisible();
  await expect(p.locator("#sidebar-right")).toBeVisible();
  for (const pane of ["files", "library", "bookmarks"]) await expect(p.locator("#sidebar-left").getByTestId(`pane-${pane}`)).toBeVisible();
  for (const pane of ["layers", "adjust", "tags", "styles", "pattern"]) await expect(p.locator("#sidebar-right").getByTestId(`pane-${pane}`)).toBeVisible();
  // a pane chosen is its panel open; the panel's command shows its pane
  await p.locator("#sidebar-right").getByTestId("pane-tags").click();
  await expect(p.getByTestId("tags-panel")).toBeVisible();
  await run("panel.layers");
  await expect(p.getByTestId("layers-panel")).toBeVisible();
  // the Files pane: the board and its canvas; a new canvas is listed and opened
  await p.locator("#sidebar-left").getByTestId("pane-files").click();
  const tree = p.getByTestId("files-tree");
  await expect(tree.locator('[data-open="board"]')).toHaveCount(1);
  await expect(tree.locator('[data-open="canvas"]')).toHaveCount(1);
  await p.getByTestId("files-new-canvas").click();
  await expect(tree.locator('[data-open="canvas"]')).toHaveCount(2);
  const second = await tree.locator('[data-open="canvas"]').nth(1).getAttribute("data-id");
  // tabs: one at first; the active tab follows what opens; a new tab's start page; Back and Forward are the tab's own
  const tabs = p.getByTestId("tab");
  await expect(tabs).toHaveCount(1);
  await tree.locator('[data-open="canvas"]').first().click();
  await p.getByTestId("tab-new").click();
  await expect(tabs).toHaveCount(2);
  await expect(p.locator("#start-page")).toBeVisible();
  await p.getByTestId("start-library").click();
  await expect(p.locator("#assets-view")).toBeVisible();
  await expect(tabs.nth(1)).toContainText("Library");
  await expect(p.locator("#sidebar-left").getByTestId("pane-library")).toHaveAttribute("aria-selected", "true");
  await p.getByTestId("tab-back").click();
  await expect(p.locator("#start-page")).toBeVisible();
  await p.getByTestId("tab-forward").click();
  await expect(p.locator("#assets-view")).toBeVisible();
  // the first tab shows its canvas again; Ctrl+click in Files opens another in a new tab
  await tabs.nth(0).click();
  await expect(p.locator("#assets-view")).toBeHidden();
  await p.locator("#sidebar-left").getByTestId("pane-files").click();
  await tree.locator(`[data-open="canvas"][data-id="${second}"]`).click({ modifiers: ["Control"] });
  await expect(tabs).toHaveCount(3);
  // a middle click closes a tab
  await tabs.nth(2).click({ button: "middle" });
  await expect(tabs).toHaveCount(2);
  expect(app.consoleErrors).toEqual([]);
});

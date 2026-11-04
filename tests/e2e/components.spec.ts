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

test("the sidebar's tags are a tree on /, a parent finds what is nested and counts each item once, and a row with whole names is one press away", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: blockyFixture() });
  await p.getByTestId("asset-card").first().click();
  await p.getByTestId("asset-tag-input").fill("art/ink, art/oil, ref");
  await p.getByTestId("asset-tag-input").press("Enter");
  const tags = p.getByTestId("tag-list");
  const row = (name: string) => tags.getByRole("button", { name: new RegExp(`^#${name}\\b`) });
  await expect(row("art")).toContainText("1");
  await expect(row("ink")).toBeVisible();
  // A parent that is only a path has no Delete: there is no such tag. A child's menu is about its whole name.
  await p.getByRole("button", { name: "More actions for tag art", exact: true }).click();
  await expect(p.getByRole("menuitem")).toHaveCount(1);
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: "More actions for tag art/ink", exact: true }).click();
  await p.getByRole("menuitem", { name: "Rename tag art/ink", exact: true }).click();
  await expect(p.getByTestId("prompt-input")).toHaveValue("art/ink");
  await p.getByTestId("prompt-cancel").click();
  await tags.getByRole("button", { name: "Collapse", exact: true }).click();
  await expect(row("ink")).toHaveCount(0);
  await p.getByRole("button", { name: "Show in a row", exact: true }).click();
  await expect(tags.locator(".tag-cloud, .side-item").filter({ hasText: "#art/ink" })).toHaveCount(1);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("view-assets").click();
  await expect(tags.getByRole("button", { name: /^#art\/oil/ })).toBeVisible();
  // O opens Organize for what is selected.
  await p.getByTestId("asset-card").first().click();
  await p.keyboard.press("o");
  await expect(p.getByTestId("tree-chooser")).toBeVisible();
  await p.getByTestId("choice-cancel").click();
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
  // Every row's name starts in one line, whether it has an arrow or not, and the count ends at the row's edge.
  await p.getByTestId("folder-new").click();
  await name("Plain");
  const leftOf = (t: string) => tree.getByRole("button", { name: new RegExp(`^${t}`) }).locator(".side-label").evaluate((e) => e.getBoundingClientRect().left);
  await expect.poll(async () => (await leftOf("Art")) - (await leftOf("Plain"))).toBe(0);
  const rightGap = await tree.getByRole("button", { name: /^Plain/ }).locator(".side-n").evaluate((e) => e.closest(".side-row")!.getBoundingClientRect().right - e.getBoundingClientRect().right);
  expect(rightGap).toBeLessThan(16);

  // Organize: nothing until Apply; a tag with a path is a branch of the tree
  await p.getByTestId("asset-card").first().click();
  await p.getByTestId("asset-organize").click();
  const dlg = p.getByTestId("tree-chooser");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator(".choice-row")).toHaveCount(4); // (No folder, Art, Ink, Plain)
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
  await expect(p.getByTestId("asset-folder-now")).toHaveText("Art › Ink");
  // The sidebar's searches: a match opens what leads to it, and the keyboard stays in the box as the list is drawn again.
  const findFolder = p.getByTestId("side-find-folders");
  await findFolder.pressSequentially("ink");
  await expect(findFolder).toHaveValue("ink");
  await expect(tree.getByText("Ink")).toBeVisible();
  await expect(tree.getByText("Plain")).toHaveCount(0);
  await findFolder.press("Escape");
  await expect(findFolder).toHaveValue("");
  await expect(tree.getByText("Ink")).toHaveCount(0); // (folded as it was)
  await expect(tree.getByText("Plain")).toBeVisible();
  await expect(p.getByTestId("asset-organize")).toBeVisible(); // (the selection stays)
  await findFolder.fill("zzz");
  await expect(tree).toContainText("No folders match.");
  const findTag = p.getByTestId("side-find-tag");
  const tags = p.getByTestId("tag-list");
  await findTag.fill("#ink");
  await expect(tags).toContainText("ink");
  await findTag.fill("zzz");
  await expect(tags).toContainText("No tags match.");
  // The sort buttons: folders go through A to Z, Z to A, newest and oldest; tags through A to Z and Z to A; what was chosen stays after a reload.
  await findTag.fill("");
  await findFolder.fill("");
  await p.getByTestId("folder-new").click();
  await name("Bee");
  const folderOrder = tree.locator(".side-label");
  await expect(folderOrder).toHaveText(["Art", "Bee", "Plain"]);
  const sortFolders = p.getByTestId("side-sort-folders");
  await sortFolders.click();
  await expect(folderOrder).toHaveText(["Plain", "Bee", "Art"]);
  await sortFolders.click();
  await expect(folderOrder).toHaveText(["Bee", "Plain", "Art"]);
  await sortFolders.click();
  await expect(folderOrder).toHaveText(["Art", "Plain", "Bee"]);
  await sortFolders.click();
  await expect(folderOrder).toHaveText(["Art", "Bee", "Plain"]);
  await p.getByTestId("asset-tag-input").fill("alpha");
  await p.getByTestId("asset-tag-input").press("Enter");
  const tagOrder = tags.locator(".side-label");
  await expect(tagOrder).toHaveText(["#alpha", "#style", "#ink"]);
  const sortTags = p.getByTestId("side-sort-tag");
  await sortTags.click();
  await expect(tagOrder).toHaveText(["#style", "#ink", "#alpha"]);
  await sortTags.click();
  await expect(tagOrder).toHaveText(["#alpha", "#style", "#ink"]);
  await sortFolders.click();
  await sortFolders.click();
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("view-assets").click();
  await expect(folderOrder).toHaveText(["Bee", "Plain", "Art"]);
  // Pins: first in the list, a subfolder too, sorted among themselves; a search shows the tree as it is; Unpin puts it back.
  const pinFolder = async (word: string, folder: string): Promise<void> => {
    await p.getByRole("button", { name: `More actions for folder ${folder}`, exact: true }).click();
    await p.getByRole("menuitem", { name: `${word} folder ${folder}`, exact: true }).click();
  };
  await pinFolder("Pin", "Art");
  await expect(folderOrder).toHaveText(["Art", "Bee", "Plain"]);
  await tree.getByRole("button", { name: "Expand", exact: true }).click();
  await expect(folderOrder).toHaveText(["Art", "Ink", "Bee", "Plain"]);
  await pinFolder("Pin", "Ink");
  await expect(folderOrder).toHaveText(["Ink", "Art", "Bee", "Plain"]);
  await findFolder.fill("ink");
  await expect(folderOrder).toHaveText(["Art", "Ink"]);
  await findFolder.fill("");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("view-assets").click();
  await expect(folderOrder).toHaveText(["Ink", "Art", "Bee", "Plain"]);
  await expect(tree.locator(".is-pinned")).toHaveCount(2);
  await pinFolder("Unpin", "Ink");
  await pinFolder("Unpin", "Art");
  await expect(folderOrder).toHaveText(["Bee", "Plain", "Art", "Ink"]);
  expect(app.consoleErrors).toEqual([]);
});

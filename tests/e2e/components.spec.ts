import type { Page } from "@playwright/test";
import { expect, sliderDragProblems, test, themeProblems } from "./harness";
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
  // Under the pointer only the count's place changes (to Pin and More): the branch mark stays where it was
  const artRow = tree.locator(".side-row", { has: p.getByRole("button", { name: /^Art/ }) });
  const branchX = () => artRow.locator(".side-kids").evaluate((e) => Math.round(e.getBoundingClientRect().left));
  await p.mouse.move(5, 5);
  const restX = await branchX();
  await artRow.hover();
  await expect(artRow.locator(".side-more").last()).toBeVisible();
  expect(await branchX(), "the branch mark does not move under the pointer").toBe(restX);
  // (Pin and More come before the marks and branch, over the end of the name: the branch is still where it was, not under them)
  const more = await artRow.locator(".side-more").last().boundingBox();
  expect(more!.x + more!.width, "More ends before the branch mark").toBeLessThanOrEqual(restX + 1);
  await tree.getByRole("button", { name: /^Art/ }).click({ position: { x: 24, y: 8 } }); // (on its name: under the pointer, Pin and More sit over the name's end) // (a folder with subfolders closes on its own row)
  await expect(tree.getByText("Ink")).toHaveCount(0);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("view-assets").click();
  await expect(tree.getByText("Art")).toBeVisible();
  await expect(tree.getByText("Ink")).toHaveCount(0);
  // (folders start folded and open as they are opened, remembered: B35)
  await tree.getByRole("button", { name: /^Art/ }).click({ position: { x: 24, y: 8 } }); // (on its name: under the pointer, Pin and More sit over the name's end)
  await expect(tree.getByText("Ink")).toBeVisible();
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("view-assets").click();
  await expect(tree.getByText("Ink"), "an opened folder stays open").toBeVisible();
  await tree.getByRole("button", { name: /^Art/ }).click({ position: { x: 24, y: 8 } }); // (on its name: under the pointer, Pin and More sit over the name's end) // (folded again, as what follows expects)
  await expect(tree.getByText("Ink")).toHaveCount(0);
  // Every row's name starts in one line, whether it has an arrow or not, and the count ends at the row's edge.
  await p.getByTestId("folder-new").click();
  await name("Plain");
  const leftOf = (t: string) => tree.getByRole("button", { name: new RegExp(`^${t}`) }).locator(".side-label").evaluate((e) => e.getBoundingClientRect().left);
  await expect.poll(async () => (await leftOf("Art")) - (await leftOf("Plain"))).toBe(0);
  const rightGap = await tree.getByRole("button", { name: /^Plain/ }).locator(".side-n").evaluate((e) => e.closest(".side-row")!.getBoundingClientRect().right - e.getBoundingClientRect().right);
  expect(rightGap).toBeLessThan(16);

  // Organize: nothing until Apply; a tag with a path is a branch of the tree
  await p.getByTestId("assets-side").getByRole("button", { name: /^All items/ }).click(); // (choosing Art on its row showed that empty folder)
  await p.getByTestId("asset-card").first().click();
  await p.getByTestId("asset-organize").click();
  const dlg = p.getByTestId("tree-chooser");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator(".choice-row")).toHaveCount(4); // (Unfiled, Art, Ink, Plain)
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
  for (const q of ["kind:picture", "#alpha"]) {
    await p.getByTestId("assets-search").fill(q);
    await p.getByRole("button", { name: "Save this search" }).filter({ visible: true }).click();
  }
  await p.getByTestId("assets-search").fill("");
  await expect(p.getByTestId("side-saved").locator(".side-label")).toHaveText(["kind:picture", "#alpha"]);
  // In your order a saved search is dragged to its place: onto the upper part of a row, before it.
  const savedRow = (t: string) => p.getByTestId("side-saved").locator(".side-item", { hasText: t });
  await savedRow("#alpha").dragTo(savedRow("kind:picture"), { targetPosition: { x: 20, y: 2 } });
  await expect(p.getByTestId("side-saved").locator(".side-label")).toHaveText(["#alpha", "kind:picture"]);
  await savedRow("#alpha").dragTo(savedRow("kind:picture"), { targetPosition: { x: 20, y: (await savedRow("kind:picture").boundingBox())!.height - 2 } }); // (its lower part: after it)
  await expect(p.getByTestId("side-saved").locator(".side-label")).toHaveText(["kind:picture", "#alpha"]);
  await p.getByTestId("side-sort-saved").click();
  await expect(p.getByTestId("side-saved").locator(".side-label")).toHaveText(["#alpha", "kind:picture"]);
  // Every list of the sidebar is a folder's list: a sort button once it has two rows, a count chip on each row, its ⋯ only under the pointer (a new list fails here).
  for (const sec of await p.locator("[data-sec]").all()) {
    const id = await sec.getAttribute("data-sec");
    const rows = sec.locator(".side-row:not(.side-show-row)").filter({ has: p.locator(".side-item") });
    if ((await rows.count()) < 2) continue;
    await expect(sec.locator(".side-head [data-side-sort]"), `the ${id} list has a sort button`).toHaveCount(1);
    for (const row of await rows.all()) await expect(row.locator(".side-n"), `each row of ${id} shows its count`).toHaveCount(1);
    const dots = sec.locator(".side-row .side-more:not(.side-pin)").first();
    if (await dots.count()) {
      await p.mouse.move(1, 1);
      await expect(dots, `the ${id} list's ⋯ waits for the pointer`).toHaveCSS("opacity", "0");
    }
  }
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
  await tree.getByRole("button", { name: "Pin folder Art", exact: true }).click(); // (the row's own button)
  await expect(folderOrder).toHaveText(["Art", "Bee", "Plain"]);
  await expect(tree.getByRole("button", { name: "Unpin folder Art", exact: true })).toHaveAttribute("aria-pressed", "true");
  await tree.getByRole("button", { name: /^Art/ }).click({ position: { x: 24, y: 8 } }); // (on its name: under the pointer, Pin and More sit over the name's end) // (and opens on it)
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
  // A section dragged near the list's edge, or past it, scrolls the list.
  const short = p.viewportSize()!;
  await p.setViewportSize({ width: short.width, height: 420 });
  const moved = await p.evaluate(async () => {
    const list = document.querySelector<HTMLElement>('[data-testid="assets-side"]')!;
    const head = list.querySelector<HTMLElement>(".side-head")!;
    const dataTransfer = new DataTransfer();
    const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 400));
    const at = (clientY: number): void => void list.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer, clientX: list.getBoundingClientRect().left + 10, clientY }));
    head.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    at(list.getBoundingClientRect().bottom - 2);
    await wait();
    const down = list.scrollTop;
    at(list.getBoundingClientRect().top - 40); // (past the top)
    await wait();
    const up = list.scrollTop;
    document.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    await wait();
    const after = list.scrollTop;
    at(list.getBoundingClientRect().bottom - 2);
    await wait();
    return { down, up, after, stopped: list.scrollTop === after };
  });
  expect(moved.down).toBeGreaterThan(0);
  expect(moved.up).toBeLessThan(moved.down);
  expect(moved.stopped).toBe(true);
  await p.setViewportSize(short);
  // A long list in the details panel: its first rows, Show more and Show fewer.
  await p.locator('[data-testid="asset-card"]').first().click(); // (the reload above left nothing selected)
  for (let i = 0; i < 15; i++) {
    await p.getByTestId("asset-tag-input").fill(`many-${i}`);
    await p.getByTestId("asset-tag-input").press("Enter");
  }
  const chipRows = p.getByTestId("asset-tags").locator(".tag-chip");
  const moreTags = p.getByTestId("asset-tags-more");
  await expect(chipRows).toHaveCount(12);
  await expect(moreTags).toContainText("more");
  await moreTags.click();
  await expect(chipRows).toHaveCount(17);
  await expect(moreTags).toHaveText("Show fewer");
  await moreTags.click();
  await expect(chipRows).toHaveCount(12);
  // A small screen has no row pin: pinning is in the row's menu.
  const shown = p.viewportSize()!;
  await p.setViewportSize({ width: 600, height: shown.height });
  await expect.poll(() => tree.locator(".side-pin").first().evaluate((e) => getComputedStyle(e).display)).toBe("none");
  await p.setViewportSize(shown);
  expect(app.consoleErrors).toEqual([]);
});

test("a select's arrow is the app's chevron, not the browser's", async ({ app, browserName }) => {
  await app.page.getByTestId("view-assets").click();
  const select = app.page.getByTestId("assets-usage");
  await expect(select).toBeVisible();
  const arrow = await select.evaluate((e) => (CSS.supports("appearance: base-select") ? getComputedStyle(e, "::picker-icon").maskImage : getComputedStyle(e).backgroundImage));
  expect(arrow, browserName).toContain("data:image/svg+xml");
});

test("a checkbox is the app's, not the browser's", async ({ app }) => {
  await app.page.getByTestId("view-settings").click();
  const box = app.page.locator('input[type="checkbox"]').first();
  await expect(box).toBeAttached();
  expect(await box.evaluate((e) => getComputedStyle(e).appearance)).toBe("none");
});

test("a focus ring is the accent, also on what has no look of its own", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("Shift"); // (the keyboard in use: a focus shows)
  const ring = await p.evaluate(() => {
    const b = document.createElement("button");
    const c = document.createElement("span");
    c.style.color = "var(--hud-accent)";
    document.body.append(b, c);
    b.focus();
    const s = getComputedStyle(b);
    const out = { style: s.outlineStyle, colour: s.outlineColor, accent: getComputedStyle(c).color };
    b.remove();
    c.remove();
    return out;
  });
  expect(ring.style).toBe("solid");
  expect(ring.colour).toBe(ring.accent);
});

test("a list column made wider: the rows hold every column, with no empty room after them", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: blockyFixture() });
  await p.locator('[data-testid="asset-card"]').first().waitFor();
  await p.locator('[data-layout="list"]').click();
  const grip = p.locator('.assets-list-head [data-col="used"] [data-resize]');
  const at = (await grip.boundingBox())!;
  await p.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await p.mouse.down();
  await p.mouse.move(at.x + 500, at.y + at.height / 2, { steps: 4 });
  await p.mouse.up();
  await expect.poll(() => p.locator(".assets-scroll").evaluate((s) => s.scrollWidth - s.querySelector<HTMLElement>(".assets-grid")!.offsetWidth - s.querySelector<HTMLElement>(".assets-grid")!.offsetLeft)).toBeLessThanOrEqual(3); // (the grid's own small inset)
});

test("every floating panel follows the theme at every density: corners and text sizes of the theme, the panel's header buttons, the shared chooser and search field (Pins too)", async ({ app }) => {
  const p = app.page;
  // every panel of the dock open, and a Pins window as a gallery and as a canvas
  for (const b of ["data-layers", "data-tags", "data-styles", "data-pattern-panel", "data-bookmarks", "data-adjust-panel"]) await p.locator(`[${b}]`).first().click();
  await p.evaluate(() => window.__canvastDebug.runCommand("pins.open", { source: "all" }, "test"));
  const win = p.getByTestId("pins");
  await expect(win).toHaveCount(1);
  for (const density of ["dense", "compact", "comfortable"]) {
    await p.evaluate((d) => window.__canvastDebug.setSetting("ui.density", d), density);
    await p.waitForTimeout(150);
    expect(await themeProblems(p), `density ${density}`).toEqual([]);
  }
  await p.evaluate(() => window.__canvastDebug.runCommand("pins.open", {}, "test"));
  await expect(p.getByTestId("pins").last().locator(".pins-canvas")).toBeVisible(); // (the second window: the first shows the gallery)
  expect(await themeProblems(p), "a pinned canvas").toEqual([]);
});

test("every slider of the panels follows a mouse drag to where it is let go: no panel is drawn again under it (issue #2)", async ({ app }) => {
  const p = app.page;
  // the Pattern panel's settings, and a Pins window's Opacity strip (the window's slider changes the window at each step)
  await p.locator("[data-pattern-panel]").first().click();
  const pattern = p.getByTestId("pattern-panel");
  await expect(pattern.locator('input[type="range"]').first()).toBeVisible();
  expect(await sliderDragProblems(p, pattern), "the Pattern panel").toEqual([]);
  // (by its command: Shift+R is a key the Pattern panel's field keeps while it has the focus)
  await p.evaluate(() => window.__canvastDebug.runCommand("pins.open", {}, "test"));
  const win = p.getByTestId("pins");
  await expect(win).toHaveCount(1);
  await win.locator("[data-pins-more]").click();
  await p.locator('.pop-menu [data-command="pins.window"]').filter({ hasText: "Opacity" }).click();
  await expect(win.locator('[data-pins-look] input[type="range"]')).toBeVisible();
  expect(await sliderDragProblems(p, win.locator("[data-pins-look]")), "the Pins window's opacity").toEqual([]);
});

/**
 * A right click at every point of what is shown (a grid over the window), each as its own event: the ones no part of the app answered,
 * which would open the browser's own menu, by what was under the point. Menus it opens on the way are closed after.
 */
async function browserMenus(p: Page): Promise<string[]> {
  const left = await p.evaluate(() => {
    const out = new Set<string>();
    const say = (el: Element): string => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""}${(el as HTMLElement).dataset?.["testid"] ? `[${(el as HTMLElement).dataset["testid"]}]` : ""}`;
    for (let y = 6; y < innerHeight; y += 22) {
      for (let x = 6; x < innerWidth; x += 22) {
        const el = document.elementFromPoint(x, y);
        if (!el || el.closest(".pop-menu")) continue;
        const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
        el.dispatchEvent(ev);
        if (!ev.defaultPrevented) out.add(say(el));
      }
    }
    return [...out];
  });
  for (let i = 0; i < 3; i++) await p.keyboard.press("Escape");
  return left;
}

test("no right click anywhere opens the browser's menu: the canvas, the Library, the details, an open note, the viewer, the note panel and Settings", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("import-input").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: blockyFixture() });
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  expect(await browserMenus(p), "the canvas").toEqual([]);
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "n.md", mimeType: "text/markdown", buffer: Buffer.from("# Note\n\nWords and [[n]].\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n") });
  await p.locator('[data-testid="asset-card"][title="n.md"]').click();
  expect(await browserMenus(p), "the Library with an item's details").toEqual([]);
  await p.locator('[data-testid="asset-card"][title="n.md"]').dblclick();
  await expect(p.getByTestId("note-editor").locator(".cm-content")).toBeVisible();
  expect(await browserMenus(p), "a note open in the viewer").toEqual([]);
  await p.locator(".viewer-back").click();
  await p.locator('[data-testid="asset-card"][title="b.png"]').dblclick();
  expect(await browserMenus(p), "a picture in the viewer").toEqual([]);
  await p.locator(".viewer-back").click();
  await p.locator('[data-testid="asset-card"][title="n.md"]').click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-canvas").click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(2);
  const b = await p.evaluate(() => { const d = window.__canvastDebug; return d.objectScreen(d.objects().at(-1)!.id)!.box; });
  await p.mouse.dblclick((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  await expect(p.getByTestId("note-panel")).toBeVisible();
  expect(await browserMenus(p), "the note panel on a canvas").toEqual([]);
  await p.getByTestId("view-settings").click();
  expect(await browserMenus(p), "Settings").toEqual([]);
});

test("the notes editor's menus and a text field's menu are the app's menu: an icon, a name and a short line on every row", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "m.md", mimeType: "text/markdown", buffer: Buffer.from("# Menus\n\nSome words here.\n\n```js\nlet a = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n") });
  await p.locator('[data-testid="asset-card"][title="m.md"]').dblclick();
  const words = p.getByTestId("note-editor").locator(".cm-line", { hasText: "Some words here." });
  await words.click({ button: "right" });
  await menuIsWhole(p, "a note's words");
  await p.getByTestId("note-editor").locator(".me-table td .me-cell").first().click({ button: "right" });
  await menuIsWhole(p, "a note's table cell");
  await p.getByTestId("note-editor").locator(".me-code-lang").click();
  await menuIsWhole(p, "a code block's language");
  await p.locator(".viewer-back").click();
  await p.getByTestId("assets-search").click({ button: "right" });
  await menuIsWhole(p, "a text field");
  expect(app.consoleErrors).toEqual([]);
});

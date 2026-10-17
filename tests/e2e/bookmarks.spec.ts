import { expect, test } from "./harness";

/**
 * Bookmark pictures (ADR 0124): bookmarks that have none (made by a script or an import) are filled in, and all of them can be updated, by
 * the canvas visiting each place; the view comes back, one write, Escape stops it. Real input; the pictures are read through the debug hook.
 */
test("the bookmark pictures are filled in and updated by visiting each place, and the view comes back", async ({ app }) => {
  const p = app.page;
  // two places with different things in them: a big dark shape here, and nothing far to the right
  await p.keyboard.press("u");
  await app.drag({ x: 450, y: 300 }, { x: 800, y: 560 }, 8);
  await p.keyboard.press("v");
  await p.mouse.click(60, 700);
  await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  await p.getByRole("button", { name: "Add bookmark" }).click();
  await p.keyboard.press("0"); // (home is where it is)
  for (let i = 0; i < 6; i++) await p.keyboard.press("Shift+ArrowRight");
  await p.getByRole("button", { name: "Add bookmark" }).click();
  await expect(p.getByTestId("bookmarks-panel").locator("li.bookmark")).toHaveCount(2);
  // a bookmark with no picture (as a script or an import makes them)
  await p.evaluate(() => window.__canvastDebug.dropBookmarkThumbs());
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.bookmarkThumbs())).toEqual(["", ""]);
  const panel = p.getByTestId("bookmarks-panel");
  await expect(panel.getByTestId("bm-missing")).toContainText("2 bookmarks have no picture");
  const before = await p.evaluate(() => window.__canvastDebug.camera());
  await panel.getByRole("button", { name: "Fill in" }).click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.bookmarkThumbs().every((t) => t.startsWith("data:image/jpeg")))).toBe(true);
  await expect(panel.getByTestId("bm-missing")).toHaveCount(0);
  await expect(p.getByTestId("thumb-veil")).toHaveCount(0);
  expect(await p.evaluate(() => window.__canvastDebug.camera()), "the view comes back where it was").toEqual(before);
  // the two places look different: the pictures differ
  const [a, b] = await p.evaluate(() => window.__canvastDebug.bookmarkThumbs());
  expect(a).not.toBe(b);
  // update all, from the menu
  await panel.getByRole("button", { name: "Update the bookmark pictures" }).click();
  await p.getByRole("menuitem", { name: "Update the pictures of all bookmarks" }).click();
  await p.getByTestId("thumb-veil").waitFor({ state: "attached" }); // it visits each place behind a veil ...
  await p.getByTestId("thumb-veil").waitFor({ state: "detached" }); // ... and is done
  await expect(p.getByTestId("toast").getByText(/2 bookmark pictures updated/)).toBeVisible();
  expect(await p.evaluate(() => window.__canvastDebug.camera())).toEqual(before);
  expect(app.consoleErrors).toEqual([]);
});

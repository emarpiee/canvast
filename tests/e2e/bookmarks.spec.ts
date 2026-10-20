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

/** Camera travel (ADR 0163): near and far trips, the three travel choices, and the keys and order of the bookmarks. */
test("a far trip to a bookmark dives instead of cutting; Glide near only and Cut arrive at once", async ({ app }) => {
  const p = app.page;
  await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  await p.getByRole("button", { name: "Add bookmark" }).click(); // at home
  const home = await p.evaluate(() => window.__canvastDebug.camera());
  await p.evaluate(() => window.__canvastDebug.jump(100)); // another frame, far from a glide's reach
  await p.evaluate(() => window.__canvastDebug.glide(300));
  const level = () => p.evaluate(() => Number(window.__canvastDebug.depth()));
  const go = () => p.getByRole("button", { name: /Go to Bookmark 1/ }).click();
  await p.evaluate(() => {
    const w = window as unknown as { __s: number[] };
    w.__s = [];
    const f = (): void => (w.__s.push(Number(window.__canvastDebug.depth())), void requestAnimationFrame(f));
    f();
  });
  await go();
  await expect.poll(async () => JSON.stringify(await p.evaluate(() => window.__canvastDebug.camera())), { timeout: 8000 }).toBe(JSON.stringify(home));
  const seen = await p.evaluate(() => (window as unknown as { __s: number[] }).__s);
  expect(seen.some((d) => d > 0 && d < 100), "it passed through the levels between").toBe(true);
  // out first (below where it started), then in: the dive zooms out before it zooms in
  expect(Math.max(...seen)).toBeLessThanOrEqual(100);
  for (const mode of ["near", "cut"]) {
    await p.evaluate(() => window.__canvastDebug.setSetting("nav.travel", "fly"));
    await p.evaluate((m) => window.__canvastDebug.setSetting("nav.travel", m), mode);
    await p.evaluate(() => window.__canvastDebug.glide(300));
    await p.evaluate(() => window.__canvastDebug.jump(100));
    await go();
    expect(await p.evaluate(() => window.__canvastDebug.camera()), `${mode}: arrives at once`).toEqual(home);
  }
  expect(await level()).toBe(0);
  expect(app.consoleErrors).toEqual([]);
});

test("a short trip still glides and linear easing reaches the same place; fixed time ends with it", async ({ app }) => {
  const p = app.page;
  await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  await p.getByRole("button", { name: "Add bookmark" }).click();
  const home = await p.evaluate(() => window.__canvastDebug.camera());
  await p.evaluate(() => window.__canvastDebug.setSetting("nav.ease", "linear"));
  await p.evaluate(() => window.__canvastDebug.setSetting("nav.speed", "fixed"));
  await p.evaluate(() => window.__canvastDebug.glide(300));
  await p.evaluate(() => window.__canvastDebug.jump(5));
  await p.getByRole("button", { name: /Go to Bookmark 1/ }).click();
  expect(await p.evaluate(() => window.__canvastDebug.camera()), "not at once").not.toEqual(home);
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.camera()), { timeout: 3000 }).toEqual(home);
});

test("bookmark keys, reorder, a bookmark of the picked things, and a tour that moves on by itself", async ({ app }) => {
  const p = app.page;
  const names = () => p.locator("li.bookmark .bookmark-name").allTextContents();
  const zoom = async () => Number(await p.evaluate(() => window.__canvastDebug.depth()));
  await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  await p.getByRole("button", { name: "Add bookmark" }).click(); // 1 at zoom 0
  await p.evaluate(() => window.__canvastDebug.jump(4));
  await p.getByRole("button", { name: "Add bookmark" }).click(); // 2 at zoom 4
  await p.evaluate(() => window.__canvastDebug.jump(4));
  await p.getByRole("button", { name: "Add bookmark" }).click(); // 3 at zoom 8
  // Alt+number, then ] and [ step from the last one visited
  await p.keyboard.press("Alt+2");
  expect(await zoom()).toBe(4);
  await p.keyboard.press("]");
  expect(await zoom()).toBe(8);
  await p.keyboard.press("]");
  expect(await zoom(), "wraps to the first").toBe(0);
  await p.keyboard.press("[");
  expect(await zoom(), "wraps back to the last").toBe(8);
  // reorder from the menu: move Bookmark 3 up, then drag Bookmark 1 onto it
  await p.getByRole("button", { name: "More actions for bookmark Bookmark 3" }).click();
  await p.getByRole("menuitem", { name: "Move Bookmark 3 up" }).click();
  await expect.poll(names).toEqual(["Bookmark 1", "Bookmark 3", "Bookmark 2"]);
  await p.locator("li.bookmark", { hasText: "Bookmark 1" }).dragTo(p.locator("li.bookmark", { hasText: "Bookmark 2" }));
  await expect.poll(names).toEqual(["Bookmark 3", "Bookmark 2", "Bookmark 1"]);
  // a bookmark of the picked things leaves the camera where it is
  await p.evaluate(() => window.__canvastDebug.jump(-8));
  await p.keyboard.press("u");
  await app.drag({ x: 450, y: 300 }, { x: 520, y: 340 }, 6);
  await p.keyboard.press("v");
  const before = await p.evaluate(() => window.__canvastDebug.camera());
  await p.getByRole("button", { name: "Bookmark the picked things" }).click();
  await expect(p.locator("li.bookmark")).toHaveCount(4);
  await expect(p.getByTestId("thumb-veil")).toHaveCount(0, { timeout: 10000 }); // (its picture is taken by visiting it, then the view comes back)
  expect(await p.evaluate(() => window.__canvastDebug.camera())).toEqual(before);
  await p.keyboard.press("Alt+4");
  expect(await zoom(), "it brings the shape into view (zoomed in)").toBeGreaterThan(1);
  // the tour moves on by itself after the wait
  await p.evaluate(() => window.__canvastDebug.setSetting("tour.pause", 1));
  await p.getByRole("button", { name: "Play the bookmarks as a tour" }).click();
  const cap = p.getByTestId("tour-caption");
  await expect(cap).toContainText("1 / 4");
  await expect(cap).toContainText("2 / 4", { timeout: 5000 });
  await p.keyboard.press("Escape");
  expect(app.consoleErrors).toEqual([]);
});

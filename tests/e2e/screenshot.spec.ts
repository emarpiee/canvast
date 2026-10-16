import { expect, test } from "./harness";

/** Screenshots (ADR 0080): the canvas saved to the library with a name, folder and tags from Settings > Screenshot. */

const names = (p: import("@playwright/test").Page) =>
  p.evaluate(async () => {
    const l = await window.__canvastDebug.assetListing();
    return l.entries.map((e) => ({ name: e.name, type: e.type, tags: [...(e.tags ?? [])], folder: l.folders.find((f) => f.id === e.folderIds?.[0])?.name ?? "" }));
  });

test("the Screenshot button saves the view to the library: webp, in the Screenshots folder, named board-canvas-date-time, tagged screenshot (ADR 0080)", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await app.drag({ x: 500, y: 400 }, { x: 640, y: 460 }, 6);
  await p.getByRole("button", { name: "Screenshot", exact: true }).click();
  await expect(p.getByTestId("toast")).toContainText("Screenshot saved");
  await expect.poll(async () => (await names(p)).length).toBe(1);
  const [shot] = await names(p);
  expect(shot!.name).toMatch(/^board_1-canvas_1-\d{8}-\d{6}\.webp$/);
  expect(shot!.type).toBe("image/webp");
  expect(shot!.folder).toBe("Screenshots");
  expect(shot!.tags).toEqual(["screenshot"]);
  expect(app.consoleErrors).toEqual([]);
});

test("Settings > Screenshot: format, name, folder, tags and area are used; the pattern and the interface can be left out or put in (ADR 0080)", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-settings").click();
  await p.locator("#settings-view").getByRole("tab", { name: "Screenshot" }).click();
  const panel = p.locator("#set-panel-screenshot");
  await panel.getByLabel("Picture format", { exact: true }).selectOption("png");
  await panel.getByLabel("File name", { exact: true }).fill("shot-{canvas}");
  await panel.getByLabel("Library folder", { exact: true }).fill("Shots");
  await panel.getByLabel("Tag: the board's name", { exact: true }).check();
  await panel.getByLabel("Include the canvas pattern", { exact: true }).uncheck();
  await panel.getByLabel("Include the interface", { exact: true }).check();
  await p.getByTestId("view-canvas").click();
  await p.getByRole("button", { name: "Screenshot", exact: true }).click();
  await expect(p.getByTestId("toast")).toContainText("Screenshot saved");
  await expect.poll(async () => (await names(p)).length).toBe(1);
  const [shot] = await names(p);
  expect(shot).toMatchObject({ name: "shot-canvas_1.png", type: "image/png", folder: "Shots" });
  expect(shot!.tags).toEqual(["screenshot", "Board 1"]);
  // A transparent, pattern-free screenshot has no pixel of the background: the picture is made from a cleared canvas.
  expect(app.consoleErrors).toEqual([]);
});

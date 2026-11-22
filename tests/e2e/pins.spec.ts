import { expect, test } from "./harness";
import { makePng } from "./png";

test("Pins (ADR 0208): Shift+R pins the open canvas in a window above every view, drawn by the canvas's own engine; what is done in it is done to the canvas (its own selection, the canvas's keys and undo), and it opens again after a reload", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.runCommand("item.create", { kind: "rect" }, "test"));
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  const id = await p.evaluate(() => window.__canvastDebug.objects()[0]!.id);
  const mainBox = () => p.evaluate((i) => window.__canvastDebug.objectScreen(i)!.box, id);
  await p.evaluate(() => window.__canvastDebug.select([]));
  await p.keyboard.press("Shift+R");
  const pins = p.getByTestId("pins");
  await expect(pins).toBeVisible();
  const view = pins.locator("canvas");
  const r = (await view.boundingBox())!;
  // its view of the same canvas: the shape in its middle, picked and moved there; the main view shows it moved (one document)
  const mid = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  await p.mouse.click(mid.x, mid.y);
  // F, the canvas's key, on the view in use: the selected shape fills Pins (so a press in its middle is on it, not on a corner's turn zone)
  await p.keyboard.press("f");
  await p.waitForTimeout(400);
  const before = await mainBox();
  await p.mouse.move(mid.x, mid.y);
  await p.mouse.down();
  await p.mouse.move(mid.x + 30, mid.y + 20, { steps: 5 });
  await p.mouse.up();
  const said = await view.evaluate((c, at) => {
    const under = document.elementFromPoint(at.x, at.y);
    return `canvas ${(c as HTMLCanvasElement).width}x${(c as HTMLCanvasElement).height}; under the press ${under === c ? "its canvas" : `${under?.tagName}.${under?.className}`}; the release ended ${(c as HTMLElement).dataset["lastGesture"] ?? "no gesture"}; turn ${(c as HTMLElement).dataset["lastTurn"] ?? "none"}`;
  }, mid);
  await expect.poll(async () => (await mainBox()).minX - before.minX, { message: `moved in Pins, moved on the canvas (${said})` }).toBeGreaterThan(10);
  expect(await p.evaluate(() => window.__canvastDebug.selection().length), "the main view's selection is its own").toBe(0);
  // the canvas's keys act on the view in use: Delete takes what Pins selected; Ctrl+Z brings it back
  await p.keyboard.press("Delete");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length), { message: "Delete in Pins" }).toBe(0);
  await p.keyboard.press("Control+z");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length), { message: "Ctrl+Z in Pins" }).toBe(1);
  // above every view: still shown over the Library
  await p.getByTestId("view-assets").click();
  await expect(pins).toBeVisible();
  // opened again after a reload
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(p.getByTestId("pins")).toBeVisible();
  expect(app.consoleErrors).toEqual([]);
});

test("a Pins window shows the library's pictures as a gallery of the library's own cards: its search narrows them, a double-click opens the library's viewer", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "red.png", mimeType: "image/png", buffer: makePng(60, 40, () => [200, 40, 40, 255]) });
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  await p.evaluate(() => window.__canvastDebug.runCommand("pins.open", { source: "all" }, "test"));
  const pins = p.getByTestId("pins");
  const card = pins.locator(".asset-card");
  await expect(card, "the library's card").toHaveCount(1);
  await expect(card.locator("img")).toHaveAttribute("src", /.+/);
  // the search narrows it
  await pins.locator(".layers-filter input").fill("blue");
  await expect(card).toHaveCount(0);
  await pins.locator(".layers-filter input").fill("");
  await expect(card).toHaveCount(1);
  // a double-click opens it in the library's own viewer
  await card.dblclick();
  await expect(p.getByTestId("slide-view")).toBeVisible();
  expect(app.consoleErrors).toEqual([]);
});

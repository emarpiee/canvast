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
  // (pressed inside it, off its middle: the middle of a selection is its turn handle, as on the canvas)
  const at = { x: mid.x - 50, y: mid.y + 30 };
  await p.mouse.move(at.x, at.y);
  await p.mouse.down();
  await p.mouse.move(at.x + 30, at.y + 20, { steps: 5 });
  await p.mouse.up();
  const said = await view.evaluate((c, at) => {
    const under = document.elementFromPoint(at.x, at.y);
    return `canvas ${(c as HTMLCanvasElement).width}x${(c as HTMLCanvasElement).height}; under the press ${under === c ? "its canvas" : `${under?.tagName}.${under?.className}`}; the release ended ${(c as HTMLElement).dataset["lastGesture"] ?? "no gesture"}; turn ${(c as HTMLElement).dataset["lastTurn"] ?? "none"}`;
  }, at);
  await expect.poll(async () => (await mainBox()).minX - before.minX, { message: `moved in Pins, moved on the canvas (${said})` }).toBeGreaterThan(10);
  expect(await p.evaluate(() => window.__canvastDebug.selection().length), "the main view's selection is its own").toBe(0);
  // the app's Actions bar comes into the window while its canvas is in use, with its Adjust and Arrange only
  const bar = pins.locator(".ctx-bar");
  await expect(bar, "the Actions bar in the Pins window").toBeVisible();
  await expect(bar.locator('.tb-group[aria-label="Objects"]')).toBeHidden();
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

test("a Pins window shows pictures of the library in the library's own viewer (its filmstrip, zoom and slideshow), for all of them or a folder; the Library view is left as it was", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").first().setInputFiles([
    { name: "red.png", mimeType: "image/png", buffer: makePng(60, 40, () => [200, 40, 40, 255]) },
    { name: "teal.png", mimeType: "image/png", buffer: makePng(40, 60, () => [30, 160, 150, 255]) },
  ]);
  await expect(p.locator("#assets-view").getByTestId("asset-card")).toHaveCount(2);
  await p.getByTestId("view-canvas").click();
  await p.evaluate(() => window.__canvastDebug.runCommand("pins.open", { source: "all" }, "test"));
  const pins = p.getByTestId("pins");
  // the viewer, in the window, at once: the picture large and the others in its strip
  await expect(pins.getByTestId("slide-view")).toBeVisible();
  await expect(pins.locator(".film-item")).toHaveCount(2);
  await expect(pins.locator(".assets-side")).toBeHidden();
  // the main view is still the canvas, and the Library view kept its own state
  await expect(p.locator("#assets-view")).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

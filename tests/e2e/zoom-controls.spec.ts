import { expect, test } from "./harness";
import type { App } from "./harness";

/** Typed zoom levels (all builds) and the #debug developer navigation panel. */

async function typeZoom(app: App, text: string): Promise<void> {
  await app.page.getByTestId("zoom-readout").click();
  const input = app.page.getByTestId("zoom-input");
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press("Enter");
  await app.frame();
}

test("typing a zoom level jumps there exactly, anchored at the viewport centre", async ({ app }) => {
  await app.page.evaluate(() => window.__canvastDebug.setCamera({ cx: "-5p1", cy: "7p-3", zi: 2, zf: 0.25, pz: 2 }));
  await app.frame();
  const centre = await app.worldAt(640, 400);
  for (const [text, level] of [["3000", 3000], ["2^-500", -500], ["10^300", 300 / Math.log10(2)], ["12.5", 12.5]] as const) {
    await typeZoom(app, text);
    const cam = await app.camera();
    expect(cam.zi + cam.zf).toBeCloseTo(level, 5); // zoom steps are quantized to 2^-20 levels
    expect(await app.worldAt(640, 400)).toEqual(centre); // the centre's world point is unchanged
    await expect(app.page.getByTestId("zoom-input")).toBeHidden();
  }
  await expect(app.page.getByTestId("zoom-readout")).toContainText("2^12.50");
});

test("invalid text and oversized jumps are rejected without moving the camera", async ({ app }) => {
  const before = await app.camera();
  await typeZoom(app, "abc");
  await expect(app.page.getByTestId("toast")).toContainText("not a zoom level");
  await app.page.getByTestId("zoom-input").press("Escape");
  // One jump is capped at 2^50 levels (ADR 0014: zoom counts are doubles); depth itself is unbounded.
  await typeZoom(app, "2^1e16");
  await expect(app.page.getByTestId("toast")).toContainText("limited to 2^50");
  await app.page.getByTestId("zoom-input").press("Escape");
  expect(await app.camera()).toEqual(before);
  // Escape restores the read-out and keeps the camera.
  await expect(app.page.getByTestId("zoom-readout")).toBeVisible();
});

test("a placed stroke is still coloured after typing a 3000-level jump into it", async ({ app }) => {
  await app.page.keyboard.press("p");
  await app.page.getByRole("button", { name: "Pen width 8 px" }).click();
  await app.page.mouse.move(500, 400);
  await app.page.mouse.down();
  await app.page.mouse.move(780, 400, { steps: 8 });
  await app.page.mouse.up();
  await app.frame();
  const ink = await app.page.evaluate(() => window.__canvastDebug.pixelAt(640, 400));
  for (const level of ["1000", "3000", "9000"]) {
    await typeZoom(app, level);
    expect(await app.page.evaluate(() => window.__canvastDebug.pixelAt(640, 400)), `at 2^${level}`).toEqual(ink);
  }
});

test("dev panel: jump buttons and auto-zoom (keeps running while drawing; stops on Escape)", async ({ app }) => {
  const panel = app.page.getByTestId("dev-panel");
  await expect(panel).toBeVisible();
  for (let i = 0; i < 3; i++) await panel.getByRole("button", { name: "+1000" }).click();
  await panel.getByRole("button", { name: "−10", exact: true }).click();
  await app.frame();
  let cam = await app.camera();
  expect(cam.zi + cam.zf).toBe(2990);

  await panel.getByRole("combobox").selectOption("100");
  await panel.getByRole("button", { name: "auto in ▶" }).click();
  await app.page.waitForTimeout(1000);
  // Drawing does not stop it: it zooms on while the stroke is drawn.
  await app.page.keyboard.press("p");
  await app.drag({ x: 900, y: 500 }, { x: 1000, y: 600 }, 6);
  expect((await app.page.evaluate(() => window.__canvastDebug.objects())).length).toBe(1);
  await app.page.keyboard.press("Escape");
  await app.frame();
  const stopped = await app.camera();
  expect(stopped.zi + stopped.zf).toBeGreaterThan(2990 + 30); // ~100 levels/s for ~1 s
  await app.page.waitForTimeout(400);
  cam = await app.camera();
  expect(cam).toEqual(stopped); // really stopped
  for (const name of ["+1e12", "−1e12", "+1e9", "−1e9", "+1e6", "−1e6"]) await panel.getByRole("button", { name, exact: true }).click();
  await app.frame();
  expect(Number((await app.page.evaluate(() => window.__canvastDebug.depth())))).toBeGreaterThan(0); // all six worked

  await panel.getByRole("button", { name: "◀ auto out" }).click();
  await app.page.waitForTimeout(500);
  await panel.getByRole("button", { name: "◀ auto out" }).click(); // toggle off
  const out = await app.camera();
  expect(out.zi + out.zf).toBeLessThan(stopped.zi + stopped.zf);
  expect(app.consoleErrors).toEqual([]);
});

test("dev panel: Clear canvas deletes every object, is saved, and Ctrl+Z brings them back", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await app.drag({ x: 400, y: 300 }, { x: 600, y: 350 }, 5);
  await app.drag({ x: 400, y: 500 }, { x: 600, y: 550 }, 5);
  expect((await p.evaluate(() => window.__canvastDebug.objects())).length).toBe(2);
  await p.getByRole("button", { name: "Clear canvas" }).click();
  await app.frame();
  expect(await p.evaluate(() => window.__canvastDebug.objects())).toEqual([]);
  await p.keyboard.press("Control+z");
  expect((await p.evaluate(() => window.__canvastDebug.objects())).length).toBe(2);
  await p.keyboard.press("Control+y");
  expect(await p.evaluate(() => window.__canvastDebug.objects())).toEqual([]);
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  expect(await p.evaluate(() => window.__canvastDebug.objects())).toEqual([]);
});

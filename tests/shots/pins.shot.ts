// README pictures of Pins (ADR 0208): a canvas of gesture studies pinned above the painting it serves, and a folder of the library as a
// gallery beside the canvas (manifest.ts).
import { test, expect } from "./scene";

test("pins", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 200 });
  const [dancer, horse] = await s.art("degas-dancer_with", "delacroix");
  // the studies, on a canvas of their own
  await s.canvas("Gesture studies");
  const studies = await s.place([dancer!]);
  await s.fit(studies, 0.7);
  const cid = await s.p.evaluate(() => window.__canvastDebug.session().current!.canvasId);
  // the painting being worked on, with the studies pinned above it
  await s.canvas("Painting");
  const work = await s.place([horse!]);
  await s.fit(work, 0.6, [0.66, 0.5]);
  await s.p.evaluate((c) => window.__canvastDebug.runCommand("pins.open", { canvas: c }, "test"), cid);
  await expect(s.p.getByTestId("pins").locator(".pins-canvas")).toBeVisible();
  await s.settle(600);
  // (the studies in sight in the window: the window is the view in use, then everything on its canvas is fitted, as F does)
  await s.p.getByTestId("pins").evaluate((el) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await s.p.evaluate(() => window.__canvastDebug.runCommand("view.fitAll", {}, "test"));
  await s.settle(800);
  await s.shot("pins", await s.around({ objects: work, els: ['[data-testid="pins"]'], pad: 20 }));
});

test("pins-gallery", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 30 });
  await s.art("hokusai-under", "hokusai-seaside", "hokusai-mystical", "hokusai-basket", "hokusai-still", "hokusai-rooster");
  const [print] = await s.art("hokusai-under");
  await s.canvas("Wave study");
  const placed = await s.place([print!]);
  await s.fit(placed, 0.6, [0.68, 0.5]);
  await s.p.evaluate(() => window.__canvastDebug.runCommand("pins.open", { source: "all" }, "test"));
  const pins = s.p.getByTestId("pins");
  // (the library's viewer in the window: the picture large, its strip loaded)
  await expect(pins.getByTestId("slide-view")).toBeVisible();
  await expect.poll(() => pins.locator(".film-item img.is-loaded").count(), { timeout: 20_000 }).toBeGreaterThan(2);
  await s.settle(800);
  await s.shot("pins-gallery", await s.around({ objects: placed, els: ['[data-testid="pins"]'], pad: 20 }));
});

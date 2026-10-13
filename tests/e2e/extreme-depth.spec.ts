import { expect, recordMetric, test } from "./harness";

/**
 * Working 10,000,000 levels deep (the largest single zoom jump). Before
 * v0.8.0 every frame there took ~1.8 s: landmarks near the origin were
 * placed on screen by an exact subtraction that built 10-million-bit numbers
 * (fixed by diffToNumber in core/dyadic.ts).
 */

/**
 * Slowest acceptable input step (input plus the frames it causes). Before the
 * fix one frame alone took ~1,800 ms and a stroke ~24 s.
 */
const MAX_STEP_MS = 500;

test("at 2^10,000,000 panning, drawing, selecting, moving, undo and text stay responsive", async ({ app }, info) => {
  const p = app.page;
  const deep = 10_000_000;
  await p.evaluate((z) => window.__canvastDebug.setCamera({ cx: "0p0", cy: "0p0", zi: z, zf: 0, pz: z }), deep);
  await app.frame();
  const frames: number[] = [];
  const timed = async (fn: () => Promise<void>): Promise<void> => {
    const t0 = Date.now();
    await fn();
    await app.frame();
    frames.push(Date.now() - t0);
  };
  await p.mouse.click(640, 400);
  for (let i = 0; i < 4; i++) await timed(() => p.keyboard.press("ArrowRight"));
  // Draw, select, move, undo.
  await p.keyboard.press("p");
  await timed(() => app.drag({ x: 500, y: 400 }, { x: 700, y: 450 }, 6));
  const [s] = await p.evaluate(() => window.__canvastDebug.objects());
  expect(s?.kind).toBe("stroke");
  await p.keyboard.press("v");
  await timed(() => p.mouse.click(600, 425));
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([s!.id]);
  await timed(() => app.drag({ x: 600, y: 425 }, { x: 650, y: 475 }, 6));
  const moved = (await p.evaluate(() => window.__canvastDebug.objects()))[0]!;
  expect(moved.ax).not.toBe(s!.ax);
  await timed(() => p.keyboard.press("Control+z"));
  expect((await p.evaluate(() => window.__canvastDebug.objects()))[0]!.ax).toBe(s!.ax);
  // Text.
  await p.keyboard.press("t");
  await p.mouse.click(400, 250);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await p.keyboard.type("deep");
  await timed(() => p.keyboard.press("Escape"));
  expect((await p.evaluate(() => window.__canvastDebug.objects())).map((o) => o.kind).sort()).toEqual(["stroke", "text"]);
  expect(await p.evaluate(() => window.__canvastDebug.inkedPixels(2))).toBeGreaterThan(50);
  recordMetric(info, "extreme-depth", { level: deep, frameMs: frames });
  for (const ms of frames) expect(ms, `steps ${frames}`).toBeLessThan(MAX_STEP_MS);
  expect(app.consoleErrors).toEqual([]);
});

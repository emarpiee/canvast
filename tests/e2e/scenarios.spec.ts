import { expect, test } from "./harness";
import type { App } from "./harness";
import { makePng } from "./png";

/**
 * The spec's U-series scenarios that belong to groups, selection and copies (U3, U6, U9, U10) and scenario I (switching views leaves
 * nothing behind). One test each, with the least input that proves it; the rest of each scenario is in editing, frames and archive.
 */
type Obj = { id: string; kind: string; groups?: string[]; attachmentTargetId: string | null; z: number; ax: string; ay: string };
const objs = async (app: App): Promise<Obj[]> => (await app.page.evaluate(() => window.__canvastDebug.objects())) as unknown as Obj[];
const boxOf = async (app: App, id: string) => (await app.page.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
const selection = (app: App) => app.page.evaluate(() => window.__canvastDebug.selection());
const PIC = makePng(40, 30, (x, y) => [x * 6, y * 8, 120, 255]);

async function place(app: App): Promise<string> {
  const before = (await objs(app)).length;
  await app.page.getByTestId("import-input").setInputFiles({ name: "pic.png", mimeType: "image/png", buffer: PIC });
  await expect.poll(async () => (await objs(app)).length).toBe(before + 1);
  await app.frame();
  return (await objs(app)).at(-1)!.id;
}

async function stroke(app: App, a: [number, number], b: [number, number]): Promise<string> {
  await app.page.keyboard.press("p");
  await app.drag({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, 6);
  return (await objs(app)).at(-1)!.id;
}

test("U3 and U9: a picture and a stroke grouped move together and ungroup in place; a copy of the picture is another object of the same original, moved alone", async ({ app }) => {
  const p = app.page;
  const pic = await place(app);
  const b0 = await boxOf(app, pic);
  const s = await stroke(app, [Math.round(b0.minX) - 150, 300], [Math.round(b0.minX) - 60, 330]);
  await p.keyboard.press("v");
  await p.mouse.click(Math.round(b0.minX) - 100, 315);
  await p.keyboard.down("Shift");
  await p.mouse.click(Math.round((b0.minX + b0.maxX) / 2), Math.round((b0.minY + b0.maxY) / 2));
  await p.keyboard.up("Shift");
  expect((await selection(app)).sort()).toEqual([pic, s].sort());
  await p.keyboard.press("Control+g");
  const sBefore = await boxOf(app, s);
  await app.drag({ x: Math.round((b0.minX + b0.maxX) / 2), y: Math.round((b0.minY + b0.maxY) / 2) }, { x: Math.round((b0.minX + b0.maxX) / 2) + 70, y: Math.round((b0.minY + b0.maxY) / 2) + 20 }, 6);
  expect((await boxOf(app, s)).minX - sBefore.minX, "the stroke went along with the picture").toBeCloseTo(70, 0);
  const grouped = { pic: await boxOf(app, pic), s: await boxOf(app, s) };
  await p.keyboard.press("Control+Shift+g");
  expect({ pic: await boxOf(app, pic), s: await boxOf(app, s) }, "ungrouping keeps both where they are").toEqual(grouped);
  expect((await objs(app)).every((o) => !o.groups?.length)).toBe(true);

  // U9: copy the picture alone: another object, the same original, moved without the first
  await p.mouse.click(Math.round((grouped.pic.minX + grouped.pic.maxX) / 2), Math.round((grouped.pic.minY + grouped.pic.maxY) / 2));
  expect(await selection(app)).toEqual([pic]);
  await p.keyboard.press("Control+d");
  const all = await objs(app);
  const copy = all.find((o) => o.kind === "image" && o.id !== pic)!;
  expect(copy).toBeTruthy();
  expect(all.filter((o) => o.kind === "stroke"), "the stroke was not copied with it").toHaveLength(1);
  expect(await p.evaluate(() => window.__canvastDebug.storedAssetHashes()), "one original").toHaveLength(1);
  const first = await boxOf(app, pic);
  await app.drag({ x: Math.round((first.minX + first.maxX) / 2) + 30, y: Math.round((first.minY + first.maxY) / 2) + 30 }, { x: Math.round((first.minX + first.maxX) / 2) + 130, y: Math.round((first.minY + first.maxY) / 2) + 30 }, 6);
  expect((await boxOf(app, pic)).minX, "the first did not move").toBeCloseTo(first.minX, 0);
  expect((await boxOf(app, copy.id)).minX).not.toBeCloseTo(first.minX, 0);
});

test("U6: a lasso that holds a stroke and only a corner of a big picture takes the stroke, whatever the filter; one that holds the whole picture takes it with All", async ({ app }) => {
  const p = app.page;
  const pic = await place(app);
  const b = await boxOf(app, pic);
  const s = await stroke(app, [Math.round(b.minX) - 140, 300], [Math.round(b.minX) - 70, 330]);
  await p.keyboard.press("v");
  const lasso = async (poly: Array<[number, number]>, filter: "all" | "strokes"): Promise<string[]> => {
    await p.evaluate((f) => window.__canvastDebug.setLassoFilter(f), filter);
    await p.keyboard.press("l");
    await p.mouse.move(...poly[0]!);
    await p.mouse.down();
    for (const q of [...poly.slice(1), poly[0]!]) await p.mouse.move(q[0], q[1], { steps: 5 });
    await p.mouse.up();
    return selection(app);
  };
  const part: Array<[number, number]> = [[b.minX - 170, 270], [b.minX + 10, 270], [b.minX + 10, 380], [b.minX - 170, 380]];
  for (const f of ["all", "strokes"] as const) {
    expect(await lasso(part, f), `a corner of the picture is not grabbed (${f})`).toEqual([s]);
    await p.keyboard.press("Escape");
  }
  const whole: Array<[number, number]> = [[b.minX - 20, b.minY - 20], [b.maxX + 20, b.minY - 20], [b.maxX + 20, b.maxY + 20], [b.minX - 20, b.maxY + 20]];
  expect(await lasso(whole, "all"), "the whole picture is taken with All").toEqual([pic]);
  await p.keyboard.press("Escape");
  expect(await lasso(whole, "strokes"), "and not with Strokes only").toEqual([]);
});

test("U10: groups, a link to a picture and the order survive a save and reopen with the same ids", async ({ app }) => {
  const p = app.page;
  const pic = await place(app);
  const b = await boxOf(app, pic);
  const a = await stroke(app, [Math.round(b.minX) - 200, 250], [Math.round(b.minX) - 120, 270]);
  const c = await stroke(app, [Math.round(b.minX) - 200, 330], [Math.round(b.minX) - 120, 350]);
  const d = await stroke(app, [Math.round(b.minX) - 200, 410], [Math.round(b.minX) - 120, 430]);
  await p.keyboard.press("v");
  await p.mouse.click(Math.round(b.minX) - 160, 260);
  await p.keyboard.down("Shift");
  await p.mouse.click(Math.round(b.minX) - 160, 340);
  await p.keyboard.up("Shift");
  await p.keyboard.press("Control+g"); // a and c are one group
  await p.mouse.click(Math.round(b.minX) - 160, 420); // d alone, attached to the picture
  await p.locator('[data-ctx="attach"]').click();
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  const before = await objs(app);
  expect(before.find((o) => o.id === d)!.attachmentTargetId).toBe(pic);
  expect(before.find((o) => o.id === a)!.groups).toEqual(before.find((o) => o.id === c)!.groups);
  expect(before.find((o) => o.id === a)!.groups?.length).toBe(1);
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  expect(await objs(app), "the same objects: ids, groups, links, order and placement").toEqual(before);
  // no phantom link: deleting the picture frees the stroke that was attached to it
  await p.keyboard.press("v");
  await p.mouse.click(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await p.keyboard.press("Delete");
  const after = await objs(app);
  expect(after.some((o) => o.id === pic)).toBe(false);
  expect(after.filter((o) => o.attachmentTargetId !== null)).toEqual([]);
});

test("scenario I: switching between the canvas, the Assets view and Settings a thousand times leaves no nodes, listeners or memory behind", async ({ app, context }) => {
  const p = app.page;
  const cdp = await context.newCDPSession(p);
  await cdp.send("Performance.enable");
  const metrics = async (): Promise<Record<string, number>> => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics: m } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(m.map((x) => [x.name, x.value]));
  };
  const cycle = (n: number) =>
    p.evaluate(async (count) => {
      for (let i = 0; i < count; i++) {
        for (const v of ["assets", "settings", "canvas"] as const) {
          window.__canvastDebug.setView(v);
          await new Promise((r) => requestAnimationFrame(r));
        }
      }
    }, n);
  await cycle(10); // everything a view builds the first time
  const start = await metrics();
  await cycle(333); // 999 switches and the 1,000th is the next line
  await cycle(1);
  const end = await metrics();
  expect(end["Nodes"]!, "page nodes").toBeLessThanOrEqual(start["Nodes"]! + 20);
  expect(end["JSEventListeners"]!, "event listeners").toBeLessThanOrEqual(start["JSEventListeners"]! + 20);
  expect(end["JSHeapUsedSize"]!, "memory").toBeLessThan(start["JSHeapUsedSize"]! * 1.25 + 2_000_000);
  expect(app.consoleErrors).toEqual([]);
});

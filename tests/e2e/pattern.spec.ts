import { exportWith, expect, test } from "./harness";
import type { App } from "./harness";

/**
 * Pattern generators (ADR 0162): the panel is built from each generator's own settings; a result goes on a new sheet, a picked sheet or a
 * picked shape; while the panel is open every change replaces the last result, and the whole session is one undo step.
 */
type Obj = { id: string; kind: string; name?: string; parent?: string; groups?: string[]; container?: { clip: boolean; mask?: boolean }; fill: string | null; sub?: unknown[] };
const objs = async (app: App): Promise<Obj[]> => (await app.page.evaluate(() => window.__canvastDebug.objects())) as unknown as Obj[];
const choose = async (app: App, id: string) => {
  await app.page.locator("[data-pg-pick]").click();
  await app.page.locator(`[data-gen="${id}"]`).click();
};
const make = (app: App) => app.page.getByTestId("pattern-make").click();
const setNumber = (app: App, key: string, v: string) => app.page.locator(`[data-k="${key}"] input[type=number]`).fill(v);
const sheets = (all: Obj[]) => all.filter((o) => o.container);
const on = (all: Obj[], id: string) => all.filter((o) => o.parent === id);
const subCount = (all: Obj[], id: string) => on(all, id).reduce((n, o) => n + (o.sub?.length ?? 0), 0); // (shapes of one colour are one path of many sub-paths)

test("Pattern: a new sheet, each change replaces the result, hiding the background, one undo step for the session", async ({ app }) => {
  const p = app.page;
  await p.click("[data-pattern-panel]");
  await expect(p.getByTestId("pattern-panel")).toBeVisible();
  await expect(p.locator("[data-pg-target]")).toHaveText("A new sheet");
  await choose(app, "tides");
  expect(await objs(app)).toHaveLength(0); // choosing makes nothing until Generate
  await make(app);
  let all = await objs(app);
  expect(sheets(all)).toHaveLength(1);
  const sheet = sheets(all)[0]!;
  expect(on(all, sheet.id)).toHaveLength(7); // background and 6 layers
  expect(new Set(on(all, sheet.id).map((o) => o.groups?.[0])).size).toBe(1); // one group

  await setNumber(app, "layers", "3"); // live: the result is replaced, not stacked
  await expect.poll(async () => (await objs(app)).length).toBe(5);
  await p.locator('[data-k="bg"] [data-eye]').click();
  await expect.poll(async () => (await objs(app)).some((o) => o.name === "Background")).toBe(false);
  all = await objs(app);
  expect(sheets(all)).toHaveLength(1);
  expect(on(all, sheets(all)[0]!.id)).toHaveLength(3);

  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await p.keyboard.press("Control+z"); // the whole session is one step
  await expect.poll(async () => (await objs(app)).length).toBe(0);
  expect(await p.evaluate(() => window.__canvastDebug.canUndo())).toBe(false);
  expect(app.consoleErrors).toEqual([]);
});

for (const [what, key] of [["sheet", "c"], ["shape", "u"]] as const) test(`Pattern: resizing the ${what} it is on (picked alone) makes the pattern again at the new size (from its settings and seed), in one undo step`, async ({ app }) => {
  const p = app.page;
  await p.keyboard.press(key);
  await app.drag({ x: 450, y: 250 }, { x: 750, y: 450 }, 6);
  await p.keyboard.press("v");
  await p.mouse.click(600, 350);
  await p.click("[data-pattern-panel]");
  await choose(app, "ripple");
  await make(app); // (the sheet or shape alone is picked: what is on it follows it)
  const box = (id: string) => p.evaluate((i) => window.__canvastDebug.objectScreen(i)!.box, id);
  const union = async (ids: string[]) => {
    const bs = await Promise.all(ids.map(box));
    return { minX: Math.min(...bs.map((b) => b.minX)), minY: Math.min(...bs.map((b) => b.minY)), maxX: Math.max(...bs.map((b) => b.maxX)), maxY: Math.max(...bs.map((b) => b.maxY)) };
  };
  let all = await objs(app);
  const sheet = sheets(all)[0]!;
  const seed = (on(all, sheet.id).find((o) => (o as Obj & { gen?: { seed: number } }).gen) as Obj & { gen: { seed: number } }).gen.seed;
  // the sheet's corner handle, dragged out: 150 px wider, 100 px taller
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([sheet.id]);
  const c = (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!.corners;
  await app.drag({ x: c[2]![0], y: c[2]![1] }, { x: c[2]![0] + 150, y: c[2]![1] + 100 }, 8);
  await app.frame();
  all = await objs(app);
  const pieces = on(all, sheet.id);
  const sb = await box(sheet.id), pb = await union(pieces.map((o) => o.id));
  expect(sb.maxX - sb.minX).toBeCloseTo(450, -1);
  for (const k of ["minX", "minY", "maxX", "maxY"] as const) expect(Math.abs(pb[k] - sb[k]), `the pattern reaches the sheet's ${k}`).toBeLessThan(2);
  expect((pieces.find((o) => (o as Obj & { gen?: unknown }).gen) as Obj & { gen: { seed: number } }).gen.seed, "the same settings and seed").toBe(seed);
  expect(new Set(pieces.map((o) => o.groups?.[0])).size, "still one pattern").toBe(1);
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await box(sheet.id)).maxX - (await box(sheet.id)).minX).toBeCloseTo(300, -1);
  expect(app.consoleErrors).toEqual([]);
});

test("Pattern: on a picked sheet and on a picked shape (which cuts it), Randomize, Done starts a new result", async ({ app }) => {
  const p = app.page;
  await p.click("[data-pattern-panel]");
  await choose(app, "stripes");
  await make(app);
  const sheet = sheets(await objs(app))[0]!;
  await p.locator("[data-pg-done]").click();
  await choose(app, "dots");
  await expect(p.locator("[data-pg-target]")).toHaveText(sheet.name!);
  await make(app);
  let all = await objs(app);
  expect(sheets(all)).toHaveLength(1); // the picked sheet holds it: no new sheet
  expect(on(all, sheet.id).some((o) => o.name === "Dots")).toBe(true);
  expect(on(all, sheet.id).some((o) => o.name === undefined || o.name !== "Dots")).toBe(true); // the first result is still there

  const seed = await p.locator("[data-pg-seed]").inputValue();
  await p.locator("[data-pg-done]").click();
  await p.keyboard.press("Escape");
  await app.page.keyboard.press("u");
  await app.drag({ x: 560, y: 300 }, { x: 760, y: 400 }, 8);
  const shape = (await objs(app)).at(-1)!;
  await app.page.keyboard.press("v");
  await app.page.mouse.click(660, 350);
  await app.frame();
  await expect(p.locator("[data-pg-target]")).toContainText("shape");
  await choose(app, "bubbles");
  await p.locator("[data-pg-random]").click();
  expect(await p.locator("[data-pg-seed]").inputValue()).not.toBe(seed);
  all = await objs(app);
  const mask = sheets(all).find((o) => o.container!.mask)!;
  expect(mask).toBeTruthy();
  expect(on(all, mask.id).length).toBeGreaterThan(1);
  expect(mask.id, "the picked shape itself holds the pattern (not a new mask over it)").toBe(shape.id);
  expect(all.filter((o) => o.kind === "path" && !o.container && !o.groups && o.fill !== null), "no copy of the shape is left under it").toHaveLength(0);
  expect(app.consoleErrors).toEqual([]);
});

test("Pattern: a made pattern keeps its settings, comes back after a reload, is changed where it is; a frozen setting survives Randomize", async ({ app }) => {
  const p = app.page;
  await p.click("[data-pattern-panel]");
  await choose(app, "stripes");
  await setNumber(app, "count", "6");
  await make(app);
  await p.locator("[data-pg-done]").click();
  const first = await objs(app);
  const sheet = sheets(first)[0]!;
  const gid = on(first, sheet.id)[0]!.groups![0]!;
  expect(on(first, sheet.id).filter((o) => (o as Obj & { gen?: unknown }).gen)).toHaveLength(1); // the settings are kept on the group's first shape
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.click("[data-pattern-panel]");
  await app.frame();
  const box = await p.evaluate((id) => window.__canvastDebug.objectScreen(id)!.box, sheet.id);
  await p.mouse.click((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2); // a click on the pattern picks the group whole
  await app.frame();
  await expect(p.locator("[data-pg-target]")).toContainText("changes replace it");
  await expect(p.locator('[data-k="count"] input[type=number]')).toHaveValue("6"); // the settings came back with the shapes
  await setNumber(app, "count", "4"); // changed where it is: same sheet, same group, fewer stripes
  await expect.poll(async () => subCount(await objs(app), sheet.id)).toBeLessThan(subCount(first, sheet.id));
  const after = await objs(app);
  expect(sheets(after)).toHaveLength(1);
  expect(on(after, sheet.id).every((o) => o.groups?.[0] === gid)).toBe(true);

  await p.locator('[data-k="count"] [data-lock]').click();
  await p.locator("[data-pg-random]").click();
  await expect(p.locator('[data-k="count"] input[type=number]')).toHaveValue("4"); // frozen
  expect(app.consoleErrors).toEqual([]);
});

test("Saved to the library, each kind has its own folder and tags: a pattern, a plain export and shapes saved as SVG; all can be changed in Settings", async ({ app }) => {
  const p = app.page;
  const filed = () => p.evaluate(async () => {
    const l = await window.__canvastDebug.assetListing();
    return l.entries.map((e) => ({ name: e.name, tags: [...(e.tags ?? [])], folder: l.folders.find((f) => f.id === e.folderIds?.[0])?.name ?? "" }));
  });
  const saveToLibrary = async () => {
    await exportWith(p, "exportpic");
    await p.getByTestId("export-dialog").locator('[data-ex="library"]').click();
    await expect(p.getByTestId("export-dialog")).toContainText("in the library");
    await p.getByTestId("export-dialog").locator('[data-ex="close"]').click();
  };
  // a pattern: its own folder and tag
  await p.click("[data-pattern-panel]");
  await choose(app, "dots");
  await make(app); // the new sheet is picked: Export… works on it
  await saveToLibrary();
  await expect.poll(async () => (await filed())[0]).toMatchObject({ tags: ["pattern"], folder: "Patterns" }); // (the folder and tags are written just after the entry: wait for them)
  // a plain shape exported as a picture: the folder and tag of exports
  await p.keyboard.press("u");
  await app.drag({ x: 100, y: 450 }, { x: 220, y: 550 }, 6); // (beside the new sheet, so the shape is not on it)
  await p.keyboard.press("v");
  await p.mouse.click(160, 500);
  await saveToLibrary();
  await expect.poll(async () => (await filed()).find((f) => f.folder === "Exports")?.tags).toEqual(["export"]);
  // the same shape saved as SVG: the folder and tag of shapes
  await exportWith(p, "svglibrary");
  await expect.poll(async () => (await filed()).find((f) => f.name.endsWith(".svg"))).toMatchObject({ folder: "Shapes", tags: ["shape"] });
  // each is a setting of its own
  await p.getByTestId("view-settings").click();
  await p.locator("#settings-view").getByRole("tab", { name: "Media and playback" }).click();
  const panel = p.locator("#set-panel-media");
  for (const [label, v] of [["Patterns: library folder", "Mine"], ["Patterns: tags", "a, b"], ["Exports: library folder", "Out"], ["Shapes: tags", "vec"]] as const) await panel.getByLabel(label, { exact: true }).fill(v);
  await p.getByTestId("view-canvas").click();
  await p.keyboard.press("Control+a"); // the shape and the pattern: it holds a pattern, so it is filed as one
  await exportWith(p, "svglibrary");
  await expect.poll(async () => (await filed()).find((f) => f.folder === "Mine")?.tags).toEqual(["a", "b"]);
  expect(app.consoleErrors).toEqual([]);
});

test("a pattern that runs past its sheet exports as the sheet's frame: the picture, the SVG and the PDF are cut to it, whether the sheet or only the pattern is picked", async ({ app }) => {
  const p = app.page;
  await p.click("[data-pattern-panel]");
  await choose(app, "spiral"); // its lines run far past the sheet
  await make(app);
  const sheet = sheets(await objs(app))[0]!;
  await p.locator("[data-pg-done]").click();
  const dlg = p.getByTestId("export-dialog");
  const exportAs = async (format: "png" | "svg" | "pdf"): Promise<Buffer> => {
    await exportWith(p, "exportpic");
    await dlg.locator(`[data-format="${format}"]`).click();
    const [download] = await Promise.all([p.waitForEvent("download"), dlg.locator('[data-ex="download"]').click()]);
    const bytes = (await import("node:fs")).readFileSync((await download.path())!);
    await dlg.locator('[data-ex="close"]').click();
    return bytes;
  };
  const ratioOfPng = (b: Buffer) => b.readUInt32BE(16) / b.readUInt32BE(20);
  const ratioOfSvg = (t: string) => { const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(t)!; return Number(m[1]) / Number(m[2]); };
  const frame = await p.evaluate((id) => window.__canvastDebug.objectScreen(id)!.box, sheet.id);
  const frameRatio = (frame.maxX - frame.minX) / (frame.maxY - frame.minY);

  // the sheet picked: the frame is the sheet
  for (const picked of ["sheet", "pattern"] as const) {
    if (picked === "pattern") { await p.mouse.click((frame.minX + frame.maxX) / 2, (frame.minY + frame.maxY) / 2); await app.frame(); expect((await p.evaluate(() => window.__canvastDebug.selection())).length).toBeGreaterThan(1); }
    else expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([sheet.id]);
    const png = await exportAs("png");
    expect(ratioOfPng(png), `${picked}: the picture is the frame`).toBeCloseTo(frameRatio, 1);
    const svg = (await exportAs("svg")).toString("utf8");
    expect(ratioOfSvg(svg), `${picked}: the SVG is the frame`).toBeCloseTo(frameRatio, 1);
    expect(svg, `${picked}: and what runs past it is cut`).toMatch(/<g clip-path="url\(#c\d+\)">/);
    expect(svg).toMatch(/<clipPath id="c\d+">/);
    const pdf = (await exportAs("pdf")).toString("latin1");
    expect(pdf.startsWith("%PDF"), picked).toBe(true);
  }
  expect(app.consoleErrors).toEqual([]);
});

test("Pattern styles: Save as a style keeps the generator, settings and seed in the Styles panel, and pressing the card puts them back in the Pattern panel", async ({ app }) => {
  const p = app.page;
  await p.click("[data-pattern-panel]");
  await choose(app, "stripes");
  await setNumber(app, "jitter", "40");
  await p.locator("[data-pg-seed]").fill("77");
  await p.locator("[data-pg-seed]").dispatchEvent("change");
  await make(app);
  await p.locator("[data-pg-style]").click();
  await choose(app, "tides"); // something else in the panel now
  await expect(p.locator("[data-pg-name]")).toHaveText("Tides");
  await p.click("[data-styles]");
  await p.locator('[data-tab="pattern"]').click();
  const card = p.getByTestId("styles-panel").locator(".style-card");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".style-pattern svg")).toBeVisible();
  await expect(card).toContainText("Stripes · seed 77");
  await card.click();
  await expect(p.locator("[data-pg-name]")).toHaveText("Stripes");
  await expect(p.locator("[data-pg-seed]")).toHaveValue("77");
  await expect(p.locator('[data-k="jitter"] input[type=number]')).toHaveValue("40");
  expect(app.consoleErrors).toEqual([]);
});

test("Pattern styles: update a style from the Pattern panel, and pressing one with several shapes picked makes it on each of them", async ({ app }) => {
  const p = app.page;
  await p.click("[data-pattern-panel]");
  await choose(app, "stripes");
  await p.locator("[data-pg-seed]").fill("11");
  await p.locator("[data-pg-seed]").dispatchEvent("change");
  await p.locator("[data-pg-style]").click();
  await p.click("[data-styles]");
  await p.locator('[data-tab="pattern"]').click();
  const panel = p.getByTestId("styles-panel");
  await expect(panel.locator(".style-card")).toContainText("Stripes · seed 11");
  // the panel changes, and the style is brought up to date from it
  await p.locator("[data-pg-seed]").fill("12");
  await p.locator("[data-pg-seed]").dispatchEvent("change");
  await panel.locator("[data-more]").click();
  await p.getByRole("menuitem", { name: /with the generator, settings and seed in the Pattern panel/ }).click();
  await expect(panel.locator(".style-card")).toContainText("Stripes · seed 12");
  // two shapes picked: the pattern is made on both (each cuts its own pattern)
  await p.keyboard.press("u");
  await app.drag({ x: 480, y: 300 }, { x: 600, y: 380 }, 6);
  await app.drag({ x: 700, y: 300 }, { x: 820, y: 380 }, 6);
  await p.keyboard.press("v");
  await p.mouse.click(540, 340);
  await p.keyboard.down("Shift");
  await p.mouse.click(760, 340);
  await p.keyboard.up("Shift");
  await panel.locator(".style-card").click();
  await expect.poll(async () => (await objs(app)).filter((o) => o.container?.mask).length).toBe(2);
  expect(app.consoleErrors).toEqual([]);
});

test("Pattern: with several shapes picked, Generate makes one pattern on each of them, and the pick stays", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("u");
  await app.drag({ x: 480, y: 300 }, { x: 600, y: 380 }, 6);
  await app.drag({ x: 700, y: 300 }, { x: 820, y: 380 }, 6);
  await p.keyboard.press("v");
  await p.mouse.click(540, 340);
  await p.keyboard.down("Shift");
  await p.mouse.click(760, 340);
  await p.keyboard.up("Shift");
  await p.click("[data-pattern-panel]");
  await choose(app, "tides");
  await expect(p.locator("[data-pg-target]")).toContainText("2 selected shapes");
  await make(app);
  await expect.poll(async () => (await objs(app)).filter((o) => o.container?.mask).length).toBe(2);
  expect(await p.evaluate(() => window.__canvastDebug.selection().length), "both shapes are still picked").toBe(2);
  expect(app.consoleErrors).toEqual([]);
});

test("Names above picked items never overlap: a pattern's sheet and its pieces, all picked, write one name where they start together", async ({ app }) => {
  const p = app.page;
  await p.click("[data-pattern-panel]");
  await choose(app, "tides");
  await make(app);
  await p.keyboard.press("v");
  await p.keyboard.press("Control+a");
  await app.frame();
  const labels = await p.evaluate(() => window.__canvastDebug.itemLabels());
  expect(labels.length).toBeGreaterThan(0);
  for (const a of labels) for (const b of labels) if (a !== b) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.text} and ${b.text} overlap`).toBe(false);
});

test("Randomize buttons carry the dice icon (the Pattern panel's, and the random view's)", async ({ app }) => {
  const p = app.page;
  await p.click("[data-pattern-panel]");
  const dice = await p.locator('[data-action="random-view"] svg').innerHTML();
  expect(dice).toContain("rect"); // (the lucide "dice-5")
  expect(await p.locator("[data-pg-random] svg").innerHTML(), "Randomize is the same icon as the random view").toBe(dice);
});

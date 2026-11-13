// README pictures of "Reference boards": each test is one picture of one feature, in the way an artist uses it (manifest.ts).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { alignWith, arrangeWith, chooseInMenu, setPenColour } from "../e2e/harness";
import { test, expect, artFiles, type Scene } from "./scene";

/** A freehand line through these screen points (the Pen must be on). */
async function line(s: Scene, pts: Array<[number, number]>): Promise<void> {
  await s.p.mouse.move(pts[0]![0], pts[0]![1]);
  await s.p.mouse.down();
  for (const [x, y] of pts.slice(1)) await s.p.mouse.move(x, y, { steps: 2 });
  await s.p.mouse.up();
}
/** An ellipse as a freehand line (a construction oval). */
const oval = (cx: number, cy: number, rx: number, ry: number, turn = 0): Array<[number, number]> =>
  Array.from({ length: 41 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    return [cx + x * Math.cos(turn) - y * Math.sin(turn), cy + x * Math.sin(turn) + y * Math.cos(turn)] as [number, number];
  });

test("board", async ({ scene: s }) => {
  await s.fonts();
  const art = await s.art("delacroix", "bonheur", "degheyn");
  await s.canvas("Horses");
  const ids = await s.placeRow(art);
  await s.fit(ids, 0.62, [0.5, 0.52]);
  const boxes = await Promise.all(ids.map((id) => s.box([id])));
  const all = (await s.box(ids))!;
  const title = await s.text(all.minX, all.minY - 70, "Horses: three masters", { size: 40, font: "cormorant garamond semibold", colour: "#efe6d2" });
  const notes = ["Delacroix: one horse, mass in wash", "Bonheur: a herd in motion", "de Gheyn: saddle and rider, two views"];
  const made = [title];
  for (const [i, b] of boxes.entries()) made.push(await s.text(b!.minX, b!.maxY + 18, notes[i]!, { size: 22, font: "caveat", colour: "#e8c27a" }));
  await s.shot("board", await s.around({ objects: [...ids, ...made], pad: 40 }));
});

test("auto-layout", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 210 });
  const art = await s.art("delacroix", "bonheur", "degheyn", "degas-dancer_with", "degas-dancer_onstage", "degas-dancer_adjusting");
  await s.canvas("Studies");
  const ids = await s.place(art);
  await s.fit(ids, 0.6);
  await s.select(ids);
  await s.p.keyboard.press("Shift+A");
  await expect.poll(async () => (await s.objects()).some((o) => o.container)).toBe(true);
  const sheet = (await s.objects()).find((o) => o.container)!.id;
  await s.select([sheet]);
  await (await s.control('[data-layout-flow="grid"]')).click();
  for (const [sel, v] of [["[data-layout-columns]", "3"], ['[data-layout-gap="0"]', "40"], ['[data-layout-gap="1"]', "40"], ['[data-layout-pad="h"]', "48"], ['[data-layout-pad="v"]', "48"]] as const) {
    const field = await s.control(sel);
    await field.fill(v);
    await field.press("Enter");
  }
  // (smaller and lower: the Layout chip's options open above its chips, the Actions bar below the sheet)
  await s.fit([sheet], 0.52, [0.5, 0.6]);
  await s.select([sheet]);
  await s.settle();
  await s.control('[data-layout-flow="grid"]'); // (the Layout chip's options open)
  await s.shot("auto-layout", await s.around({ objects: [sheet], els: ['[data-layout-flow="grid"]', ...(await s.chipEls())], pad: 30 }));
});

/** Pictures of every shape on a new sheet with auto layout, picked; its flow and lengths set in the bar (a field and its value). */
async function laidOut(s: Scene, art: string[], flow: string, fields: ReadonlyArray<readonly [string, string]>): Promise<string> {
  const ids = await s.place(art);
  await s.fit(ids, 0.6);
  await s.select(ids);
  await s.p.keyboard.press("Shift+A");
  await expect.poll(async () => (await s.objects()).some((o) => o.container)).toBe(true);
  const sheet = (await s.objects()).find((o) => o.container)!.id;
  await s.select([sheet]);
  await (await s.control(`[data-layout-flow="${flow}"]`)).click();
  for (const [sel, v] of fields) {
    const field = await s.control(sel);
    await field.fill(v);
    await field.press("Enter");
  }
  return sheet;
}

test("layout-masonry", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 30 });
  await s.canvas("References");
  const art = await s.art(...artFiles("hokusai", "degas", "delany", "anonymous", "vangogh"));
  const sheet = await laidOut(s, art, "masonry", [["[data-layout-columns]", "4"], ['[data-layout-gap="0"]', "18"], ['[data-layout-gap="1"]', "18"], ['[data-layout-pad="h"]', "24"], ['[data-layout-pad="v"]', "24"]]);
  await s.fit([sheet], 0.62, [0.5, 0.47]);
  await s.select([sheet]);
  await s.settle();
  await s.shot("layout-masonry", await s.around({ objects: [sheet], pad: 24 }));
});

test("layout-justified", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 200 });
  await s.canvas("Landscapes");
  const art = await s.art(...artFiles("waterloo", "verhaecht", "leprince", "vangogh", "hokusai-under", "hokusai-seaside", "degas-dancer_onstage", "bonheur"));
  const sheet = await laidOut(s, art, "justified", [['[data-layout-gap="0"]', "14"], ['[data-layout-gap="1"]', "14"], ['[data-layout-pad="h"]', "20"], ['[data-layout-pad="v"]', "20"]]);
  // (rows about a quarter of the sheet's width tall, and the sheet as tall as its rows)
  const w = (await s.box([sheet]))!;
  await (await s.control("[data-layout-rowh]")).fill(String(Math.round((w.maxX - w.minX) / 4.5)));
  await (await s.control("[data-layout-rowh]")).press("Enter");
  const size = await s.control("[data-layout-size]");
  if ((await size.inputValue()) !== "w") await size.selectOption("w");
  await expect(size).toHaveValue("w");
  await s.fit([sheet], 0.66, [0.5, 0.47]);
  await s.select([sheet]);
  await s.settle();
  await s.shot("layout-justified", await s.around({ objects: [sheet], pad: 24 }));
});

test("layout-tracks", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 270 });
  await s.canvas("Page 1");
  const art = await s.art("bonheur", "degas-dancer_with", "degas-dancer_onstage", "delacroix", "degheyn");
  const sheet = await laidOut(s, art, "grid", [["[data-layout-columns]", "3"], ['[data-layout-gap="0"]', "20"], ['[data-layout-gap="1"]', "20"], ['[data-layout-pad="h"]', "32"], ['[data-layout-pad="v"]', "32"]]);
  // (the front picture, Bonheur's wide horse fair, spans all three columns: a wide establishing panel)
  const first = (await s.objects()).filter((o) => o.kind === "image").map((o) => o.id).at(-1)!;
  await s.select([first]);
  await (await s.control('[data-in-span="0"]')).fill("3");
  await (await s.control('[data-in-span="0"]')).press("Enter");
  // (made larger in its own shape: the columns it spans widen round it)
  const w0 = Number(await (await s.control("[data-on-w]")).inputValue()), h0 = Number(await (await s.control("[data-on-h]")).inputValue());
  await (await s.control("[data-on-w]")).fill(String(Math.round(w0 * 260) / 100));
  await (await s.control("[data-on-h]")).fill(String(Math.round(h0 * 260) / 100));
  await (await s.control("[data-on-h]")).press("Enter");
  await s.fit([sheet], 0.5, [0.62, 0.55]);
  await s.select([sheet]);
  await (await s.control("[data-layout-tracks]")).click();
  await s.p.locator('button[data-track="c:1:fr"]').click();
  await expect(s.p.getByRole("dialog", { name: "Columns and rows" })).toBeVisible();
  await s.settle();
  await s.shot("layout-tracks", await s.around({ objects: [sheet], els: ['[role="dialog"][aria-label="Columns and rows"]'], pad: 24 }));
});

test("import-menu", async ({ scene: s }) => {
  await s.art("hokusai-under", "hokusai-seaside", "waterloo", "verhaecht");
  await s.p.getByTestId("view-assets").click();
  await s.p.locator('[data-action="import-menu"]').click();
  await expect(s.p.locator(".pop-menu")).toBeVisible();
  await s.shot("import-menu", await s.around({ els: [".pop-menu", '[data-testid="assets-import"]'], pad: 60 }));
});

test("crop", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 25 });
  const [h] = await s.art("bonheur");
  await s.canvas("Crop");
  const [id] = await s.place([h!]);
  await s.fit([id!], 0.6);
  await s.select([id!]);
  await (await s.control("[data-crop]")).click();
  const b = (await s.box([id!]))!;
  await s.app.drag({ x: b.maxX - 2, y: (b.minY + b.maxY) / 2 }, { x: b.minX + (b.maxX - b.minX) * 0.55, y: (b.minY + b.maxY) / 2 }, 6);
  await s.settle();
  await s.shot("crop", await s.around({ objects: [id!], pad: 70 }));
});

test("flip", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 300 });
  await s.fonts();
  const [h] = await s.art("degheyn");
  await s.canvas("Flip");
  const ids = await s.placeRow([h!, h!]);
  await s.fit(ids, 0.6);
  await s.select([ids[1]!]);
  await (await s.control('[data-flip="x"]')).click();
  await expect(await s.control('[data-flip="x"]')).toHaveAttribute("aria-pressed", "true");
  await s.select([]);
  const [a, b] = [(await s.box([ids[0]!]))!, (await s.box([ids[1]!]))!];
  // (the labels under the pictures: the chips by the selection stand above it)
  const t1 = await s.text(a.minX, a.maxY + 16, "original", { size: 26, font: "caveat", colour: "#e8c27a" });
  const t2 = await s.text(b.minX, b.maxY + 16, "flipped: proportions with fresh eyes", { size: 26, font: "caveat", colour: "#e8c27a" });
  await s.select([ids[1]!]);
  await s.settle();
  await s.control('[data-flip="x"]'); // (its chip's options open, framed with what they edit)
  await s.shot("flip", await s.around({ objects: [...ids, t1, t2], els: ['[data-flip="x"]', ...(await s.chipEls())], pad: 36 }));
});

test("corners", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 330, pattern: "dots" });
  const [h] = await s.art("hokusai-mystical");
  await s.canvas("Card");
  const [id] = await s.place([h!]);
  await s.fit([id!], 0.55);
  await s.select([id!]);
  const r = await s.control("[data-sel-radius-wrap] input");
  await r.fill("44");
  await r.press("Enter");
  await (await s.control('[data-paint="stroke"]')).click();
  await s.p.locator('.colour-pop [data-mode="solid"]').click();
  await s.hex("#5b4636");
  await s.settle();
  await s.control("[data-sel-radius-wrap]"); // (its chip's options open, framed with what they edit)
  await s.shot("corners", await s.around({ objects: [id!], els: ["[data-sel-radius-wrap]", ...(await s.chipEls())], pad: 36 }));
});

test("adjust-values", async ({ scene: s }) => {
  await s.fonts();
  const [h] = await s.art("vangogh");
  await s.canvas("Value study");
  const ids = await s.placeRow([h!, h!]);
  await s.fit(ids, 0.55, [0.42, 0.5]);
  await s.select([ids[1]!]);
  await s.p.getByRole("button", { name: "Adjust panel", exact: true }).click();
  for (const [k, v] of [["saturation", "-100"], ["contrast", "45"]] as const) {
    const n = s.p.locator(`[data-adj-num="${k}"]`).first();
    await n.fill(v);
    await n.press("Enter");
  }
  await s.blur();
  const [a, b] = [(await s.box([ids[0]!]))!, (await s.box([ids[1]!]))!];
  await s.select([]);
  const t1 = await s.text(a.minX, a.maxY + 16, "colour", { size: 26, font: "caveat", colour: "#e8c27a" });
  const t2 = await s.text(b.minX, b.maxY + 16, "values: light and dark masses", { size: 26, font: "caveat", colour: "#e8c27a" });
  await s.select([ids[1]!]);
  await s.settle();
  await s.shot("adjust-values", await s.around({ objects: [...ids, t1, t2], els: ['[data-testid="adjust-panel"]'], pad: 24 }));
});

test("adjust-shadow", async ({ scene: s }) => {
  const art = await s.art("hokusai-basket", "hokusai-still", "hokusai-rooster");
  await s.canvas("Prints");
  await s.look({ theme: "light", hue: 40, pattern: "none" });
  const ids = await s.placeRow(art);
  await s.fit(ids, 0.6, [0.42, 0.5]);
  await s.select(ids);
  await s.p.getByRole("button", { name: "Adjust panel", exact: true }).click();
  for (const [k, v] of [["dropOpacity", "55"], ["dropBlur", "24"], ["dropY", "12"]] as const) {
    const n = s.p.locator(`[data-adj-num="${k}"]`).first();
    await n.scrollIntoViewIfNeeded();
    await n.fill(v);
    await n.press("Enter");
  }
  await s.blur();
  await s.settle();
  await s.shot("adjust-shadow", await s.around({ objects: ids, els: ['[data-testid="adjust-panel"]'], pad: 30 }));
});

test("sheets", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 95 });
  await s.fonts();
  const [h] = await s.art("delany");
  await s.canvas("Print");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.45, [0.5, 0.45]);
  const b = (await s.box([pic!]))!;
  const label = await s.text(b.minX, b.maxY + 30, "Mary Delany, Botanical Study, ca. 1772–82", { size: 22, font: "cormorant garamond semibold italic", colour: "#3b3428" });
  // (a print and its label put on a sheet: the sheet holds them and cuts what goes past its edges)
  await s.select([pic!, label]);
  await chooseInMenu(s.p, "sheetmenu", "puton");
  await expect.poll(async () => (await s.objects()).some((o) => o.container)).toBe(true);
  const sheet = (await s.objects()).find((o) => o.container)!.id;
  await s.paint(sheet, "fill", "#f6f1e6");
  // (auto layout sizes the sheet a moment later: framed once it has)
  await s.settle(800);
  await s.fit([sheet], 0.62);
  await s.settle(400);
  await s.fit([sheet], 0.62);
  await s.select([sheet]);
  await s.settle();
  await s.control("[data-sheet-ratio]"); // (the Size chip's options open: its Ratio)
  await s.shot("sheets", await s.around({ objects: [sheet], els: ["[data-sheet-ratio]", ...(await s.chipEls())], pad: 30 }));
});

test("arrange", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 260 });
  const art = await s.art("degas");
  await s.canvas("Dancers");
  const ids = await s.place(art);
  // (a loose pile: each a little off the last)
  for (const [i, id] of ids.entries()) {
    const b = (await s.box([id]))!;
    await s.select([id]);
    await s.app.drag({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, { x: (b.minX + b.maxX) / 2 + (i - 1.5) * 150, y: (b.minY + b.maxY) / 2 + (i % 2 ? 60 : -50) }, 4);
  }
  await s.fit(ids, 0.6, [0.42, 0.5]);
  await s.select(ids);
  await arrangeWith(s.p, "grid:name-asc", true);
  await s.settle();
  await s.shot("arrange", await s.around({ objects: ids, els: [".pop-menu"], pad: 30 }));
});

test("align", async ({ scene: s }) => {
  const art = await s.art("degas-dancer_with", "degas-dancer_onstage", "degas-dancer_adjusting");
  await s.canvas("Line up");
  const ids = await s.placeRow(art);
  await s.fit(ids, 0.6, [0.42, 0.5]);
  for (const [i, id] of ids.entries()) {
    const b = (await s.box([id]))!;
    await s.select([id]);
    await s.app.drag({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 + [-60, 40, -10][i]! }, 4);
  }
  await s.fit(ids, 0.6, [0.42, 0.5]);
  await s.select(ids);
  await alignWith(s.p, "align:bottom", true);
  await s.settle();
  await s.shot("align", await s.around({ objects: ids, els: [".pop-menu"], pad: 30 }));
});

test("layers", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 20 });
  const [h] = await s.art("delacroix");
  await s.canvas("Master study");
  const [ref] = await s.place([h!]);
  await s.fit([ref!], 0.62, [0.4, 0.5]);
  const b = (await s.box([ref!]))!;
  const W = b.maxX - b.minX, Hh = b.maxY - b.minY;
  const at = (x: number, y: number): [number, number] => [b.minX + W * x, b.minY + Hh * y];
  await s.tool("pen");
  await setPenColour(s.p, "#e05a47");
  const before = new Set(await s.ids());
  // construction: the chest, the barrel and the hindquarters as ovals, the head as a wedge
  for (const [x, y, rx, ry] of [[0.36, 0.42, 0.09, 0.15], [0.52, 0.44, 0.14, 0.13], [0.68, 0.43, 0.1, 0.14]] as const) await line(s, oval(...at(x, y), W * rx, Hh * ry));
  await line(s, [at(0.3, 0.12), at(0.24, 0.3), at(0.33, 0.27), at(0.3, 0.12)]);
  const construction = (await s.ids()).filter((i) => !before.has(i));
  await setPenColour(s.p, "#2fb7a8");
  const before2 = new Set(await s.ids());
  await line(s, [at(0.27, 0.14), at(0.36, 0.34), at(0.5, 0.46), at(0.66, 0.4), at(0.74, 0.62), at(0.72, 0.9)]); // (the line of action)
  const action = (await s.ids()).filter((i) => !before2.has(i));
  await s.tool("select");
  await s.select(construction);
  await s.command("Group");
  await s.select(action);
  await s.command("Group");
  await s.select([ref!]);
  await s.p.locator('[data-ctx="lock"]').click();
  await s.select([]);
  await s.p.getByRole("button", { name: "Layers panel", exact: true }).click();
  await expect(s.p.getByTestId("layers-panel")).toBeVisible();
  await s.settle();
  await s.shot("layers", await s.around({ objects: [ref!], els: ['[data-testid="layers-panel"]'], pad: 24 }));
});

test("reveal", async ({ scene: s }) => {
  const art = await s.art("hokusai");
  await s.canvas("Pile");
  const ids = await s.place(art);
  for (const [i, id] of ids.entries()) {
    const b = (await s.box([id]))!;
    await s.select([id]);
    await s.app.drag({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, { x: (b.minX + b.maxX) / 2 + (i - 2.5) * 60, y: (b.minY + b.maxY) / 2 + (i % 2 ? 30 : -30) }, 4);
  }
  await s.fit(ids, 0.62);
  await s.select([]);
  await s.p.mouse.move(720, 450);
  await s.p.keyboard.down("Control");
  await s.p.mouse.move(722, 451);
  await expect.poll(() => s.p.evaluate(() => window.__canvastDebug.revealList()?.total ?? 0)).toBeGreaterThan(2);
  await s.p.mouse.move(762, 450 + 4 + 16 * 2 + 8);
  await s.settle();
  await s.shot("reveal", await s.around({ objects: ids, pad: 20 }));
  await s.p.keyboard.up("Control");
});

test("canvas-tags", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 140 });
  const art = await s.art("degas-dancer_with", "degas-dancer_onstage", "delacroix", "bonheur");
  await s.canvas("Studies");
  const ids = await s.placeRow(art);
  await s.fit(ids, 0.6, [0.62, 0.5]);
  await s.p.getByRole("button", { name: "Tags panel", exact: true }).click();
  for (const [sel, tags] of [[ids.slice(0, 2), "gesture, figure"], [ids.slice(2), "anatomy, horse"]] as const) {
    await s.select([...sel]);
    await s.p.getByLabel("Add a tag to the selection").fill(tags);
    await s.p.keyboard.press("Enter");
    await s.settle();
  }
  await s.select(ids.slice(0, 2));
  await s.settle();
  await s.shot("canvas-tags", await s.around({ objects: ids, els: ['[data-testid="tags-panel"]'], pad: 24 }));
});

test("media", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 50 });
  // (a camera move planned for an animatic: a slow pan across the painting, made here with ffmpeg)
  const dir = mkdtempSync(join(tmpdir(), "cv-clip-"));
  const clip = join(dir, "wheat_field_camera_pan.webm");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", resolve("scripts/showcase/art", artFiles("vangogh")[0]!), "-vf", "scale=1600:-2,zoompan=z='1.15':x='iw/2-(iw/zoom/2)+on*1.2':y='ih/2-(ih/zoom/2)':d=150:s=960x720:fps=30", "-c:v", "libvpx-vp9", "-b:v", "600k", "-t", "5", clip]);
  const h = await s.library([clip]);
  await s.canvas("Animatic");
  const [id] = await s.place([h["wheat_field_camera_pan.webm"]!]);
  await s.fit([id!], 0.5);
  const b = (await s.box([id!]))!;
  await s.tool("select");
  await s.p.mouse.click((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  const play = s.p.getByRole("button", { name: /^Play/ }).first();
  if (await play.isVisible()) await play.click();
  await s.p.waitForTimeout(1500);
  await s.p.mouse.move((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2 + 20);
  await s.shot("media", await s.around({ objects: [id!], pad: 90 }));
});

test("extract-frame", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 50 });
  const dir = mkdtempSync(join(tmpdir(), "cv-clip-"));
  const clip = join(dir, "wheat_field_camera_pan.webm");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", resolve("scripts/showcase/art", artFiles("vangogh")[0]!), "-vf", "scale=1600:-2,zoompan=z='1.15':x='iw/2-(iw/zoom/2)+on*1.2':y='ih/2-(ih/zoom/2)':d=150:s=960x720:fps=30", "-c:v", "libvpx-vp9", "-b:v", "600k", "-t", "5", clip]);
  const h = await s.library([clip]);
  await s.canvas("Animatic");
  const [id] = await s.place([h["wheat_field_camera_pan.webm"]!]);
  await s.fit([id!], 0.42, [0.36, 0.5]);
  const b = (await s.box([id!]))!;
  await s.tool("select");
  await s.p.mouse.click((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  // (a key frame of the move, kept as a still picture beside the clip)
  const before = new Set(await s.ids());
  await s.p.locator('[data-cmd="extract"]').filter({ visible: true }).first().click();
  await expect.poll(async () => (await s.ids()).some((i) => !before.has(i))).toBe(true);
  const still = (await s.ids()).find((i) => !before.has(i))!;
  await s.fit([id!, still], 0.7);
  await s.select([still]);
  await s.p.mouse.move((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  await s.settle(600);
  await s.shot("extract-frame", await s.around({ objects: [id!, still], pad: 70 }));
});

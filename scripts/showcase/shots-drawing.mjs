// The README's pictures of drawing and vector editing, comics and exporting: a botanical study drawn with the Pen beside its public-domain
// references, shapes combined and edited, a clipping mask, a pattern and a guide on sheets, colour and styles, a comic page of panels
// with speech balloons and captions, the text bar, and the Export dialog. Everything drawn here is drawn by this script.
// Run from the repo root after `npm run build`: node scripts/showcase/shots-drawing.mjs <unused> <outDir>
import { artOf, artPath, open } from "./lib.mjs";

const [, out] = process.argv.slice(2);
const s = await open(out);
const { p, H, settle, shot, step, off, blur, drag, stroke, menu, panel, newCanvas, importFiles, place, select, boxOf, fit } = s;
const files = [...artOf("delany", "anonymous-botanical", "waterloo", "verhaecht", "leprince", "hokusai-seaside", "hokusai-under")];
const hashes = await importFiles(files.map(artPath));
const h = (f) => hashes[f];
await p.getByTestId("view-canvas").click();
await settle();
const objs = () => H(() => window.__canvastDebug.objects());
const v = await H(() => window.__canvastDebug.viewport());
const cx = v.width / 2, cy = v.height / 2;

/** A leaf: an outline with its midrib and veins, as points of one stroke each. */
const leaf = (x, y, k) => {
  const outline = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; outline.push([x + Math.sin(t * Math.PI) * 60 * k, y - t * 220 * k]); }
  for (let i = 24; i >= 0; i--) { const t = i / 24; outline.push([x - Math.sin(t * Math.PI) * 55 * k, y - t * 220 * k]); }
  const rib = [[x, y + 40 * k], [x + 4 * k, y - 110 * k], [x, y - 215 * k]];
  const veins = [0.25, 0.45, 0.65].flatMap((t) => [[[x + 2, y - t * 220 * k], [x + 45 * k, y - (t + 0.12) * 220 * k]], [[x - 2, y - t * 220 * k], [x - 42 * k, y - (t + 0.12) * 220 * k]]]);
  return [outline, rib, ...veins];
};

// 1. Pen: a botanical study drawn beside its references, the Pen's bar showing
await step("pen", async () => {
  await newCanvas("Botanical study");
  const [a, b] = await place(artOf("delany", "anonymous-botanical").map(h));
  await select([a, b]);
  await menu("arrangemenu", "grid:name-asc");
  await fit();
  await p.keyboard.press("-");
  await settle(400);
  await p.keyboard.press("p");
  await p.locator('[data-pen-kind="ink"]').click().catch(() => undefined);
  for (const line of [...leaf(cx + 330, cy + 210, 1.1), ...leaf(cx + 480, cy + 240, 0.8)]) await stroke(line);
  await stroke([[cx + 330, cy + 250], [cx + 380, cy + 300], [cx + 470, cy + 310], [cx + 480, cy + 270]]); // (the stem)
  await off();
  await shot("pen");
  await p.keyboard.press("v");
});

// 2. Shapes combined: a flower of ellipses joined into one shape, the Shapes menu open with its operations
await step("shapes", async () => {
  await newCanvas("Shapes");
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="ellipse"]').click();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = cx + Math.cos(a) * 90, y = cy + Math.sin(a) * 90;
    await drag([x - 70, y - 40], [x + 70, y + 40], 4);
  }
  await p.locator('[data-shape-kind="star"]').click();
  await drag([cx - 60, cy - 60], [cx + 60, cy + 60], 4);
  await p.keyboard.press("v");
  await p.keyboard.press("Control+a");
  await menu("boolmenu", "op:union");
  await settle(500);
  await p.locator('[data-ctx="boolmenu"]').click();
  await settle(300);
  await off();
  await shot("shapes");
  await p.keyboard.press("Escape");
});

// 3. Edit nodes: the flower's outline in node editing, a few nodes picked
await step("nodes", async () => {
  await p.keyboard.press("Control+a");
  await menu("boolmenu", "flatten");
  await settle(400);
  await p.keyboard.press("n");
  await settle(400);
  const id = (await objs()).at(-1).id;
  const b = await boxOf(id);
  await drag([b.minX - 10, b.minY - 10], [cx, cy], 6); // (a box over a quarter of the nodes picks them)
  await off();
  await shot("nodes");
  await p.keyboard.press("v");
  await p.keyboard.press("Escape");
});

// 4. A clipping mask: a landscape cut to a circle, as a vignette for a page
await step("mask", async () => {
  await newCanvas("Vignette");
  const [pic] = await place([h(artOf("waterloo")[0])]);
  await fit();
  const b = await boxOf(pic);
  const r = Math.min(b.maxX - b.minX, b.maxY - b.minY) * 0.42;
  const mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="ellipse"]').click();
  await drag([mx - r, my - r], [mx + r, my + r], 4);
  await p.keyboard.press("v");
  await p.keyboard.press("Control+a");
  await menu("maskmenu", "clipmask");
  await settle(500);
  await p.locator('[data-ctx="maskmenu"]').click();
  await settle(300);
  await off();
  await shot("mask");
  await p.keyboard.press("Escape");
});

// 5. Pattern: a sheet with the Contours generator made on it, the Pattern panel open
await step("pattern", async () => {
  await newCanvas("Patterns");
  await p.keyboard.press("c");
  await drag([cx - 360, cy - 260], [cx + 360, cy + 260], 6);
  await settle(400);
  await panel("Pattern panel");
  await p.locator("[data-pg-pick]").click();
  await p.locator('.pg-tile[data-gen="contours"], .pg-tile[aria-label^="Contours"]').first().click();
  await p.getByTestId("pattern-make").click();
  await settle(1500);
  await off();
  await shot("pattern");
});

// 6. Guides: the Guides tab, a perspective guide on a second sheet
await step("guides", async () => {
  await p.keyboard.press("Escape");
  await p.keyboard.press("c");
  await drag([cx + 420, cy - 260], [cx + 1140, cy + 260], 6);
  await fit();
  await select([(await objs()).filter((o) => o.container).at(-1).id]);
  await settle(300);
  await p.locator('[data-pg-tabs] [role="tab"]', { hasText: "Guides" }).click();
  await settle(300);
  await p.locator("[data-pg-pick]").click();
  const tile = p.locator('.pg-tile[data-gen*="perspective"], .pg-tile[aria-label*="erspective"]').first();
  if (await tile.count()) await tile.click();
  else await p.locator(".pg-tile").first().click();
  await p.getByTestId("pattern-make").click();
  await settle(1500);
  await off();
  await shot("guides");
  await panel("Pattern panel", false);
});

// 7. The colour picker on a shape's fill
await step("colour-picker", async () => {
  await newCanvas("Colour");
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="rect"]').click();
  await drag([cx - 300, cy - 160], [cx - 40, cy + 160], 4);
  await p.keyboard.press("v");
  await settle(300);
  await p.getByRole("button", { name: /^Fill/ }).first().click();
  await settle(600);
  await shot("colour-picker");
  await p.keyboard.press("Escape");
});

// 8. Styles: a palette taken from a print (colours pasted as CSS over the panel), and gradients
await step("styles", async () => {
  await p.keyboard.press("Escape");
  await panel("Styles panel");
  const box = await p.locator(".styles-panel, [data-panel='styles']").first().boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const paste = (t) => H((t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, t);
  for (const c of ["#1d2b53", "#2c4f7c", "#5f8fb4", "#a9c6d9", "#e9e2cf", "#d8c39a", "#b07d4f", "#6b4b3a", "#2f2a26", "#c94f3d", "#e6a85c", "#f4efe6"]) { await paste(c); await settle(100); }
  for (const g of ["linear-gradient(180deg, #1d2b53, #5f8fb4, #e9e2cf)", "linear-gradient(90deg, #6b4b3a, #d8c39a)", "radial-gradient(circle, #f4efe6, #e6a85c, #c94f3d)"]) { await paste(g); await settle(100); }
  await blur();
  await off();
  await shot("styles");
  await panel("Styles panel", false);
});

// 9. A comic page: four panels (landscapes as backgrounds) laid out by auto layout on a page, speech balloons and a caption
let page = null;
await step("comic", async () => {
  await newCanvas("Comic page");
  const pics = await place(artOf("waterloo", "verhaecht", "leprince", "hokusai-seaside").map(h));
  await select(pics);
  await menu("sheetmenu", "eachsheet");
  await settle(600);
  const panels = (await objs()).filter((o) => o.container).map((o) => o.id);
  await select(panels);
  await p.keyboard.press("Shift+A");
  await settle(600);
  page = (await objs()).filter((o) => o.container).find((o) => !panels.includes(o.id))?.id ?? null;
  await select([page]);
  await p.locator('[data-layout-flow="grid"]').click();
  await p.locator("[data-layout-columns]").fill("2");
  await p.locator("[data-layout-columns]").press("Enter");
  for (const [sel, val] of [['[data-layout-gap="0"]', "16"], ['[data-layout-gap="1"]', "16"], ['[data-layout-pad="h"]', "24"], ['[data-layout-pad="v"]', "24"]]) {
    await p.locator(sel).fill(val);
    await p.locator(sel).press("Enter");
  }
  await p.keyboard.press("Escape");
  await fit();
  const boxes = await Promise.all(panels.map((id) => boxOf(id)));
  const say = async (b, at, words) => {
    await p.keyboard.press("k");
    const x = b.minX + (b.maxX - b.minX) * at[0], y = b.minY + (b.maxY - b.minY) * at[1];
    await drag([x, y], [x + (b.maxX - b.minX) * 0.42, y + (b.maxY - b.minY) * 0.3], 4);
    await p.mouse.dblclick(x + (b.maxX - b.minX) * 0.21, y + (b.maxY - b.minY) * 0.15);
    await settle(200);
    await p.keyboard.type(words);
    await p.keyboard.press("Escape");
    await settle(200);
  };
  await say(boxes[0], [0.06, 0.06], "The road ends at the forest.");
  await say(boxes[1], [0.5, 0.08], "Then we climb.");
  await say(boxes[3], [0.06, 0.06], "Look, the sea!");
  await p.keyboard.press("v");
  await p.keyboard.press("Escape");
  await off();
  await shot("comic");
});

// 10. Speech balloons: one picked, its handles and the Speech balloon panel
await step("balloons", async () => {
  const balloon = (await objs()).find((o) => o.shape === "balloon" || o.params?.balloon);
  await select([balloon.id]);
  await settle(300);
  await p.locator("[data-balloon-panel]").filter({ visible: true }).first().click();
  await settle(400);
  await off();
  await shot("balloons");
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
});

// 11. Text: a caption being written on the page, its formatting bar and its look in the bar above
await step("text", async () => {
  const b = await boxOf(page);
  await p.keyboard.press("t");
  await p.mouse.click(b.minX, b.maxY + 30);
  await p.keyboard.type("Chapter one: The way north");
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Control+b");
  await p.locator("[data-text-size]").fill("32");
  await p.locator("[data-text-size]").press("Enter");
  await p.keyboard.press("Control+a");
  await off();
  await shot("text");
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await p.keyboard.press("v");
});

// 12. Export: the page at A4 for print, the dialog with its size, padding and background
await step("export", async () => {
  await select([page]);
  await menu("exportmenu", "exportpic");
  await settle(1200);
  await shot("export");
  await p.keyboard.press("Escape");
});

// 13. Export, each on its own: the four panels as pages of their own
await step("export-each", async () => {
  const panels = (await objs()).filter((o) => o.container && o.id !== page).map((o) => o.id);
  await select(panels);
  await menu("exportmenu", "exportpic");
  await p.getByTestId("export-each").click();
  await p.locator("[data-mini]").nth(1).waitFor();
  await settle(1200);
  await shot("export-each");
  await p.keyboard.press("Escape");
});

await s.done();

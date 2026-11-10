// The README's pictures of reference boards: public-domain artworks (scripts/showcase/art) collected on a canvas, laid out on a sheet,
// cropped, adjusted, found under one another, and a short clip of one playing. A fresh profile; nothing of anyone's own.
// Run from the repo root after `npm run build` (ffmpeg makes the clip): node scripts/showcase/shots-boards.mjs <unused> <outDir>
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ART, artOf, artPath, open } from "./lib.mjs";

const [, out] = process.argv.slice(2);
const s = await open(out);
const { p, H, settle, shot, step, off, blur, drag, menu, panel, newCanvas, importFiles, place, select, boxOf, fit } = s;

const hashes = await importFiles(ART.map((a) => artPath(a.file)));
const h = (file) => hashes[file];
await p.getByTestId("view-canvas").click();
await settle();

// 1. A board for horse studies: the studies and the landscapes laid out on a sheet by auto layout as a grid, a title above them
let sheet = null;
const layoutGrid = async (cols, gap, pad) => {
  await p.locator('[data-layout-flow="grid"]').click();
  await p.locator("[data-layout-columns]").fill(String(cols));
  await p.locator("[data-layout-columns]").press("Enter");
  for (const [sel, v] of [['[data-layout-gap="0"]', gap], ['[data-layout-gap="1"]', gap], ['[data-layout-pad="h"]', pad], ['[data-layout-pad="v"]', pad]]) {
    await p.locator(sel).fill(String(v));
    await p.locator(sel).press("Enter");
  }
  await blur();
  await settle(600);
};
await step("board", async () => {
  await newCanvas("Horse studies");
  await place(artOf("delacroix", "bonheur", "degheyn", "waterloo", "verhaecht", "leprince").map(h));
  await fit();
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Shift+A");
  await settle(800);
  sheet = (await H(() => window.__canvastDebug.objects())).find((o) => o.container)?.id ?? null;
  await select([sheet]);
  await settle(300);
  await layoutGrid(3, 60, 60);
  await p.keyboard.press("Escape");
  await fit();
  // a title over the sheet
  const b = await boxOf(sheet);
  await p.keyboard.press("t");
  await p.mouse.click(b.minX, b.minY - 60);
  await p.keyboard.type("Horses: weight, gesture, light");
  await p.keyboard.press("Control+a");
  await p.locator("[data-text-size]").fill("32");
  await p.locator("[data-text-size]").press("Enter");
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await p.keyboard.press("v");
  await fit();
  await off();
  await shot("board");
});

// 2. Auto layout: the sheet picked, its layout in the Properties bar
await step("auto-layout", async () => {
  await select([sheet]);
  await settle(500);
  await p.locator("[data-auto-layout]").waitFor();
  await off();
  await shot("auto-layout");
  await p.keyboard.press("Escape");
});

// 3. Crop: a study on a canvas of its own, its window being moved
await step("crop", async () => {
  await newCanvas("Crop");
  const [one] = await place([h(artOf("delacroix")[0])]);
  await fit();
  await p.keyboard.press("-");
  await settle(400);
  await select([one]);
  await settle(300);
  await p.locator("[data-crop]").click();
  await settle(400);
  const b = await boxOf(one);
  await drag([b.maxX, (b.minY + b.maxY) / 2], [b.maxX - (b.maxX - b.minX) * 0.22, (b.minY + b.maxY) / 2]);
  await drag([(b.minX + b.maxX) / 2, b.minY], [(b.minX + b.maxX) / 2, b.minY + (b.maxY - b.minY) * 0.12]);
  await off();
  await shot("crop");
  await p.locator("[data-crop]").click();
  await p.keyboard.press("Escape");
});

// 4. Adjust: a landscape made warmer and brighter, the Adjust panel open beside it
await step("adjust", async () => {
  await newCanvas("Colour study");
  const [id] = await place([h(artOf("vangogh")[0])]);
  await fit();
  await select([id]);
  await settle(300);
  await panel("Adjust panel");
  for (const [k, v] of [["exposure", "10"], ["contrast", "18"], ["temperature", "22"], ["saturation", "25"], ["vibrance", "15"]]) {
    const n = p.locator(`[data-adj-num="${k}"]`).first();
    await n.fill(v);
    await n.press("Enter");
  }
  await blur();
  await off();
  await shot("adjust");
  await panel("Adjust panel", false);
  await p.keyboard.press("Escape");
});

// 5. Reveal: Hokusai's prints stacked; Ctrl held over them lists them all, and one is outlined
await step("reveal", async () => {
  await newCanvas("Prints");
  const ids = await place(artOf("hokusai").map(h));
  // spread a little, as a pile on a desk
  for (let i = 0; i < ids.length; i++) {
    const b = await boxOf(ids[i]);
    await select([ids[i]]);
    await drag([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], [(b.minX + b.maxX) / 2 + (i - 2.5) * 70, (b.minY + b.maxY) / 2 + (i % 2 ? 40 : -30)], 4);
  }
  await fit();
  const v = await H(() => window.__canvastDebug.viewport());
  await p.mouse.move(v.width / 2, v.height / 2);
  await p.keyboard.down("Control");
  await p.mouse.move(v.width / 2 + 2, v.height / 2 + 1);
  await settle(500);
  const list = await H(() => window.__canvastDebug.revealList());
  if (list) await p.mouse.move(v.width / 2 + 40, v.height / 2 + 4 + 16 * 2 + 8); // (on its third row: that print outlined)
  await settle(300);
  await shot("reveal");
  await p.keyboard.up("Control");
});

// 6. The Layers panel over the prints: rows by name, a group, the eye and the lock
await step("layers", async () => {
  const ids = (await H(() => window.__canvastDebug.objects())).filter((o) => o.kind === "image").map((o) => o.id);
  await select(ids.slice(0, 2));
  await p.keyboard.press("Control+g");
  await panel("Layers panel");
  await p.keyboard.press("Escape");
  await select([ids[3]]);
  await off();
  await shot("layers");
  await panel("Layers panel", false);
  await p.keyboard.press("Escape");
});

// 7. A clip playing on a board, with its player: the wheat field, slowly panned (made here with ffmpeg)
await step("media", async () => {
  const clip = join(s.work, "wheat_field_pan.webm");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", artPath(artOf("vangogh")[0]), "-vf", "scale=1600:-2,zoompan=z='1.15':x='iw/2-(iw/zoom/2)+on*1.2':y='ih/2-(ih/zoom/2)':d=150:s=960x720:fps=30", "-c:v", "libvpx-vp9", "-b:v", "1M", "-t", "5", clip]);
  await newCanvas("Moving references");
  await p.getByTestId("import-input").setInputFiles(clip);
  await p.waitForTimeout(3000);
  await fit();
  for (let i = 0; i < 2; i++) { await p.keyboard.press("-"); await settle(300); }
  const v = await H(() => window.__canvastDebug.viewport());
  await p.mouse.click(v.width / 2, v.height / 2);
  await settle(400);
  const play = p.getByRole("button", { name: /^Play/ }).first();
  if (await play.isVisible()) await play.click();
  await p.waitForTimeout(1800);
  await p.mouse.move(v.width / 2, v.height / 2 + 20);
  await shot("media");
});

await s.done();

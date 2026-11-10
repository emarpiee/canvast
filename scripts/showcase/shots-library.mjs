// The README's pictures of the Library: public-domain artworks (scripts/showcase/art) filed in folders and tagged, as a gallery and a
// list, the sidebar, search with its keywords, the viewer, Organize, several selected, similar images, art files, a font. A fresh
// profile; nothing of anyone's own.
// Run from the repo root after `npm run build` (ImageMagick and zip make the copies and the art files):
//   node scripts/showcase/shots-library.mjs <unused> <outDir>
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ART, artOf, artPath, open } from "./lib.mjs";

const [, out] = process.argv.slice(2);
const s = await open(out);
const { p, H, settle, shot, step, off, blur, importFiles } = s;

// A smaller, warmer copy of one print, as a library gathers (Similar images finds it), and two art files that keep a picture inside
const copy = join(s.work, "great_wave_print_scan.jpg");
execFileSync("convert", [artPath(artOf("hokusai-under")[0]), "-resize", "70%", "-modulate", "100,108,98", copy]);
const artFiles = [["sea_study.ora", "hokusai-under"], ["dancer_paintover.kra", "degas-dancer_with"]].map(([name, from], i) => {
  const dir = join(s.work, `art${i}`);
  mkdirSync(join(dir, "Thumbnails"), { recursive: true });
  execFileSync("convert", [artPath(artOf(from)[0]), "-resize", "800x800>", join(dir, "mergedimage.png")]);
  execFileSync("cp", [join(dir, "mergedimage.png"), join(dir, "preview.png")]);
  execFileSync("cp", [join(dir, "mergedimage.png"), join(dir, "Thumbnails", "thumbnail.png")]);
  writeFileSync(join(dir, "mimetype"), name.endsWith(".ora") ? "image/openraster" : "application/x-krita");
  const zip = join(s.work, name);
  execFileSync("zip", ["-q", "-X", "-0", zip, "mimetype", "mergedimage.png", "preview.png", "Thumbnails/thumbnail.png"], { cwd: dir });
  return zip;
});
const fonts = ["SpaceGrotesk_400Regular.ttf", "SpaceGrotesk_700Bold.ttf"].map((f) => resolve("scripts/showcase/fonts", f));
const hashes = await importFiles([...ART.map((a) => artPath(a.file)), copy, ...artFiles, ...fonts]);
const h = (f) => hashes[f];
const op = (...a) => H((x) => window.__canvastDebug.libraryOp(...x), a);

// Folders, filing, tags and a description, as a collection is organized
const folders = [["f-horses", "Horses"], ["f-prints", "Japanese prints"], ["f-land", "Landscapes"], ["f-plants", "Botanical"], ["f-dance", "Figure and dance"], ["f-studies", "Studies"]];
for (const [id, name] of folders) await op("createFolder", id, name, "");
await op("createFolder", "f-gesture", "Gesture", "f-dance");
const file = async (starts, folder) => { for (const f of artOf(...starts)) await op("file", h(f), folder); };
await file(["delacroix", "bonheur", "degheyn"], "f-horses");
await file(["hokusai"], "f-prints");
await file(["waterloo", "verhaecht", "leprince", "vangogh"], "f-land");
await file(["delany", "anonymous-botanical"], "f-plants");
await file(["degas"], "f-dance");
await file(["degas-dancer_onstage", "degas-dancer_adjusting"], "f-gesture");
await op("note", h(artOf("delacroix")[0]), "Weight on the back legs; the neck carries the movement.");
await settle(800);
const cards = p.getByTestId("asset-card");
const card = (file) => p.locator(`[data-testid="asset-card"][data-hash="${h(file)}"]`);
const tagAll = async (files, tags) => {
  await card(files[0]).click();
  for (const f of files.slice(1)) await card(f).click({ modifiers: ["Control"] });
  for (const t of tags) {
    const input = files.length > 1 ? p.getByTestId("bulk-tag-input") : p.getByTestId("asset-tag-input");
    await input.fill(t);
    await input.press("Enter");
  }
  await p.keyboard.press("Escape");
};
await step("tags", async () => {
  await tagAll(artOf("hokusai"), ["woodblock", "reference/composition"]);
  await tagAll(artOf("delacroix", "bonheur", "degheyn", "degas"), ["reference/anatomy", "ink"]);
  await tagAll(artOf("waterloo", "verhaecht", "leprince"), ["reference/landscape", "ink"]);
  await card(artOf("vangogh")[0]).click();
  await p.getByTestId("asset-favorite").click();
  await p.keyboard.press("Escape");
});

// 1. The gallery: the whole collection, a picture selected with its details
await step("library", async () => {
  await card(artOf("hokusai-under")[0]).click();
  await off();
  await shot("library");
  await p.keyboard.press("Escape");
});

// 2. The list: columns of name, type, size, tags and use
await step("library-list", async () => {
  await p.locator('[data-layout="list"]').click();
  await settle(600);
  await card(artOf("delacroix")[0]).click();
  await off();
  await shot("library-list");
  await p.keyboard.press("Escape");
  await p.locator('[data-layout="grid"]').click();
  await settle(400);
});

// 3. The sidebar: the folders as a tree (one pinned), the tags as a tree, saved searches with their counts
await step("sidebar", async () => {
  await p.getByRole("button", { name: "Pin folder Japanese prints", exact: true }).click();
  for (const q of ["kind:picture ratio:landscape", "#reference/anatomy"]) {
    await p.getByTestId("assets-search").fill(q);
    await p.getByRole("button", { name: "Save this search" }).filter({ visible: true }).click();
  }
  await p.getByTestId("assets-search").fill("");
  await p.getByTestId("assets-search").press("Escape");
  await p.getByTestId("side-saved").waitFor();
  await p.locator('[data-sec-toggle="ctags"]').click().catch(() => undefined);
  await p.locator('[data-sec-toggle="types"]').click().catch(() => undefined);
  await p.getByTestId("folder-tree").getByRole("button", { name: /^Japanese prints/ }).first().hover();
  await settle(400);
  await shot("sidebar", { x: 0, y: 50, width: 480, height: 850 });
});

// 4. Search: keywords and operators, the matches and the chip over the grid that says what is shown
await step("search", async () => {
  await p.getByTestId("assets-search").fill("#ink -#reference/landscape width>600");
  await p.getByTestId("assets-search").press("Enter");
  await settle(800);
  await blur();
  await off();
  await shot("search");
  await p.getByTestId("assets-reset-filters").click();
});

// 5. Search keywords: the help card beside the box
await step("search-help", async () => {
  await p.locator(".search-help-btn").first().click();
  await settle(500);
  await shot("search-help");
  await p.keyboard.press("Escape");
});

// 6. The viewer: a print large, with the filmstrip and its details
await step("viewer", async () => {
  await p.locator('[data-scope="folder:f-prints"]').click();
  await settle(500);
  await card(artOf("hokusai-under")[0]).dblclick();
  await settle(1500);
  await off();
  await shot("viewer");
  await p.keyboard.press("Escape");
  await p.locator('[data-scope="all"]').click();
});

// 7. Organize: folders and tags for a picked item in one dialog
await step("organize", async () => {
  await card(artOf("delany")[0]).click();
  await p.getByTestId("asset-organize").click();
  await p.getByTestId("tree-chooser").waitFor();
  await settle(500);
  await shot("organize");
  await p.getByTestId("choice-cancel").click();
  await p.keyboard.press("Escape");
});

// 8. Several selected: their tags with how many have each, their folders, and what can be done to all of them
await step("bulk", async () => {
  const dancers = artOf("degas");
  await card(dancers[0]).click();
  for (const f of dancers.slice(1)) await card(f).click({ modifiers: ["Control"] });
  await off();
  await shot("bulk");
  await p.keyboard.press("Escape");
});

// 9. Similar images: the print and its smaller scan found together
await step("similar", async () => {
  await p.locator('[data-scope="similar"]').click();
  await settle(2500);
  await off();
  await shot("similar");
  await p.locator('[data-scope="all"]').click();
});

// 10. Art files: the pictures kept inside a painting program's files, on their cards and in the details
await step("art-files", async () => {
  await p.getByTestId("assets-search").fill(".ora OR .kra");
  await p.getByTestId("assets-search").press("Enter");
  await settle(1500);
  await p.locator('[data-testid="asset-card"][title="dancer_paintover.kra"]').click();
  await settle(1200);
  await off();
  await shot("art-files");
  await p.getByTestId("assets-reset-filters").click();
});

// 11. A font: its sample in the details, the library as a list of fonts
await step("font", async () => {
  await p.getByTestId("assets-search").fill("kind:font");
  await p.getByTestId("assets-search").press("Enter");
  await settle(800);
  await p.getByTestId("asset-card").first().click();
  await p.locator(".asset-preview .font-sample.is-ready").waitFor({ timeout: 20_000 }).catch(() => undefined);
  await off();
  await shot("font");
  await p.getByTestId("assets-reset-filters").click();
});

await s.done();

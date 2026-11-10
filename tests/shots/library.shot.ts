// README pictures of "The Library": one collection of the artworks, organized as an artist would (folders by subject, tags by medium
// and subject, true to art.json), and a picture of each Library feature in use (manifest.ts).
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, expect, ART, artFiles, type Scene } from "./scene";

const FOLDERS: Array<[string, string, string[]]> = [
  ["f-prints", "Japanese prints", ["hokusai"]],
  ["f-horses", "Horses", ["delacroix", "bonheur", "degheyn"]],
  ["f-dance", "Dancers", ["degas"]],
  ["f-land", "Landscapes", ["waterloo", "verhaecht", "leprince", "vangogh"]],
  ["f-plants", "Botanical", ["delany", "anonymous-botanical"]],
];
// (tags by what each work is: its medium as art.json gives it, and its subject)
const TAGS: Array<[string[], string[]]> = [
  [["hokusai"], ["print", "japan"]],
  [["delacroix", "bonheur", "degheyn"], ["drawing", "animal/horse"]],
  [["degas"], ["drawing", "figure/dance"]],
  [["waterloo", "verhaecht", "leprince"], ["drawing", "landscape"]],
  [["vangogh"], ["painting", "landscape"]],
  [["delany"], ["cut-paper", "botanical"]],
  [["anonymous-botanical"], ["drawing", "botanical"]],
  [["hokusai-rooster", "hokusai-mystical"], ["animal/bird"]],
];

interface Collection { h: (file: string) => string; card: (file: string) => ReturnType<Scene["p"]["locator"]> }

/** The whole collection in the library, filed and tagged; the Library view open. */
async function collection(s: Scene, extra: string[] = []): Promise<Collection> {
  const p = s.p;
  const files = ART.map((a) => resolve("scripts/showcase/art", a.file));
  const hashes = await s.library([...files, ...extra]);
  const h = (f: string): string => hashes[f]!;
  const op = (...a: string[]): Promise<void> => p.evaluate((x) => window.__canvastDebug.libraryOp(...(x as [never])), a);
  for (const [id, name, starts] of FOLDERS) {
    await op("createFolder", id, name, "");
    for (const f of artFiles(...starts)) await op("file", h(f), id);
  }
  await p.getByTestId("view-assets").click();
  const card = (f: string) => p.locator(`[data-testid="asset-card"][data-hash="${h(f)}"]`);
  for (const [starts, tags] of TAGS) {
    const fs = artFiles(...starts);
    await card(fs[0]!).click();
    for (const f of fs.slice(1)) await card(f).click({ modifiers: ["Control"] });
    for (const t of tags) {
      const input = fs.length > 1 ? p.getByTestId("bulk-tag-input") : p.getByTestId("asset-tag-input");
      await input.fill(t);
      await input.press("Enter");
    }
    await p.keyboard.press("Escape");
  }
  await s.settle();
  return { h, card };
}

/** Two art files that keep a picture inside (an OpenRaster and a Krita file), made from a print, as a painter's studies. */
function artFilesMade(): string[] {
  const work = mkdtempSync(join(tmpdir(), "cv-art-"));
  return [["wave_colour_study.ora", "hokusai-under"], ["dancer_paintover.kra", "degas-dancer_with"]].map(([name, from], i) => {
    const dir = join(work, `a${i}`);
    mkdirSync(join(dir, "Thumbnails"), { recursive: true });
    execFileSync("convert", [resolve("scripts/showcase/art", artFiles(from!)[0]!), "-resize", "800x800>", join(dir, "mergedimage.png")]);
    copyFileSync(join(dir, "mergedimage.png"), join(dir, "preview.png"));
    copyFileSync(join(dir, "mergedimage.png"), join(dir, "Thumbnails", "thumbnail.png"));
    writeFileSync(join(dir, "mimetype"), name!.endsWith(".ora") ? "image/openraster" : "application/x-krita");
    const zip = join(work, name!);
    execFileSync("zip", ["-q", "-X", "-0", zip, "mimetype", "mergedimage.png", "preview.png", "Thumbnails/thumbnail.png"], { cwd: dir });
    return zip;
  });
}

test("library", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 30 });
  const c = await collection(s);
  await c.card(artFiles("hokusai-under")[0]!).click();
  await s.settle();
  await s.shot("library");
});

test("library-list", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 250 });
  const c = await collection(s);
  await s.p.locator('[data-layout="list"]').click();
  await c.card(artFiles("bonheur")[0]!).click();
  await s.settle();
  await s.shot("library-list");
});

test("sidebar", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 30 });
  await collection(s);
  await s.p.getByRole("button", { name: "Pin folder Japanese prints", exact: true }).click();
  for (const q of ["#drawing #animal/horse", "kind:picture orientation:portrait"]) {
    await s.p.getByTestId("assets-search").fill(q);
    await s.p.getByRole("button", { name: "Save this search" }).filter({ visible: true }).click();
  }
  await s.p.getByTestId("assets-search").fill("");
  await s.p.getByTestId("assets-search").press("Escape");
  await s.settle();
  await s.shot("sidebar", await s.around({ els: ['[data-testid="assets-side"]'], pad: 0 }));
});

test("search", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 200 });
  await collection(s);
  // (the figure and animal drawings in a tall format: a search by tag, medium and shape)
  await s.p.getByTestId("assets-search").fill("#drawing (#figure OR #animal) orientation:portrait");
  await s.p.getByTestId("assets-search").press("Enter");
  await expect(s.p.getByTestId("asset-card").first()).toBeVisible();
  await s.settle();
  await s.shot("search");
});

test("search-help", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 160 });
  await collection(s);
  await s.p.locator(".assets-searchbox .search-help-btn").filter({ visible: true }).first().click();
  await s.settle();
  await s.shot("search-help");
});

test("viewer-grey", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 200 });
  const c = await collection(s);
  await c.card(artFiles("hokusai-under")[0]!).dblclick();
  await s.p.getByTestId("viewer-grey").click();
  await expect(s.p.getByTestId("viewer-grey")).toHaveAttribute("aria-pressed", "true");
  await s.settle(800);
  await s.shot("viewer-grey");
});

test("organize", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 95 });
  const c = await collection(s);
  await c.card(artFiles("delany")[0]!).click();
  await s.p.getByTestId("asset-organize").click();
  await s.p.getByTestId("tree-chooser").waitFor();
  await s.settle();
  await s.shot("organize");
});

test("bulk", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 300 });
  const c = await collection(s);
  const fs = artFiles("degas");
  await c.card(fs[0]!).click();
  for (const f of fs.slice(1)) await c.card(f).click({ modifiers: ["Control"] });
  await s.settle();
  await s.shot("bulk");
});

test("similar", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 210 });
  // (a second scan of the same print, smaller and warmer, as a collection gathers: Similar images finds the pair)
  const work = mkdtempSync(join(tmpdir(), "cv-sim-"));
  const scan = join(work, "great_wave_second_scan.jpg");
  execFileSync("convert", [resolve("scripts/showcase/art", artFiles("hokusai-under")[0]!), "-resize", "70%", "-modulate", "100,108,98", scan]);
  await collection(s, [scan]);
  await s.p.locator('[data-scope="similar"]').click();
  await expect(s.p.getByTestId("asset-card").first()).toBeVisible();
  await s.settle();
  await s.shot("similar");
});

test("art-files", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 330 });
  await collection(s, artFilesMade());
  await s.p.getByTestId("assets-search").fill(".ora OR .kra");
  await s.p.getByTestId("assets-search").press("Enter");
  await s.p.locator('[data-testid="asset-card"][title="dancer_paintover.kra"]').click();
  await s.settle();
  await s.shot("art-files");
});

test("font", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 40 });
  await s.fonts();
  await s.p.getByTestId("view-assets").click();
  await s.p.getByTestId("assets-search").fill("kind:font");
  await s.p.getByTestId("assets-search").press("Enter");
  await s.p.locator('[data-testid="asset-card"][title^="Bangers"]').click();
  await s.p.locator(".asset-preview .font-sample.is-ready").waitFor();
  await s.settle();
  await s.shot("font");
});

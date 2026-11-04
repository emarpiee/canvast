// The README's pictures of the library's folder tree, the Organize dialog, several items selected and art files, in a fresh profile (dark, the default theme colour). Made-up folders and tags.
// Run from the repo root after `npm run build`: node scripts/showcase/shots-library.mjs <showcase.canvast> <outDir>
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [, out] = process.argv.slice(2);
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-shots-"));
const ctx = await chromium.launchPersistentContext(join(work, "profile"), { viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await p.goto("file://" + process.cwd() + "/dist/canvast.html#debug");
await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
await p.getByTestId("view-assets").click();
await p.getByTestId("assets-import-input").setInputFiles(["hero", "journey", "deep-zoom", "zoom-out", "shapes", "pattern", "text", "adjust"].map((n) => resolve(`docs/screenshots/${n}.webp`)));
await p.getByTestId("asset-card").nth(7).waitFor();
const named = async (name) => {
  await p.getByTestId("folder-name-input").fill(name);
  await p.getByTestId("folder-name-input").press("Enter");
  await p.getByTestId("folder-tree").getByRole("button", { name: new RegExp(`^${name}`) }).first().waitFor();
};
for (const name of ["Characters", "Environments", "Lighting", "Studies"]) {
  await p.getByTestId("folder-new").click();
  await named(name);
}
await p.getByRole("button", { name: "More actions for folder Studies", exact: true }).click();
await p.getByRole("menuitem", { name: "New folder inside Studies", exact: true }).click();
await named("Hands");
await p.getByRole("button", { name: "Pin folder Lighting", exact: true }).click();
await p.getByTestId("asset-card").first().click();
for (const tag of ["reference", "art/ink", "art/paint"]) {
  await p.getByTestId("asset-tag-input").fill(tag);
  await p.getByTestId("asset-tag-input").press("Enter");
}
await p.getByTestId("asset-organize").click();
await p.getByTestId("tree-chooser").waitFor();
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/organize.png` });
console.log("shot organize");
await p.getByTestId("choice-cancel").click();

// The sidebar: a folder pinned, the pointer on its row
await p.getByTestId("folder-tree").getByRole("button", { name: /^Lighting/ }).first().hover();
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/sidebar.png`, clip: { x: 0, y: 50, width: 480, height: 620 } });
console.log("shot sidebar");

// Several selected: their tags and folders together, in the details panel
await p.keyboard.press("Escape");
const cards = p.getByTestId("asset-card");
await cards.nth(0).click();
for (const n of [1, 2, 3]) await cards.nth(n).click({ modifiers: ["Control"] });
await p.getByTestId("bulk-tag-input").fill("reference");
await p.getByTestId("bulk-tag-input").press("Enter");
await p.mouse.move(700, 880);
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/bulk.png` });
console.log("shot bulk");
await p.keyboard.press("Escape");

// Art files: made-up ones, each a ZIP with a picture in it, as paint programs keep them
const art = join(work, "art");
const made = [["character_study.kra", "hero"], ["character_study.kra~", "text"], ["contour_study.ora", "pattern"], ["planet_poster.kra", "shapes"], ["colour_grade.ora", "adjust"]];
const files = made.map(([name, from], i) => {
  const dir = join(art, String(i));
  mkdirSync(join(dir, "Thumbnails"), { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", resolve(`docs/screenshots/${from}.webp`), "-vf", "scale=720:-2", join(dir, "mergedimage.png")]);
  execFileSync("cp", [join(dir, "mergedimage.png"), join(dir, "preview.png")]);
  execFileSync("cp", [join(dir, "mergedimage.png"), join(dir, "Thumbnails", "thumbnail.png")]);
  writeFileSync(join(dir, "mimetype"), name.includes(".ora") ? "image/openraster" : "application/x-krita");
  const zip = join(art, name);
  execFileSync("zip", ["-q", "-X", "-0", zip, "mimetype", "mergedimage.png", "preview.png", "Thumbnails/thumbnail.png"], { cwd: dir });
  return zip;
});
await p.getByTestId("assets-import-input").setInputFiles(files);
await p.getByTestId("assets-search").fill("study OR poster OR grade");
await p.locator('[data-testid="asset-card"][title="planet_poster.kra"]').waitFor({ timeout: 60_000 });
await p.waitForTimeout(1500);
const backup = p.locator('[data-testid="asset-card"][title$=".kra~"]');
console.log("listed:", await p.getByTestId("asset-card").evaluateAll((c) => c.map((e) => e.getAttribute("title")).join(", ")));
await ((await backup.count()) ? backup.first() : p.locator('[data-testid="asset-card"][title="planet_poster.kra"]')).click();
await p.mouse.move(700, 880);
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/art-files.png` });
console.log("shot art-files");
await ctx.close();

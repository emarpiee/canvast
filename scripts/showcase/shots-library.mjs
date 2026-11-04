// The README's picture of the library with its folder tree and the Organize dialog, in a fresh profile (dark, the default theme colour). Made-up folders and tags.
// Run from the repo root after `npm run build`: node scripts/showcase/shots-library.mjs <showcase.canvast> <outDir>
import { chromium } from "@playwright/test";
import { mkdtempSync } from "node:fs";
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
await p.keyboard.press("o");
await p.getByTestId("tree-chooser").waitFor();
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/organize.png` });
console.log("shot organize");
await ctx.close();

// The README's pictures of speech balloons, Advanced export and a page for each item, in a fresh profile (dark, the default theme colour).
// Run from the repo root after `npm run build`: node scripts/showcase/shots-balloons.mjs <showcase.canvast> <outDir>
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
const drag = async (a, b) => {
  await p.mouse.move(a[0], a[1]);
  await p.mouse.down();
  await p.mouse.move(b[0], b[1], { steps: 8 });
  await p.mouse.up();
};
const balloon = async (a, b, words) => {
  await p.keyboard.press("k");
  await drag(a, b);
  await p.mouse.dblclick((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  await p.waitForTimeout(200);
  await p.keyboard.type(words);
  await p.mouse.click(1380, 850);
  await p.waitForTimeout(200);
};
await balloon([330, 170], [700, 400], "Is anyone there? Hello?");
await balloon([700, 470], [1040, 680], "Down here! Follow the line.");
await p.keyboard.press("v");
await p.keyboard.press("Control+a");
await p.waitForTimeout(200);
await p.locator("[data-balloon-panel]").filter({ visible: true }).first().click();
await p.locator('[data-bl="connect"]').click();
await p.waitForTimeout(300);
await p.mouse.click(1380, 850);
await p.mouse.click(372, 285); // (the first balloon, away from its words: its handles and its panel)
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/balloons.png` });
console.log("shot balloons");

// Advanced export, over a library
await p.getByTestId("view-assets").click();
await p.getByTestId("assets-import-input").setInputFiles(["hero", "journey", "deep-zoom", "zoom-out", "shapes", "pattern"].map((n) => resolve(`docs/screenshots/${n}.webp`)));
await p.getByTestId("asset-card").nth(5).waitFor();
const hashes = await p.getByTestId("asset-card").evaluateAll((c) => c.map((x) => x.getAttribute("data-hash")));
await p.getByTestId("save-status").click();
await p.getByTestId("set-export-advanced").click();
const dlg = p.getByTestId("advanced-export");
for (const h of hashes.slice(0, 3)) await dlg.locator(`[data-ax-item="${h}"]`).check();
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/advanced-export.png` });
console.log("shot advanced-export");
await dlg.getByRole("button", { name: "Cancel" }).click();

// A page for each selected picture
await p.getByTestId("view-canvas").click();
await p.evaluate(() => window.__canvastDebug.setCamera({ cx: "4000p0", cy: "4000p0", zi: 0, zf: 0, pz: 0 }));
for (const h of hashes.slice(0, 3)) await p.evaluate((x) => window.__canvastDebug.placeFromLibrary(x), h);
await p.waitForTimeout(300);
await p.keyboard.press("Control+a");
await p.locator('[data-ctx="exportmenu"]').click();
await p.locator('.pop-menu [data-id="exportpic"]').click();
await p.getByTestId("export-each").click();
await p.locator("[data-mini]").nth(1).waitFor();
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/export-each.png` });
console.log("shot export-each");
await ctx.close();

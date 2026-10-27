// More README screenshots (text, the Pattern panel and the colour picker): imports showcase.canvast into a fresh profile (theme: System, the browser set to dark) and photographs the app.
// Run from the repo root after `npm run build`: node scripts/showcase/shots.mjs <showcase.canvast> <outDir>
import { chromium } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [archive, out] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-")), { viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await p.goto("file://" + process.cwd() + "/dist/canvast.html#debug"); // (the hook gives a frame to wait for; its panels are hidden below)
await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
const frame = () => p.evaluate(() => window.__canvastDebug.nextFrame());
const settle = async (ms = 600) => { await frame(); await p.waitForTimeout(ms); await frame(); };
const shot = async (name) => {
  // (no notices or stray text selection in the pictures)
  await p.evaluate(() => { for (const b of document.querySelectorAll(".notice-close")) b.click(); getSelection()?.removeAllRanges(); });
  await settle();
  await p.evaluate(() => { for (const b of document.querySelectorAll(".notice-close")) b.click(); });
  await settle(300); await p.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name); };
const off = () => p.mouse.move(700, 893); // (the pointer on the status bar: no hover outlines on the canvas)
const blur = () => p.evaluate(() => document.activeElement?.blur());

// A theme colour for the cosmos: the Ultramarine preset (265°) of Settings > Appearance
await p.getByTestId("view-settings").click();
await p.getByRole("tab", { name: "Appearance" }).click();
await p.locator('.set-preset[aria-label="Ultramarine"]').click();
await p.getByRole("button", { name: "Back to canvas" }).click();

// Import the showcase and open its canvas
await p.getByTestId("save-status").click();
await p.getByTestId("set-import-input").setInputFiles(resolve(archive));
await p.getByTestId("confirm-ok").click();
await p.getByTestId("toast").filter({ hasText: /Imported/ }).waitFor();
await p.keyboard.press("Escape");
await p.getByTestId("workspace-nav").click();
await p.getByTestId("workspace-menu").getByText("Powers of two", { exact: true }).click();
if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");
await blur();

const bookmarks = async (open) => {
  const panel = p.locator(".bookmarks-panel");
  if ((await panel.isVisible()) !== open) await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
};
const go = async (name) => {
  await bookmarks(true);
  await p.getByRole("button", { name: `Go to ${name}` }).click();
  await settle(900);
};


const panel = async (name) => { await p.getByRole("button", { name, exact: true }).click(); await settle(500); };

// Text: a text typed on the canvas, with its options bar
await go("1 · The Solar System");
await bookmarks(false);
await p.keyboard.press("t");
await p.mouse.click(300, 700);
await p.keyboard.type("Zoom into a letter as far as you like");
await p.keyboard.press("Control+a");
await p.keyboard.press("Control+b");
await p.locator("[data-text-size]").fill("40"); await p.locator("[data-text-size]").press("Enter");
await p.keyboard.press("Control+a");
await off();
await shot("text");
await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
while (await p.evaluate(() => window.__canvastDebug.canUndo())) { await p.keyboard.press("Control+z"); await settle(100); }

// Pattern panel: a sheet on a new, empty canvas, with a generator made on it
await p.getByTestId("workspace-nav").click();
await p.getByTestId("workspace-menu").locator('[data-action="new-canvas"]').first().click();
if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");
await settle(600);
await p.mouse.click(27, 318); // (the Sheet tool)
await p.mouse.move(330, 130); await p.mouse.down(); await p.mouse.move(700, 400, { steps: 5 }); await p.mouse.move(1080, 740, { steps: 5 }); await p.mouse.up();
await settle(400);
await panel("Pattern panel");
await p.locator("[data-pg-pick]").click();
await p.locator('.pg-tile[data-gen="contours"], .pg-tile[aria-label^="Contours"]').first().click();
await p.getByTestId("pattern-make").click();
await settle(1500);
await off();
await shot("pattern");
await panel("Pattern panel");

// Colour picker: the fill of the sheet, open
await p.keyboard.press("v");
await p.getByRole("button", { name: /^Fill/ }).first().click();
await settle(600);
await shot("colour-picker");
await p.keyboard.press("Escape");

await ctx.close();

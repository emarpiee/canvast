// README screenshots: imports showcase.canvast into a fresh profile (theme: System, the browser set to dark) and photographs the app.
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
await p.getByTestId("import-archive-input").setInputFiles(resolve(archive));
await p.getByTestId("confirm-ok").click();
await p.getByTestId("toast").filter({ hasText: /Imported/ }).waitFor();
await p.keyboard.press("Escape");
await p.getByTestId("workspace-nav").click();
await p.getByTestId("workspace-menu").getByText("A tour of everything", { exact: true }).click();
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

// 1. Hero: the Solar System
await go("1 · The Solar System");
await bookmarks(false);
await off();
await shot("hero");

// 2. Deep in the galaxy (1,000 levels down)
await go("4 · A galaxy 1,000 levels down");
await bookmarks(false);
await off();
await shot("deep-zoom");

// 3. A tour of the bookmarks
await bookmarks(true);
await p.getByRole("button", { name: "Play the bookmarks as a tour" }).click();
for (let i = 0; i < 4; i++) { await p.keyboard.press("ArrowRight"); await settle(400); }
await shot("tour");
await p.keyboard.press("Escape");

// 4. Boolean shapes: the rocket is a Union, with the Shapes menu open
await go("3 · Earth and the Moon");
await bookmarks(false);
await p.keyboard.press("v");
await p.mouse.click(1062, 352);
await p.locator('[data-ctx="boolmenu"]').click();
await p.mouse.move(1300, 600);
await shot("shapes");
await p.keyboard.press("Escape");
await p.keyboard.press("Escape");

// 5. The cosmic web
await go("5 · The cosmic web");
await bookmarks(false);
await off();
await shot("zoom-out");

// 6. Layers and properties: Jupiter (a gradient fill) picked exactly with Ctrl+click
await go("1 · The Solar System");
await bookmarks(false);
await p.getByRole("button", { name: "Layers panel", exact: true }).click();
await p.keyboard.down("Control");
await p.mouse.click(880, 530);
await p.keyboard.up("Control");
await off();
await shot("layers");
await p.getByRole("button", { name: "Layers panel", exact: true }).click();
await p.keyboard.press("Escape");

// 7. Command palette
await go("1 · The Solar System");
await bookmarks(false);
await p.keyboard.press("Control+k");
await p.keyboard.type("zoom");
await shot("command-palette");
await p.keyboard.press("Escape");

// 8. Export: the Earth (a clipping mask) picked by its name, Export… dialog
await go("3 · Earth and the Moon");
await bookmarks(false);
await p.mouse.click(225, 213);
await p.keyboard.press("Control+k");
await p.keyboard.type("Export… (choose a size)");
await p.keyboard.press("Enter");
await shot("export");
await p.keyboard.press("Escape");
await p.keyboard.press("Escape");

// 9. Library: screenshots of the bookmarks, kept in the library
for (const name of ["1 · The Solar System", "3 · Earth and the Moon", "4 · A galaxy 1,000 levels down", "5 · The cosmic web", "2 · Saturn's ring (Exclude)"]) {
  await go(name);
  await bookmarks(false);
  await p.getByRole("button", { name: "Screenshot", exact: true }).click();
  await p.getByTestId("toast").filter({ hasText: /Screenshot saved/ }).waitFor();
}
await p.getByTestId("view-assets").click();
await off();
await shot("library");
await p.locator(".asset-card, [data-testid='asset-card']").first().dblclick().catch(() => {});
await shot("viewer");
await p.keyboard.press("Escape");

// 10. Settings
await p.getByTestId("view-settings").click();
await p.getByRole("tab", { name: "Appearance" }).click();
await off();
await shot("settings");

await ctx.close();

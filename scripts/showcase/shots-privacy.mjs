// README screenshots of the privacy features: the canvas context menu, hiding in the library, the Hidden list, the export questions, Settings > Privacy and the lock screen.
// Imports showcase.canvast into a fresh profile, like shots.mjs. Run from the repo root after `npm run build`: node scripts/showcase/shots-privacy.mjs <showcase.canvast> <outDir>
import { chromium } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [archive, out] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-")), { viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
const open = async () => {
  await p.goto("file://" + process.cwd() + "/dist/canvast.html#debug");
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
};
await open();
const frame = () => p.evaluate(() => window.__canvastDebug.nextFrame());
const settle = async (ms = 600) => { await frame(); await p.waitForTimeout(ms); await frame(); };
const shot = async (name) => {
  await p.evaluate(() => { for (const b of document.querySelectorAll(".notice-close")) b.click(); getSelection()?.removeAllRanges(); });
  await settle(300);
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};
const off = () => p.mouse.move(700, 893);
const blur = () => p.evaluate(() => document.activeElement?.blur());

await p.getByTestId("view-settings").click();
await p.getByRole("tab", { name: "Appearance" }).click();
await p.locator('.set-preset[aria-label="Ultramarine"]').click();
await p.getByRole("button", { name: "Back to canvas" }).click();
await p.getByTestId("save-status").click();
await p.getByTestId("set-import-input").setInputFiles(resolve(archive));
await p.getByTestId("confirm-ok").click();
await p.getByTestId("toast").filter({ hasText: /Imported/ }).waitFor();
await p.keyboard.press("Escape");
await p.getByTestId("workspace-nav").click();
await p.getByTestId("workspace-menu").getByText("Powers of two", { exact: true }).click();
if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");
await blur();

const bookmarks = async (on) => {
  const panel = p.locator(".bookmarks-panel");
  if ((await panel.isVisible()) !== on) await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
};
const go = async (name) => {
  await bookmarks(true);
  await p.getByRole("button", { name: `Go to ${name}` }).click();
  await settle(900);
};

// Pictures for the library: screenshots of the showcase
for (const name of ["1 · The Solar System", "4 · The Milky Way", "8 · Earth", "9 · An island", "13 · DNA", "16 · Inside a proton"]) {
  await go(name);
  await bookmarks(false);
  await p.getByRole("button", { name: "Screenshot", exact: true }).click();
  await p.getByTestId("toast").filter({ hasText: /Screenshot saved/ }).waitFor();
}

// 1. The canvas context menu on a picture: place one from the library, right click it
await p.getByTestId("view-assets").click();
await p.getByTestId("asset-card").first().click();
await p.getByTestId("asset-place").click();
if (await p.getByTestId("choose-dialog").isVisible().catch(() => false)) await p.getByTestId("choose-ok").click(); // (placing may ask about tags)
await p.getByTestId("view-canvas").click();
await settle(900);
await p.mouse.click(720, 300);
await p.mouse.click(720, 300, { button: "right" });
await shot("context-menu");
await p.keyboard.press("Escape");

// 2. Hiding: an item picked in the library, its details panel with the Hide button
await p.getByTestId("view-assets").click();
await off();
const card = p.getByTestId("asset-card").nth(1);
await card.click();
await p.getByTestId("asset-hide").hover();
await shot("library-hide");
await p.getByTestId("asset-hide").click();
await settle(400);

// 3. The Hidden list: the opening word typed in the search
await p.getByTestId("assets-search").fill("hidden:");
await p.getByTestId("asset-card").first().waitFor();
await p.mouse.click(700, 600); // (leaves the search box: its modes popover would cover the first item)
await off();
await shot("hidden-list");

// 4. A backup asks about the hidden items
await p.getByTestId("view-canvas").click();
await p.getByTestId("save-status").click();
await p.getByTestId("set-export-full").click();
await p.getByTestId("choose-dialog").waitFor();
await shot("export-hidden");
await p.getByTestId("choose-cancel").click();

// 5. Settings > Privacy with both passwords set
await p.getByTestId("view-settings").click();
await p.getByRole("tab", { name: /Privacy/ }).click();
for (const kind of ["workspace", "hidden"]) {
  await p.getByTestId(`${kind}-pw-set`).click();
  for (let i = 0; i < 2; i++) {
    await p.getByTestId("prompt-input").fill("correct horse");
    await p.getByTestId("prompt-ok").click();
  }
  await p.locator(`[data-pw-card="${kind}"] [data-pw-state]`).filter({ hasText: "password was set" }).waitFor();
}
await off();
await shot("privacy");

// 6. The lock screen
await p.reload();
await p.getByTestId("lock-screen").waitFor();
await p.waitForTimeout(400); // (nothing is loaded behind it, so there is no frame to wait for)
await p.screenshot({ path: `${out}/lock-screen.png` });
console.log("shot lock-screen");

await ctx.close();

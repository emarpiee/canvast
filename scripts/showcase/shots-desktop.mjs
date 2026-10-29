// README screenshot of the desktop app: the showcase imported into a fresh workspace folder, the Switch workspace menu open, and the
// folder's files listed (printed, for the README's workspace folder section). Run from the repo root after `npm run desktop`'s build
// (dist-desktop/): node scripts/showcase/shots-desktop.mjs <showcase.canvast> <outDir>
import { _electron as electron } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [archive, out] = process.argv.slice(2);
const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-desk-"));
// (a short, neutral path: the menu shows it in full)
const ws = "/tmp/My art";
if (existsSync(ws)) throw new Error(`${ws} is in the way: remove it first`);
mkdirSync(ws);
const app = await electron.launch({ args: [resolve("dist-desktop"), `--workspace=${ws}`, `--user-data-dir=${root}/data`], env: { ...process.env, CANVAST_HIDDEN: "1", CANVAST_HASH: "#debug" } });
const p = await app.firstWindow();
await p.setViewportSize({ width: 1440, height: 900 });
await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 60000 });
await p.emulateMedia({ colorScheme: "dark" });
await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
const frame = () => p.evaluate(() => window.__canvastDebug.nextFrame());
const settle = async (ms = 600) => { await frame(); await p.waitForTimeout(ms); await frame(); };

// The showcase, imported: written into the folder, then the app starts again on it
await p.getByTestId("save-status").click();
await p.getByTestId("set-import-input").setInputFiles(resolve(archive));
await Promise.all([p.waitForEvent("load", { timeout: 120000 }), p.getByTestId("confirm-ok").click()]);
await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 60000 });
await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
// A few pictures in the library too (the README's own screenshots), so library/images/ is in the folder
await p.getByTestId("view-assets").click();
await p.getByTestId("assets-import-input").setInputFiles(["hero", "journey", "deep-zoom"].map((n) => resolve(`docs/screenshots/${n}.webp`)));
await p.waitForFunction(() => window.__canvastDebug.assetListing().then((l) => l.entries.length >= 5), null, { timeout: 60000 });
await p.getByTestId("view-canvas").click();
await p.evaluate(() => window.__canvastDebug.flushStorage());
await p.getByTestId("workspace-nav").click();
await p.getByTestId("workspace-menu").getByText("Powers of two", { exact: true }).click();
if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");
await p.evaluate(() => { for (const b of document.querySelectorAll(".notice-close")) b.click(); });
await settle(1200);
// The board and canvas menu, with Switch workspace… open beside it
await p.getByTestId("workspace-nav").click();
await p.getByTestId("nav-switch-workspace").click();
await p.mouse.move(900, 700);
await settle(500);
await p.screenshot({ path: `${out}/desktop.png` });
console.log("shot desktop");
await app.close();

// The folder as a file manager shows it (dot-folders included), a few files per folder
const list = (dir, depth) => readdirSync(dir).sort((a, b) => a.localeCompare(b)).flatMap((n) => {
  const path = join(dir, n);
  const isDir = statSync(path).isDirectory();
  const line = `${"  ".repeat(depth)}${n}${isDir ? "/" : ""}`;
  return isDir && depth < 4 ? [line, ...list(path, depth + 1).slice(0, 8)] : [line];
});
console.log(`\nMy art/\n${list(ws, 1).join("\n")}`);
rmSync(ws, { recursive: true, force: true });
rmSync(root, { recursive: true, force: true });

// README screenshots of the media player, the Adjust panel, the library's list and a font's sample, the board and canvas menu, and
// the Styles panel: imports showcase.canvast into a fresh profile (dark, the default theme colour) and photographs the app.
// Run from the repo root after `npm run build` (ffmpeg makes the clip that plays on the canvas):
//   node scripts/showcase/shots-features.mjs <showcase.canvast> <outDir>
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [archive, out] = process.argv.slice(2);
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-shots-"));
// A short clip for the player: the README's journey sheet, slowly zoomed (VP9 WebM, which every browser plays)
const clip = join(work, "journey.webm");
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", resolve("docs/screenshots/journey.webp"), "-vf", "scale=1600:-2,zoompan=z='1+0.0015*on':d=150:s=960x540:fps=30", "-c:v", "libvpx-vp9", "-b:v", "1M", "-t", "5", clip]);

const ctx = await chromium.launchPersistentContext(join(work, "profile"), { viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await p.goto("file://" + process.cwd() + "/dist/canvast.html#debug");
await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
const H = (fn, arg) => p.evaluate(fn, arg);
const frame = () => H(() => window.__canvastDebug.nextFrame());
const settle = async (ms = 600) => { await frame(); await p.waitForTimeout(ms); await frame(); };
const shot = async (name) => {
  await H(() => { for (const b of document.querySelectorAll(".notice-close")) b.click(); getSelection()?.removeAllRanges(); });
  await settle();
  await H(() => { for (const b of document.querySelectorAll(".notice-close")) b.click(); });
  await settle(300); await p.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name);
};
const off = () => p.mouse.move(700, 893);
const blur = () => H(() => document.activeElement?.blur());
const ws = (op, ...a) => H(([op, a]) => window.__canvastDebug.workspaceOp(op, ...a), [op, a]);

// The showcase, and a few more boards so the board and canvas menu shows its search and folding
await p.getByTestId("save-status").click();
await p.getByTestId("set-import-input").setInputFiles(resolve(archive));
await p.getByTestId("confirm-ok").click();
await p.getByTestId("toast").filter({ hasText: /Imported/ }).waitFor();
await p.keyboard.press("Escape");
const boards = [["Character studies", ["Hands", "Faces", "Gesture"]], ["Environments", ["Forest", "City at night"]], ["Storyboard: Act 1", ["Opening", "The chase"]], ["References", ["Lighting", "Colour scripts"]]];
for (const [board, canvases] of boards) {
  await ws("newBoard");
  const t = await H(() => window.__canvastDebug.session().tree);
  const b = t[t.length - 1];
  await ws("renameBoard", b.id, board);
  await ws("renameCanvas", b.canvases[0].id, canvases[0]);
  for (const c of canvases.slice(1)) {
    await ws("newCanvas", b.id);
    const nb = (await H(() => window.__canvastDebug.session().tree)).find((x) => x.id === b.id);
    await ws("renameCanvas", nb.canvases[nb.canvases.length - 1].id, c);
  }
}
const openCanvas = async (name) => {
  await p.getByTestId("workspace-nav").click();
  await p.getByTestId("nav-find").fill(name); // (with several boards, the others are folded: search instead)
  await p.getByTestId("workspace-menu").getByText(name, { exact: true }).click();
  if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");
  await blur();
};

// 1. The board and canvas menu, searched
await openCanvas("Hands");
await p.getByTestId("workspace-nav").click();
await p.getByTestId("nav-find").fill("st");
await p.getByTestId("workspace-menu").waitFor();
await p.mouse.move(700, 600);
await shot("switcher");
await p.keyboard.press("Escape");

// 2. A video playing on the canvas, with its player
await openCanvas("Lighting");
await p.getByTestId("import-input").setInputFiles(clip);
await p.getByTestId("toast").filter({ hasText: /journey/i }).waitFor({ timeout: 30000 }).catch(() => undefined);
await settle(1500);
await p.keyboard.press("f");
await settle(900);
for (let i = 0; i < 2; i++) { await p.keyboard.press("-"); await settle(300); } // (room round it for its player)
await p.mouse.click(720, 400);
await settle(400);
const play = p.getByRole("button", { name: /^Play/ }).first();
if (await play.isVisible()) await play.click();
await p.waitForTimeout(1800);
await p.mouse.move(720, 420);
await shot("media");

// 3. The Adjust panel on the same clip, with a drop shadow
await p.getByRole("button", { name: "Adjust panel", exact: true }).click();
await settle(400);
for (const [k, v] of [["exposure", "12"], ["contrast", "28"], ["temperature", "-18"], ["saturation", "35"], ["vibrance", "20"]]) {
  const n = p.locator(`[data-adj-num="${k}"]`).first();
  await n.fill(v);
  await n.press("Enter");
}
await blur();
await settle(600);
await shot("adjust");
await p.getByRole("button", { name: "Adjust panel", exact: true }).click();
await p.keyboard.press("Escape");

// 4. The Styles panel, with colours and gradients pasted into it as CSS (with nothing selected, a paste over the panel saves a style)
await openCanvas("Powers of two");
await p.keyboard.press("Escape");
await p.getByRole("button", { name: "Styles panel", exact: true }).click();
const panel = p.locator(".styles-panel, [data-panel='styles']").first();
const box = await panel.boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const paste = (t) => H((t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, t);
for (const c of ["#1b0f3a", "#2a3a8a", "#00b4d8", "#80ffdb", "#ffd166", "#ff9e7a", "#f72585", "#9d4edd", "oklch(0.72 0.11 178)", "#ffb703", "#3a0ca3", "#e8f1ff"]) { await paste(c); await settle(120); }
for (const g of ["linear-gradient(90deg, #03045e, #00b4d8, #80ffdb)", "radial-gradient(circle, #fffbe6, #ffd6a5, #ff7b00)", "linear-gradient(135deg, #f72585, #7b2ff7, #3a0ca3)", "conic-gradient(#ffd166, #f72585, #00b4d8, #ffd166)"]) { await paste(g); await settle(120); }
await p.locator(".styles-panel [role=tab]", { hasText: "12" }).first().click(); // (the colours)
await blur();
await off();
await shot("styles");
await p.getByRole("button", { name: "Styles panel", exact: true }).click();

// 5. The library as a list, with a font selected: its sample in the details
await p.getByTestId("view-assets").click();
await settle(900);
await p.locator('[data-layout="list"]').click();
await settle(600);
console.log("cards:", await p.locator('[data-testid="asset-card"]').allInnerTexts().then((t) => t.map((x) => x.split("\n")[0]).join(" | ")));
await p.locator('[data-testid="asset-card"]', { hasText: "Space Grotesk Bold" }).first().click();
await p.locator(".asset-preview .font-sample.is-ready").waitFor();
await off();
await shot("library-list");

await ctx.close();

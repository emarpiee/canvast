// Footage for the motion piece: the app's own drawing of showcase.canvast, chrome hidden, at 30 fps. Each leg of the dive takes the same
// time (one beat) and eases in and out, so every scene lands on the beat. Writes JPEG frames, stills and footage.json (per-frame zoom level
// and scene name). Run from the repo root after `npm run build`: node scripts/showcase/motion/footage.mjs showcase.canvast <outDir>
import { chromium } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [archive, out] = process.argv.slice(2);
const VW = 1600, VH = 900, LEG = 14; // frames per leg
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-")), { viewport: { width: VW, height: VH }, colorScheme: "dark" });
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await p.goto("file://" + process.cwd() + "/dist/canvast.html#debug");
await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
const H = (fn, arg) => p.evaluate(fn, arg);
const frame = () => H(() => window.__canvastDebug.nextFrame());

// The app's default theme colour (Viridian, the logo's colour): nothing is set in Settings > Appearance
await p.getByTestId("save-status").click();
await p.getByTestId("import-archive-input").setInputFiles(resolve(archive));
await p.getByTestId("confirm-ok").click();
await p.getByTestId("toast").filter({ hasText: /Imported/ }).waitFor({ timeout: 120000 });
await p.keyboard.press("Escape");
await p.getByTestId("workspace-nav").click();
await p.getByTestId("workspace-menu").getByText("Powers of two", { exact: true }).click();
if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");

await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
const names = await p.locator("li.bookmark .bookmark-name").allTextContents();
const cams = {};
for (const name of names) {
  await p.getByRole("button", { name: `Go to ${name}` }).click();
  await p.waitForTimeout(250);
  cams[Number(name.split(" · ")[0])] = { name: name.split(" · ")[1], cam: await H(() => window.__canvastDebug.camera()) };
}
await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
await H(() => { for (const b of document.querySelectorAll(".notice-close")) b.click(); });

const Q = 2 ** -20;
const level = (c) => Number(c.zi) + Number(c.zf);
const split = (z) => { const zi = Math.floor(z); return [zi, Math.min(Math.round((z - zi) / Q) * Q, 1 - Q)]; };
const setCam = (cx, cy, z) => { const [zi, zf] = split(z); return H(([cx, cy, zi, zf]) => window.__canvastDebug.setCamera({ cx, cy, zi, zf, pz: zi }), [cx, cy, zi, zf]); };
const go = async (k) => { const c = cams[k].cam; await setCam(c.cx, c.cy, level(c)); await p.waitForTimeout(300); await frame(); await frame(); };

// A still with the app's chrome: home
await go(1);
await p.mouse.move(VW / 2, VH - 4);
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/app-home.jpg`, quality: 92 });

// Only the canvas from here on
await H(() => {
  const c = document.querySelector("canvas");
  for (let el = c; el && el !== document.body; el = el.parentElement) for (const sib of el.parentElement.children) if (sib !== el && !sib.contains(c)) sib.style.visibility = "hidden";
});
const still = async (k, name) => { await go(k); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${name}.jpg`, quality: 92 }); };
await still(6, "web");
await still(1, "home");
await still(18, "plus1000");
await still(19, "million");
await still(7, "multiverse");

const meta = [];
let n = 0;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
async function leg(a, b) {
  const A = cams[a].cam, B = cams[b].cam, La = level(A), Lb = level(B);
  await setCam(A.cx, A.cy, La);
  const s0 = await H(([x, y]) => window.__canvastDebug.worldToScreen(x, y), [B.cx, B.cy]);
  for (let i = 0; i < LEG; i++) {
    const t = i / LEG, e = ease(t), z = La + (Lb - La) * e;
    const g = Math.min(1, e * 1.25); // (the next scene's centre reaches the middle a little before the zoom lands)
    const sx = s0.x + (VW / 2 - s0.x) * g, sy = s0.y + (VH / 2 - s0.y) * g;
    const [zi, zf] = split(z);
    const c = await H(([cx, cy, zi, zf, sx, sy, VW, VH]) => { const h = window.__canvastDebug; h.setCamera({ cx, cy, zi, zf, pz: zi }); return h.screenToWorld(VW - sx, VH - sy); }, [B.cx, B.cy, zi, zf, sx, sy, VW, VH]);
    await setCam(c.x, c.y, z);
    await frame(); await frame();
    await p.screenshot({ path: `${out}/f${String(n++).padStart(4, "0")}.jpg`, quality: 88 });
    meta.push({ z, from: cams[a].name, to: cams[b].name, t });
  }
}
for (const [a, b] of [[6, 5], [5, 4], [4, 3], [3, 2], [2, 1], [1, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16]]) await leg(a, b);
await go(16);
await p.screenshot({ path: `${out}/f${String(n++).padStart(4, "0")}.jpg`, quality: 88 });
meta.push({ z: level(cams[16].cam), from: cams[16].name, to: cams[16].name, t: 1 });
writeFileSync(`${out}/footage.json`, JSON.stringify({ fps: 30, leg: LEG, frames: meta }, null, 1));
console.log("frames", n);
await ctx.close();

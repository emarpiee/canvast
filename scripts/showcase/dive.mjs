// The animated dive of the README: imports showcase.canvast, then flies the camera from the multiverse down to a million levels below the
// Solar System, frame by frame, and writes PNG frames plus `frames.txt` (img2webp arguments: one duration per frame).
// Run from the repo root after `npm run build`: node scripts/showcase/dive.mjs showcase.canvast <framesDir>
import { chromium } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [archive, out] = process.argv.slice(2);
const FPL = Number(process.env.FRAMES_PER_LEVEL ?? 2.5), MS = 80;
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-")), { viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await p.goto("file://" + process.cwd() + "/dist/canvast.html#debug");
await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
const H = (fn, arg) => p.evaluate(fn, arg);
const frame = () => H(() => window.__canvastDebug.nextFrame());

await p.getByTestId("save-status").click();
await p.getByTestId("set-import-input").setInputFiles(resolve(archive));
await p.getByTestId("confirm-ok").click();
await p.getByTestId("toast").filter({ hasText: /Imported/ }).waitFor();
await p.keyboard.press("Escape");
await p.getByTestId("workspace-nav").click();
await p.getByTestId("workspace-menu").getByText("Powers of two", { exact: true }).click();
if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");

// Every bookmark's camera, by its number
await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
const names = await p.locator("li.bookmark .bookmark-name").allTextContents();
const cams = {};
for (const name of names) {
  await p.getByRole("button", { name: `Go to ${name}` }).click();
  await p.waitForTimeout(300);
  cams[Number(name.split(" · ")[0])] = { name: name.split(" · ")[1], cam: await H(() => window.__canvastDebug.camera()) };
}
await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();

// Only the canvas, and a zoom meter of our own on top
await H(() => {
  const c = document.querySelector("canvas");
  for (let el = c; el && el !== document.body; el = el.parentElement) for (const sib of el.parentElement.children) if (sib !== el && !sib.contains(c)) sib.style.visibility = "hidden";
  const m = document.createElement("div");
  m.id = "meter";
  m.style.cssText = "position:fixed;right:28px;bottom:24px;font:600 22px/1.3 system-ui,sans-serif;color:#fff;text-align:right;text-shadow:0 1px 6px #000c;z-index:99999";
  document.body.append(m);
});
const meter = (z) => H((z) => {
  const sup = (s) => s.replace(/[-0-9]/g, (d) => "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"["-0123456789".indexOf(d)]);
  const lv = Math.round(z);
  const ten = Math.round(z * Math.LOG10E * Math.LN2);
  document.getElementById("meter").innerHTML = `zoom level ${lv > 0 ? "+" : ""}${lv.toLocaleString("en")}<br><span style="font-weight:400;font-size:17px;opacity:.85">${ten >= 0 ? "magnified" : "shrunk"} 10${sup(String(Math.abs(ten)))}×</span>`;
}, z);

const Q = 2 ** -20;
const setCam = (cx, cy, z) => { const zi = Math.floor(z), zf = Math.min(Math.round((z - zi) / Q) * Q, 1 - Q); return H(([cx, cy, zi, zf]) => window.__canvastDebug.setCamera({ cx, cy, zi, zf, pz: zi }), [cx, cy, zi, zf]); };
const level = (c) => Number(c.zi) + Number(c.zf);
const durations = [];
let n = 0;
const snap = async (ms, z) => {
  await meter(z);
  await frame(); await frame();
  await p.screenshot({ path: `${out}/f${String(n++).padStart(4, "0")}.png` });
  durations.push(ms);
};
const hold = async (k, ms) => { const c = cams[k].cam; await setCam(c.cx, c.cy, level(c)); await p.waitForTimeout(400); await snap(ms, level(c)); };
/** From bookmark a down to bookmark b: zoom about b's centre, which glides from where it is on a's screen to the middle. */
async function fly(a, b) {
  const A = cams[a].cam, B = cams[b].cam, La = level(A), Lb = level(B);
  await setCam(A.cx, A.cy, La);
  const s0 = await H(([x, y]) => window.__canvastDebug.worldToScreen(x, y), [B.cx, B.cy]);
  const steps = Math.max(2, Math.round((Lb - La) * FPL));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, e = t * t * (3 - 2 * t), z = La + (Lb - La) * t;
    const sx = s0.x + (720 - s0.x) * e, sy = s0.y + (450 - s0.y) * e;
    const c = await H(([cx, cy, zi, zf, sx, sy]) => { const h = window.__canvastDebug; h.setCamera({ cx, cy, zi, zf, pz: zi }); return h.screenToWorld(1440 - sx, 900 - sy); }, [B.cx, B.cy, Math.floor(z), Math.min(Math.round((z - Math.floor(z)) / Q) * Q, 1 - Q), sx, sy]);
    await setCam(c.x, c.y, z);
    await snap(MS, z);
  }
}

// 7 multiverse … 2 heliosphere, 1 Solar System, 8 Earth … 16 proton, 17 Planck, 18 +1,000, 19 a million
await hold(7, 2200);
await hold(6, 1400);
for (const [a, b] of [[6, 5], [5, 4], [4, 3], [3, 2], [2, 1], [1, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16]]) {
  await fly(a, b);
  await hold(b, b === 1 ? 2000 : 900);
}
await hold(17, 2200);
await hold(18, 2200);
await hold(19, 3500);
writeFileSync(`${out}/frames.txt`, durations.map((d, i) => `-d ${d} f${String(i).padStart(4, "0")}.png`).join("\n"));
console.log("frames", n);
await ctx.close();

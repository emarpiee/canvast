// Builds showcase.canvast by driving the app (dist/canvast.html#debug) like a person would, then exporting a workspace backup.
// Run from the repo root after `npm run build`: node scripts/showcase/build.mjs showcase.canvast [debugShotsDir]
import { chromium } from "@playwright/test";
import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as S from "./scenes.mjs";

const [out, shots] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-")), { viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await p.goto("file://" + process.cwd() + "/dist/canvast.html#debug");
await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
const H = (fn, arg) => p.evaluate(fn, arg);
const frame = () => H(() => window.__canvastDebug.nextFrame());
const shot = async (name) => { if (!shots) return; await frame(); await p.waitForTimeout(250); await p.screenshot({ path: `${shots}/${name}.png` }); };
const world = (x, y) => H(([a, b]) => window.__canvastDebug.screenToWorld(a, b), [x, y]);
const Q = 2 ** -20;
const cam = (w, z) => {
  const zi = Math.floor(z), zf = Math.round((z - zi) / Q) * Q;
  return H(([w, zi, zf]) => window.__canvastDebug.setCamera({ cx: w.x, cy: w.y, zi, zf: zf >= 1 ? 0 : zf, pz: zi }), [w, zi, zf]).then(frame);
};
const ORIGIN = { x: "0p0", y: "0p0" };
/** Paste SVG text so that its viewBox (largest side `max`) is centred on `w` and one SVG unit is one screen px at level `L`. (A paste fills half the view's height, under the pointer.) */
const pasteAt = async (w, L, svg, max) => {
  await cam(w, L - Math.log2(max / 450));
  await p.mouse.move(720, 450);
  await paste(svg);
  await cam(w, L);
};
const paste = async (svg) => {
  await H((t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, svg);
  await frame();
};
const esc = async () => { await p.keyboard.press("Escape"); await p.evaluate(() => document.activeElement?.blur()); await frame(); };
const menu = async (button, id) => {
  await command("Ungroup"); // (a paste is one group; only loose shapes combine)
  await p.locator(`[data-ctx="${button}"]`).click();
  await p.locator(`.pop-menu [data-id="${id}"]`).click();
  await p.keyboard.press("Escape");
};
const command = async (name) => {
  await p.keyboard.press("Control+k");
  await p.keyboard.type(name);
  await p.waitForTimeout(150);
  await p.keyboard.press("Enter");
  await frame();
};
const setHex = async (hex) => {
  const field = p.locator(".colour-pop [data-hex]");
  await field.fill(hex.replace("#", ""));
  await field.press("Enter");
  await p.keyboard.press("Escape");
};
/** A new text with its size and colour set on the Text tool first (they carry to the new text). */
const text = async (x, y, str, size, hex) => {
  await p.keyboard.press("t");
  const sz = p.getByRole("spinbutton", { name: "Text size (px at this zoom)" });
  await sz.fill(String(size));
  await sz.press("Enter");
  await p.getByRole("button", { name: "Text colour" }).click();
  await setHex(hex);
  await p.mouse.click(x, y);
  await p.waitForFunction(() => (document.activeElement)?.isContentEditable === true, null, { timeout: 3000 }); // (else the keys would be shortcuts)
  await p.keyboard.type(str);
  await p.keyboard.press("Escape");
  await p.keyboard.press("v");
  await esc();
};
const bookmark = async (name) => {
  const panel = p.locator(".bookmarks-panel");
  if (!(await panel.isVisible())) await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  await p.waitForTimeout(700); // (the bookmark's picture is taken from the drawn view)
  await p.getByRole("button", { name: "Add bookmark" }).click();
  const last = p.locator("li.bookmark .bookmark-name").last();
  await last.dblclick();
  await p.keyboard.press("Control+a");
  await p.keyboard.type(name);
  await p.keyboard.press("Enter");
  await frame();
};
/** Name the clipping mask an SVG paste made ("Clip 1", …) in the Layers panel, so the label above it says what it is. */
const nameLayer = async (from, to) => {
  if (!(await p.getByTestId("layers-panel").isVisible())) await p.getByRole("button", { name: "Layers panel", exact: true }).click();
  await p.locator(".layer-name", { hasText: new RegExp(`^${from}$`) }).first().dblclick();
  await p.locator("[data-rename]").fill(to);
  await p.keyboard.press("Enter");
  await shot("dbg-layers");
  await p.getByRole("button", { name: "Layers panel", exact: true }).click();
};
const OFF = [20, 20]; // a pasted 1400 × 860 scene is centred in the 1440 × 900 view

// Board and canvas names
await p.getByTestId("workspace-nav").click();
await p.getByRole("button", { name: "More actions for board Board 1" }).last().click();
await p.getByRole("menuitem", { name: "Rename board Board 1" }).click();
await p.locator(".nav-rename").fill("Cosmos");
await p.locator(".nav-rename").press("Enter");
await p.getByRole("button", { name: "More actions for canvas Canvas 1" }).last().click();
await p.getByRole("menuitem", { name: "Rename canvas Canvas 1" }).click();
await p.locator(".nav-rename").fill("A tour of everything");
await p.locator(".nav-rename").press("Enter");
await esc();
if (await p.getByTestId("workspace-menu").isVisible()) await p.getByTestId("workspace-nav").click();

// 1. The Solar System
await pasteAt(ORIGIN, 0, S.solarSystem(), 1400);
await esc();
const scr = ([x, y]) => [x + OFF[0], y + OFF[1]];
const earthW = await world(...scr(S.PLANETS.earth.at));
const saturnW = await world(...scr(S.PLANETS.saturn.at));
await shot("dbg-1-solar");
await nameLayer("Clip 1", "The Solar System");

// Saturn's ring: Exclude makes a ring of two ellipses
await pasteAt(saturnW, 0, S.saturnRing(), 160);
await menu("boolmenu", "op:exclude");
await esc();

// The Big Dipper, drawn with the pen
await cam(ORIGIN, 0);
await p.keyboard.press("p");
await p.locator("[data-colour-open]").first().click();
await setHex("#ffd6a5");
const d = S.DIPPER.map(scr);
await p.mouse.move(d[0][0], d[0][1]);
await p.mouse.down();
for (const [x, y] of [...d.slice(1), d[3]]) await p.mouse.move(x, y, { steps: 12 });
await p.mouse.up();
await p.keyboard.press("v");
await esc();

// Titles
await text(930, 60, "canvast", 72, "#ffffff");
await text(936, 172, "An endless canvas. Zoom in forever.", 22, "#cfe3ff");
await text(...scr([S.PLANETS.earth.at[0] - 92, S.PLANETS.earth.at[1] - 9]), "Earth", 13, "#a9d6ff");
await text(...scr([S.PLANETS.saturn.at[0] - 22, S.PLANETS.saturn.at[1] + 34]), "Saturn", 13, "#f3e3b8");
await shot("dbg-1b-solar");

// 2. Earth and the Moon (16× closer)
const earthCam = await H(([w]) => { const h = window.__canvastDebug; h.setCamera({ cx: w.x, cy: w.y, zi: 4, zf: 0, pz: 4 }); return h.screenToWorld(720 + (720 - 430), 450); }, [earthW]);
await cam(earthCam, 4);
await pasteAt(earthCam, 4, S.earthScene(), 1440);
await esc();
await nameLayer("Clip 1", "Earth");
const moonW = await world(1230, 180);
const craterW = await world(1230 - 110 + S.CRATER[0], 180 - 110 + S.CRATER[1]);
const rocketW = await world(1080, 330);
await pasteAt(moonW, 4, S.moon(), 220);
await menu("boolmenu", "op:subtract");
await esc();
await pasteAt(moonW, 4, S.craters(), 220);
await esc();
await pasteAt(rocketW, 4, S.rocketParts(), 220);
await menu("boolmenu", "op:union");
await esc();
await pasteAt(rocketW, 4, S.rocketDetails(), 220);
await esc();
await cam(earthCam, 4);
await text(80, 70, "Earth and the Moon", 40, "#ffffff");
await text(84, 128, "16× closer than the Solar System", 18, "#a9d6ff");
await shot("dbg-2-earth");

// 3. A galaxy 1,000 levels inside a crater of the Moon
await pasteAt(craterW, 1004, S.galaxy(), 2400);
await esc();
await text(80, 70, "A galaxy in a crater of the Moon", 40, "#ffffff");
await text(84, 128, "1,000 zoom levels down: 10^301× magnified, still exact", 18, "#cdb4db");
await shot("dbg-3-galaxy");

// 4. The cosmic web, 16,384× farther out than the Solar System
await pasteAt(ORIGIN, -14, S.cosmicWeb(), 1400);
await command("Send to back");
await esc();
await text(80, 70, "The cosmic web", 40, "#ffffff");
await text(84, 128, "16,384× farther out. The Solar System is the speck in the ring.", 18, "#9bb1ff");
await text(752, 404, "You are here", 14, "#ffd166");
await shot("dbg-4-web");

// Bookmarks, in the order of the tour
await cam(ORIGIN, 0);
await bookmark("1 · The Solar System");
await cam(saturnW, 3);
await bookmark("2 · Saturn's ring (Exclude)");
await cam(earthCam, 4);
await bookmark("3 · Earth and the Moon");
await cam(craterW, 1004);
await bookmark("4 · A galaxy 1,000 levels down");
await cam(ORIGIN, -14);
await bookmark("5 · The cosmic web");
await cam(ORIGIN, 0);
await shot("dbg-5-home");

// Save and export
await H(() => window.__canvastDebug.flushSave());
await p.getByTestId("save-status").click();
const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("export-workspace").click()]);
copyFileSync(await dl.path(), out);
console.log("objects", (await H(() => window.__canvastDebug.objects())).length, "→", out);
await ctx.close();

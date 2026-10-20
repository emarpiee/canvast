// Builds showcase.canvast by driving the app (dist/canvast.html#debug) like a person would, then exporting a workspace backup.
// A "powers of two" journey: every scene (scenes.mjs) sits at the portal of the one above it, from a multiverse 1,000 levels up to a
// million levels down. Run from the repo root after `npm run build`: node scripts/showcase/build.mjs showcase.canvast [debugShotsDir]
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
const cam = (w, zi) => H(([w, z]) => window.__canvastDebug.setCamera({ cx: w.x, cy: w.y, zi: z, zf: 0, pz: z }), [w, zi]).then(frame);
const ORIGIN = { x: "0p0", y: "0p0" };
// The scenes' SVG is 1800 × 1124; a paste fills half the view's height (450 px for its longest side), under the pointer: pasted two
// levels up, one SVG unit is one screen px at the scene's level, and screen = SVG − (180, 112) with the camera on the scene's centre.
const OFF = [(S.W - 1440) / 2, (S.H - 900) / 2];
const scr = ([x, y]) => [x - OFF[0], y - OFF[1]];
const paste = async (svg) => {
  await H((t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, svg);
  await frame();
};
const pasteAt = async (w, L, svg) => {
  await cam(w, L - 2);
  await p.mouse.move(720, 450);
  await paste(svg);
  await cam(w, L);
};
const esc = async () => { await p.keyboard.press("Escape"); await p.evaluate(() => document.activeElement?.blur()); await frame(); };
const command = async (name) => {
  await p.keyboard.press("Control+k");
  await p.keyboard.type(name);
  await p.waitForTimeout(150);
  await p.keyboard.press("Enter");
  await frame();
};
const menu = async (button, id) => {
  await command("Ungroup"); // (a paste is one group; only loose shapes combine)
  await p.locator(`[data-ctx="${button}"]`).click();
  await p.locator(`.pop-menu [data-id="${id}"]`).click();
  await p.keyboard.press("Escape");
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
  await p.waitForFunction(() => document.activeElement?.isContentEditable === true, null, { timeout: 3000 }).catch(async (e) => { await shot("dbg-fail"); throw new Error(`text "${str}" at ${x},${y}: ${e}`); }); // (else the keys would be shortcuts)
  await p.keyboard.type(str);
  await p.keyboard.press("Escape");
  await p.keyboard.press("v");
  await esc();
};
const nameLayer = async (from, to) => {
  if (!(await p.getByTestId("layers-panel").isVisible())) await p.getByRole("button", { name: "Layers panel", exact: true }).click();
  await p.locator(".layer-name", { hasText: new RegExp(`^${from}$`) }).first().dblclick();
  await p.locator("[data-rename]").fill(to);
  await p.keyboard.press("Enter");
  await p.getByRole("button", { name: "Layers panel", exact: true }).click();
};
const bookmark = async (name) => {
  const panel = p.locator(".bookmarks-panel");
  if (!(await panel.isVisible())) await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  await p.waitForTimeout(900); // (the bookmark's picture is taken from the drawn view)
  await p.getByRole("button", { name: "Add bookmark" }).click();
  const last = p.locator("li.bookmark .bookmark-name").last();
  await last.dblclick();
  await p.keyboard.press("Control+a");
  await p.keyboard.type(name);
  await p.keyboard.press("Enter");
  await frame();
};

// Board and canvas names
await p.getByTestId("workspace-nav").click();
await p.getByRole("button", { name: "More actions for board Board 1" }).last().click();
await p.getByRole("menuitem", { name: "Rename board Board 1" }).click();
await p.locator(".nav-rename").fill("Cosmos");
await p.locator(".nav-rename").press("Enter");
await p.getByRole("button", { name: "More actions for canvas Canvas 1" }).last().click();
await p.getByRole("menuitem", { name: "Rename canvas Canvas 1" }).click();
await p.locator(".nav-rename").fill("Powers of two");
await p.locator(".nav-rename").press("Enter");
await esc();
if (await p.getByTestId("workspace-menu").isVisible()) await p.getByTestId("workspace-nav").click();

// The journey, outermost first. `L` is the zoom level (log2) each scene is drawn at.
const chain = [
  ["multiverse", -1000, "The multiverse (1,000 levels up)"], ["observable", -40, "The observable universe"], ["localGroup", -32, "The Local Group"],
  ["milkyWay", -27, "The Milky Way"], ["neighbourhood", -18, "The Sun's neighbourhood"], ["heliosphere", -9, "The heliosphere"],
  ["solarSystem", 0, "The Solar System"], ["earth", 5, "Earth"], ["island", 12, "An island"], ["tree", 19, "A tree"], ["leaf", 25, "A leaf"],
  ["cells", 32, "Plant cells"], ["dna", 40, "DNA"], ["atom", 47, "A carbon atom"], ["nucleus", 54, "The nucleus"], ["proton", 60, "Inside a proton"],
  ["planck", 116, "The Planck length"], ["universeAgain", 1000, "Universes all the way down (+1,000)"], ["million", 1000000, "One million levels down"],
].map(([fn, L, name]) => ({ fn, L, name, scene: S[fn]() }));
const home = chain.findIndex((s) => s.fn === "solarSystem");
chain[home].c = ORIGIN;
for (let i = home - 1; i >= 0; i--) { // a parent is placed so that its portal is the centre of the scene below
  const [px, py] = chain[i].scene.portal;
  await cam(chain[i + 1].c, chain[i].L);
  chain[i].c = await world(720 + S.CX - px, 450 + S.CY - py);
}
for (let i = home + 1; i < chain.length; i++) { // a child's centre is its parent's portal
  await cam(chain[i - 1].c, chain[i - 1].L);
  chain[i].c = await world(...scr(chain[i - 1].scene.portal));
}

for (const s of chain) {
  await pasteAt(s.c, s.L, s.scene.svg);
  await esc();
  if (s.fn === "earth") await nameLayer("Clip 1", "Earth");
  if (s.fn === "solarSystem") { // Saturn's ring: two ellipses made one by Exclude
    await cam(s.c, 0);
    const saturnW = await world(...scr(S.PLANETS.Saturn.at));
    await pasteAt(saturnW, 0, S.saturnRing());
    await menu("boolmenu", "op:exclude");
    await esc();
  }
  if (s.fn === "earth") {
    await cam(s.c, s.L);
    const moonW = await world(...scr(s.scene.moonAt)), rocketW = await world(...scr(s.scene.rocketAt));
    await pasteAt(moonW, s.L, S.moon());
    await menu("boolmenu", "op:subtract");
    await esc();
    await pasteAt(rocketW, s.L, S.rocketParts());
    await menu("boolmenu", "op:union");
    await esc();
    await pasteAt(rocketW, s.L, S.rocketDetails());
    await esc();
  }
  await cam(s.c, s.L);
  if (s.scene.pen) { // a line drawn by hand with the Pen
    await p.keyboard.press("p");
    await p.locator("[data-colour-open]").first().click();
    await setHex("#ffd6a5");
    const d = s.scene.pen.map(scr);
    await p.mouse.move(d[0][0], d[0][1]);
    await p.mouse.down();
    for (const [x, y] of d.slice(1)) await p.mouse.move(x, y, { steps: 14 });
    await p.mouse.up();
    await p.keyboard.press("v");
    await esc();
  }
  for (const [x, y, str, size, hex] of s.scene.labels) await text(...scr([x, y]), str, size, hex);
  await shot(`dbg-${String(chain.indexOf(s)).padStart(2, "0")}-${s.fn}`);
  console.log("scene", s.name);
}

// Bookmarks in the order of the tour: home, out to the multiverse, then all the way in
const order = [home, ...[...Array(home).keys()].reverse(), ...[...chain.keys()].slice(home + 1)];
let n = 1;
for (const i of order) {
  await cam(chain[i].c, chain[i].L);
  await bookmark(`${n++} · ${chain[i].name}`);
}
await cam(ORIGIN, 0);
await shot("dbg-home");

if (await p.locator(".bookmarks-panel").isVisible()) await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
await H(() => window.__canvastDebug.flushSave());
await p.getByTestId("save-status").click();
const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 180000 }), p.getByTestId("export-workspace").click()]);
copyFileSync(await dl.path(), out);
console.log("objects", (await H(() => window.__canvastDebug.objects())).length, "→", out);
await ctx.close();

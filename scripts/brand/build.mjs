// Builds the canvast brand board (the logo and its guidelines, pages.mjs) by driving the app like a person would, then exports the canvas.
// Nine pages become nine sheets on one canvas; the glyph on page 03 is made with the Shape tool and Subtract, the crosses on page 08 with the
// Path tool, every label with the Text tool, and the cover's dot holds the mark again, 20 times over. Run from the repo root after `npm run build`:
// node scripts/brand/build.mjs <out.canvast> [shotsDir]   (shotsDir: a PNG of every page, the whole board and the deepest view)
import { open, VW, VH } from "./lib.mjs";
import { pages, markSvg, C, HERO, GRID, MARKERS, MISUSE } from "./pages.mjs";
import { favPixels } from "./preview.mjs";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const [out, shots] = process.argv.slice(2);
if (!out) { console.log("usage: node scripts/brand/build.mjs <out.canvast> [shotsDir]"); process.exit(1); }
if (shots) mkdirSync(shots, { recursive: true });
const shotPath = (name) => (shots ? join(shots, name) : null);
const A = await open();
const { p } = A;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const FONT = { r: "Space Grotesk", b: "Space Grotesk Bold" };
const K = 0.75; // screen px per page unit at level 0 (a 1600-unit page pasted one level up fills 600 px, so 1200 at level 0)
const sc = (u, v) => [VW / 2 + (u - 800) * K, VH / 2 + (v - 500) * K];
const click = async (u, v, mods = []) => { for (const m of mods) await p.keyboard.down(m); await p.mouse.click(...sc(u, v)); for (const m of mods) await p.keyboard.up(m); await A.frame(); };
const drag = async ([u1, v1], [u2, v2]) => { await p.mouse.move(...sc(u1, v1)); await p.mouse.down(); await p.mouse.move(...sc((u1 + u2) / 2, (v1 + v2) / 2), { steps: 4 }); await p.mouse.move(...sc(u2, v2), { steps: 4 }); await p.mouse.up(); await A.frame(); };
const fieldSet = async (loc, v) => { await loc.fill(String(v)); await loc.press("Enter"); await loc.blur(); await A.frame(); };
const radius = async (v) => { await p.keyboard.press("v"); await fieldSet(p.locator("[data-sel-radius]"), v); };
const paint = async (which, hex) => { await p.click(`[data-paint="${which}"]`); await A.setHex(hex); await A.frame(); };

// Workspace names and fonts
await p.getByTestId("workspace-nav").click();
await p.getByRole("button", { name: "More actions for board Board 1" }).last().click();
await p.getByRole("menuitem", { name: "Rename board Board 1" }).click();
await p.locator(".nav-rename").fill("canvast brand");
await p.locator(".nav-rename").press("Enter");
await p.getByRole("button", { name: "More actions for canvas Canvas 1" }).last().click();
await p.getByRole("menuitem", { name: "Rename canvas Canvas 1" }).click();
await p.locator(".nav-rename").fill("Logo and guidelines");
await p.locator(".nav-rename").press("Enter");
await A.esc();
if (await p.getByTestId("workspace-menu").isVisible()) await p.getByTestId("workspace-nav").click();
await A.loadFonts([["Space Grotesk.ttf", "SpaceGrotesk_400Regular.ttf"], ["Space Grotesk Bold.ttf", "SpaceGrotesk_700Bold.ttf"]]);

const O = { x: "0p0", y: "0p0" };
await A.cam(O, 0);
const PAGES = pages(await favPixels(p));
const centres = [];
for (let i = 0; i < PAGES.length; i++) centres.push(await A.world(VW / 2 + (i % 3) * 1800 * K, VH / 2 + Math.floor(i / 3) * 1200 * K));

const nameLayer = async (from, to) => {
  if (!(await p.getByTestId("layers-panel").isVisible())) await p.getByRole("button", { name: "Layers panel", exact: true }).click();
  await p.locator(".layer-name", { hasText: from }).first().dblclick();
  await p.locator("[data-rename]").fill(to);
  await p.keyboard.press("Enter");
  await p.getByRole("button", { name: "Layers panel", exact: true }).click();
  await A.frame();
};

// 03: the glyph on the grid, built with the Shape tool: a rounded rectangle minus the mouth and minus a slab on the right (Subtract), flattened
async function buildGlyph() {
  const g = (gx, gy) => [GRID.x + gx * GRID.u, GRID.y + gy * GRID.u];
  const px = (units) => +(units * GRID.u * K).toFixed(3);
  await p.keyboard.press("u");
  await p.click('[data-shape-kind="rect"]').catch(() => {});
  await paint("fill", C.ultra);
  await drag(g(12, 12), g(64, 52)); // the outer body, wider than the glyph
  await radius(px(12));
  await p.keyboard.press("u");
  await drag(g(22, 22), g(70, 42)); // the mouth
  await radius(px(2));
  await p.keyboard.press("u");
  await drag(g(52, 4), g(70, 60)); // the slab that squares the arms off
  await p.keyboard.press("v");
  await click(...g(16, 32), ["Shift"]);
  await click(...g(30, 32), ["Shift"]);
  log("glyph parts picked", (await A.H(() => window.__canvastDebug.selection())).length);
  await p.locator('[data-ctx="boolmenu"]').click();
  await p.locator('.pop-menu [data-id="op:subtract"]').click();
  await p.keyboard.press("Escape");
  await A.frame();
  await click(...g(16, 32));
  await p.keyboard.press("Control+e");
  await A.frame();
  await A.esc();
  // the dot
  await p.keyboard.press("u");
  await paint("fill", C.spark);
  await drag(g(37, 27), g(47, 37));
  await radius(px(2.5));
  await A.esc();
  // the numbered markers, as ellipses (Shift: round)
  await p.keyboard.press("u");
  await p.click('[data-shape-kind="ellipse"]');
  await paint("fill", C.ink);
  for (const [mx, my] of MARKERS) {
    const [cx, cy] = g(mx, my);
    await p.keyboard.down("Shift");
    await drag([cx - 15, cy - 15], [cx + 15, cy + 15]);
    await p.keyboard.up("Shift");
  }
  await p.click('[data-shape-kind="rect"]');
  await p.keyboard.press("v");
  await A.esc();
}

// 08: a white cross on each red badge, drawn with the Path tool (two clicks and Enter per stroke)
async function drawCrosses() {
  for (const [cx, cy] of MISUSE) {
    for (const [a, b] of [[[cx - 7, cy - 7], [cx + 7, cy + 7]], [[cx + 7, cy - 7], [cx - 7, cy + 7]]]) {
      await p.keyboard.press("b");
      await click(...a);
      await click(...b);
      await p.keyboard.press("Enter");
      await A.frame();
      await p.keyboard.press("v");
      const picked = await A.H(() => window.__canvastDebug.selection().length);
      if (!picked) { log("cross: nothing picked after Enter"); continue; }
      await paint("stroke", C.white);
      await p.click("[data-outline-options]");
      await fieldSet(p.locator(".outline-pop .op-width"), 3.5);
      await p.keyboard.press("Escape");
      await A.esc();
    }
  }
}

// 01: the mark inside the hero's dot at 1/64, again inside that one's dot, and so on
const DEPTH = 20;
let deep = null;
async function recurse(c) {
  await A.cam(c, 0);
  const tile = markSvg({}, 64);
  // the hero's dot centre, in page units → world
  const dotU = HERO.x + (42 / 64) * HERO.size, dotV = HERO.y + (32 / 64) * HERO.size;
  let w = await A.world(...sc(dotU, dotV));
  let L = 7; // the inner tile (6.25 units = 4.6875 px at level 0) fills 600 px at level 7
  for (let k = 0; k < DEPTH; k++) {
    await A.cam(w, L);
    await p.mouse.move(VW / 2, VH / 2);
    await A.paste(tile);
    await A.esc();
    if (k < DEPTH - 1) { w = await A.world(VW / 2 + (10 / 64) * 600, VH / 2); L += 6; }
  }
  deep = { w, L };
  await A.cam(w, L);
  await A.text(VW / 2 - 300, VH / 2 + 380, `${L} zoom levels in, and it goes on.`, 30, C.ink, FONT.b);
  await A.text(VW / 2 - 300, VH / 2 + 430, "Every point is a canvas.", 22, C.ink, FONT.r);
  await A.shot(shotPath("inside-the-dot.png"));
  await A.cam(c, 0);
}

for (const [i, pg] of PAGES.entries()) {
  const c = centres[i];
  await A.cam(c, -1);
  await p.mouse.move(VW / 2, VH / 2);
  await A.paste(pg.body);
  await A.cam(c, 0);
  await A.esc();
  if (i === 2) await buildGlyph();
  if (i === 7) await drawCrosses();
  for (const [u, v, str, size, hex, bold] of [...pg.labels].sort((m, n) => m[3] - n[3])) // (small first: a click inside a big text's box would edit it)
   await A.text(...sc(u, v), str, +(size * K).toFixed(3), hex, bold ? FONT.b : FONT.r);
  // the page becomes a sheet, named after it
  await p.keyboard.press("c");
  await drag([-0.4, -0.4], [1600.4, 1000.4]);
  await p.keyboard.press("v");
  await A.esc();
  await nameLayer(/^Sheet \d+$/, pg.name).catch((e) => log("rename failed", pg.name, String(e).slice(0, 120)));
  if (i === 0) await recurse(c);
  await A.cam(c, 0);
  await A.esc();
  await A.frame();
  await p.waitForTimeout(300);
  if (shots) await p.screenshot({ path: shotPath(`page-0${i + 1}.png`), clip: { x: VW / 2 - 600, y: VH / 2 - 375, width: 1200, height: 750 } });
  log("page", pg.name, "objects", (await A.objects()).length);
}

// Bookmarks: the pages in order, then the deepest view
const bookmark = async (name) => {
  const panel = p.locator(".bookmarks-panel");
  if (!(await panel.isVisible())) await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  await p.waitForTimeout(900);
  await p.getByRole("button", { name: "Add bookmark" }).click();
  const last = p.locator("li.bookmark .bookmark-name").last();
  await last.dblclick();
  await p.keyboard.press("Control+a");
  await p.keyboard.type(name);
  await p.keyboard.press("Enter");
  await A.frame();
};
{
  for (const [i, pg] of PAGES.entries()) { await A.cam(centres[i], 0); await bookmark(pg.name); }
  if (deep) { await A.cam(deep.w, deep.L); await bookmark("∞ Inside the dot"); }
  if (await p.locator(".bookmarks-panel").isVisible()) await p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  // the whole board in view
  await A.cam(centres[4], -2);
  await A.shot(shotPath("board-overview.png"));
}

await A.H(() => window.__canvastDebug.flushSave());
{
  await A.cam(O, 0);
  await p.getByTestId("workspace-nav").click();
  await p.getByRole("button", { name: "More actions for canvas Logo and guidelines" }).last().click();
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 180000 }), p.getByRole("menuitem", { name: "Export canvas Logo and guidelines" }).click()]);
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(await dl.path(), out);
  log("exported", dl.suggestedFilename(), "→", out);
}
log("objects", (await A.objects()).length);
await A.ctx.close();

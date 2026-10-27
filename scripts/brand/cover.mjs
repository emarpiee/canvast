// The cover at the top of the README: the wordmark and the tagline, and the logo holding itself in its dot (a speck at 1/64 of the tile) with a
// zoom cone from that speck to the same mark at full size. 1600 × 640 units, drawn at 2× for a sharp picture; the type is Space Grotesk (scripts/showcase/fonts).
// Usage: node scripts/brand/cover.mjs <out.png | out.webp>   (a .webp is converted with cwebp -q 85)
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { C, mark } from "./pages.mjs";
import { FONT_DIR } from "./lib.mjs";

const out = process.argv[2];
if (!out) { console.log("usage: node scripts/brand/cover.mjs <out.png | out.webp>"); process.exit(1); }
const W = 1600, H = 640;
const f = (n) => Math.round(n * 100) / 100;

// The logo, and the dot's centre and size (the dot is 10/64 of the tile, centred at 42/64, 32/64)
const HERO = { x: 900, y: 80, s: 380 }, LOUPE = { x: 1300, y: 380, s: 190 };
const dot = ({ x, y, s }) => ({ cx: x + (42 / 64) * s, cy: y + 0.5 * s, d: (10 / 64) * s });
const dh = dot(HERO), dl = dot(LOUPE);

// The mark again inside each dot, at 1/64 of its tile (the dot is 10/64, so the speck is a tenth of the dot); the cone runs from the corners of the
// hero's speck frame to the corners of the loupe frame, so it widens exactly as the zoom does
const speck = (dotSize) => dotSize / 10; // (1/64 of the tile is a tenth of the dot, which is 10/64)
const sh = speck(dh.d), sl = speck(dl.d);
const fh = { x0: dh.cx - sh / 2 - 4, y0: dh.cy - sh / 2 - 4, x1: dh.cx + sh / 2 + 4, y1: dh.cy + sh / 2 + 4 }; // (a little wider than the speck)
const fl = { x0: LOUPE.x - 10, y0: LOUPE.y - 10, x1: LOUPE.x + LOUPE.s + 10, y1: LOUPE.y + LOUPE.s + 10 };
const cone = [[fh.x1, fh.y0], [fl.x1, fl.y0], [fl.x0, fl.y1], [fh.x0, fh.y1]];

let grid = "";
for (let x = 0; x <= W; x += 40) grid += `<path d="M${x} 0V${H}" stroke="${x % 200 ? "#151938" : "#1C2150"}" stroke-width="1"/>`;
for (let y = 0; y <= H; y += 40) grid += `<path d="M0 ${y}H${W}" stroke="${y % 200 ? "#151938" : "#1C2150"}" stroke-width="1"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0">
<defs><radialGradient id="glow" cx="${f(HERO.x + HERO.s / 2)}" cy="${f(HERO.y + HERO.s / 2)}" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.ultra}" stop-opacity="0.34"/><stop offset="1" stop-color="${C.ultra}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="${C.ink}"/>${grid}<rect width="${W}" height="${H}" fill="url(#glow)"/>
${mark(HERO.x, HERO.y, HERO.s)}
<polygon points="${cone.map((p) => p.map(f).join(",")).join(" ")}" fill="${C.spark}" opacity="0.08"/>
<path d="M${f(fh.x1)} ${f(fh.y0)}L${f(fl.x1)} ${f(fl.y0)}M${f(fh.x0)} ${f(fh.y1)}L${f(fl.x0)} ${f(fl.y1)}" stroke="${C.spark}" stroke-width="2" opacity="0.85"/>
${mark(dh.cx - sh / 2, dh.cy - sh / 2, sh)}
<rect x="${fl.x0}" y="${fl.y0}" width="${fl.x1 - fl.x0}" height="${fl.y1 - fl.y0}" rx="26" fill="${C.ink}"/>
${mark(LOUPE.x, LOUPE.y, LOUPE.s)}${mark(dl.cx - sl / 2, dl.cy - sl / 2, sl)}
<rect x="${fl.x0}" y="${fl.y0}" width="${fl.x1 - fl.x0}" height="${fl.y1 - fl.y0}" rx="26" fill="none" stroke="${C.spark}" stroke-width="2.5"/>
</svg>`;

const chip = (t) => `<span class="chip"><i></i>${t}</span>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:SG;src:url("${pathToFileURL(join(FONT_DIR, "SpaceGrotesk_400Regular.ttf")).href}")}
@font-face{font-family:SGB;src:url("${pathToFileURL(join(FONT_DIR, "SpaceGrotesk_700Bold.ttf")).href}")}
body{margin:0;background:${C.ink}}
.t{position:absolute;white-space:pre;line-height:1}
.chip{display:inline-flex;align-items:center;gap:12px;height:52px;padding:0 22px;margin-right:14px;border:2px solid #2B3170;border-radius:26px;font:22px SG;color:${C.haze}}
.chip i{width:9px;height:9px;border-radius:2.5px;background:${C.spark}}
</style></head><body><div style="position:relative;width:${W}px;height:${H}px;overflow:hidden">${svg}
<div class="t" style="left:100px;top:122px;font:22px SGB;letter-spacing:0.16em;color:${C.spark}">OFFLINE-FIRST ENDLESS CANVAS</div>
<div class="t" style="left:94px;top:166px;font:190px SGB;letter-spacing:-0.02em;color:${C.paper}">canvast</div>
<div class="t" style="left:100px;top:392px;font:46px SG;color:${C.haze}">Every point is a canvas.</div>
<div class="t" style="left:100px;top:470px">${["One HTML file", "No account", "Works offline"].map(chip).join("")}</div>
<div class="t" style="left:${HERO.x}px;top:500px;font:32px SGB;color:${C.spark}">Zoom into the dot:</div>
<div class="t" style="left:${HERO.x}px;top:546px;font:24px SG;color:${C.haze}">the logo is there again.</div>
</div></body></html>`;

const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-cover-"));
const page = join(tmp, "cover.html");
writeFileSync(page, html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await p.goto(pathToFileURL(page).href);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(200);
mkdirSync(dirname(resolve(out)), { recursive: true });
const png = out.endsWith(".webp") ? join(tmp, "cover.png") : out;
await p.screenshot({ path: png });
await b.close();
if (png !== out) execFileSync("cwebp", ["-q", "85", "-m", "6", "-quiet", png, "-o", out]);
rmSync(tmp, { recursive: true, force: true });
console.log("cover →", out);

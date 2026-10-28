// The cover at the top of the README, drawn as a canvas in the app's default light theme: the multi-scale grid (tiers of powers of four) and the
// orange origin axes, the tile placed so its dot is the origin and picked (the selection box and its handles), the wordmark standing on the
// x axis, and the app's status bar along the bottom. One mark, no repeats. 1600 × 640 units, drawn at 2× for a sharp picture. The wordmark is
// Space Grotesk (scripts/showcase/fonts), everything else Inter, the app's own text face.
// Usage: node scripts/brand/cover.mjs <out.png | out.webp> [height]   (a .webp is converted with cwebp -q 85; height 800 makes the 2:1 social preview)
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { C, mark } from "./pages.mjs";
import { FONT_DIR } from "./lib.mjs";

const out = process.argv[2];
if (!out) { console.log("usage: node scripts/brand/cover.mjs <out.png | out.webp>"); process.exit(1); }
const W = 1600, H = +(process.argv[3] ?? 640), BAR = 44;
// The light theme's canvas tokens (src/styles.css at hue 178): --canvas-grid, --canvas-axis, --canvas-selection, --canvas-handle-fill
const T = { grid: "#667671", axis: "#C96736", sel: C.ultra, handle: "#FFFFFF" };
const O = { x: 1190, y: Math.round((H - BAR) / 2 + 20) }, S = 272; // the origin, and the tile centred on it (its dot is the origin)
const tx = O.x - S / 2, ty = O.y - S / 2;

// The multi-scale grid: every tier is four times the one below and a little stronger, all counted from the origin
let grid = "";
for (const [step, op] of [[10, 0.06], [40, 0.12], [160, 0.24]]) {
  let d = "";
  for (let x = O.x % step; x <= W; x += step) d += `M${x} 0V${H}`;
  for (let y = O.y % step; y <= H; y += step) d += `M0 ${y}H${W}`;
  grid += `<path d="${d}" stroke="${T.grid}" stroke-width="1" opacity="${op}"/>`;
}
const handles = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]
  .map(([u, v]) => `<rect x="${tx + u * S - 6}" y="${ty + v * S - 6}" width="12" height="12" rx="2" fill="${T.handle}" stroke="${T.sel}" stroke-width="1.5"/>`).join("");
const icon = (name) => readFileSync(resolve("node_modules/lucide-static/icons", `${name}.svg`), "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/class="[^"]*"/, "").replace(/width="24" height="24"/, 'width="17" height="17"');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0">
<defs><radialGradient id="fade" cx="${O.x}" cy="${O.y}" r="1150" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0.2"/></radialGradient>
<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask></defs>
<rect width="${W}" height="${H}" fill="${C.paper}"/>
<g mask="url(#m)">${grid}</g>
<path d="M0 ${O.y}H${W}M${O.x} 0V${H}" stroke="${T.axis}" stroke-width="2"/>
${mark(tx, ty, S)}
<rect x="${tx}" y="${ty}" width="${S}" height="${S}" fill="none" stroke="${T.sel}" stroke-width="1.5"/>${handles}
<text x="92" y="${O.y}" font-family="SGB" font-size="178" letter-spacing="-3" fill="${C.ink}">canvast</text>
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:SGB;src:url("${pathToFileURL(join(FONT_DIR, "SpaceGrotesk_700Bold.ttf")).href}")}
@font-face{font-family:Inter;font-weight:400;src:url("${pathToFileURL(resolve("node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf")).href}")}
@font-face{font-family:Inter;font-weight:600;src:url("${pathToFileURL(resolve("node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf")).href}")}
body{margin:0;background:${C.paper};font-family:Inter}
.t{position:absolute;white-space:pre;line-height:1.25;color:${C.ink}}
.bar{position:absolute;left:0;right:0;bottom:0;height:${BAR}px;box-sizing:border-box;padding:0 28px;display:flex;align-items:center;gap:22px;background:${C.white};border-top:1px solid rgb(23 37 34 / 0.14);font-size:15px;color:${C.muted}}
.bar b{font-weight:600;color:${C.ink}}
.bar .facts{margin-left:auto;display:flex;gap:22px}
.bar span{display:inline-flex;align-items:center;gap:7px}
.bar svg{color:${C.muted}}
</style></head><body><div style="position:relative;width:${W}px;height:${H}px;overflow:hidden">${svg}
<div class="t" style="left:100px;top:${O.y + 34}px;font-size:38px">Every point is a canvas.</div>
<div class="t" style="left:100px;top:${O.y + 96}px;font-size:21px;color:${C.muted}">An endless canvas in one file. Pan and zoom without limit,<br>draw, write, place pictures. Every position is stored exactly.</div>
<div class="t" style="left:${tx + S + 34}px;top:${ty + 6}px;font-size:18px;color:${C.muted}"><b style="font-weight:600;color:${C.ink}">The dot is the origin.</b><br>Zoom into it 10^301,030<br>times and it is still a<br>canvas you can draw on.</div>
<div class="bar"><span><b>Zoom 1×</b></span><span>Saved</span><span class="facts"><span>${icon("file-code")}One HTML file</span><span>${icon("user-round-x")}No account</span><span>${icon("wifi-off")}Works offline</span></span></div>
</div></body></html>`;

const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-cover-"));
const page = join(tmp, "cover.html");
writeFileSync(page, html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await p.goto(pathToFileURL(page).href);
await p.evaluate(() => Promise.all(["178px SGB", "16px Inter", "600 16px Inter"].map((f) => document.fonts.load(f))));
await p.waitForTimeout(200);
mkdirSync(dirname(resolve(out)), { recursive: true });
const png = out.endsWith(".webp") ? join(tmp, "cover.png") : out;
await p.screenshot({ path: png });
await b.close();
if (png !== out) execFileSync("cwebp", ["-q", "85", "-m", "6", "-quiet", png, "-o", out]);
rmSync(tmp, { recursive: true, force: true });
console.log("cover →", out);

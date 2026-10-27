// Writes the logo files from the same geometry as the brand board (pages.mjs): the SVG masters, PNGs from 16 to 512 px (the small-size
// master at 32 px and under) and a favicon.ico with 16, 32 and 48 px. Usage: node scripts/brand/icons.mjs <dir>
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { markSvg, C } from "./pages.mjs";

const dir = process.argv[2];
if (!dir) { console.log("usage: node scripts/brand/icons.mjs <dir>"); process.exit(1); }
mkdirSync(dir, { recursive: true });
const svgs = {
  "canvast-icon.svg": markSvg({}, 512),
  "canvast-favicon.svg": markSvg({ small: true }, 32),
  "canvast-mark-on-light.svg": markSvg({ tile: null, c: C.ultra }, 512),
  "canvast-mark-on-dark.svg": markSvg({ tile: null, c: C.paper }, 512),
  "canvast-mark-one-colour-ink.svg": markSvg({ tile: null, c: C.ink, dot: C.ink }, 512),
  "canvast-mark-one-colour-white.svg": markSvg({ tile: null, c: C.white, dot: C.white }, 512),
};
for (const [n, s] of Object.entries(svgs)) writeFileSync(join(dir, n), s);

const b = await chromium.launch();
const p = await b.newPage();
const png = (svg, size) => p.evaluate(async ([s, n]) => {
  const i = new Image(); i.src = "data:image/svg+xml;base64," + btoa(s); await i.decode();
  const c = document.createElement("canvas"); c.width = c.height = n; c.getContext("2d").drawImage(i, 0, 0, n, n);
  return c.toDataURL("image/png").split(",")[1];
}, [svg, size]);
const ico = [];
for (const n of [16, 32, 48, 64, 128, 180, 192, 512]) {
  const buf = Buffer.from(await png(markSvg({ small: n <= 32 }, 64), n), "base64");
  writeFileSync(join(dir, n === 180 ? "apple-touch-icon-180.png" : `canvast-icon-${n}.png`), buf);
  if (n <= 48) ico.push([n, buf]);
}
await b.close();
// favicon.ico: an ICONDIR, one 16-byte entry per size, then the PNGs
const head = Buffer.alloc(6 + 16 * ico.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(ico.length, 4);
let off = head.length;
ico.forEach(([n, d], k) => {
  const e = 6 + 16 * k;
  head.writeUInt8(n, e); head.writeUInt8(n, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(d.length, e + 8); head.writeUInt32LE(off, e + 12); off += d.length;
});
writeFileSync(join(dir, "favicon.ico"), Buffer.concat([head, ...ico.map(([, d]) => d)]));
console.log(`${Object.keys(svgs).length} SVG, 8 PNG and favicon.ico → ${dir}`);

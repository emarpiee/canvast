// A quick look at the brand pages without the app: each page's SVG with its labels laid over it in Space Grotesk, as PNGs.
// Usage: node scripts/brand/preview.mjs <dir> [pages, e.g. 1,3]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pages, markSvg } from "./pages.mjs";
import { FONT_DIR } from "./lib.mjs";

/** The 16 px favicon (the small-size master) as 256 RGBA pixels, for page 05. */
export async function favPixels(page) {
  return page.evaluate(async (s) => {
    const img = new Image(); img.src = "data:image/svg+xml;base64," + btoa(s); await img.decode();
    const c = document.createElement("canvas"); c.width = c.height = 16; const g = c.getContext("2d"); g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data, out = [];
    for (let i = 0; i < 256; i++) out.push([d[4 * i], d[4 * i + 1], d[4 * i + 2], d[4 * i + 3]]);
    return out;
  }, markSvg({ small: true }, 16));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, only] = process.argv.slice(2);
  if (!dir) { console.log("usage: node scripts/brand/preview.mjs <dir> [pages]"); process.exit(1); }
  mkdirSync(dir, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await p.setContent("<html></html>");
  const px = await favPixels(p);
  const ff = `@font-face{font-family:SG;src:url(file://${FONT_DIR}/SpaceGrotesk_400Regular.ttf)}@font-face{font-family:SGB;src:url(file://${FONT_DIR}/SpaceGrotesk_700Bold.ttf)}`;
  for (const [i, pg] of pages(px).entries()) {
    if (only && !only.split(",").includes(String(i + 1))) continue;
    // (the app puts a label's left edge at x and the middle of its capitals at y: its box is 1.8 × the size, centred on y)
    const t = pg.labels.map(([x, y, s, z, c, bold]) => `<div style="position:absolute;left:${x}px;top:${y - 0.9 * z}px;line-height:${1.8 * z}px;font:${z}px ${bold ? "SGB" : "SG"};color:${c};white-space:pre">${s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("");
    await p.goto(pathToFileURL(resolve(FONT_DIR)).href); // (a file:// page, so the fonts load)
    await p.setContent(`<html><head><style>${ff}body{margin:0}</style></head><body><div style="position:relative;width:1600px;height:1000px">${pg.body}${t}</div></body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(dir, `page-${String(i + 1).padStart(2, "0")}.png`) });
  }
  await b.close();
}

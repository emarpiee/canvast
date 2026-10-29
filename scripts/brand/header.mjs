// The README's header picture, for GitHub's dark and light themes (shown with <picture>): the logo beside the wordmark, drawn in the
// brand's own font (Space Grotesk, scripts/showcase/fonts) at twice its shown size.
//   node scripts/brand/header.mjs docs/brand/
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FONT_DIR } from "./lib.mjs";
import { C, markSvg } from "./pages.mjs";

const out = resolve(process.argv[2] ?? "docs/brand");
mkdirSync(out, { recursive: true });
const THEMES = { dark: { word: C.white }, light: { word: C.ink } };

// (inline: a page made from a string may not read files)
const font = (f) => `url(data:font/ttf;base64,${readFileSync(join(FONT_DIR, f)).toString("base64")})`;
const fonts = `@font-face{font-family:SGB;src:${font("SpaceGrotesk_700Bold.ttf")}}`;
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
/** A transparent PNG of `html`, cut to the element #shot. */
async function shot(html, file) {
  await page.setContent(`<!doctype html><style>${fonts}html,body{margin:0;background:transparent}#shot{display:inline-flex;align-items:center}</style>${html}`);
  await page.evaluate(async () => { await document.fonts.load("96px SGB"); await document.fonts.ready; });
  await page.locator("#shot").screenshot({ path: join(out, file), omitBackground: true });
  console.log(`${join(out, file)}`);
}
for (const [name, t] of Object.entries(THEMES)) {
  // The logo, full colour (its tile and dot are the same in both themes), and the wordmark in the theme's text colour
  await shot(`<div id="shot" style="gap:28px;padding:8px 12px">${markSvg({}, 128)}<span style="font:96px/1 SGB;color:${t.word};letter-spacing:-0.02em;padding-bottom:10px">canvast</span></div>`, `header-logo-${name}.png`);
}
await browser.close();

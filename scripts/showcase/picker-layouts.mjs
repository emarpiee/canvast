// The pictures of the colour package (src/colour-picker/docs/): the four layouts (layouts.png) and light and dark (themes.png), made from the built package.
// Run from the repo root after `npm run build:picker`: node scripts/showcase/picker-layouts.mjs <outDir>
import { chromium } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? ".");
const dir = mkdtempSync(join(tmpdir(), "cv-layouts-"));
const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#eef1f3;font-family:system-ui,sans-serif"><main id="m" style="display:flex;gap:32px;align-items:flex-start;justify-content:center;padding:56px 24px;width:1132px"></main>
<script src="file://${resolve("dist-picker/colour-picker.js")}"></script>
<script>
const set = [
  { view: "wheel", model: "okhsv" },
  { view: "plane", model: "okhsl" },
  { view: "sliders", model: "okhsv", groups: [{ label: "Presets", colours: ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"] }] },
  { view: "mixer", model: "okhsv", harmony: ["triad"] },
];
for (const o of set) document.getElementById("m").append(ColourPicker.createColourPicker({ value: "#c12c6c80", alpha: true, contrast: "#ffffff", ...o }).el);
</script>`;
writeFileSync(join(dir, "layouts.html"), page);
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1180, height: 640 }, colorScheme: "light" });
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await p.goto("file://" + join(dir, "layouts.html"));
await p.waitForTimeout(500);
await p.screenshot({ path: join(outDir, "layouts.png") });
// Light and dark, side by side, each chosen by `theme` (so the picture does not depend on this machine's setting)
const themes = `<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;font-family:system-ui,sans-serif"><div id="l" style="background:#eef1f3;padding:40px 48px 36px"></div><div id="d" style="background:#14171b;padding:40px 48px 36px"></div>
<script src="file://${resolve("dist-picker/colour-picker.js")}"></script>
<script>
for (const [id, theme] of [["l", "light"], ["d", "dark"]]) document.getElementById(id).append(ColourPicker.createColourPicker({ value: "#c12c6c80", alpha: true, contrast: "#ffffff", view: "mixer", theme, groups: [{ label: "Presets", colours: ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"] }] }).el);
</script>`;
writeFileSync(join(dir, "themes.html"), themes);
const t = await browser.newPage({ viewport: { width: 656, height: 616 } });
await t.goto("file://" + join(dir, "themes.html"));
await t.waitForTimeout(500);
await t.screenshot({ path: join(outDir, "themes.png"), fullPage: true });
await browser.close();
console.log("wrote", outDir);

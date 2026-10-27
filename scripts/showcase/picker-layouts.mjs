// The picture of the colour package's four layouts (src/colour-picker/docs/layouts.png), made from the built package.
// Run from the repo root after `npm run build:picker`: node scripts/showcase/picker-layouts.mjs <out.png>
import { chromium } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] ?? "layouts.png");
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
await p.screenshot({ path: out });
await browser.close();
console.log("wrote", out);

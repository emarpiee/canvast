// Builds the colour picker on its own, to prove it works outside canvast and to ship it as a file:
//   node scripts/build-picker.mjs  -> dist-picker/colour-picker.js (ESM) and dist-picker/demo.html (opens from file://)
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const out = outArg >= 0 ? resolve(process.argv[outArg + 1]) : resolve(root, "dist-picker"); // (--out: a test snapshot builds its own copy)
await mkdir(out, { recursive: true });
const r = await build({ entryPoints: [resolve(root, "src/colour-picker/index.ts")], bundle: true, format: "iife", globalName: "ColourPicker", target: ["es2020"], minify: true, write: false, logLevel: "warning" });
const js = r.outputFiles[0].text;
await writeFile(resolve(out, "colour-picker.js"), js);
const demo = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Colour picker</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;font-family:system-ui,sans-serif;background:#eef1f3;color:#1f2329}main{display:flex;gap:32px;align-items:flex-start;padding:24px}#swatch{width:160px;height:160px;border-radius:12px;box-shadow:0 0 0 1px rgba(0,0,0,.15);background-image:conic-gradient(#d5d9dd 25%,#fff 0 50%,#d5d9dd 0 75%,#fff 0);background-size:16px 16px}#swatch i{display:block;height:100%;border-radius:inherit}#out{font:13px ui-monospace,monospace;margin-top:8px}@media(prefers-color-scheme:dark){body{background:#14171a;color:#e8eaed}}</style>
<main><div><div id="swatch"><i id="fill"></i></div><div id="out"></div></div><div id="host"></div><div id="ghost"></div></main>
<script src="colour-picker.js"></script>
<script>
const swatch = document.getElementById("swatch"), out = document.getElementById("out");
const show = (hex) => { document.getElementById("fill").style.background = hex; out.textContent = hex; };
const p = window.picker = ColourPicker.createColourPicker({ value: "#2563eb", alpha: true, contrast: "#ffffff", harmony: ["complementary", "triad"], groups: [{ label: "Presets", colours: ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#111827", "#ffffff"] }], onInput: show });
document.getElementById("host").append(p.el);
window.gradient = ColourPicker.createGradientEditor({ value: { type: "linear", angle: 90, cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, colour: "#2563eb" }, { offset: 1, colour: "#2563eb00" }] }, picker: { view: "sliders" }, onInput: (v) => { window.gradientEvents = (window.gradientEvents || 0) + 1; } });
document.getElementById("ghost").append(window.gradient.el);
show(p.value);
</script></html>`;
await writeFile(resolve(out, "demo.html"), demo);
console.log("dist-picker/colour-picker.js", Math.round(js.length / 1024) + " KiB");

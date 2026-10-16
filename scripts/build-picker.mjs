// Builds the colour picker on its own, to prove it works outside canvast and to ship it as a file:
//   node scripts/build-picker.mjs  -> dist-picker/colour-picker.js (ESM) and dist-picker/demo.html (opens from file://)
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist-picker");
await mkdir(out, { recursive: true });
const r = await build({ entryPoints: [resolve(root, "src/colour-picker/index.ts")], bundle: true, format: "iife", globalName: "ColourPicker", target: ["es2020"], minify: true, write: false, logLevel: "warning" });
const js = r.outputFiles[0].text;
await writeFile(resolve(out, "colour-picker.js"), js);
const demo = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Colour picker</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;font-family:system-ui,sans-serif;background:#eef1f3;color:#1f2329}main{display:flex;gap:32px;align-items:flex-start;padding:24px}#swatch{width:160px;height:160px;border-radius:12px;box-shadow:0 0 0 1px rgba(0,0,0,.15)}#out{font:13px ui-monospace,monospace;margin-top:8px}@media(prefers-color-scheme:dark){body{background:#14171a;color:#e8eaed}}</style>
<main><div><div id="swatch"></div><div id="out"></div></div><div id="host"></div></main>
<script src="colour-picker.js"></script>
<script>
const swatch = document.getElementById("swatch"), out = document.getElementById("out");
const show = (hex) => { swatch.style.background = hex; out.textContent = hex; };
const p = ColourPicker.createColourPicker({ value: "#2563eb", groups: [{ label: "Presets", colours: ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#111827", "#ffffff"] }], onInput: show });
document.getElementById("host").append(p.el);
show(p.value);
</script></html>`;
await writeFile(resolve(out, "demo.html"), demo);
console.log("dist-picker/colour-picker.js", Math.round(js.length / 1024) + " KiB");

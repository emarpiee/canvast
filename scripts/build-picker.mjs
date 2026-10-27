// Builds the colour picker on its own, to prove it works outside canvast and to ship it as a file:
//   node scripts/build-picker.mjs  -> dist-picker/colour-picker.js (ESM) and dist-picker/demo.html (opens from file://)
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const out = outArg >= 0 ? resolve(process.argv[outArg + 1]) : resolve(root, "dist-picker"); // (--out: a test snapshot builds its own copy)
await mkdir(out, { recursive: true });
const r = await build({ entryPoints: [resolve(root, "src/colour-picker/index.ts")], bundle: true, format: "iife", globalName: "ColourPicker", target: ["es2020"], minify: true, write: false, banner: { js: `/*!\n${(await readFile(resolve(root, "src/colour-picker/LICENSE"), "utf8")).replace(/\*\//g, "* /").trim()}\n*/` }, // (the licences travel in the file)
   logLevel: "warning" });
const js = r.outputFiles[0].text;
await writeFile(resolve(out, "colour-picker.js"), js);
const demo = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Colour picker</title>
<style>:root{--bg:#eef1f3;--fg:#1f2329;--line:rgba(31,35,41,.18);--chip:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#14171a;--fg:#e8eaed;--line:rgba(232,234,237,.22);--chip:#1d2126}}
:root[data-cp-theme=light]{--bg:#eef1f3;--fg:#1f2329;--line:rgba(31,35,41,.18);--chip:#fff;color-scheme:light}
:root[data-cp-theme=dark]{--bg:#14171a;--fg:#e8eaed;--line:rgba(232,234,237,.22);--chip:#1d2126;color-scheme:dark}
body{margin:0;display:grid;place-items:center;min-height:100vh;font-family:system-ui,sans-serif;background:var(--bg);color:var(--fg)}main{display:flex;gap:32px;align-items:flex-start;padding:24px}
#swatch{width:160px;height:160px;border-radius:12px;box-shadow:0 0 0 1px var(--line);background-image:conic-gradient(#d5d9dd 25%,#fff 0 50%,#d5d9dd 0 75%,#fff 0);background-size:16px 16px}#swatch i{display:block;height:100%;border-radius:inherit}#out{font:13px ui-monospace,monospace;margin-top:8px}
#theme{position:fixed;top:12px;right:12px;display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--chip);box-shadow:0 0 0 1px var(--line)}#theme button{font:13px system-ui,sans-serif;color:inherit;background:none;border:0;border-radius:6px;padding:5px 12px;cursor:pointer}#theme button[aria-pressed=true]{background:#2563eb;color:#fff}#theme button:focus-visible{outline:2px solid #2563eb;outline-offset:1px}</style>
<div id="theme" role="group" aria-label="Theme"><button type="button" data-t="auto">Auto</button><button type="button" data-t="light">Light</button><button type="button" data-t="dark">Dark</button></div>
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
// Light, dark, or the system's: data-cp-theme on the page is all the picker and the gradient editor need (ColourPicker's theme option does the same for one)
const setTheme = (t) => {
  if (t === "auto") delete document.documentElement.dataset.cpTheme; else document.documentElement.dataset.cpTheme = t;
  for (const b of document.querySelectorAll("#theme button")) b.setAttribute("aria-pressed", String(b.dataset.t === t));
  try { localStorage.setItem("colour-picker-demo-theme", t); } catch {}
};
document.getElementById("theme").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setTheme(b.dataset.t); });
let saved = "auto"; try { saved = localStorage.getItem("colour-picker-demo-theme") || "auto"; } catch {}
setTheme(["light", "dark"].includes(saved) ? saved : "auto");
</script></html>`;
await writeFile(resolve(out, "demo.html"), demo);
console.log("dist-picker/colour-picker.js", Math.round(js.length / 1024) + " KiB");

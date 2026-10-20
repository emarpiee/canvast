// Builds the pattern generators on their own, to prove they work outside canvast and to ship them as files:
//   node scripts/build-patterns.mjs -> dist-patterns/canvast-patterns.js (script, global CanvastPatterns), canvast-patterns.mjs (ES module),
//                                      types/ (declarations) and demo.html (opens from file://)
import { build } from "esbuild";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const out = outArg >= 0 ? resolve(process.argv[outArg + 1]) : resolve(root, "dist-patterns"); // (--out: a test snapshot builds its own copy)
await mkdir(out, { recursive: true });
const entry = resolve(root, "src/gen/index.ts");
const common = { entryPoints: [entry], bundle: true, target: ["es2020"], minify: true, write: false, logLevel: "warning" };
const iife = (await build({ ...common, format: "iife", globalName: "CanvastPatterns" })).outputFiles[0].text;
const esm = (await build({ ...common, format: "esm" })).outputFiles[0].text;
await writeFile(resolve(out, "canvast-patterns.js"), iife);
await writeFile(resolve(out, "canvast-patterns.mjs"), esm);

// declarations, so the package is typed when it is published (a failure here is a warning: the files above are complete)
await rm(resolve(out, "types"), { recursive: true, force: true });
const dts = spawnSync("npx", ["tsc", entry, "--declaration", "--emitDeclarationOnly", "--outDir", resolve(out, "types"), "--target", "es2020", "--module", "esnext", "--moduleResolution", "bundler", "--strict", "--skipLibCheck", "--noUncheckedIndexedAccess", "--ignoreConfig"], { cwd: root, encoding: "utf8" });
if (dts.status !== 0) console.warn("warning: declarations were not written\n" + (dts.stdout || dts.stderr).slice(0, 600));

const demo = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pattern generators</title>
<style>
:root{color-scheme:light dark;--bg:#eef1f3;--fg:#1f2329;--card:#fff;--line:#c9ced3;--accent:#0d7d6c}
@media(prefers-color-scheme:dark){:root{--bg:#14171a;--fg:#e8eaed;--card:#1d2125;--line:#3a4048;--accent:#38b7a4}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif}
main{display:grid;grid-template-columns:minmax(0,1fr) 20rem;gap:16px;padding:16px;max-width:1200px;margin:0 auto}
@media(max-width:800px){main{grid-template-columns:1fr}}
h1{font-size:18px;margin:0 0 12px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin:16px 0 8px;opacity:.7}
#big{background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;aspect-ratio:3/2}#big svg{display:block;width:100%;height:100%}
#gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(8rem,1fr));gap:8px}
.card{display:grid;gap:4px;padding:4px;background:var(--card);border:1px solid var(--line);border-radius:8px;cursor:pointer;color:inherit;font:inherit;text-align:center}
.card[aria-pressed=true]{border-color:var(--accent);outline:1px solid var(--accent)}.card .t{aspect-ratio:3/2;overflow:hidden;border-radius:4px}.card svg{display:block;width:100%;height:100%}
aside{display:grid;gap:8px;align-content:start}label.row{display:grid;grid-template-columns:7rem 1fr 3rem;gap:8px;align-items:center}
label.row span:last-child{text-align:right;opacity:.7}button,select,input[type=number]{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 8px}
button{cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.bar{display:flex;gap:8px;flex-wrap:wrap}
</style>
<main><div><h1>Pattern generators</h1><div id="big"></div><div class="bar" style="margin-top:8px"><button id="random" class="primary">Randomize</button><button id="newseed">New seed</button><label>Seed <input id="seed" type="number" min="1" max="999999" value="7"></label><a id="download" download="pattern.svg"><button>Download SVG</button></a></div><h2>Generators</h2><div id="gallery"></div></div><aside><h2>Settings</h2><div id="settings"></div></aside></main>
<script src="canvast-patterns.js"></script>
<script>
const P = CanvastPatterns, W = 900, H = 600;
const big = document.getElementById("big"), seedBox = document.getElementById("seed"), settings = document.getElementById("settings"), gallery = document.getElementById("gallery"), dl = document.getElementById("download");
let gen = P.GENERATORS[0], values = P.defaultValues(gen), seed = 7;
const draw = () => {
  const svg = P.toSvg(P.generate(gen, values, seed, W, H), W, H, { idPrefix: "big" });
  big.innerHTML = svg;
  dl.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  window.lastSvg = svg;
};
const form = () => {
  settings.innerHTML = "";
  for (const sec of P.sectionsOf(gen)) {
    const h = document.createElement("h2"); h.textContent = sec.title; settings.append(h);
    for (const s of sec.items) {
      const row = document.createElement("label"); row.className = "row"; row.dataset.key = s.k;
      const name = document.createElement("span"); name.textContent = s.label; row.append(name);
      let input, out = document.createElement("span");
      if (s.t === "range") { input = Object.assign(document.createElement("input"), { type: "range", min: s.min, max: s.max, step: s.step, value: values[s.k] }); out.textContent = values[s.k]; input.oninput = () => { values[s.k] = Number(input.value); out.textContent = input.value; draw(); }; }
      else if (s.t === "toggle") { input = Object.assign(document.createElement("input"), { type: "checkbox", checked: values[s.k] }); input.onchange = () => { values[s.k] = input.checked; draw(); }; }
      else if (s.t === "choice") { input = document.createElement("select"); for (const [v, l] of s.opts) input.append(new Option(l, v)); input.value = values[s.k]; input.onchange = () => { values[s.k] = input.value; draw(); }; }
      else { input = Object.assign(document.createElement("input"), { type: "color", value: values[s.k] || s.def }); input.oninput = () => { values[s.k] = input.value; draw(); }; }
      row.append(input, out); settings.append(row);
    }
  }
};
const choose = (g) => { gen = g; values = P.defaultValues(g); for (const c of gallery.children) c.setAttribute("aria-pressed", String(c.dataset.id === g.id)); form(); draw(); };
for (const g of P.GENERATORS) {
  const card = document.createElement("button"); card.className = "card"; card.dataset.id = g.id; card.title = g.about;
  card.innerHTML = '<span class="t">' + P.toSvg(P.generate(g, P.defaultValues(g), 7, 150, 100), 150, 100, { idPrefix: "t-" + g.id + "-", fit: "xMidYMid slice" }) + "</span><span>" + g.label + "</span>";
  card.onclick = () => choose(g); gallery.append(card);
}
seedBox.onchange = () => { seed = Math.max(1, Math.min(999999, Math.round(Number(seedBox.value)) || 1)); draw(); };
document.getElementById("newseed").onclick = () => { seed = 1 + Math.floor(Math.random() * 999999); seedBox.value = seed; draw(); };
document.getElementById("random").onclick = () => { seed = 1 + Math.floor(Math.random() * 999999); seedBox.value = seed; values = P.randomValues(gen, P.makeRng(seed)); form(); draw(); };
choose(gen);
</script></html>`;
await writeFile(resolve(out, "demo.html"), demo);
console.log("dist-patterns/canvast-patterns.js", Math.round(iife.length / 1024) + " KiB (script),", Math.round(esm.length / 1024) + " KiB (module)");

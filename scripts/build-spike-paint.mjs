// SPIKE build (P0 of the Painting view): dist-spike/paint.html with the brush engine's two builds inlined (run
// scripts/build-engine.mjs --spike first). The app's CSP plus 'wasm-unsafe-eval'. Never writes dist/.
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const b64 = async (f) => JSON.stringify((await readFile(resolve(root, "dist-spike", f))).toString("base64"));
const r = await build({
  entryPoints: [resolve(root, "src/spike/paint/main.ts")],
  bundle: true,
  format: "iife",
  target: ["es2022"],
  write: false,
  logLevel: "warning",
  define: { WASM: `{"release":${await b64("brush.wasm")},"small":${await b64("brush-small.wasm")},"simd":${await b64("brush-simd.wasm")}}` },
});
const script = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>canvast spike: brush engine</title></head><body><script>${script}</script></body></html>`;
await writeFile(resolve(root, "dist-spike/paint.html"), html);
console.log(`dist-spike/paint.html  ${(html.length / 1024).toFixed(1)} KiB`);

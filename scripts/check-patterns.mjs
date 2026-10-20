// The pattern generators must stay usable outside canvast (src/gen/README.md): no file in src/gen may import from outside its folder, and none
// may touch the page (document, window, localStorage...), so they run in Node, a worker or a server as they do in a browser.
import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/gen");
let bad = 0;
for (const f of await readdir(dir)) {
  if (!f.endsWith(".ts")) continue;
  const src = await readFile(resolve(dir, f), "utf8");
  for (const m of [...src.matchAll(/^\s*(?:import|export)\b[^;\n]*?\bfrom\s+["']([^"']+)["']/gm), ...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)]) {
    if (!m[1].startsWith("./")) {
      bad++;
      console.error(`FAIL patterns: ${f} imports "${m[1]}"; the generators may import only files in their own folder.`);
    }
  }
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const m of code.matchAll(/\b(document|window|localStorage|sessionStorage|navigator|HTMLElement|requestAnimationFrame)\b/g)) {
    bad++;
    console.error(`FAIL patterns: ${f} uses "${m[1]}"; the generators must not touch the page.`);
  }
}
if (bad) process.exit(1);
console.log("PASS patterns: imports stay inside src/gen and nothing touches the page");

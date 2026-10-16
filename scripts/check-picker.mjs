// The colour picker must stay usable outside canvast (src/colour-picker/README.md): no file in it may import from outside its folder.
import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/colour-picker");
let bad = 0;
for (const f of await readdir(dir)) {
  if (!f.endsWith(".ts")) continue;
  const src = await readFile(resolve(dir, f), "utf8");
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    if (!m[1].startsWith("./")) {
      bad++;
      console.error(`FAIL picker: ${f} imports "${m[1]}"; the picker may import only files in its own folder.`);
    }
  }
}
if (bad) process.exit(1);
console.log("PASS picker: imports stay inside src/colour-picker");

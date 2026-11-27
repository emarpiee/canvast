// The Markdown editor must stay usable outside canvast (src/markdown-editor/README.md): no file in it (its behaviours/ too) may import from
// outside its folder, except the CodeMirror and Lezer packages it is built on and its optional Vim keys.
import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/markdown-editor");
const files = async (d) => (await Promise.all((await readdir(d, { withFileTypes: true })).map((e) => (e.isDirectory() ? files(resolve(d, e.name)) : e.name.endsWith(".ts") ? [resolve(d, e.name)] : [])))).flat();
let bad = 0;
for (const f of await files(dir)) {
  const src = await readFile(f, "utf8");
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const spec = m[1];
    const inside = spec.startsWith(".") && !relative(dir, resolve(dirname(f), spec)).startsWith("..");
    if (!inside && !/^@(codemirror|lezer)\/|^@replit\/codemirror-vim$/.test(spec)) {
      bad++;
      console.error(`FAIL markdown-editor: ${relative(dir, f).split(sep).join("/")} imports "${spec}"; it may import only its own folder and @codemirror/ or @lezer/ packages.`);
    }
  }
}
if (bad) process.exit(1);
console.log("PASS markdown-editor: imports stay inside src/markdown-editor (and CodeMirror, Lezer)");

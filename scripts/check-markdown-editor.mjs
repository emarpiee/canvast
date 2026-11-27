// The Markdown editor must stay usable outside canvast (src/markdown-editor/README.md): no file in it may import from outside its folder,
// except the CodeMirror and Lezer packages it is built on.
import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/markdown-editor");
let bad = 0;
for (const f of await readdir(dir)) {
  if (!f.endsWith(".ts")) continue;
  const src = await readFile(resolve(dir, f), "utf8");
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    if (!m[1].startsWith("./") && !/^@(codemirror|lezer)\/|^@replit\/codemirror-vim$/.test(m[1])) {
      bad++;
      console.error(`FAIL markdown-editor: ${f} imports "${m[1]}"; it may import only files in its own folder and @codemirror/ or @lezer/ packages.`);
    }
  }
}
if (bad) process.exit(1);
console.log("PASS markdown-editor: imports stay inside src/markdown-editor (and CodeMirror, Lezer)");

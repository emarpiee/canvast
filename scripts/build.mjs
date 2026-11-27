// Builds the single self-contained HTML file. No runtime fetches, no dev server.
//   node scripts/build.mjs [--out <dir>]  -> <dir>/canvast.html (default dist/) and <dir>/build.json: what it was made from (source hash, git head), to compare builds
//   (developer tools are a setting: Settings > Develop, or #debug)
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sourceHash } from "./lib/source-hash.mjs";
import { photocraftBlock } from "./artcraft/photocraft/package.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

const result = await build({
  entryPoints: [resolve(root, "src/app/main.ts")],
  bundle: true,
  format: "iife",
  target: ["es2020"],
  platform: "browser",
  minify: !process.argv.includes("--no-minify"), // (--no-minify: readable names in an error, for finding one)
  sourcemap: false,
  legalComments: "eof",
  write: false,
  define: {
    __CANVAST_VERSION__: JSON.stringify(pkg.version),
    "import.meta.url": '""', // (only in pdf.js' branch for Node)
  },
  loader: { ".svg": "text", ".ttf": "binary", ".woff2": "binary", ".md": "text", ".wasm": "binary" },
  // pdf.js' worker, as the text of a plain script: a page opened from a file cannot start a module worker in every browser.
  plugins: [{
    name: "pdf-worker",
    setup(b) {
      // The model reader's worker likewise: three.js' file readers, off the page.
      b.onResolve({ filter: /^virtual:model-worker$/ }, () => ({ path: resolve(root, "src/assets/model-worker.ts"), namespace: "model-worker" }));
      b.onLoad({ filter: /./, namespace: "model-worker" }, async (args) => {
        const r = await build({ entryPoints: [args.path], bundle: true, format: "iife", target: ["es2020"], minify: true, write: false, legalComments: "none", define: { "import.meta.url": '""' }, logLevel: "error" });
        return { contents: r.outputFiles[0].text, loader: "text" };
      });
      b.onLoad({ filter: /pdf\.worker\.min\.mjs$/ }, async (args) => {
        const r = await build({ entryPoints: [args.path], bundle: true, format: "iife", target: ["es2020"], minify: true, write: false, legalComments: "none", define: { "import.meta.url": '""' }, logLevel: "error" });
        return { contents: r.outputFiles[0].text, loader: "text" };
      });
    },
  }],
  logLevel: "warning",
});

// (Mermaid's grammar lists another product's name as a keyword, in a quoted string: written with its first letter escaped, it reads the
// same to the browser and the built file names no other product, as check:names requires)
const script = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--").replace(/"value":"(f)(igma)"/g, '"value":"\\u0066$2"');
// KaTeX's stylesheet for math in notes, without its @font-face rules: its fonts are registered from bytes in the file (src/notes/math.ts).
const katexCss = (await readFile(resolve(root, "node_modules/katex/dist/katex.min.css"), "utf8")).replace(/@font-face\{[^}]*\}/g, "");
const styles = `${await readFile(resolve(root, "src/styles.css"), "utf8")}\n${katexCss}`;
const template = await readFile(resolve(root, "src/index.html"), "utf8");
// Third-party notices travel inside the single file (Lucide icons are ISC, Inter is OFL-1.1).
const pkgOf = async (name) => JSON.parse(await readFile(resolve(root, "node_modules", name, "package.json"), "utf8"));
const licence = async (path) => (await readFile(resolve(root, "node_modules", path), "utf8")).replace(/--/g, "- -").trim();
const lucide = await pkgOf("lucide-static");
const inter = await pkgOf("@expo-google-fonts/inter");
const cm = await pkgOf("@codemirror/view");
const lezer = await pkgOf("@lezer/markdown");
const katexPkg = await pkgOf("katex");
const mermaidPkg = await pkgOf("mermaid");
const vimPkg = await pkgOf("@replit/codemirror-vim");
const pdfjs = await pkgOf("pdfjs-dist");
const threejs = await pkgOf("three");
// PhotoCraft's released web build (scripts/artcraft/photocraft/): an inert data block, read only when PhotoCraft is first opened.
const photocraft = await photocraftBlock(root);
const own = (await readFile(resolve(root, "LICENSE"), "utf8")).replace(/--/g, "- -").trim(); // (canvast's own licence, the GNU GPL v3, travels in the file too)
const notices =
  `<!--\ncanvast, copyright (C) 2026 emarpiee. Free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. Source: https://github.com/emarpiee/canvast\n\n${own}\n-->\n<!--\nThird-party notices\n\nLucide icons (lucide-static ${lucide.version})\n${await licence("lucide-static/LICENSE")}\n\n` +
  `Inter Regular font (@expo-google-fonts/inter ${inter.version}, Inter_400Regular.ttf, unmodified)\n${await licence("@expo-google-fonts/inter/LICENSE_FONT")}\n\n` +
  `CodeMirror (@codemirror/view ${cm.version} and its packages) and Lezer (@lezer/markdown ${lezer.version}), the notes editor's text view and Markdown reader\n${await licence("@codemirror/view/LICENSE")}\n\n` +
  `KaTeX (katex ${katexPkg.version}, math in notes, with its fonts)\n${await licence("katex/LICENSE")}\n\n` +
  `Mermaid (mermaid ${mermaidPkg.version}, diagrams in notes)\n${await licence("mermaid/LICENSE")}\n\n` +
  `codemirror-vim (@replit/codemirror-vim ${vimPkg.version}, Vim keys in notes)\n${await licence("@replit/codemirror-vim/LICENSE")}\n\n` +
  `pdf.js (pdfjs-dist ${pdfjs.version}, draws PDFs), Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0\n\n` +
  `three.js (three ${threejs.version}, draws 3D models)\n${await licence("three/LICENSE")}\n` +
  (photocraft ? `\nPhotoCraft ${photocraft.version} (its released web build, unmodified; the photo editor opened from canvast), MIT OR Apache-2.0\n${photocraft.notice.replace(/--/g, "- -")}\n` : "") +
  `-->\n`;
const html = template
  .replaceAll("__CANVAST_VERSION__", pkg.version)
  .replace("/*__CANVAST_STYLES__*/", () => styles)
  .replace("/*__CANVAST_SCRIPT__*/", () => script)
  .replace("<!--__PHOTOCRAFT__-->", () => photocraft?.html ?? "")
  .replace("<html", () => `${notices}<html`);

const outDir = resolve(root, process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "dist");
const out = resolve(outDir, "canvast.html");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
const digest = createHash("sha256").update(html).digest("hex");
const git = (c) => { try { return execSync(`git ${c}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
const src = await sourceHash(root);
await writeFile(resolve(outDir, "build.json"), JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString(), gitHead: git("rev-parse --short HEAD"), dirty: git("status --porcelain -- src package.json") !== "", srcHash: src.srcHash, htmlSha256: digest, files: src.files }, null, 1));
console.log(`${out.slice(root.length + 1)}  ${(html.length / 1024).toFixed(1)} KiB  sha256 ${digest}`);

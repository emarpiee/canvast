// Builds the single self-contained HTML file. No runtime fetches, no dev server.
//   node scripts/build.mjs --mode=production   -> dist/canvast.html
//   node scripts/build.mjs --mode=debug        -> dist/canvast-debug.html
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = (process.argv.find((a) => a.startsWith("--mode=")) ?? "--mode=production").slice(7);
if (mode !== "production" && mode !== "debug") throw new Error(`unknown mode ${mode}`);
const debug = mode === "debug";
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

const result = await build({
  entryPoints: [resolve(root, "src/app/main.ts")],
  bundle: true,
  format: "iife",
  target: ["es2020"],
  platform: "browser",
  minify: !debug,
  sourcemap: debug ? "inline" : false,
  legalComments: "eof",
  write: false,
  define: {
    __CANVAST_DEBUG__: JSON.stringify(debug),
    __CANVAST_VERSION__: JSON.stringify(pkg.version),
  },
  loader: { ".svg": "text", ".ttf": "binary" },
  logLevel: "warning",
});

// The note editor (ADR 0032) ships as inert text and is only run when the first note opens.
const sun = await build({
  entryPoints: [resolve(root, "scripts/sun-entry.js")],
  bundle: true,
  format: "iife",
  target: ["es2020"],
  platform: "browser",
  minify: true,
  write: false,
  loader: { ".svg": "text", ".css": "text" },
  logLevel: "warning",
});
const inert = (t) => t.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const sunJs = inert(sun.outputFiles[0].text);
const sunCss = inert(await readFile(resolve(root, "node_modules/suneditor/dist/suneditor.min.css"), "utf8"));

const script = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
const template = await readFile(resolve(root, "src/index.html"), "utf8");
// Third-party notices travel inside the single file (Lucide icons are ISC, Inter is OFL-1.1).
const pkgOf = async (name) => JSON.parse(await readFile(resolve(root, "node_modules", name, "package.json"), "utf8"));
const licence = async (path) => (await readFile(resolve(root, "node_modules", path), "utf8")).replace(/--/g, "- -").trim();
const lucide = await pkgOf("lucide-static");
const inter = await pkgOf("@expo-google-fonts/inter");
const notices =
  `<!--\nThird-party notices\n\nLucide icons (lucide-static ${lucide.version})\n${await licence("lucide-static/LICENSE")}\n\n` +
  `SunEditor (suneditor ${(await pkgOf("suneditor")).version}, note editor)\n${await licence("suneditor/LICENSE.txt")}\n\n` +
  `Inter Regular font (@expo-google-fonts/inter ${inter.version}, Inter_400Regular.ttf, unmodified)\n${await licence("@expo-google-fonts/inter/LICENSE_FONT")}\n-->\n`;
const html = template
  .replaceAll("__CANVAST_VERSION__", pkg.version)
  .replace("/*__CANVAST_STYLES__*/", () => styles)
  .replace("/*__CANVAST_SCRIPT__*/", () => script)
  .replace("/*__CANVAST_SUN_JS__*/", () => sunJs)
  .replace("/*__CANVAST_SUN_CSS__*/", () => sunCss)
  .replace("<html", () => `${notices}<html`);

const out = resolve(root, "dist", debug ? "canvast-debug.html" : "canvast.html");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
const digest = createHash("sha256").update(html).digest("hex");
console.log(`${out.slice(root.length + 1)}  ${(html.length / 1024).toFixed(1)} KiB  sha256 ${digest}`);

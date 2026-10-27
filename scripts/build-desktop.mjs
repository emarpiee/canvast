// Builds the desktop shell (ADR 0177) into dist-desktop/: the main process, the preload bridge and a copy of the
// single-file app (dist/canvast.html, built first by `npm run build`), so `electron dist-desktop` runs on its own.
//   node scripts/build-desktop.mjs [--html <path>] [--out <dir>]   (default dist/canvast.html into dist-desktop/)
import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const opt = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return resolve(root, at > 0 ? process.argv[at + 1] : fallback);
};
const out = opt("--out", "dist-desktop");
const html = opt("--html", "dist/canvast.html");
if (!existsSync(html)) {
  console.error(`missing ${html}: run npm run build first`);
  process.exit(1);
}
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

await mkdir(out, { recursive: true });
const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "warning" };
await build({ ...common, entryPoints: [resolve(root, "desktop/main.ts")], outfile: resolve(out, "main.cjs") });
await build({ ...common, entryPoints: [resolve(root, "desktop/preload.ts")], outfile: resolve(out, "preload.cjs") });
await copyFile(html, resolve(out, "canvast.html"));
await writeFile(resolve(out, "package.json"), JSON.stringify({ name: "canvast", productName: "canvast", version: pkg.version, main: "main.cjs", private: true }, null, 2));
console.log(`${out.replace(root + "/", "")}/ (main.cjs, preload.cjs, canvast.html from ${html.replace(root + "/", "")})`);

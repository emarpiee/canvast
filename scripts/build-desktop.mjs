// Builds the desktop shell (ADR 0177) into dist-desktop/: the main process, the preload bridge and a copy of the
// single-file app (dist/canvast.html, built first by `npm run build`), so `electron dist-desktop` runs on its own.
//   node scripts/build-desktop.mjs [--html <path>] [--out <dir>]   (default dist/canvast.html into dist-desktop/)
import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
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
// better-sqlite3 ships a ready-made N-API binary per platform (no rebuild for Electron): bundle the entry for this machine and
// copy its .node next to main.cjs and require it from there (package-desktop unpacks it from the asar).
const sqlite = resolve(root, `node_modules/better-sqlite3/lib/${process.platform}-${process.arch}.js`);
if (!existsSync(sqlite)) {
  console.error(`no better-sqlite3 binary for ${process.platform}-${process.arch}`);
  process.exit(1);
}
const nativeAddon = {
  name: "native-addon",
  setup(b) {
    b.onResolve({ filter: /\.node$/ }, async (a) => {
      const file = resolve(a.resolveDir, a.path);
      await copyFile(file, resolve(out, basename(file)));
      return { path: `./${basename(file)}`, external: true };
    });
  },
};
const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], alias: { "better-sqlite3": sqlite }, plugins: [nativeAddon], logLevel: "warning" };
await build({ ...common, entryPoints: [resolve(root, "desktop/main.ts")], outfile: resolve(out, "main.cjs") });
await build({ ...common, entryPoints: [resolve(root, "desktop/preload.ts")], outfile: resolve(out, "preload.cjs") });
await copyFile(html, resolve(out, "canvast.html"));
await writeFile(resolve(out, "package.json"), JSON.stringify({ name: "canvast", productName: "canvast", desktopName: "canvast.desktop", version: pkg.version, main: "main.cjs", private: true }, null, 2));
console.log(`${out.replace(root + "/", "")}/ (main.cjs, preload.cjs, canvast.html from ${html.replace(root + "/", "")})`);

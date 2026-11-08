// Build the standalone tools into one file, dist-tools/canvast-tools.mjs (Node.js 20 or later, nothing else): the tools' own code
// with the app's folder sharing and certificate, so the two never drift apart. Released beside canvast.html.
import { build } from "esbuild";
import { chmodSync, readFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const out = "dist-tools/canvast-tools.mjs";
await build({
  entryPoints: ["scripts/tools/canvast-tools.mjs"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: out,
  // (the entry's own #! line is kept by esbuild)
  banner: { js: `// canvast tools ${version}: built from the canvast repository (scripts/tools/canvast-tools.mjs). GPL-3.0-or-later.` },
  logLevel: "warning",
});
chmodSync(out, 0o755);
console.log(`${out} (${version})`);

// Where each test snapshot stands against the source and against `dist/` (the build the owner tests by hand).
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changedFiles, sourceHash } from "./lib/source-hash.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (p) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; } };
const now = await sourceHash(root);
const dist = await json(resolve(root, "dist", "build.json"));
console.log(`source ${now.srcHash.slice(0, 8)}   dist ${dist ? `${dist.srcHash.slice(0, 8)} (${dist.srcHash === now.srcHash ? "current" : `${changedFiles(dist.files, now.files).length} files behind the source`}, built ${dist.builtAt})` : "none"}`);
let names = [];
try { names = (await readdir(resolve(root, "test-builds"))).sort().reverse(); } catch { /* none yet */ }
if (!names.length) console.log("no test snapshots (npm run test:snap)");
for (const n of names) {
  const b = await json(resolve(root, "test-builds", n, "build.json"));
  const r = await json(resolve(root, "test-builds", n, "run.json"));
  if (!b) continue;
  const vsSource = b.srcHash === now.srcHash ? "= source" : `${changedFiles(b.files, now.files).length} files behind the source`;
  const vsDist = dist ? (b.srcHash === dist.srcHash ? "= dist" : `${changedFiles(b.files, dist.files).length} files differ from dist`) : "";
  console.log(`${n}  ${r?.status ?? "?"} ${r?.counts ? JSON.stringify(r.counts) : ""}  ${vsSource}; ${vsDist}  [${r?.args?.join(" ") ?? ""}]`);
}

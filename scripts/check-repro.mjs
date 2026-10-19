// Reproducible-build check (Phase 9): the committed source, cloned twice into different directories and built under different time zones and
// locales from the locked dependencies (`npm ci`), must give the same `canvast.html`, byte for byte. Needs the network once (npm ci); it is not part of
// `npm test`. Also fails if a dependency is not pinned to an exact version. Builds the last COMMIT: commit first, a dirty tree is reported.
//   node scripts/check-repro.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const loose = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => !/^\d+\.\d+\.\d+$/.test(v));
if (loose.length) {
  console.error(`FAIL repro: not pinned to an exact version: ${loose.map(([n, v]) => `${n}@${v}`).join(", ")}`);
  process.exit(1);
}
const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "package.json", "package-lock.json", "scripts"], { cwd: root, encoding: "utf8" }).trim();
if (dirty) console.log(`note: uncommitted changes are NOT in this check (it builds HEAD):\n${dirty}`);

const base = mkdtempSync(resolve(tmpdir(), "canvast-repro-"));
const runs = [
  { dir: resolve(base, "a"), env: { TZ: "Asia/Manila", LANG: "C" } },
  { dir: resolve(base, "deeper", "path", "b"), env: { TZ: "America/New_York", LANG: "de_DE.UTF-8" } },
];
const hashes = [];
try {
  for (const r of runs) {
    mkdirSync(dirname(r.dir), { recursive: true });
    execFileSync("git", ["clone", "-q", root, r.dir], { stdio: "inherit" });
    execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: r.dir, stdio: "ignore" });
    execFileSync("node", ["scripts/build.mjs", "--out", "out"], { cwd: r.dir, env: { ...process.env, ...r.env }, stdio: "ignore" });
    const h = createHash("sha256").update(readFileSync(resolve(r.dir, "out", "canvast.html"))).digest("hex");
    hashes.push(h);
    console.log(`${r.dir.slice(base.length)}  ${r.env.TZ}  ${h}`);
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}
if (hashes[0] !== hashes[1]) {
  console.error("FAIL repro: the two builds differ");
  process.exit(1);
}
console.log(`PASS repro: two clean builds of ${execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim()} are identical (${hashes[0].slice(0, 12)})`);

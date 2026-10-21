// What a build was made from: the hash of every file under src/ plus package.json, so a build and the source can be compared without git.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function walk(dir, out) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

/** { files: { "src/x.ts": sha1... }, srcHash } for the repo at `root`. */
export async function sourceHash(root) {
  // (and the brush engine's wrapper: it is compiled into the file too, ADR 0164)
  const engine = ["engine/Cargo.toml", "engine/Cargo.lock"].map((f) => resolve(root, f));
  const paths = (await walk(resolve(root, "src"), [])).concat(await walk(resolve(root, "engine/src"), []), await walk(resolve(root, "engine/patches"), []), engine, resolve(root, "package.json")).sort();
  const files = {};
  for (const p of paths) files[p.slice(root.length + 1)] = createHash("sha1").update(await readFile(p)).digest("hex");
  const srcHash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return { files, srcHash };
}

/** The files that differ between two `files` maps (added, removed or changed). */
export function changedFiles(a, b) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
}

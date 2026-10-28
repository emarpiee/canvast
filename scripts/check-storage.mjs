// Storage boundary (ADR 0177): the app reaches storage only through the interfaces of src/storage/store.ts, so the browser
// build (IndexedDB) and the desktop build (a workspace folder) share every line above them. IndexedDB may be named only in the
// files that implement the browser build's storage, plus two that only look at it from outside.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const IMPLEMENTATION = [
  "src/storage/idb.ts",
  "src/storage/idb-storage.ts",
  "src/storage/workspace-repo.ts",
  "src/storage/archive.ts",
  "src/storage/files-zip.ts",
  "src/storage/external-folder.ts",
  "src/storage/folder-move.ts",
  "src/storage/migrate-v1.ts",
  "src/storage/reset.ts",
  "src/storage/workspace-mirror.ts", // the desktop build writes the workspace folder from the IndexedDB journal
  "src/storage/library-mirror.ts", // and the library, with each original in its place
  "src/assets/asset-catalog.ts",
];
const OUTSIDE = [
  "src/app/debug-hook.ts", // the #debug test hook reads and seeds stores directly
  "src/app/diagnostics.ts", // reports whether the browser has IndexedDB at all
];
const allowed = new Set([...IMPLEMENTATION, ...OUTSIDE]);
const pattern = /\bIDB[A-Z]\w*|\bindexedDB\b|["'](?:\.\.\/storage|\.)\/idb["']/;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".ts") && !allowed.has(f));
const hits = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  text.split("\n").forEach((line, i) => {
    if (pattern.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
  });
}
if (hits.length) {
  console.error(`FAIL storage boundary: IndexedDB used outside the storage implementation (go through src/storage/store.ts)\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`PASS storage boundary: ${files.length} files reach storage only through its interfaces`);

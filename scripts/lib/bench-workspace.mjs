// A workspace folder of N library files, as another device would have made it (the files in library/<folder>/, the library index in
// parts), for the benchmarks and stress runs that open it in the desktop app. Each file's bytes are its own text, so its hash is known.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Make `dir` afresh with `n` files, `perFolder` to a folder. `nest`: every folder but each `nest`-th sits inside the one before it
 * (library/a/b/c/…), to stand for folders inside folders. Returns the items (hash, file, name, folderId) and the folders.
 */
export function makeWorkspace(dir, n, { perFolder = 1000, nest = 0 } = {}) {
  rmSync(dir, { recursive: true, force: true });
  const folders = [];
  const pathOf = new Map();
  const items = [];
  const parts = new Map();
  for (let i = 0; i < n; i++) {
    const f = Math.floor(i / perFolder);
    const folderId = `f${String(f).padStart(5, "0")}`;
    if (i % perFolder === 0) {
      const name = `bench_${String(f).padStart(5, "0")}`;
      const parentId = nest && f % nest !== 0 ? folders[f - 1].id : null;
      folders.push({ id: folderId, name, parentId });
      pathOf.set(folderId, parentId ? `${pathOf.get(parentId)}/${name}` : name);
      mkdirSync(join(dir, "library", pathOf.get(folderId)), { recursive: true });
    }
    const name = `b${String(i).padStart(7, "0")}.png`;
    const bytes = Buffer.from(`canvast bench item ${i}\n`);
    const file = `library/${pathOf.get(folderId)}/${name}`;
    writeFileSync(join(dir, file), bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const item = { hash, file, name, type: "image/png", size: bytes.length, pixelW: 1, pixelH: 1, importedAt: 1_700_000_000_000 + i, tags: [], favorite: false, folderId, note: "", fields: [], state: "active" };
    items.push(item);
    (parts.get(hash[0]) ?? parts.set(hash[0], []).get(hash[0])).push(item);
  }
  mkdirSync(join(dir, ".canvast/library"), { recursive: true });
  for (const [k, list] of parts) writeFileSync(join(dir, `.canvast/library/items-${k}.json`), `{"format":"canvast-library-items","version":2,\n"items":[\n${list.map((i) => JSON.stringify(i)).join(",\n")}\n]}\n`);
  writeFileSync(join(dir, ".canvast/library/index.json"), `${JSON.stringify({ format: "canvast-library", version: 2, folders, parts: [...parts.keys()].sort() })}\n`);
  return { items, folders };
}

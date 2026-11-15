// A workspace folder of N library files, as another device would have made it (the files in library/<folder>/, the library index in
// parts), for the benchmarks and stress runs that open it in the desktop app. Each file's bytes are its own text, so its hash is known.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type, "latin1"), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
/** A small picture of its own for item `i`: a gradient in a colour of its own, in one of a few shapes (wide, square, tall), so its bytes and so its hash are its own. */
export function benchPicture(i) {
  const [w, h] = [[240, 160], [200, 200], [160, 240], [280, 150]][i % 4];
  const hue = (i * 137.5) % 360, f = (n, k = (n + hue / 30) % 12) => 0.6 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  const [r, g, b] = [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1), shade = 0.55 + 0.45 * (y / h);
    for (let x = 0; x < w; x++) { const q = o + 1 + x * 3, d = ((x ^ y ^ i) & 15) - 8; raw[q] = Math.max(0, Math.min(255, r * shade + d)); raw[q + 1] = Math.max(0, Math.min(255, g * shade + d)); raw[q + 2] = Math.max(0, Math.min(255, b * shade + d)); }
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return { bytes: Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]), w, h };
}

/**
 * Make `dir` afresh with `n` files, `perFolder` to a folder. `nest`: every folder but each `nest`-th sits inside the one before it
 * (library/a/b/c/…), to stand for folders inside folders. `pictures`: each file a real small PNG (benchPicture), for what draws
 * thumbnails. Returns the items (hash, file, name, folderId) and the folders.
 */
export function makeWorkspace(dir, n, { perFolder = 1000, nest = 0, pictures = false } = {}) {
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
    const pic = pictures ? benchPicture(i) : null;
    const bytes = pic ? pic.bytes : Buffer.from(`canvast bench item ${i}\n`);
    const file = `library/${pathOf.get(folderId)}/${name}`;
    writeFileSync(join(dir, file), bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const item = { hash, file, name, type: "image/png", size: bytes.length, pixelW: pic ? pic.w : 1, pixelH: pic ? pic.h : 1, importedAt: 1_700_000_000_000 + i, tags: [], favorite: false, folderId, note: "", fields: [], state: "active" };
    items.push(item);
    (parts.get(hash[0]) ?? parts.set(hash[0], []).get(hash[0])).push(item);
  }
  mkdirSync(join(dir, ".canvast/library"), { recursive: true });
  for (const [k, list] of parts) writeFileSync(join(dir, `.canvast/library/items-${k}.json`), `{"format":"canvast-library-items","version":2,\n"items":[\n${list.map((i) => JSON.stringify(i)).join(",\n")}\n]}\n`);
  writeFileSync(join(dir, ".canvast/library/index.json"), `${JSON.stringify({ format: "canvast-library", version: 2, folders, parts: [...parts.keys()].sort() })}\n`);
  return { items, folders };
}

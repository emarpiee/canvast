/**
 * Pictures art files keep inside themselves: read, never written, and no art program needed. Each reader checks its file's signature and every offset; whatever does not
 * add up gives null, and the library shows its usual tile. The pictures found are decoded only by the browser's own image decoder.
 */

import { externalFolder, type FileParts } from "../storage/external-folder";

/** The extensions that may hold a picture. */
const ART = /\.(kra|ora|psd|psb|procreate|sketch|fig|figcraft|clip)~?$/i;
export const isArtFile = (name: string): boolean => ART.test(name);
/** The name a backup copy (`a.kra~`) is the copy of: it is the same kind of file. */
const kindName = (name: string): string => name.trim().replace(/~$/, "");

/** Most a picture inside a file may take once unpacked: a small file must not become a huge one in memory. */
const MAX_UNPACKED = 256 * 1024 * 1024;
/** Most pixels of a merged picture that are kept: a bigger one is reduced as it is read, so its size costs time, not memory. */
const MAX_PIXELS = 64_000_000;
/** The longest side a canvas takes, and the longest a Photoshop file has. */
const MAX_EDGE = 16384;
const MAX_SIDE = 300_000;
/** How much of a file is held at a time. */
const WINDOW = 16 * 1024 * 1024;
/** Most of a Clip Studio file's database that is looked through. */
const MAX_DATABASE = 512 * 1024 * 1024;

/** What the readers take: a Blob, or a file too big to read into the page, read a part at a time. */
export type ArtFile = Blob | FileParts;

const bytesOf = async (file: ArtFile, from: number, to: number): Promise<Uint8Array> => {
  if (file instanceof Blob) return new Uint8Array(await file.slice(from, to).arrayBuffer());
  const end = Math.min(to, file.size);
  if (end - from <= WINDOW) return from < end ? file.part(from, end) : new Uint8Array(0);
  const out = new Uint8Array(end - from);
  for (let at = from; at < end; at += WINDOW) out.set(await file.part(at, Math.min(end, at + WINDOW)), at - from);
  return out;
};
const textAt = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));

/** A part of a file as a stream, a window at a time. */
const streamOf = (file: ArtFile, from: number, to: number): ReadableStream<Uint8Array<ArrayBuffer>> => {
  let at = from;
  return new ReadableStream({
    async pull(c) {
      const b = at < to ? await bytesOf(file, at, Math.min(to, at + WINDOW)) : new Uint8Array(0);
      if (!b.length) return c.close();
      at += b.length;
      c.enqueue(b as Uint8Array<ArrayBuffer>);
    },
  });
};

/** A ZIP's central directory, also of a file past 4 GiB (ZIP64). */
async function zipDirectory(file: ArtFile): Promise<{ start: number; size: number } | null> {
  const n = file.size;
  if (n < 22) return null;
  const from = Math.max(0, n - 22 - 0xffff);
  const tail = await bytesOf(file, from, n);
  const v = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  const size = v.getUint32(end + 12, true);
  const start = v.getUint32(end + 16, true);
  if (start !== 0xffffffff && size !== 0xffffffff) return { start, size };
  if (end < 20 || v.getUint32(end - 20, true) !== 0x07064b50) return null;
  const at = Number(v.getBigUint64(end - 12, true));
  const big = await bytesOf(file, at, at + 56);
  if (big.length < 56) return null;
  const b = new DataView(big.buffer, big.byteOffset, 56);
  return b.getUint32(0, true) === 0x06064b50 ? { start: Number(b.getBigUint64(48, true)), size: Number(b.getBigUint64(40, true)) } : null;
}

/** The first of these names a ZIP has that can be read: a look through its central directory, and only what is asked for is read. One too big gives way to the next. */
async function zipEntry(file: ArtFile, want: readonly string[]): Promise<Blob | null> {
  const place = await zipDirectory(file);
  if (!place || place.start + place.size > file.size || place.size > MAX_UNPACKED) return null;
  const dir = await bytesOf(file, place.start, place.start + place.size);
  const d = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const lower = want.map((w) => w.toLowerCase());
  const found: Array<{ rank: number; method: number; csize: number; usize: number; at: number }> = [];
  for (let p = 0; p + 46 <= dir.length && d.getUint32(p, true) === 0x02014b50; ) {
    const nameLen = d.getUint16(p + 28, true);
    const extraLen = d.getUint16(p + 30, true);
    const name = new TextDecoder().decode(dir.subarray(p + 46, p + 46 + nameLen)).toLowerCase();
    const rank = lower.indexOf(name);
    if (rank >= 0) {
      let usize = d.getUint32(p + 24, true);
      let csize = d.getUint32(p + 20, true);
      let at = d.getUint32(p + 42, true);
      // (past 4 GiB the real numbers are in its ZIP64 extra field, each only if it is needed)
      for (let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen && x + 4 <= dir.length; ) {
        const id = d.getUint16(x, true);
        const len = d.getUint16(x + 2, true);
        if (id === 1 && x + 4 + len <= dir.length) {
          let q = x + 4;
          const next = (): number => ((q += 8), Number(d.getBigUint64(q - 8, true)));
          if (usize === 0xffffffff && q + 8 <= x + 4 + len) usize = next();
          if (csize === 0xffffffff && q + 8 <= x + 4 + len) csize = next();
          if (at === 0xffffffff && q + 8 <= x + 4 + len) at = next();
        }
        x += 4 + len;
      }
      found.push({ rank, method: d.getUint16(p + 10, true), csize, usize, at });
    }
    p += 46 + nameLen + extraLen + d.getUint16(p + 32, true);
  }
  for (const e of found.sort((a, b) => a.rank - b.rank)) {
    const got = await zipUnpack(file, e).catch(() => null);
    if (got) return got;
  }
  return null;
}

async function zipUnpack(file: ArtFile, e: { method: number; csize: number; usize: number; at: number }): Promise<Blob | null> {
  if (e.usize > MAX_UNPACKED || e.csize > MAX_UNPACKED || e.at + 30 > file.size) return null;
  const head = await bytesOf(file, e.at, e.at + 30);
  const h = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (h.getUint32(0, true) !== 0x04034b50) return null;
  const dataAt = e.at + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  if (dataAt + e.csize > file.size) return null;
  if (e.method === 0) return new Blob([(await bytesOf(file, dataAt, dataAt + e.csize)) as BlobPart]);
  if (e.method !== 8) return null;
  // (unpacked with a limit: what a file says of its own size is not taken on trust)
  const reader = streamOf(file, dataAt, dataAt + e.csize).pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNPACKED) return void (await reader.cancel().catch(() => undefined)), null;
    parts.push(value);
  }
  return new Blob(parts as BlobPart[]);
}

/** Where each ZIP-based kind keeps its picture, the best first. */
const IN_ZIP: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\.(kra|ora)$/i, ["mergedimage.png", "preview.png", "Thumbnails/thumbnail.png"]],
  [/\.procreate$/i, ["QuickLook/Thumbnail.png"]],
  [/\.sketch$/i, ["previews/preview.png"]],
  [/\.(fig|figcraft)$/i, ["thumbnail.png"]],
];

interface PsdHead {
  big: boolean;
  channels: number;
  h: number;
  w: number;
  depth: number;
  mode: number;
  resourcesAt: number;
  resourcesLen: number;
}
async function psdHead(file: ArtFile): Promise<PsdHead | null> {
  const b = await bytesOf(file, 0, 34);
  if (b.length < 34 || textAt(b, 0, 4) !== "8BPS") return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = v.getUint16(4);
  if (version !== 1 && version !== 2) return null;
  const colourLen = v.getUint32(26);
  const lenAt = 30 + colourLen;
  if (lenAt + 4 > file.size) return null;
  const l = await bytesOf(file, lenAt, lenAt + 4);
  const resourcesLen = new DataView(l.buffer, l.byteOffset, 4).getUint32(0);
  if (lenAt + 4 + resourcesLen > file.size) return null;
  return { big: version === 2, channels: v.getUint16(12), h: v.getUint32(14), w: v.getUint32(18), depth: v.getUint16(22), mode: v.getUint16(24), resourcesAt: lenAt + 4, resourcesLen };
}

/** A Photoshop file's own thumbnail: a JPEG among its image resources. */
async function psdThumbnail(file: ArtFile): Promise<Blob | null> {
  const head = await psdHead(file);
  if (!head || head.resourcesLen > 64 * 1024 * 1024) return null;
  const r = await bytesOf(file, head.resourcesAt, head.resourcesAt + head.resourcesLen);
  const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
  for (let p = 0; p + 12 <= r.length; ) {
    if (textAt(r, p, 4) !== "8BIM") return null;
    const id = v.getUint16(p + 4);
    let q = p + 6;
    q += (r[q]! + 2) & ~1; // (a name, padded to even)
    if (q + 4 > r.length) return null;
    const size = v.getUint32(q);
    q += 4;
    if (q + size > r.length) return null;
    if ((id === 1036 || id === 1033) && size > 28) return new Blob([r.slice(q + 28, q + size)], { type: "image/jpeg" });
    p = q + ((size + 1) & ~1);
  }
  return null;
}

/**
 * A Photoshop file's merged picture, when it is one this can read (8 bits, RGB or grey): its pixels. Null otherwise (saved without it, 16 bits, CMYK...).
 * Read a window at a time and reduced as it is read when it is past `maxPixels`, so a file of any size takes the same memory; `w` and `h` are what was kept.
 */
export async function psdPixels(file: ArtFile, maxPixels = MAX_PIXELS): Promise<{ w: number; h: number; rgba: Uint8ClampedArray<ArrayBuffer> } | null> {
  const head = await psdHead(file);
  if (!head) return null;
  const { w, h, channels, depth, mode } = head;
  if (depth !== 8 || (mode !== 3 && mode !== 1) || !w || !h || w > MAX_SIDE || h > MAX_SIDE || !channels) return null;
  let at = head.resourcesAt + head.resourcesLen;
  const lenBytes = head.big ? 8 : 4;
  const lenB = await bytesOf(file, at, at + lenBytes);
  if (lenB.length < lenBytes) return null;
  const lv = new DataView(lenB.buffer, lenB.byteOffset, lenBytes);
  at += lenBytes + (head.big ? Number(lv.getBigUint64(0)) : lv.getUint32(0));
  if (at + 2 > file.size) return null;
  const first = await bytesOf(file, at, at + 2);
  const compression = (first[0]! << 8) | first[1]!;
  if (compression !== 0 && compression !== 1) return null;
  const planes = mode === 3 ? Math.min(channels, 4) : Math.min(channels, 2);
  if (mode === 3 && channels < 3) return null;
  let pos = at + 2;
  if (compression === 1) pos += h * channels * (head.big ? 4 : 2);
  // (what it says of itself is checked against what is there before anything is made: at least two bytes for 128 pixels, so the work follows the file's size)
  const least = compression === 0 ? w * h * planes : Math.ceil(w / 128) * 2 * h * planes;
  if (pos + least > file.size) return null;
  const scale = Math.max(1, Math.ceil(Math.sqrt((w * h) / maxPixels)), Math.ceil(Math.max(w, h) / MAX_EDGE));
  const outW = Math.ceil(w / scale);
  const outH = Math.ceil(h / scale);
  const rgba = new Uint8ClampedArray(outW * outH * 4).fill(255) as Uint8ClampedArray<ArrayBuffer>;
  const longest = compression === 0 ? w : 2 * w; // (the most bytes a row can take)
  let buf: Uint8Array = new Uint8Array(0);
  let bufAt = pos;
  const row = new Uint8Array(w);
  const sum = new Uint32Array(outW);
  for (let c = 0; c < planes; c++) {
    let rows = 0;
    for (let y = 0; y < h; y++) {
      if (pos + longest > bufAt + buf.length && bufAt + buf.length < file.size) {
        buf = await bytesOf(file, pos, Math.min(file.size, pos + Math.max(WINDOW, longest)));
        bufAt = pos;
      }
      let p = pos - bufAt;
      if (compression === 0) {
        if (p + w > buf.length) return null;
        row.set(buf.subarray(p, p + w));
        p += w;
      } else {
        for (let x = 0; x < w; ) {
          if (p >= buf.length) return null;
          const n = (buf[p++]! << 24) >> 24;
          if (n >= 0) {
            if (p + n + 1 > buf.length || x + n + 1 > w) return null;
            row.set(buf.subarray(p, p + n + 1), x);
            p += n + 1;
            x += n + 1;
          } else if (n !== -128) {
            const run = 1 - n;
            if (p >= buf.length || x + run > w) return null;
            row.fill(buf[p++]!, x, x + run);
            x += run;
          }
        }
      }
      pos = bufAt + p;
      for (let x = 0; x < w; x++) sum[Math.floor(x / scale)]! += row[x]!;
      rows++;
      if (rows < scale && y < h - 1) continue;
      // (a whole block of rows read: its pixels are their average)
      const start = Math.floor(y / scale) * outW * 4;
      for (let x = 0; x < outW; x++) {
        const value = Math.round(sum[x]! / (rows * (x < outW - 1 ? scale : w - x * scale)));
        const i = start + x * 4;
        if (mode === 3) rgba[i + c] = value;
        else if (c === 0) rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
        else rgba[i + 3] = value;
      }
      sum.fill(0);
      rows = 0;
    }
  }
  return { w: outW, h: outH, rgba };
}

/** A SQLite record's whole payload at a table leaf's cell, its overflow pages followed. */
function sqlitePayload(db: Uint8Array, pageSize: number, usable: number, cellAt: number, pageEnd: number): Uint8Array | null {
  let p = cellAt;
  const varint = (): number => {
    let out = 0;
    for (let i = 0; i < 9; i++) {
      const b = db[p++];
      if (b === undefined) return -1;
      if (i === 8) return out * 256 + b;
      out = out * 128 + (b & 0x7f);
      if (b < 128) return out;
    }
    return out;
  };
  const size = varint();
  varint(); // (its row)
  if (size < 0 || size > MAX_UNPACKED) return null;
  const most = usable - 35;
  let local = size;
  if (size > most) {
    const least = Math.floor(((usable - 12) * 32) / 255) - 23;
    local = least + ((size - least) % (usable - 4));
    if (local > most) local = least;
  }
  if (p + local > pageEnd) return null;
  const out = new Uint8Array(size);
  out.set(db.subarray(p, p + local));
  let filled = local;
  if (filled < size) {
    const v = new DataView(db.buffer, db.byteOffset, db.byteLength);
    let next = v.getUint32(p + local);
    for (let guard = 0; next && filled < size && guard < 1_000_000; guard++) {
      const at = (next - 1) * pageSize;
      if (at + usable > db.length) return null;
      const take = Math.min(usable - 4, size - filled);
      out.set(db.subarray(at + 4, at + 4 + take), filled);
      filled += take;
      next = v.getUint32(at);
    }
    if (filled < size) return null;
  }
  return out;
}

/** The first whole PNG in these bytes. */
function pngIn(b: Uint8Array): Blob | null {
  for (let i = 0; i + 8 < b.length; i++) {
    if (b[i] !== 0x89 || b[i + 1] !== 0x50 || b[i + 2] !== 0x4e || b[i + 3] !== 0x47) continue;
    for (let j = i + 8; j + 8 <= b.length; j++) {
      if (b[j] === 0x49 && b[j + 1] === 0x45 && b[j + 2] === 0x4e && b[j + 3] === 0x44) return new Blob([b.slice(i, j + 8)], { type: "image/png" });
    }
    return null;
  }
  return null;
}

/** A Clip Studio file's preview: a PNG in a row of the SQLite database it holds as a chunk; the biggest such row, read as a table's leaf pages say. */
async function clipPreview(file: ArtFile): Promise<Blob | null> {
  const head = await bytesOf(file, 0, 24);
  if (head.length < 24 || textAt(head, 0, 8) !== "CSFCHUNK") return null;
  for (let at = 24; at + 16 <= file.size; ) {
    const c = await bytesOf(file, at, at + 16);
    if (textAt(c, 0, 4) !== "CHNK") return null;
    const size = Number(new DataView(c.buffer, c.byteOffset, 16).getBigUint64(8));
    if (at + 16 + size > file.size) return null;
    if (textAt(c, 4, 4) === "SQLi") {
      if (size > MAX_DATABASE) return null;
      const db = await bytesOf(file, at + 16, at + 16 + size);
      if (textAt(db, 0, 15) !== "SQLite format 3") return null;
      const v = new DataView(db.buffer, db.byteOffset, db.byteLength);
      const raw = v.getUint16(16);
      const pageSize = raw === 1 ? 65536 : raw;
      if (pageSize < 512 || pageSize % 2) return null;
      const usable = pageSize - db[20]!;
      let best: Blob | null = null;
      for (let page = 0; (page + 1) * pageSize <= db.length; page++) {
        const start = page * pageSize;
        const hdr = page === 0 ? start + 100 : start;
        if (db[hdr] !== 13) continue;
        const cells = v.getUint16(hdr + 3);
        for (let i = 0; i < cells; i++) {
          const pointer = hdr + 8 + i * 2;
          if (pointer + 2 > start + pageSize) break;
          const cell = start + v.getUint16(pointer);
          if (cell >= start + pageSize) continue;
          const row = sqlitePayload(db, pageSize, usable, cell, start + pageSize);
          const png = row && pngIn(row);
          if (png && (!best || png.size > best.size)) best = png;
        }
      }
      return best;
    }
    at += 16 + size;
  }
  return null;
}

/** The ready-made picture an art file keeps, encoded, or null. Quick: what a thumbnail is made from. */
export async function artPicture(file: ArtFile, name: string): Promise<Blob | null> {
  const kind = kindName(name);
  try {
    for (const [zip, names] of IN_ZIP) if (zip.test(kind)) return await zipEntry(file, names);
    if (/\.(psd|psb)$/i.test(kind)) return await psdThumbnail(file);
    if (/\.clip$/i.test(kind)) return await clipPreview(file);
  } catch {
    // (not what its name says, or damaged: its tile)
  }
  return null;
}

/** The picture for a thumbnail or a card: the ready-made one, else the merged one. */
export const artCardPicture = async (file: ArtFile, name: string): Promise<Blob | null> => (await artPicture(file, name)) ?? (await artFullPicture(file, name));

/** The largest picture an art file gives, for the viewer, encoded; a Photoshop file's merged one when it can be read, else what `artPicture` finds. */
export async function artFullPicture(file: ArtFile, name: string): Promise<Blob | null> {
  if (/\.(psd|psb)$/i.test(kindName(name))) {
    const px = await psdPixels(file).catch(() => null);
    if (px) {
      const c = document.createElement("canvas");
      c.width = px.w;
      c.height = px.h;
      c.getContext("2d")!.putImageData(new ImageData(px.rgba, px.w, px.h), 0, 0);
      const made = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (made) return made;
    }
  }
  return artPicture(file, name);
}

/** Where an item's art file is read from: its bytes, or, too big to be read into the page, its file on disk. */
export const artFileOf = async (rec: { hash: string; size: number; file?: string; blob: Blob }): Promise<ArtFile> => (rec.blob.size || !rec.size ? rec.blob : ((await externalFolder.parts(rec.hash, rec.size, rec.file)) ?? rec.blob));

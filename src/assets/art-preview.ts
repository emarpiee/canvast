/**
 * Pictures art files keep inside themselves: read, never written, and no art program needed. Each reader checks its file's signature and every offset; whatever does not
 * add up gives null, and the library shows its usual tile. The pictures found are decoded only by the browser's own image decoder.
 */

/** The extensions that may hold a picture. */
const ART = /\.(kra|ora|psd|psb|procreate|sketch|fig|clip)$/i;
export const isArtFile = (name: string): boolean => ART.test(name);

/** Most a picture inside a file may take once unpacked: a small file must not become a huge one in memory. */
const MAX_UNPACKED = 256 * 1024 * 1024;
const MAX_PIXELS = 64_000_000;
/** Most of a Clip Studio file's database that is looked through. */
const MAX_DATABASE = 512 * 1024 * 1024;

const bytesOf = async (file: Blob, from: number, to: number): Promise<Uint8Array> => new Uint8Array(await file.slice(from, to).arrayBuffer());
const textAt = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));

/** A file's entries in a ZIP, by name, as a look through its central directory: only what is asked for is read. */
async function zipEntry(file: Blob, want: readonly string[]): Promise<Blob | null> {
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
  if (start === 0xffffffff || start + size > n) return null;
  const dir = await bytesOf(file, start, start + size);
  const d = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const lower = want.map((w) => w.toLowerCase());
  const found: Array<{ rank: number; method: number; csize: number; usize: number; at: number }> = [];
  for (let p = 0; p + 46 <= dir.length && d.getUint32(p, true) === 0x02014b50; ) {
    const nameLen = d.getUint16(p + 28, true);
    const name = new TextDecoder().decode(dir.subarray(p + 46, p + 46 + nameLen)).toLowerCase();
    const rank = lower.indexOf(name);
    if (rank >= 0) found.push({ rank, method: d.getUint16(p + 10, true), csize: d.getUint32(p + 20, true), usize: d.getUint32(p + 24, true), at: d.getUint32(p + 42, true) });
    p += 46 + nameLen + d.getUint16(p + 30, true) + d.getUint16(p + 32, true);
  }
  const e = found.sort((a, b) => a.rank - b.rank)[0];
  if (!e || e.usize > MAX_UNPACKED || e.at + 30 > n) return null;
  const head = await bytesOf(file, e.at, e.at + 30);
  const h = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (h.getUint32(0, true) !== 0x04034b50) return null;
  const dataAt = e.at + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  if (dataAt + e.csize > n) return null;
  const packed = file.slice(dataAt, dataAt + e.csize);
  if (e.method === 0) return packed;
  if (e.method !== 8) return null;
  // (unpacked with a limit: what a file says of its own size is not taken on trust)
  const reader = packed.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
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
  [/\.fig$/i, ["thumbnail.png"]],
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
async function psdHead(file: Blob): Promise<PsdHead | null> {
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
async function psdThumbnail(file: Blob): Promise<Blob | null> {
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

/** A Photoshop file's merged picture, when it is one this can read (8 bits, RGB or grey): its pixels. Null otherwise (saved without it, 16 bits, CMYK...). */
export async function psdPixels(file: Blob): Promise<{ w: number; h: number; rgba: Uint8ClampedArray<ArrayBuffer> } | null> {
  const head = await psdHead(file);
  if (!head) return null;
  const { w, h, channels, depth, mode } = head;
  if (depth !== 8 || (mode !== 3 && mode !== 1) || !w || !h || w * h > MAX_PIXELS || !channels) return null;
  let at = head.resourcesAt + head.resourcesLen;
  const lenBytes = head.big ? 8 : 4;
  const lenB = await bytesOf(file, at, at + lenBytes);
  if (lenB.length < lenBytes) return null;
  const lv = new DataView(lenB.buffer, lenB.byteOffset, lenBytes);
  at += lenBytes + (head.big ? Number(lv.getBigUint64(0)) : lv.getUint32(0));
  if (at + 2 > file.size) return null;
  const data = await bytesOf(file, at, Math.min(file.size, at + MAX_UNPACKED));
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const compression = d.getUint16(0);
  if (compression !== 0 && compression !== 1) return null;
  const planes = mode === 3 ? Math.min(channels, 4) : Math.min(channels, 2);
  if (mode === 3 && channels < 3) return null;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255) as Uint8ClampedArray<ArrayBuffer>;
  const put = (plane: number, row: number, col: number, value: number): void => {
    const i = (row * w + col) * 4;
    if (mode === 1) {
      if (plane === 0) rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
      else rgba[i + 3] = value;
    } else rgba[i + plane] = value;
  };
  let p = 2;
  if (compression === 0) {
    if (p + w * h * planes > data.length) return null;
    for (let c = 0; c < planes; c++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(c, y, x, data[p++]!);
  } else {
    const countBytes = head.big ? 4 : 2;
    p += h * channels * countBytes;
    if (p > data.length) return null;
    for (let c = 0; c < planes; c++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; ) {
          if (p >= data.length) return null;
          const n = (data[p++]! << 24) >> 24;
          if (n >= 0) {
            if (p + n + 1 > data.length || x + n + 1 > w) return null;
            for (let k = 0; k <= n; k++) put(c, y, x++, data[p++]!);
          } else if (n !== -128) {
            const run = 1 - n;
            if (p >= data.length || x + run > w) return null;
            const value = data[p++]!;
            for (let k = 0; k < run; k++) put(c, y, x++, value);
          }
        }
      }
    }
  }
  return { w, h, rgba };
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
async function clipPreview(file: Blob): Promise<Blob | null> {
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
export async function artPicture(file: Blob, name: string): Promise<Blob | null> {
  try {
    for (const [kind, names] of IN_ZIP) if (kind.test(name)) return await zipEntry(file, names);
    if (/\.(psd|psb)$/i.test(name)) return await psdThumbnail(file);
    if (/\.clip$/i.test(name)) return await clipPreview(file);
  } catch {
    // (not what its name says, or damaged: its tile)
  }
  return null;
}

/** The picture for a thumbnail or a card: the ready-made one, else the merged one. */
export const artCardPicture = async (file: Blob, name: string): Promise<Blob | null> => (await artPicture(file, name)) ?? (await artFullPicture(file, name));

/** The largest picture an art file gives, for the viewer, encoded; a Photoshop file's merged one when it can be read, else what `artPicture` finds. */
export async function artFullPicture(file: Blob, name: string): Promise<Blob | null> {
  if (/\.(psd|psb)$/i.test(name)) {
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

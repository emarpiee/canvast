/**
 * Minimal ZIP container (store method only) for portable archives (ADR 0008).
 *
 * Entries are written uncompressed: originals are already-compressed media,
 * and storing keeps both directions streamable from Blob slices without
 * holding the archive in memory. Any standard unzip tool can open the result.
 *
 * shortcut: no ZIP64, so an archive is limited to 4 GiB and 65,535 entries.
 * Upgrade to ZIP64 records when a real workspace approaches either limit.
 */
export interface ZipInput {
  name: string;
  data: Blob;
}

export interface ZipEntry {
  name: string;
  size: number;
  crc: number;
  /** The entry's bytes, as a slice of the archive (nothing is read yet). */
  data: Blob;
}

export class ZipError extends Error {}

const LIMIT = 0xffffffff;
const MAX_ENTRIES = 0xffff;

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (ZIP polynomial). Pass the previous result to continue over chunks. */
export function crc32(bytes: Uint8Array, prev = 0): number {
  let c = ~prev >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** CRC-32 of a Blob, read in chunks (never the whole Blob at once). */
export async function crc32Blob(b: Blob): Promise<number> {
  let c = 0;
  const reader = b.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return c;
    c = crc32(value, c);
  }
}

function dosDateTime(d: Date): { date: number; time: number } {
  return {
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/** Build a ZIP from entries. The result is composed of the input Blobs; their bytes are only read for CRCs. */
export async function writeZip(entries: readonly ZipInput[], when = new Date()): Promise<Blob> {
  if (entries.length > MAX_ENTRIES) throw new ZipError(`too many files for one archive (${entries.length}; the limit is ${MAX_ENTRIES})`);
  const enc = new TextEncoder();
  const { date, time } = dosDateTime(when);
  const parts: BlobPart[] = [];
  const central: Array<Uint8Array<ArrayBuffer>> = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const size = e.data.size;
    const crc = await crc32Blob(e.data);
    if (offset + 30 + name.length + size > LIMIT) throw new ZipError("the archive would exceed 4 GiB, which this version cannot write");
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    parts.push(local, e.data);
    offset += local.length + size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  if (offset + cdSize + 22 > LIMIT) throw new ZipError("the archive would exceed 4 GiB, which this version cannot write");
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

async function view(b: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await b.slice(start, end).arrayBuffer());
}

/**
 * Read a ZIP's directory. Every offset and size is bounds-checked against the
 * file; only stored, unencrypted entries are accepted; duplicate names are
 * rejected. Entry bytes are not read here (see `verifyEntry`).
 */
export async function readZip(file: Blob): Promise<Map<string, ZipEntry>> {
  const n = file.size;
  if (n < 22) throw new ZipError("not an archive (file too small)");
  const tailStart = Math.max(0, n - 22 - 0xffff);
  const tail = await view(file, tailStart, n);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("not an archive (no end-of-directory record)");
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === LIMIT || cdOffset + cdSize > tailStart + eocd) throw new ZipError("unsupported or damaged archive directory");
  const cd = await view(file, cdOffset, cdOffset + cdSize);
  const dec = new TextDecoder("utf-8", { fatal: true });
  const out = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new ZipError("damaged archive directory");
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    const csize = cd.getUint32(p + 20, true);
    const usize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    if (p + 46 + nameLen > cd.byteLength) throw new ZipError("damaged archive directory");
    let name: string;
    try {
      name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    } catch {
      throw new ZipError("archive has a file name that is not valid UTF-8");
    }
    if (flags & 1) throw new ZipError(`"${name}" is encrypted`);
    if (method !== 0 || csize !== usize) throw new ZipError(`"${name}" is compressed; only archives exported by canvast can be imported`);
    if (out.has(name)) throw new ZipError(`archive lists "${name}" twice`);
    const lh = await view(file, localOffset, Math.min(n, localOffset + 30));
    if (lh.byteLength < 30 || lh.getUint32(0, true) !== 0x04034b50) throw new ZipError(`damaged entry "${name}"`);
    const start = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (start + usize > cdOffset) throw new ZipError(`entry "${name}" runs past the end of the data`);
    out.set(name, { name, size: usize, crc, data: file.slice(start, start + usize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Throw unless the entry's bytes match its recorded CRC-32. */
export async function verifyEntry(e: ZipEntry): Promise<void> {
  if ((await crc32Blob(e.data)) !== e.crc) throw new ZipError(`"${e.name}" is damaged (checksum mismatch)`);
}

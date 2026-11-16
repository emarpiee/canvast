/**
 * Minimal ZIP container (store method only) for portable archives (ADR 0008).
 *
 * Entries are written uncompressed: originals are already-compressed media,
 * and storing keeps both directions streamable from Blob slices without
 * holding the archive in memory. Any standard unzip tool can open the result.
 *
 * ZIP64 (ADR 0115): an archive with more than 65,535 entries, or any size or offset of 4 GiB or more, is written with ZIP64
 * records (a ZIP64 end-of-directory record and its locator, and a ZIP64 extra field on every entry), which every current
 * unzip tool reads; a smaller archive is plain ZIP, as before. Both are read.
 */
import { asBlob, isDisk, joined } from "./disk-file";

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
/** Counts and offsets are read as numbers: beyond this they could not be addressed in a browser anyway. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** The CRC-32 table (ZIP polynomial), shared with the old ZIP encryption's keys. */
export const CRC_TABLE = (() => {
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
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** A task boundary, so the browser can draw a frame (a message, not a timer: timers are slowed down in a hidden tab). */
const breathe = (): Promise<void> =>
  new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });

/** CRC-32 of a Blob, read in chunks (never the whole Blob at once), pausing every few ms so a big one never stalls a frame. */
export async function crc32Blob(b: Blob): Promise<number> {
  if (b.size === 0) return 0;
  let c = 0;
  let since = performance.now();
  const reader = b.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return c;
    c = crc32(value, c);
    if (performance.now() - since > 8) {
      await breathe();
      since = performance.now();
    }
  }
}

function dosDateTime(d: Date): { date: number; time: number } {
  return {
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/**
 * Build a ZIP from entries. The result is composed of the input Blobs; their bytes are only read for CRCs. `force64` writes the ZIP64
 * records even when nothing needs them (for tests, and for tools that want them).
 */
export async function writeZip(entries: readonly ZipInput[], when = new Date(), force64 = false, onEntry?: (done: number, total: number) => void): Promise<Blob> {
  const enc = new TextEncoder();
  const { date, time } = dosDateTime(when);
  const names = entries.map((e) => enc.encode(e.name));
  const crcs: number[] = [];
  for (const e of entries) {
    crcs.push(await crc32Blob(e.data));
    onEntry?.(crcs.length, entries.length);
  }
  // Does anything need ZIP64? Sizes and offsets are known before anything is written (every local header is the same size in either form).
  let need64 = force64 || entries.length >= MAX_ENTRIES;
  let probe = 0;
  entries.forEach((e, i) => {
    if (e.data.size >= LIMIT || probe >= LIMIT) need64 = true;
    probe += 30 + names[i]!.length + e.data.size;
  });
  if (probe + 46 * entries.length + names.reduce((n, x) => n + x.length, 0) >= LIMIT) need64 = true;
  const parts: BlobPart[] = [];
  const central: Array<Uint8Array<ArrayBuffer>> = [];
  let offset = 0;
  entries.forEach((e, i) => {
    const name = names[i]!;
    const size = e.data.size;
    const crc = crcs[i]!;
    const extraLocal = need64 ? 20 : 0; // id, length, uncompressed size, compressed size
    const local = new Uint8Array(30 + name.length + extraLocal);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, need64 ? 45 : 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, need64 ? LIMIT : size, true);
    lv.setUint32(22, need64 ? LIMIT : size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, extraLocal, true);
    local.set(name, 30);
    if (need64) {
      lv.setUint16(30 + name.length, 0x0001, true);
      lv.setUint16(32 + name.length, 16, true);
      lv.setBigUint64(34 + name.length, BigInt(size), true);
      lv.setBigUint64(42 + name.length, BigInt(size), true);
    }
    const extraCentral = need64 ? 28 : 0; // id, length, uncompressed size, compressed size, offset
    const cd = new Uint8Array(46 + name.length + extraCentral);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, need64 ? 45 : 20, true); // version made by
    cv.setUint16(6, need64 ? 45 : 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, need64 ? LIMIT : size, true);
    cv.setUint32(24, need64 ? LIMIT : size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extraCentral, true);
    cv.setUint32(42, need64 ? LIMIT : offset, true);
    cd.set(name, 46);
    if (need64) {
      cv.setUint16(46 + name.length, 0x0001, true);
      cv.setUint16(48 + name.length, 24, true);
      cv.setBigUint64(50 + name.length, BigInt(size), true);
      cv.setBigUint64(58 + name.length, BigInt(size), true);
      cv.setBigUint64(66 + name.length, BigInt(offset), true);
    }
    central.push(cd);
    parts.push(local, e.data);
    offset += local.length + size;
  });
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const tail: Uint8Array<ArrayBuffer>[] = [];
  if (need64) {
    const z = new Uint8Array(56 + 20);
    const zv = new DataView(z.buffer);
    zv.setUint32(0, 0x06064b50, true); // ZIP64 end of directory
    zv.setBigUint64(4, 44n, true); // the rest of this record
    zv.setUint16(12, 45, true);
    zv.setUint16(14, 45, true);
    zv.setBigUint64(24, BigInt(entries.length), true);
    zv.setBigUint64(32, BigInt(entries.length), true);
    zv.setBigUint64(40, BigInt(cdSize), true);
    zv.setBigUint64(48, BigInt(offset), true);
    zv.setUint32(56, 0x07064b50, true); // its locator
    zv.setBigUint64(64, BigInt(offset + cdSize), true);
    zv.setUint32(72, 1, true);
    tail.push(z);
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, need64 ? 0xffff : entries.length, true);
  ev.setUint16(10, need64 ? 0xffff : entries.length, true);
  ev.setUint32(12, need64 ? LIMIT : cdSize, true);
  ev.setUint32(16, need64 ? LIMIT : offset, true);
  // (with a file too big for the page in it: the same bytes, read from where they lie as far as is asked)
  if (entries.some((e) => isDisk(e.data))) return asBlob(joined([...parts, ...central, ...tail, end].map((p) => (isDisk(p) ? p : p instanceof Blob ? p : new Blob([p as BlobPart]))), "application/zip"));
  return new Blob([...parts, ...central, ...tail, end], { type: "application/zip" });
}

async function view(b: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await b.slice(start, end).arrayBuffer());
}

/** One file listed in a ZIP's directory, as written there (nothing checked but its place in the file). */
export interface ZipRecord {
  name: string;
  /** General purpose flags: bit 0 encrypted, bit 3 sizes after the data, bit 11 a UTF-8 name. */
  flags: number;
  /** 0 stored, 8 deflated, 99 WinZip AES (its own method in `extra`). */
  method: number;
  crc: number;
  /** Its size in the archive, and unpacked. */
  csize: number;
  usize: number;
  localOffset: number;
  /** MS-DOS time and date of its last change. */
  time: number;
  date: number;
  /** Its extra fields (the directory's). */
  extra: DataView;
}

/** One extra field of a record, by its id, null when it has none. */
export function extraField(extra: DataView, id: number): DataView | null {
  for (let q = 0; q + 4 <= extra.byteLength; ) {
    const len = extra.getUint16(q + 2, true);
    if (q + 4 + len > extra.byteLength) return null;
    if (extra.getUint16(q, true) === id) return new DataView(extra.buffer, extra.byteOffset + q + 4, len);
    q += 4 + len;
  }
  return null;
}

/** A name that is not UTF-8 (an old archive's, flag 11 off): read as Windows' Western code page, the closest a browser has to the old DOS one. */
const LOOSE = new TextDecoder("windows-1252");

/**
 * Read a ZIP's directory: every record's facts, bounds-checked against the file (ZIP64 too). `names`: "strict" throws on a name that is not
 * UTF-8 (canvast's own archives); "any" reads an old archive's names as best it can (its Unicode path field first).
 */
export async function zipDirectory(file: Blob, names: "strict" | "any" = "strict"): Promise<{ records: ZipRecord[]; cdOffset: number }> {
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
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === LIMIT || cdOffset === LIMIT) {
    // ZIP64: the real numbers are in the record the locator (just before the end record) points at.
    if (eocd < 20 || tail.getUint32(eocd - 20, true) !== 0x07064b50) throw new ZipError("unsupported or damaged archive directory");
    const at = Number(tail.getBigUint64(eocd - 20 + 8, true));
    if (!(at >= 0 && at + 56 <= n)) throw new ZipError("unsupported or damaged archive directory");
    const z = await view(file, at, at + 56);
    if (z.getUint32(0, true) !== 0x06064b50) throw new ZipError("unsupported or damaged archive directory");
    const big = (o: number): number => {
      const v = z.getBigUint64(o, true);
      if (v > BigInt(MAX_SAFE)) throw new ZipError("archive is larger than this browser can address");
      return Number(v);
    };
    count = big(32);
    cdSize = big(40);
    cdOffset = big(48);
  }
  if (cdOffset + cdSize > n) throw new ZipError("unsupported or damaged archive directory");
  const cd = await view(file, cdOffset, cdOffset + cdSize);
  const dec = new TextDecoder("utf-8", { fatal: true });
  const records: ZipRecord[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new ZipError("damaged archive directory");
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const time = cd.getUint16(p + 12, true);
    const date = cd.getUint16(p + 14, true);
    const crc = cd.getUint32(p + 16, true);
    let csize = cd.getUint32(p + 20, true);
    let usize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localOffset = cd.getUint32(p + 42, true);
    if (p + 46 + nameLen + extraLen > cd.byteLength) throw new ZipError("damaged archive directory");
    const extra = new DataView(cd.buffer, cd.byteOffset + p + 46 + nameLen, extraLen);
    // ZIP64 extra field: the sizes and the offset that did not fit are here, in this order, each only when its field holds 0xFFFFFFFF.
    if (usize === LIMIT || csize === LIMIT || localOffset === LIMIT) {
      const z = extraField(extra, 0x0001);
      if (!z) throw new ZipError("damaged archive directory");
      let r = 0;
      const next = (): number => {
        if (r + 8 > z.byteLength) throw new ZipError("damaged archive directory");
        const v = z.getBigUint64(r, true);
        r += 8;
        if (v > BigInt(MAX_SAFE)) throw new ZipError("archive is larger than this browser can address");
        return Number(v);
      };
      if (usize === LIMIT) usize = next();
      if (csize === LIMIT) csize = next();
      if (localOffset === LIMIT) localOffset = next();
    }
    const raw = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
    let name: string;
    try {
      name = dec.decode(raw);
    } catch {
      if (names === "strict") throw new ZipError("archive has a file name that is not valid UTF-8");
      // Info-ZIP's Unicode path field (version 1, the CRC of the old name, the UTF-8 name), else the old code page.
      const u = extraField(extra, 0x7075);
      const utf = u && u.byteLength > 5 && u.getUint8(0) === 1 ? new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(u.buffer, u.byteOffset + 5, u.byteLength - 5)) : "";
      name = utf || LOOSE.decode(raw);
    }
    records.push({ name, flags, method, crc, csize, usize, localOffset, time, date, extra });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { records, cdOffset };
}

/** Where a record's bytes start: after its local header, whose name and extra field may differ from the directory's. */
export async function recordStart(file: Blob, r: Pick<ZipRecord, "localOffset" | "name">): Promise<number> {
  const lh = await view(file, r.localOffset, Math.min(file.size, r.localOffset + 30));
  if (lh.byteLength < 30 || lh.getUint32(0, true) !== 0x04034b50) throw new ZipError(`damaged entry "${r.name}"`);
  return r.localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
}

/**
 * Read a canvast archive's directory. Every offset and size is bounds-checked against the
 * file; only stored, unencrypted entries are accepted; duplicate names are
 * rejected. Entry bytes are not read here (see `verifyEntry`).
 */
export async function readZip(file: Blob): Promise<Map<string, ZipEntry>> {
  const { records, cdOffset } = await zipDirectory(file, "strict");
  const out = new Map<string, ZipEntry>();
  for (const r of records) {
    if (r.flags & 1) throw new ZipError(`"${r.name}" is encrypted`);
    if (r.method !== 0 || r.csize !== r.usize) throw new ZipError(`"${r.name}" is compressed; only archives exported by canvast can be imported`);
    if (out.has(r.name)) throw new ZipError(`archive lists "${r.name}" twice`);
    out.set(r.name, { name: r.name, size: r.usize, crc: r.crc, data: file.slice(0, 0) });
  }
  // The local headers say where each entry's bytes start: read them in parallel batches.
  for (let from = 0; from < records.length; from += 256) {
    const batch = records.slice(from, from + 256);
    const starts = await Promise.all(batch.map((r) => recordStart(file, r)));
    batch.forEach((r, k) => {
      const start = starts[k]!;
      if (start + r.usize > cdOffset) throw new ZipError(`entry "${r.name}" runs past the end of the data`);
      out.get(r.name)!.data = file.slice(start, start + r.usize);
    });
  }
  return out;
}

/** Throw unless the entry's bytes match its recorded CRC-32. */
export async function verifyEntry(e: ZipEntry): Promise<void> {
  if ((await crc32Blob(e.data)) !== e.crc) throw new ZipError(`"${e.name}" is damaged (checksum mismatch)`);
}

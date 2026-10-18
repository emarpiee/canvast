/**
 * WOFF2 → plain sfnt (ADR 0132). The tables are one Brotli stream (the browser's own `DecompressionStream("brotli")` when it has it, else
 * the decoder of this app); the glyf and loca tables are stored transformed (separate streams for contours, points, flags, coordinates and
 * instructions, with the coordinates packed as "triplets") and are rebuilt into ordinary TrueType tables; hmtx may be stored without its
 * left side bearings. The result is what `parseFont` and a `FontFace` read, like a font that was never packed.
 */
import { BrotliError, brotliDecode } from "./brotli";
import { FontError } from "./font";

export type Unpack = (data: Uint8Array) => Promise<Uint8Array>;

/** The browser's own Brotli when it has it (quicker), else the decoder of this app (brotli.ts). */
async function browserBrotli(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new DecompressionStream("brotli" as CompressionFormat);
      return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
    } catch {
      // not supported by this browser: the decoder below
    }
  }
  try {
    return await brotliDecode(data);
  } catch (e) {
    throw new FontError(e instanceof BrotliError ? "This WOFF2 font file is damaged." : "This browser cannot open WOFF2 fonts. Use a .ttf or .woff file.");
  }
}

let unpack: Unpack = browserBrotli;
/** Use another Brotli unpacker (the tests use the app's own decoder, and Node's, to see they agree). */
export const setBrotli = (fn: Unpack): void => {
  unpack = fn;
};

const KNOWN = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

class Reader {
  p = 0;
  constructor(readonly b: Uint8Array) {}
  u8(): number {
    if (this.p >= this.b.length) throw new FontError("This font file is damaged.");
    return this.b[this.p++]!;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  i16(): number {
    const v = this.u16();
    return v & 0x8000 ? v - 0x10000 : v;
  }
  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  base128(): number {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = this.u8();
      if (i === 0 && c === 0x80) throw new FontError("This font file is damaged.");
      if (v & 0xfe000000) throw new FontError("This font file is damaged.");
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v >>> 0;
    }
    throw new FontError("This font file is damaged.");
  }
  u255(): number {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return 253 + this.u8();
    if (c === 254) return 506 + this.u8();
    return c;
  }
  bytes(n: number): Uint8Array {
    if (this.p + n > this.b.length) throw new FontError("This font file is damaged.");
    const out = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return out;
  }
}

interface Entry {
  tag: string;
  flags: number;
  orig: number;
  length: number; // as stored (the transformed length when transformed)
  transformed: boolean;
}

const sign = (flag: number, v: number): number => (flag & 1 ? v : -v);

/** The font as plain sfnt bytes. */
export async function sfntOfWoff2(bytes: Uint8Array): Promise<Uint8Array> {
  const r = new Reader(bytes);
  r.p = 4;
  const flavor = r.u32();
  r.u32(); // length
  const n = r.u16();
  r.u16();
  r.u32(); // totalSfntSize
  const compressedSize = r.u32();
  r.p = 48;
  if (flavor === 0x74746366) throw new FontError("This is a font collection. Use one of its fonts as a .ttf file.");
  const entries: Entry[] = [];
  for (let i = 0; i < n; i++) {
    const flags = r.u8();
    const idx = flags & 0x3f;
    const tag = idx === 63 ? String.fromCharCode(...r.bytes(4)) : KNOWN[idx];
    if (!tag) throw new FontError("This font file is damaged.");
    const version = flags >> 6;
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    const orig = r.base128();
    const length = transformed ? r.base128() : orig;
    entries.push({ tag, flags, orig, length, transformed });
  }
  const data = await unpack(r.bytes(compressedSize));
  const at = new Map<string, Uint8Array>();
  let off = 0;
  for (const e of entries) {
    if (off + e.length > data.length) throw new FontError("This font file is damaged.");
    at.set(e.tag, data.subarray(off, off + e.length));
    off += e.length;
  }
  const tables = new Map<string, Uint8Array>();
  for (const e of entries) if (!e.transformed) tables.set(e.tag, at.get(e.tag)!);
  let glyphXMin: number[] = [];
  if (entries.some((e) => e.tag === "glyf" && e.transformed)) {
    const { glyf, loca, xMin, indexFormat } = rebuildGlyf(at.get("glyf")!);
    tables.set("glyf", glyf);
    tables.set("loca", loca);
    glyphXMin = xMin;
    const head = tables.get("head");
    if (head) {
      const h = head.slice();
      new DataView(h.buffer).setInt16(50, 1); // the loca made here is always long
      tables.set("head", h);
    }
    void indexFormat;
  }
  const hm = entries.find((e) => e.tag === "hmtx" && e.transformed);
  if (hm) tables.set("hmtx", rebuildHmtx(at.get("hmtx")!, tables, glyphXMin));
  return assemble(flavor, tables);
}

function rebuildGlyf(t: Uint8Array): { glyf: Uint8Array; loca: Uint8Array; xMin: number[]; indexFormat: number } {
  const r = new Reader(t);
  r.u16(); // version
  const optionFlags = r.u16();
  const numGlyphs = r.u16();
  const indexFormat = r.u16();
  const sizes = [r.u32(), r.u32(), r.u32(), r.u32(), r.u32(), r.u32(), r.u32()] as const;
  const [nContourSize, nPointsSize, flagSize, glyphSize, compositeSize, bboxSize, instrSize] = sizes;
  const nContour = new Reader(r.bytes(nContourSize));
  const nPoints = new Reader(r.bytes(nPointsSize));
  const flagS = new Reader(r.bytes(flagSize));
  const glyphS = new Reader(r.bytes(glyphSize));
  const compS = new Reader(r.bytes(compositeSize));
  const bboxAll = r.bytes(bboxSize);
  const instrS = new Reader(r.bytes(instrSize));
  void optionFlags;
  const bitmapLen = 4 * Math.floor((numGlyphs + 31) / 32);
  const bitmap = bboxAll.subarray(0, bitmapLen);
  const bboxS = new Reader(bboxAll.subarray(bitmapLen));
  const out: number[] = [];
  const offsets: number[] = [];
  const xMins: number[] = [];
  const push16 = (v: number): void => void out.push((v >> 8) & 255, v & 255);
  for (let g = 0; g < numGlyphs; g++) {
    offsets.push(out.length);
    const nc = nContour.i16();
    const hasBox = (bitmap[g >> 3]! & (0x80 >> (g & 7))) !== 0;
    if (nc === 0) {
      xMins.push(0);
      continue;
    }
    const start = out.length;
    if (nc > 0) {
      const ends: number[] = [];
      let total = 0;
      for (let c = 0; c < nc; c++) {
        total += nPoints.u255();
        ends.push(total - 1);
      }
      const xs: number[] = [], ys: number[] = [], on: boolean[] = [];
      let x = 0, y = 0;
      for (let i = 0; i < total; i++) {
        const flag = flagS.u8();
        on.push((flag & 0x80) === 0);
        const f = flag & 0x7f;
        let dx: number, dy: number;
        if (f < 10) { dx = 0; dy = sign(f, ((f & 14) << 7) + glyphS.u8()); }
        else if (f < 20) { dx = sign(f, (((f - 10) & 14) << 7) + glyphS.u8()); dy = 0; }
        else if (f < 84) {
          const b0 = f - 20, b1 = glyphS.u8();
          dx = sign(f, 1 + (b0 & 0x30) + (b1 >> 4));
          dy = sign(f >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
        } else if (f < 120) {
          const b0 = f - 84;
          dx = sign(f, 1 + (Math.floor(b0 / 12) << 8) + glyphS.u8());
          dy = sign(f >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphS.u8());
        } else if (f < 124) {
          const b1 = glyphS.u8(), b2 = glyphS.u8(), b3 = glyphS.u8();
          dx = sign(f, (b1 << 4) + (b2 >> 4));
          dy = sign(f >> 1, ((b2 & 0x0f) << 8) + b3);
        } else {
          dx = sign(f, (glyphS.u8() << 8) + glyphS.u8());
          dy = sign(f >> 1, (glyphS.u8() << 8) + glyphS.u8());
        }
        x += dx;
        y += dy;
        xs.push(x);
        ys.push(y);
      }
      const ilen = glyphS.u255();
      const instr = instrS.bytes(ilen);
      let box: [number, number, number, number];
      if (hasBox) box = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
      else box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      xMins.push(box[0]);
      push16(nc);
      for (const v of box) push16(v < 0 ? v + 0x10000 : v);
      for (const e of ends) push16(e);
      push16(ilen);
      out.push(...instr);
      for (const o of on) out.push(o ? 1 : 0); // 16-bit deltas: no short or repeat flags
      let px = 0;
      for (const v of xs) { const d = v - px; px = v; push16(d < 0 ? d + 0x10000 : d); }
      let py = 0;
      for (const v of ys) { const d = v - py; py = v; push16(d < 0 ? d + 0x10000 : d); }
    } else {
      // a composite: its components are copied as they are; the box is always given
      const box = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
      xMins.push(box[0]!);
      push16(0xffff);
      for (const v of box) push16(v < 0 ? v + 0x10000 : v);
      let more = true;
      let instructions = false;
      while (more) {
        const flags = compS.u16();
        const gid = compS.u16();
        push16(flags);
        push16(gid);
        let argBytes = flags & 1 ? 4 : 2;
        if (flags & 8) argBytes += 2;
        else if (flags & 0x40) argBytes += 4;
        else if (flags & 0x80) argBytes += 8;
        out.push(...compS.bytes(argBytes));
        more = (flags & 0x20) !== 0;
        if (flags & 0x100) instructions = true;
      }
      if (instructions) {
        const ilen = glyphS.u255();
        push16(ilen);
        out.push(...instrS.bytes(ilen));
      }
    }
    while ((out.length - start) % 4) out.push(0);
  }
  offsets.push(out.length);
  const loca = new Uint8Array(offsets.length * 4);
  const lv = new DataView(loca.buffer);
  offsets.forEach((o, i) => lv.setUint32(4 * i, o));
  return { glyf: Uint8Array.from(out), loca, xMin: xMins, indexFormat };
}

function rebuildHmtx(t: Uint8Array, tables: Map<string, Uint8Array>, xMin: number[]): Uint8Array {
  const hhea = tables.get("hhea"), maxp = tables.get("maxp");
  if (!hhea || !maxp) throw new FontError("This font file is damaged.");
  const numHMetrics = new DataView(hhea.buffer, hhea.byteOffset).getUint16(34);
  const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset).getUint16(4);
  const r = new Reader(t);
  const flags = r.u8();
  const adv: number[] = [];
  for (let i = 0; i < numHMetrics; i++) adv.push(r.u16());
  const lsb: number[] = [];
  for (let i = 0; i < numHMetrics; i++) lsb.push(flags & 1 ? xMin[i] ?? 0 : r.i16());
  const rest: number[] = [];
  for (let i = numHMetrics; i < numGlyphs; i++) rest.push(flags & 2 ? xMin[i] ?? 0 : r.i16());
  const out = new Uint8Array(4 * numHMetrics + 2 * (numGlyphs - numHMetrics));
  const v = new DataView(out.buffer);
  for (let i = 0; i < numHMetrics; i++) {
    v.setUint16(4 * i, adv[i]!);
    v.setInt16(4 * i + 2, lsb[i]!);
  }
  rest.forEach((l, i) => v.setInt16(4 * numHMetrics + 2 * i, l));
  return out;
}

const sum = (b: Uint8Array): number => {
  let s = 0;
  for (let i = 0; i < b.length; i += 4) s = (s + (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
  return s;
};

/** A plain sfnt from its tables (sorted by tag, four-byte aligned, with checksums). */
export function assemble(flavor: number, tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  const headLen = 12 + 16 * n;
  const total = headLen + tags.reduce((m, t) => m + ((tables.get(t)!.length + 3) & ~3), 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, flavor);
  v.setUint16(4, n);
  const pow = 2 ** Math.floor(Math.log2(n));
  v.setUint16(6, pow * 16);
  v.setUint16(8, Math.log2(pow));
  v.setUint16(10, n * 16 - pow * 16);
  let at = headLen;
  let headAt = -1;
  tags.forEach((tag, i) => {
    const d = tables.get(tag)!;
    const e = 12 + 16 * i;
    for (let k = 0; k < 4; k++) v.setUint8(e + k, tag.charCodeAt(k));
    out.set(d, at);
    if (tag === "head") {
      headAt = at;
      v.setUint32(at + 8, 0);
    }
    v.setUint32(e + 4, sum(out.subarray(at, at + ((d.length + 3) & ~3))));
    v.setUint32(e + 8, at);
    v.setUint32(e + 12, d.length);
    at += (d.length + 3) & ~3;
  });
  if (headAt >= 0) v.setUint32(headAt + 8, (0xb1b0afba - sum(out)) >>> 0);
  return out;
}

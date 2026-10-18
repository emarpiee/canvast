/**
 * Font files we can set text in (ADR 0127). The reader (font.ts) knows TrueType outlines, so a file is accepted when it holds them: a
 * plain `.ttf` or `.otf` as it is, a `.woff` or `.woff2` unpacked into the same thing. Collections are refused with a sentence that says
 * what to use instead (CFF outlines are read by cff.ts, ADR 0132).
 */
import { FontError } from "./font";
import { sfntOfWoff2 } from "./woff2";

const tag = (v: DataView, o: number): string => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

const inflate = async (data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());

/** The font as plain sfnt bytes (what `parseFont` and a `FontFace` read), or a `FontError` saying why not. */
export async function sfntOf(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 12) throw new FontError("This is not a font file.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = tag(v, 0);
  if (t === "ttcf") throw new FontError("This is a font collection. Use one of its fonts as a .ttf file.");
  if (t === "wOF2") return sfntOfWoff2(bytes);
  if (t !== "wOFF") {
    if (v.getUint32(0) === 0x00010000 || t === "true" || t === "OTTO") return bytes;
    throw new FontError("This is not a font file.");
  }
  const flavor = v.getUint32(4);
  if (flavor !== 0x00010000 && tag(v, 4) !== "true" && tag(v, 4) !== "OTTO") throw new FontError("This is not a font file.");
  const n = v.getUint16(12);
  if (bytes.length < 44 + 20 * n) throw new FontError("This font file is damaged.");
  const tables: Array<{ tag: string; data: Uint8Array; sum: number }> = [];
  for (let i = 0; i < n; i++) {
    const e = 44 + 20 * i;
    const off = v.getUint32(e + 4), comp = v.getUint32(e + 8), orig = v.getUint32(e + 12);
    if (off + comp > bytes.length) throw new FontError("This font file is damaged.");
    const raw = bytes.subarray(off, off + comp);
    const data = comp < orig ? await inflate(raw) : raw;
    if (data.length !== orig) throw new FontError("This font file is damaged.");
    tables.push({ tag: tag(v, e), data, sum: v.getUint32(e + 16) });
  }
  const head = 12 + 16 * n;
  const out = new Uint8Array(head + tables.reduce((m, x) => m + ((x.data.length + 3) & ~3), 0));
  const o = new DataView(out.buffer);
  o.setUint32(0, flavor);
  o.setUint16(4, n);
  const pow = 2 ** Math.floor(Math.log2(n));
  o.setUint16(6, pow * 16);
  o.setUint16(8, Math.log2(pow));
  o.setUint16(10, n * 16 - pow * 16);
  let at = head;
  tables.forEach((x, i) => {
    const d = 12 + 16 * i;
    for (let k = 0; k < 4; k++) o.setUint8(d + k, x.tag.charCodeAt(k));
    o.setUint32(d + 4, x.sum);
    o.setUint32(d + 8, at);
    o.setUint32(d + 12, x.data.length);
    out.set(x.data, at);
    at += (x.data.length + 3) & ~3;
  });
  return out;
}

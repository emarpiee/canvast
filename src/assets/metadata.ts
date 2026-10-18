/**
 * What a file says about itself (ADR 0138), read for the details panel of the Assets view: the camera and settings an EXIF block of a
 * JPEG (or WebP) holds, where it was taken (a person sees what a file would give away before sharing it), the colour profile, the
 * text and the print size of a PNG, the frames of a GIF, the codec of a video. Pure: it reads bytes and never throws (a damaged file just
 * gives fewer rows).
 */
import { probeMp4 } from "./mp4-probe";

export interface MetaRow {
  readonly group: string;
  readonly label: string;
  readonly value: string;
}

const text = (b: Uint8Array, from: number, to: number): string => {
  let s = "";
  for (let i = from; i < to && i < b.length; i++) if (b[i]) s += String.fromCharCode(b[i]!);
  return s;
};

// ---- EXIF ------------------------------------------------------------------------------------------------------------------------

const ORIENTATION = ["", "Normal", "Mirrored", "Turned 180°", "Flipped", "Mirrored, turned 90° left", "Turned 90° right", "Mirrored, turned 90° right", "Turned 90° left"];

/** The rows of a TIFF structure (the content of an EXIF block, from its "II" or "MM"). */
export function readExif(b: Uint8Array, base: number): { rows: MetaRow[]; orientation: number } {
  const rows: MetaRow[] = [];
  let orientation = 1;
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const le = b[base] === 0x49;
    if (!(b[base] === b[base + 1] && (b[base] === 0x49 || b[base] === 0x4d)) || dv.getUint16(base + 2, le) !== 42) return { rows, orientation };
    const u16 = (o: number): number => dv.getUint16(o, le), u32 = (o: number): number => dv.getUint32(o, le);
    const entries = (ifd: number): Array<{ tag: number; type: number; count: number; at: number }> => {
      if (ifd < 0 || base + ifd + 2 > b.length) return [];
      const n = Math.min(u16(base + ifd), 200);
      const out: Array<{ tag: number; type: number; count: number; at: number }> = [];
      for (let i = 0; i < n; i++) {
        const e = base + ifd + 2 + 12 * i;
        if (e + 12 > b.length) break;
        const type = u16(e + 2), count = u32(e + 4);
        const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type] ?? 1;
        out.push({ tag: u16(e), type, count, at: size * count <= 4 ? e + 8 : base + u32(e + 8) });
      }
      return out;
    };
    const rational = (at: number, i = 0): number => (u32(at + 8 * i + 4) ? u32(at + 8 * i) / u32(at + 8 * i + 4) : 0);
    const srational = (at: number): number => (dv.getInt32(at + 4, le) ? dv.getInt32(at, le) / dv.getInt32(at + 4, le) : 0);
    const ascii = (e: { at: number; count: number }): string => text(b, e.at, e.at + e.count).trim();
    const value = (e: { type: number; at: number; count: number }): number => (e.type === 3 ? u16(e.at) : e.type === 4 ? u32(e.at) : e.type === 5 ? rational(e.at) : e.type === 10 ? srational(e.at) : e.type === 1 ? b[e.at]! : NaN);
    const add = (group: string, label: string, v: string): void => void (v && rows.push({ group, label, value: v }));
    const ifd0 = entries(u32(base + 4));
    let exifPtr = -1, gpsPtr = -1;
    for (const e of ifd0) {
      if (e.tag === 0x010f) add("Camera", "Make", ascii(e));
      else if (e.tag === 0x0110) add("Camera", "Model", ascii(e));
      else if (e.tag === 0x0131) add("Camera", "Software", ascii(e));
      else if (e.tag === 0x0132) add("Camera", "Date", ascii(e));
      else if (e.tag === 0x0112) {
        orientation = value(e) || 1;
        if (orientation !== 1) add("Picture", "Orientation", ORIENTATION[orientation] ?? String(orientation));
      } else if (e.tag === 0x8769) exifPtr = u32(e.at);
      else if (e.tag === 0x8825) gpsPtr = u32(e.at);
    }
    for (const e of exifPtr >= 0 ? entries(exifPtr) : []) {
      const v = value(e);
      if (e.tag === 0x829a) add("Camera", "Exposure", v > 0 && v < 1 ? `1/${Math.round(1 / v)} s` : `${Math.round(v * 10) / 10} s`);
      else if (e.tag === 0x829d) add("Camera", "Aperture", `f/${Math.round(v * 10) / 10}`);
      else if (e.tag === 0x8827) add("Camera", "ISO", String(v));
      else if (e.tag === 0x920a) add("Camera", "Focal length", `${Math.round(v * 10) / 10} mm`);
      else if (e.tag === 0x9003) add("Camera", "Taken", ascii(e));
      else if (e.tag === 0xa434) add("Camera", "Lens", ascii(e));
      else if (e.tag === 0xa001) add("Picture", "Colour space", v === 1 ? "sRGB" : v === 0xffff ? "Not calibrated" : String(v));
    }
    if (gpsPtr >= 0) {
      const g = new Map(entries(gpsPtr).map((e) => [e.tag, e] as const));
      const coord = (ref: number, val: number): string | null => {
        const r = g.get(ref), v = g.get(val);
        if (!r || !v || v.count < 3) return null;
        const d = rational(v.at, 0) + rational(v.at, 1) / 60 + rational(v.at, 2) / 3600;
        return `${(Math.round(d * 10000) / 10000).toString()}° ${ascii(r)}`;
      };
      const lat = coord(1, 2), lon = coord(3, 4);
      if (lat && lon) add("Place", "Where it was taken", `${lat}, ${lon}`);
    }
  } catch {
    // a damaged block: the rows read so far
  }
  return { rows, orientation };
}

// ---- colour profiles ---------------------------------------------------------------------------------------------------------------

/** The name and kind of an ICC profile. */
export function readIcc(p: Uint8Array): MetaRow[] {
  if (p.length < 132 || text(p, 36, 40) !== "acsp") return [];
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const rows: MetaRow[] = [];
  let name = "";
  const n = Math.min(dv.getUint32(128), 100);
  for (let i = 0; i < n; i++) {
    const e = 132 + 12 * i;
    if (e + 12 > p.length || text(p, e, e + 4) !== "desc") continue;
    const o = dv.getUint32(e + 4), len = dv.getUint32(e + 8);
    if (o + len > p.length) break;
    if (text(p, o, o + 4) === "desc") name = text(p, o + 12, o + 12 + Math.max(0, dv.getUint32(o + 8) - 1));
    else if (text(p, o, o + 4) === "mluc") {
      const count = dv.getUint32(o + 8), recLen = dv.getUint32(o + 12);
      if (count > 0 && recLen >= 12) {
        const sl = dv.getUint32(o + 16 + 4), so = dv.getUint32(o + 16 + 8);
        for (let k = 0; k + 1 < sl && o + so + k + 1 < p.length; k += 2) name += String.fromCharCode(dv.getUint16(o + so + k));
      }
    }
  }
  rows.push({ group: "Colour", label: "Profile", value: name.trim() || "(unnamed)" });
  rows.push({ group: "Colour", label: "Colours", value: text(p, 16, 20).trim() });
  return rows;
}

// ---- formats -----------------------------------------------------------------------------------------------------------------------

function readJpeg(b: Uint8Array): { rows: MetaRow[]; orientation: number } {
  const rows: MetaRow[] = [];
  let orientation = 1;
  const icc: Uint8Array[] = [];
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    const len = (b[p + 2]! << 8) | b[p + 3]!;
    const body = p + 4;
    if (marker === 0xe1 && text(b, body, body + 4) === "Exif") {
      const r = readExif(b, body + 6);
      rows.push(...r.rows);
      orientation = r.orientation;
    } else if (marker === 0xe2 && text(b, body, body + 11) === "ICC_PROFILE") icc.push(b.subarray(body + 14, body + len - 2));
    else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      rows.push({ group: "Picture", label: "Kind", value: marker === 0xc2 ? "Progressive JPEG" : "JPEG" }, { group: "Picture", label: "Bits per channel", value: String(b[body]) });
    } else if (marker === 0xda) break;
    p += 2 + len;
  }
  if (icc.length) {
    const all = new Uint8Array(icc.reduce((m, x) => m + x.length, 0));
    let at = 0;
    for (const x of icc) {
      all.set(x, at);
      at += x.length;
    }
    rows.push(...readIcc(all));
  }
  return { rows, orientation };
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  } catch {
    return null;
  }
}

async function readPng(b: Uint8Array): Promise<MetaRow[]> {
  const rows: MetaRow[] = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8;
  const kinds = ["Greyscale", "", "Colour", "Palette", "Greyscale with transparency", "", "Colour with transparency"];
  while (p + 12 <= b.length) {
    const len = dv.getUint32(p), type = text(b, p + 4, p + 8), body = p + 8;
    if (body + len > b.length) break;
    if (type === "IHDR") rows.push({ group: "Picture", label: "Kind", value: `${kinds[b[body + 9]!] ?? "PNG"}, ${b[body + 8]} bits${b[body + 12] ? ", interlaced" : ""}` });
    else if (type === "pHYs" && b[body + 8] === 1) rows.push({ group: "Picture", label: "Print size", value: `${Math.round(dv.getUint32(body) * 0.0254)} dpi` });
    else if (type === "gAMA") rows.push({ group: "Colour", label: "Gamma", value: String(Math.round((100000 / dv.getUint32(body)) * 100) / 100) });
    else if (type === "sRGB") rows.push({ group: "Colour", label: "Colours", value: "sRGB" });
    else if (type === "iCCP") {
      const nul = b.indexOf(0, body);
      const profile = nul > 0 ? await inflate(b.subarray(nul + 2, body + len)) : null;
      if (profile) rows.push(...readIcc(profile));
    } else if (type === "tEXt") {
      const nul = b.indexOf(0, body);
      if (nul > body && nul < body + len) rows.push({ group: "Text", label: text(b, body, nul).slice(0, 40), value: text(b, nul + 1, body + len).slice(0, 300) });
    } else if (type === "eXIf") rows.push(...readExif(b, body).rows);
    else if (type === "IDAT") break;
    p += 12 + len;
  }
  return rows;
}

function readWebp(b: Uint8Array): { rows: MetaRow[]; orientation: number } {
  const rows: MetaRow[] = [];
  let orientation = 1;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12;
  while (p + 8 <= b.length) {
    const type = text(b, p, p + 4), len = dv.getUint32(p + 4, true);
    if (type === "EXIF") {
      const at = text(b, p + 8, p + 14) === "Exif\0\0" ? p + 14 : p + 8;
      const r = readExif(b, at);
      rows.push(...r.rows);
      orientation = r.orientation;
    } else if (type === "ICCP") rows.push(...readIcc(b.subarray(p + 8, p + 8 + len)));
    else if (type === "VP8X") rows.push({ group: "Picture", label: "Kind", value: `WebP${b[p + 8]! & 2 ? ", animated" : ""}${b[p + 8]! & 16 ? ", with transparency" : ""}` });
    p += 8 + len + (len & 1);
  }
  return { rows, orientation };
}

/** The rows a file gives, and the orientation its EXIF asks for (1: none), by its type; a type with nothing to read gives none. */
export async function readMetadata(b: Uint8Array, type: string): Promise<{ rows: MetaRow[]; orientation: number }> {
  try {
    if (b[0] === 0xff && b[1] === 0xd8) return readJpeg(b);
    if (b[0] === 0x89 && text(b, 1, 4) === "PNG") return { rows: await readPng(b), orientation: 1 };
    if (text(b, 0, 4) === "RIFF" && text(b, 8, 12) === "WEBP") return readWebp(b);
    if (text(b, 0, 3) === "GIF") {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      return { rows: [{ group: "Picture", label: "Kind", value: `${text(b, 0, 6)}, ${dv.getUint16(6, true)} × ${dv.getUint16(8, true)}` }], orientation: 1 };
    }
    if (/^(video|audio)\//.test(type) || text(b, 4, 8) === "ftyp") {
      const v = probeMp4(b);
      if (v) return { rows: [{ group: "Video", label: "Codec", value: v.codec }, { group: "Video", label: "Size", value: `${v.w} × ${v.h}` }, ...(v.duration ? [{ group: "Video", label: "Length", value: `${Math.round(v.duration * 10) / 10} s` }] : [])], orientation: 1 };
    }
  } catch {
    // unreadable: nothing to show
  }
  return { rows: [], orientation: 1 };
}

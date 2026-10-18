/**
 * The files Export… writes (ADR 0147): the print resolution put into a PNG or a JPEG so that an editor or a printer reads the intended
 * size (a 5 in picture says 5 in, not 1500 px), and a PDF of one page for each picture, each page the physical size asked for. Pure
 * byte work; the pictures themselves come from `export-render.ts`.
 */
import { crc32 } from "../storage/zip";
import type { PdfVector } from "./pdf-vector";

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** A PNG with its resolution written as a pHYs chunk (pixels per metre, as the format has it); an existing one is replaced. */
export async function pngWithDpi(blob: Blob, dpi: number): Promise<Blob> {
  const b = new Uint8Array(await blob.arrayBuffer());
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 33 || SIG.some((v, i) => b[i] !== v)) return blob;
  const perMetre = Math.round(dpi / 0.0254);
  const body = new Uint8Array([0x70, 0x48, 0x59, 0x73, ...u32(perMetre), ...u32(perMetre), 1]); // "pHYs", x, y, metre
  const chunk = new Uint8Array([...u32(9), ...body, ...u32(crc32(body))]);
  const out: Uint8Array[] = [b.subarray(0, 33)]; // signature + IHDR (8 + 25)
  let at = 33;
  while (at + 12 <= b.length) {
    const len = ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
    const type = String.fromCharCode(b[at + 4]!, b[at + 5]!, b[at + 6]!, b[at + 7]!);
    const end = at + 12 + len;
    if (end > b.length) return blob; // damaged: leave it as it is
    if (type !== "pHYs") out.push(b.subarray(at, end));
    at = end;
  }
  out.splice(1, 0, chunk);
  return new Blob(out as BlobPart[], { type: "image/png" });
}

/** A JPEG with its resolution in the JFIF header (dots per inch); one without a JFIF header gets one. */
export async function jpegWithDpi(blob: Blob, dpi: number): Promise<Blob> {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return blob;
  const d = Math.min(65535, Math.max(1, Math.round(dpi)));
  const isJfif = b[2] === 0xff && b[3] === 0xe0 && b[6] === 0x4a && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46;
  if (isJfif) {
    const c = b.slice();
    c[13] = 1; // dots per inch
    c[14] = d >> 8; c[15] = d & 255; // x
    c[16] = d >> 8; c[17] = d & 255; // y
    return new Blob([c as BlobPart], { type: "image/jpeg" });
  }
  const jfif = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
  return new Blob([b.subarray(0, 2) as BlobPart, jfif as BlobPart, b.subarray(2) as BlobPart], { type: "image/jpeg" });
}

/**
 * A WebP with its resolution in an EXIF chunk (XResolution, YResolution, unit inch). A plain WebP (one VP8 or VP8L chunk) becomes an
 * extended one (a VP8X header first); one that is already extended keeps its chunks and its old EXIF is replaced. Anything else is left alone.
 */
export async function webpWithDpi(blob: Blob, dpi: number): Promise<Blob> {
  const b = new Uint8Array(await blob.arrayBuffer());
  const tag = (at: number): string => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
  if (b.length < 20 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return blob;
  const le32 = (a: Uint8Array, at: number): number => (a[at]! | (a[at + 1]! << 8) | (a[at + 2]! << 16) | (a[at + 3]! << 24)) >>> 0;
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  for (let at = 12; at + 8 <= b.length;) {
    const len = le32(b, at + 4);
    if (at + 8 + len > b.length) return blob; // damaged: leave it as it is
    chunks.push({ type: tag(at), data: b.subarray(at + 8, at + 8 + len) });
    at += 8 + len + (len & 1);
  }
  const first = chunks[0];
  if (!first) return blob;
  const d = Math.min(0xffffffff, Math.max(1, Math.round(dpi)));
  const le = (n: number, bytes: number): number[] => Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 255);
  const entry = (tagId: number, type: number, value: number[]): number[] => [...le(tagId, 2), ...le(type, 2), ...le(1, 4), ...value];
  const exif = new Uint8Array([
    0x49, 0x49, 0x2a, 0, ...le(8, 4), // little endian, the first directory at 8
    ...le(3, 2),
    ...entry(0x011a, 5, le(50, 4)), ...entry(0x011b, 5, le(58, 4)), ...entry(0x0128, 3, [...le(2, 2), 0, 0]), // x, y (rationals at 50 and 58), unit: inch
    ...le(0, 4),
    ...le(d, 4), ...le(1, 4), ...le(d, 4), ...le(1, 4),
  ]);
  let head: { type: string; data: Uint8Array };
  let rest = chunks.filter((c) => c.type !== "EXIF");
  if (first.type === "VP8X") {
    const flags = first.data.slice();
    flags[0] = flags[0]! | 0x08;
    head = { type: "VP8X", data: flags };
    rest = rest.slice(1);
  } else {
    let w = 0, h = 0, alpha = false;
    if (first.type === "VP8L" && first.data.length >= 5 && first.data[0] === 0x2f) {
      const bits = le32(first.data, 1);
      w = (bits & 0x3fff) + 1;
      h = ((bits >>> 14) & 0x3fff) + 1;
      alpha = ((bits >>> 28) & 1) === 1;
    } else if (first.type === "VP8 " && first.data.length >= 10 && first.data[3] === 0x9d && first.data[4] === 0x01 && first.data[5] === 0x2a) {
      w = (first.data[6]! | (first.data[7]! << 8)) & 0x3fff;
      h = (first.data[8]! | (first.data[9]! << 8)) & 0x3fff;
    } else return blob;
    head = { type: "VP8X", data: new Uint8Array([0x08 | (alpha ? 0x10 : 0), 0, 0, 0, ...le(w - 1, 3), ...le(h - 1, 3)]) };
  }
  const all = [head, ...rest, { type: "EXIF", data: exif }];
  const parts: number[][] = [];
  let total = 4;
  const bodies: Uint8Array[] = [];
  for (const c of all) {
    const pad = c.data.length & 1;
    parts.push([...Array.from(c.type, (ch) => ch.charCodeAt(0)), ...le(c.data.length, 4)]);
    bodies.push(c.data);
    total += 8 + c.data.length + pad;
  }
  const out: Uint8Array[] = [new Uint8Array([0x52, 0x49, 0x46, 0x46, ...le(total, 4), 0x57, 0x45, 0x42, 0x50])];
  all.forEach((c, i) => {
    out.push(new Uint8Array(parts[i]!), bodies[i]!);
    if (c.data.length & 1) out.push(new Uint8Array(1));
  });
  return new Blob(out as BlobPart[], { type: "image/webp" });
}

export interface PdfPage {
  /** The page's size in points (1/72 in). */
  readonly wPt: number;
  readonly hPt: number;
  /** The paths themselves (ADR 0153): the page is drawn by them, with no picture. */
  readonly vector?: PdfVector;
  /** The picture in pixels, and how it is stored: a JPEG as it is, or raw RGB with an optional alpha plane (both are deflated here). */
  readonly wPx: number;
  readonly hPx: number;
  readonly image?: { readonly kind: "jpeg"; readonly bytes: Uint8Array } | { readonly kind: "raw"; readonly rgb: Uint8Array; readonly alpha: Uint8Array | null };
}

/** A page drawn as vectors. */
export const pdfVectorPage = (wPt: number, hPt: number, vector: PdfVector): PdfPage => ({ wPt, hPt, wPx: 0, hPx: 0, vector });

const deflate = async (bytes: Uint8Array): Promise<Uint8Array> => new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
const num = (v: number): string => String(Math.round(v * 100) / 100);

/** A PDF with one page for each picture, each filling its page. Raw pictures are deflated; a JPEG is embedded as it is. */
export async function pdfOf(pages: readonly PdfPage[]): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array): void => {
    parts.push(b);
    size += b.length;
  };
  const text = (s: string): void => push(enc.encode(s));
  const obj = (n: number, head: string, stream?: Uint8Array): void => {
    offsets[n] = size;
    text(`${n} 0 obj\n${head}`);
    if (stream) {
      text("\nstream\n");
      push(stream);
      text("\nendstream");
    }
    text("\nendobj\n");
  };
  text("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  // 1 catalog, 2 pages, then four objects for each page: page, content, image, (alpha plane)
  const first = (i: number): number => 3 + i * 4;
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${first(i)} 0 R`).join(" ")}] >>`);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const n = first(i);
    const img = p.image;
    const hasAlpha = img?.kind === "raw" && img.alpha !== null;
    const v = p.vector;
    const res = v
      ? `/Resources << /ExtGState << ${v.gs.map((g, k) => `/G${k} ${g}`).join(" ")} >> /Shading << ${v.shadings.map((g, k) => `/S${k} ${g}`).join(" ")} >> >>`
      : `/Resources << /XObject << /Im0 ${n + 2} 0 R >> >>`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.wPt)} ${num(p.hPt)}] ${res} /Contents ${n + 1} 0 R >>`);
    const content = enc.encode(v ? v.content : `q ${num(p.wPt)} 0 0 ${num(p.hPt)} 0 0 cm /Im0 Do Q`);
    obj(n + 1, `<< /Length ${content.length} >>`, content);
    if (v) {
      obj(n + 2, "null");
    } else if (img!.kind === "jpeg") {
      obj(n + 2, `<< /Type /XObject /Subtype /Image /Width ${p.wPx} /Height ${p.hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img!.bytes.length} >>`, img!.bytes);
    } else {
      const rgb = await deflate(img!.rgb);
      obj(n + 2, `<< /Type /XObject /Subtype /Image /Width ${p.wPx} /Height ${p.hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${hasAlpha ? ` /SMask ${n + 3} 0 R` : ""} /Length ${rgb.length} >>`, rgb);
      if (hasAlpha) {
        const a = await deflate(img!.alpha!);
        obj(n + 3, `<< /Type /XObject /Subtype /Image /Width ${p.wPx} /Height ${p.hPx} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${a.length} >>`, a);
      }
    }
    if (!hasAlpha) obj(n + 3, "null"); // (keeps the numbering the same for every page)
  }
  const total = first(pages.length);
  const xref = size;
  text(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) text(`${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`);
  text(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

/** A canvas as a PDF page picture: a JPEG when it has no transparency to keep (`jpeg`), else raw RGB with its alpha plane. */
export function pdfPageOf(canvas: HTMLCanvasElement, wPt: number, hPt: number, jpeg: Uint8Array | null): PdfPage {
  const { width: wPx, height: hPx } = canvas;
  if (jpeg) return { wPt, hPt, wPx, hPx, image: { kind: "jpeg", bytes: jpeg } };
  const d = canvas.getContext("2d")!.getImageData(0, 0, wPx, hPx).data;
  const rgb = new Uint8Array(wPx * hPx * 3);
  const alpha = new Uint8Array(wPx * hPx);
  let opaque = true;
  for (let i = 0, j = 0, k = 0; i < d.length; i += 4, j += 3, k++) {
    const a = d[i + 3]!;
    alpha[k] = a;
    if (a !== 255) opaque = false;
    // (the canvas holds non-premultiplied colour already)
    rgb[j] = d[i]!;
    rgb[j + 1] = d[i + 1]!;
    rgb[j + 2] = d[i + 2]!;
  }
  return { wPt, hPt, wPx, hPx, image: { kind: "raw", rgb, alpha: opaque ? null : alpha } };
}

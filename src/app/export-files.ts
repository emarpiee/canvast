/**
 * The files Export… writes (ADR 0147): the print resolution put into a PNG or a JPEG so that an editor or a printer reads the intended
 * size (a 5 in picture says 5 in, not 1500 px), and a PDF of one page for each picture, each page the physical size asked for. Pure
 * byte work; the pictures themselves come from `export-render.ts`.
 */
import { crc32 } from "../storage/zip";

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

export interface PdfPage {
  /** The page's size in points (1/72 in). */
  readonly wPt: number;
  readonly hPt: number;
  /** The picture in pixels, and how it is stored: a JPEG as it is, or raw RGB with an optional alpha plane (both are deflated here). */
  readonly wPx: number;
  readonly hPx: number;
  readonly image: { readonly kind: "jpeg"; readonly bytes: Uint8Array } | { readonly kind: "raw"; readonly rgb: Uint8Array; readonly alpha: Uint8Array | null };
}

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
    const hasAlpha = p.image.kind === "raw" && p.image.alpha !== null;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.wPt)} ${num(p.hPt)}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    const content = enc.encode(`q ${num(p.wPt)} 0 0 ${num(p.hPt)} 0 0 cm /Im0 Do Q`);
    obj(n + 1, `<< /Length ${content.length} >>`, content);
    if (p.image.kind === "jpeg") {
      obj(n + 2, `<< /Type /XObject /Subtype /Image /Width ${p.wPx} /Height ${p.hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.image.bytes.length} >>`, p.image.bytes);
    } else {
      const rgb = await deflate(p.image.rgb);
      obj(n + 2, `<< /Type /XObject /Subtype /Image /Width ${p.wPx} /Height ${p.hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${hasAlpha ? ` /SMask ${n + 3} 0 R` : ""} /Length ${rgb.length} >>`, rgb);
      if (hasAlpha) {
        const a = await deflate(p.image.alpha!);
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

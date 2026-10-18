import { describe, expect, it } from "vitest";
import { jpegWithDpi, pdfOf, pngWithDpi, webpWithDpi } from "../../src/app/export-files";
import { crc32 } from "../../src/storage/zip";
import { makePng } from "../e2e/png";

const bytesOf = async (b: Blob): Promise<Uint8Array> => new Uint8Array(await b.arrayBuffer());
const chunks = (b: Uint8Array): Array<{ type: string; data: Uint8Array; crc: number }> => {
  const out: Array<{ type: string; data: Uint8Array; crc: number }> = [];
  let at = 8;
  while (at + 12 <= b.length) {
    const len = new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0);
    out.push({ type: String.fromCharCode(...b.subarray(at + 4, at + 8)), data: b.subarray(at + 8, at + 8 + len), crc: new DataView(b.buffer, b.byteOffset + at + 8 + len, 4).getUint32(0) });
    at += 12 + len;
  }
  return out;
};

describe("export files", () => {
  it("a PNG gets its resolution as a pHYs chunk after the header, with a right checksum, and nothing else changes", async () => {
    const png = new Blob([makePng(8, 4, () => [10, 20, 30, 255]) as BlobPart], { type: "image/png" });
    const out = await bytesOf(await pngWithDpi(png, 300));
    const cs = chunks(out);
    expect(cs.map((c) => c.type)).toEqual(["IHDR", "pHYs", ...chunks(await bytesOf(png)).slice(1).map((c) => c.type)]);
    const phys = cs[1]!;
    const dv = new DataView(phys.data.buffer, phys.data.byteOffset, 9);
    expect(dv.getUint32(0)).toBe(11811); // 300 per inch is 11,811 per metre
    expect(dv.getUint32(4)).toBe(11811);
    expect(phys.data[8]).toBe(1);
    expect(phys.crc).toBe(crc32(new Uint8Array([0x70, 0x48, 0x59, 0x73, ...phys.data])));
    // again with another resolution: replaced, not doubled
    const again = chunks(await bytesOf(await pngWithDpi(new Blob([out as BlobPart]), 96)));
    expect(again.filter((c) => c.type === "pHYs")).toHaveLength(1);
    expect(new DataView(again[1]!.data.buffer, again[1]!.data.byteOffset, 4).getUint32(0)).toBe(3780);
  });
  it("a JPEG gets its resolution in the JFIF header, or a header if it has none; other files are left alone", async () => {
    const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    const a = await bytesOf(await jpegWithDpi(new Blob([jfif as BlobPart]), 300));
    expect([a[13], (a[14]! << 8) | a[15]!, (a[16]! << 8) | a[17]!]).toEqual([1, 300, 300]);
    expect(a.length).toBe(jfif.length);
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const b = await bytesOf(await jpegWithDpi(new Blob([bare as BlobPart]), 150));
    expect([b[2], b[3], b[13], (b[14]! << 8) | b[15]!]).toEqual([0xff, 0xe0, 1, 150]);
    expect(b.slice(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
    const junk = new Blob(["not an image"]);
    expect(await jpegWithDpi(junk, 300)).toBe(junk);
    expect(await pngWithDpi(junk, 300)).toBe(junk);
  });
  it("a PDF has a page for each picture at the physical size, and its cross-reference table points at every object", async () => {
    const rgb = new Uint8Array(4 * 2 * 3).fill(200);
    const pdf = await pdfOf([
      { wPt: 595.28, hPt: 841.89, wPx: 4, hPx: 2, image: { kind: "raw", rgb, alpha: null } },
      { wPt: 200, hPt: 100, wPx: 4, hPx: 2, image: { kind: "raw", rgb, alpha: new Uint8Array(8).fill(128) } },
    ]);
    const b = await bytesOf(pdf);
    const s = new TextDecoder("latin1").decode(b);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/Count 2");
    expect(s).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(s).toContain("/MediaBox [0 0 200 100]");
    expect(s).toContain("/SMask 10 0 R"); // the second page keeps its transparency
    const xrefAt = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const rows = s.slice(xrefAt).split("\n").filter((l) => /^\d{10} 00000 n $/.test(l));
    expect(rows.length).toBe(10);
    rows.forEach((r, i) => expect(s.slice(Number(r.slice(0, 10)), Number(r.slice(0, 10)) + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
  it("a plain WebP becomes an extended one with its size and an EXIF resolution; an extended one keeps its chunks; other files are left alone", async () => {
    const le = (n: number, k: number): number[] => Array.from({ length: k }, (_, i) => (n >>> (8 * i)) & 255);
    const riff = (chunks: number[][]): Blob => new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, ...le(4 + chunks.reduce((a, c) => a + c.length, 0), 4), 0x57, 0x45, 0x42, 0x50, ...chunks.flat()])]);
    const chunk = (t: string, d: number[]): number[] => [...[...t].map((c) => c.charCodeAt(0)), ...le(d.length, 4), ...d, ...(d.length & 1 ? [0] : [])];
    const vp8l = chunk("VP8L", [0x2f, ...le(9 | (4 << 14) | (1 << 28), 4), 1, 2, 3]); // 10 × 5, with alpha
    const out = new Uint8Array(await (await webpWithDpi(riff([vp8l]), 300)).arrayBuffer());
    const at = (o: number): string => String.fromCharCode(...out.subarray(o, o + 4));
    expect(at(0) + at(8) + at(12)).toBe("RIFFWEBPVP8X");
    expect(out[20]! & 0x18).toBe(0x18); // EXIF and alpha flags
    expect([out[24]!, out[27]!]).toEqual([9, 4]); // width 10, height 5 (stored minus one)
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
    const exifAt = out.length - 8 - 66;
    expect(at(exifAt)).toBe("EXIF");
    const dv = new DataView(out.buffer, exifAt + 8, 66);
    expect(dv.getUint32(50, true)).toBe(300); // XResolution 300 / 1
    expect(dv.getUint32(58, true)).toBe(300);
    // again with another resolution: replaced, not doubled
    const again = new Uint8Array(await (await webpWithDpi(new Blob([out]), 96)).arrayBuffer());
    expect(again.length).toBe(out.length);
    expect(new DataView(again.buffer, again.length - 66, 66).getUint32(50, true)).toBe(96);
    const junk = new Blob([new Uint8Array([1, 2, 3])]);
    expect(await webpWithDpi(junk, 300)).toBe(junk);
  });
});

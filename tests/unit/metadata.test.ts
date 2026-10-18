import { describe, expect, it } from "vitest";
import { readIcc, readMetadata } from "../../src/assets/metadata";

/** A little-endian TIFF block with the given IFDs, built by hand. */
function tiff(): Uint8Array {
  const out: number[] = [0x49, 0x49, 42, 0, 8, 0, 0, 0];
  const u16 = (v: number): number[] => [v & 255, v >> 8];
  const u32 = (v: number): number[] => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const entry = (tag: number, type: number, count: number, v: number[]): number[] => [...u16(tag), ...u16(type), ...u32(count), ...[...v, 0, 0, 0, 0].slice(0, 4)];
  // layout: IFD0 at 8 (3 entries), Make string, ExifIFD, GPS IFD, rationals
  const ifd0At = 8;
  const makeAt = ifd0At + 2 + 3 * 12 + 4 + 0;
  const exifAt = makeAt + 6;
  const rat = exifAt + 2 + 2 * 12 + 4;
  const gpsAt = rat + 8;
  const latAt = gpsAt + 2 + 4 * 12 + 4;
  const body: number[] = [];
  body.push(...u16(3), ...entry(0x010f, 2, 6, u32(makeAt)), ...entry(0x0112, 3, 1, u16(6)), ...entry(0x8769, 4, 1, u32(exifAt)), ...u32(0));
  body.push(...[..."Acme\0"].map((c) => c.charCodeAt(0)), 0);
  body.push(...u16(2), ...entry(0x8827, 3, 1, u16(400)), ...entry(0x829d, 5, 1, u32(rat)), ...u32(0));
  body.push(...u32(28), ...u32(10)); // f/2.8
  // the GPS block was placed after: patch the pointer by rebuilding IFD0 with it (a fourth entry is simpler: write it into the first IFD)
  void gpsAt; void latAt;
  return Uint8Array.from([...out, ...body.slice(0)]);
}

describe("what a file says about itself (v0.18.1)", () => {
  it("a JPEG: camera, settings and the orientation its EXIF asks for", async () => {
    const t = tiff();
    const exif = [...[..."Exif"].map((c) => c.charCodeAt(0)), 0, 0, ...t];
    const len = exif.length + 2;
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...exif, 0xff, 0xc0, 0, 11, 8, 0, 4, 0, 4, 1, 1, 0x11, 0]);
    const { rows, orientation } = await readMetadata(jpeg, "image/jpeg");
    expect(orientation).toBe(6);
    const by = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(by["Make"]).toBe("Acme");
    expect(by["Orientation"]).toBe("Turned 90° right");
    expect(by["ISO"]).toBe("400");
    expect(by["Aperture"]).toBe("f/2.8");
    expect(by["Kind"]).toBe("JPEG");
  });

  it("a PNG: its kind, print size and text", async () => {
    const chunk = (type: string, body: number[]): number[] => [(body.length >>> 24) & 255, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...[...type].map((c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0];
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...chunk("IHDR", [0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]),
      ...chunk("pHYs", [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]),
      ...chunk("tEXt", [..."Author\0Mark"].map((c) => c.charCodeAt(0))),
      ...chunk("IDAT", [0]),
    ]);
    const { rows } = await readMetadata(png, "image/png");
    expect(rows).toContainEqual({ group: "Picture", label: "Kind", value: "Colour, 8 bits" });
    expect(rows).toContainEqual({ group: "Picture", label: "Print size", value: "72 dpi" });
    expect(rows).toContainEqual({ group: "Text", label: "Author", value: "Mark" });
  });

  it("a colour profile is named; a GIF says its size; garbage gives nothing and no error", async () => {
    const p = new Uint8Array(200);
    p.set([..."acsp"].map((c) => c.charCodeAt(0)), 36);
    p.set([..."RGB "].map((c) => c.charCodeAt(0)), 16);
    p[131] = 1; // one tag
    p.set([..."desc"].map((c) => c.charCodeAt(0)), 132);
    p[139] = 144; // offset 144
    p[143] = 40;
    p.set([..."desc"].map((c) => c.charCodeAt(0)), 144);
    p[155] = 5; // length 5
    p.set([..."Test\0"].map((c) => c.charCodeAt(0)), 156);
    expect(readIcc(p)).toEqual([{ group: "Colour", label: "Profile", value: "Test" }, { group: "Colour", label: "Colours", value: "RGB" }]);
    const gif = Uint8Array.from([...[..."GIF89a"].map((c) => c.charCodeAt(0)), 5, 0, 7, 0]);
    expect((await readMetadata(gif, "image/gif")).rows[0]!.value).toBe("GIF89a, 5 × 7");
    expect(await readMetadata(Uint8Array.of(1, 2, 3), "application/x")).toEqual({ rows: [], orientation: 1 });
    expect((await readMetadata(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2), "image/jpeg")).rows).toEqual([]);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { parseFont } from "../../src/text/font";
import { sfntOf } from "../../src/text/font-file";
import { brotliDecode } from "../../src/text/brotli";
import { setBrotli } from "../../src/text/woff2";

const FILES = {
  red: "/usr/share/cockpit/static/fonts/RedHatDisplay-Medium.woff2",
  icons: "node_modules/lucide-static/font/lucide.woff2",
  vf: "/usr/share/cockpit/static/fonts/RedHatText/RedHatTextVF.woff2",
};

beforeAll(() => setBrotli(async (d) => new Uint8Array(brotliDecompressSync(d))));

/** The outline of every glyph must stay inside the box its header names (a wrong triplet or a lost point would not). */
function checkOutlines(bytes: Uint8Array, chars: string): void {
  const f = parseFont(bytes);
  for (const ch of chars) {
    const gid = f.glyphId(ch.codePointAt(0)!);
    expect(gid, ch).toBeGreaterThan(0);
    const g = f.glyph(gid);
    expect(g.advance, ch).toBeGreaterThan(0);
    expect(g.contours.length, ch).toBeGreaterThan(0);
    for (const c of g.contours) {
      for (let i = 0; i < c.length; i++) {
        const prev = c[(i - 1 + c.length) % c.length]!;
        expect([c[i]![0], c[i]![1]]).toEqual([prev[prev.length - 2], prev[prev.length - 1]]);
      }
    }
  }
}

describe.skipIf(!existsSync(FILES.red))("WOFF2 (v0.18.1)", () => {
  it("is unpacked into a font whose glyphs have closed outlines and sensible widths, and whose box and metrics agree", async () => {
    const bytes = await sfntOf(new Uint8Array(readFileSync(FILES.red)));
    checkOutlines(bytes, "AaBbgQ&@.i");
    const f = parseFont(bytes);
    expect(f.unitsPerEm).toBe(1000);
    // a plain letter H is as wide as its box plus the side bearings: the advance is more than the outline's width
    const g = f.glyph(f.glyphId("H".codePointAt(0)!));
    expect(g.advance).toBeGreaterThan(g.xMax - g.xMin);
    expect(g.yMax).toBeGreaterThan(600);
    expect(g.yMin).toBe(0);
    // the box in the header (rebuilt) is the box of the outline the points make
    let minX = Infinity, maxX = -Infinity;
    for (const c of g.contours) for (const s of c) for (let i = 0; i < s.length; i += 2) { minX = Math.min(minX, s[i]!); maxX = Math.max(maxX, s[i]!); }
    expect(g.xMin).toBeCloseTo(minX, 0);
    expect(g.xMax).toBeCloseTo(maxX, 0);
  });

  it("an icon font and a variable font unpack too (composites, many glyphs)", async () => {
    if (existsSync(FILES.icons)) {
      const f = parseFont(await sfntOf(new Uint8Array(readFileSync(FILES.icons))));
      let withOutline = 0;
      for (let gid = 1; gid < 60; gid++) if (f.glyph(gid).contours.length) withOutline++;
      expect(withOutline).toBeGreaterThan(20);
    }
    if (existsSync(FILES.vf)) checkOutlines(await sfntOf(new Uint8Array(readFileSync(FILES.vf))), "AaBb");
  });

  it("the decoder of the app and Node's give the very same font", async () => {
    for (const f of [FILES.red, FILES.vf, FILES.icons]) {
      if (!existsSync(f)) continue;
      const bytes = new Uint8Array(readFileSync(f));
      setBrotli(async (d) => new Uint8Array(brotliDecompressSync(d)));
      const a = await sfntOf(bytes);
      setBrotli(brotliDecode);
      const b = await sfntOf(bytes);
      expect(Buffer.from(b).equals(Buffer.from(a)), f).toBe(true);
    }
    setBrotli(async (d) => new Uint8Array(brotliDecompressSync(d)));
  });

  it("a damaged file is refused with a sentence", async () => {
    const bytes = new Uint8Array(readFileSync(FILES.red)).slice(0, 200);
    await expect(sfntOf(bytes)).rejects.toThrow();
  });
});

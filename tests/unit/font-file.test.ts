import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { FontError, parseFont } from "../../src/text/font";
import type { Font } from "../../src/text/font";
import { sfntOf } from "../../src/text/font-file";
import { faceReady, familyFor, fontFor, registerFont } from "../../src/text/fonts";
import { layoutText, setFont } from "../../src/text/layout";

const TTF = new Uint8Array(readFileSync("node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"));

/** The same font as a WOFF 1.0 file: every table deflated when that is smaller. */
function toWoff(ttf: Uint8Array): Uint8Array {
  const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const n = v.getUint16(4);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const e = 12 + 16 * i;
    const off = v.getUint32(e + 8), len = v.getUint32(e + 12);
    const raw = ttf.subarray(off, off + len);
    const z = deflateSync(raw);
    tables.push({ tag: ttf.subarray(e, e + 4), sum: v.getUint32(e + 4), raw, data: z.length < raw.length ? new Uint8Array(z) : raw });
  }
  let at = 44 + 20 * n;
  const offsets = tables.map((t) => { const o = at; at += (t.data.length + 3) & ~3; return o; });
  const out = new Uint8Array(at);
  const o = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x46]);
  o.setUint32(4, v.getUint32(0));
  o.setUint32(8, at);
  o.setUint16(12, n);
  tables.forEach((t, i) => {
    const e = 44 + 20 * i;
    out.set(t.tag, e);
    o.setUint32(e + 4, offsets[i]!);
    o.setUint32(e + 8, t.data.length);
    o.setUint32(e + 12, t.raw.length);
    o.setUint32(e + 16, t.sum);
    out.set(t.data, offsets[i]!);
  });
  return out;
}

let font: Font;
beforeAll(() => {
  font = parseFont(TTF);
  setFont(font);
});

describe("font files (ADR 0127)", () => {
  it("a .woff is unpacked into a font that reads the same as the .ttf, and what cannot be read is refused with a reason", async () => {
    expect(await sfntOf(TTF)).toBe(TTF);
    const unpacked = parseFont(await sfntOf(toWoff(TTF)));
    for (const ch of "AgÉ&") {
      const cp = ch.codePointAt(0)!;
      expect(unpacked.glyphId(cp)).toBe(font.glyphId(cp));
      expect(unpacked.glyph(unpacked.glyphId(cp)).advance).toBe(font.glyph(font.glyphId(cp)).advance);
      expect(unpacked.glyph(unpacked.glyphId(cp)).contours.length).toBe(font.glyph(font.glyphId(cp)).contours.length);
    }
    const head = (tag: string): Uint8Array => { const b = new Uint8Array(64); b.set([...tag].map((c) => c.charCodeAt(0))); return b; };
    await expect(sfntOf(head("OTTO"))).rejects.toThrow(/PostScript/);
    await expect(sfntOf(head("wOF2"))).rejects.toThrow(/WOFF2/);
    await expect(sfntOf(head("ttcf"))).rejects.toThrow(/collection/);
    await expect(sfntOf(head("JUNK"))).rejects.toThrow(FontError);
  });

  it("a text names its font by the hash: layout uses that font, any other text the bundled one", () => {
    const wide: Font = { ...font, glyph: (g) => ({ ...font.glyph(g), advance: font.glyph(g).advance * 2 }) };
    const hash = "ab".repeat(32);
    expect(fontFor(hash)).toBe(font); // not loaded: the bundled font
    const before = layoutText("Hello", Infinity, { assetId: hash }).width;
    registerFont(hash, wide, "canvast-font-test", false);
    expect(fontFor(hash)).toBe(wide);
    expect(layoutText("Hello", Infinity, { assetId: hash }).width).toBeCloseTo(before * 2, 6); // (the cache was dropped when it arrived)
    expect(layoutText("Hello", Infinity).width).toBeCloseTo(before, 6);
    expect(faceReady(hash)).toBe(false); // the browser did not take it: letters are drawn from outlines
    expect(familyFor(hash)).toBe(familyFor());
    registerFont(hash, wide, "canvast-font-test", true);
    expect(familyFor(hash)).toBe("canvast-font-test");
  });
});

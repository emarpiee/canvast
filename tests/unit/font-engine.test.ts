import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFont } from "../../src/text/font";
import type { Font } from "../../src/text/font";
import { sfntOf } from "../../src/text/font-file";

const NOTO_VF = "/usr/share/fonts/google-noto-vf/NotoSans[wght].ttf";
const CFF = "/usr/share/fonts/aajohan-comfortaa-fonts/Comfortaa-Regular.otf";
const CFF2 = "/usr/share/fonts/abattis-cantarell-vf-fonts/Cantarell-VF.otf";
const INTER = "node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf";
const load = async (p: string): Promise<Font> => parseFont(await sfntOf(new Uint8Array(readFileSync(p))));
const gid = (f: Font, ch: string): number => f.glyphId(ch.codePointAt(0)!);
const ink = (f: Font, ch: string) => f.glyph(gid(f, ch));

function closed(f: Font, chars: string): void {
  for (const ch of chars) {
    const g = ink(f, ch);
    expect(g.contours.length, ch).toBeGreaterThan(0);
    for (const c of g.contours) {
      for (let i = 0; i < c.length; i++) {
        const prev = c[(i - 1 + c.length) % c.length]!;
        expect([c[i]![0], c[i]![1]], ch).toEqual([prev[prev.length - 2], prev[prev.length - 1]]);
        expect(c[i]!.length === 4 || c[i]!.length === 6).toBe(true);
      }
    }
  }
}

describe.skipIf(!existsSync(CFF))("PostScript (CFF) outlines (v0.18.1)", () => {
  it("are read into closed lines and quadratics, with the metrics of the font", async () => {
    const f = await load(CFF);
    expect(f.names.family).toMatch(/Comfortaa/i);
    closed(f, "AaBbgQ&@.i%");
    const o = ink(f, "o");
    expect(o.contours.length).toBe(2); // an outside and a hole
    expect(o.xMax - o.xMin).toBeLessThan(o.advance);
    expect(o.yMax).toBeGreaterThan(300);
    // an O is round: its outline is about as tall as it is wide, and the curve is smooth (many short quadratics, not a few lines)
    const O = ink(f, "O");
    expect(O.contours[0]!.length).toBeGreaterThan(8);
  });
});

describe.skipIf(!existsSync(NOTO_VF))("variable TrueType (gvar, HVAR) (v0.18.1)", () => {
  it("has its axes with names and ranges; a weight changes the outline and the advance; the default is the font itself", async () => {
    const f = await load(NOTO_VF);
    const wght = f.axes.find((a) => a.tag === "wght")!;
    expect(wght.max).toBeGreaterThan(wght.def);
    expect(wght.name.length).toBeGreaterThan(0);
    const normal = ink(f, "H");
    const bold = f.instance({ wght: wght.max });
    expect(f.instance({ wght: wght.def })).toBe(f);
    expect(f.instance({})).toBe(f);
    // a stem is thicker in bold: the box is wider, and so is the advance
    expect(ink(bold, "H").xMax - ink(bold, "H").xMin).toBeGreaterThan(normal.xMax - normal.xMin);
    expect(ink(bold, "H").advance).toBeGreaterThan(normal.advance);
    closed(bold, "AaBbgQ&@éÅ");
    // the same position gives the very same instance, and one in between is between
    expect(f.instance({ wght: 650 })).toBe(f.instance({ wght: 650 }));
    const mid = f.instance({ wght: (wght.def + wght.max) / 2 });
    expect(ink(mid, "H").advance).toBeGreaterThan(normal.advance);
    expect(ink(mid, "H").advance).toBeLessThan(ink(bold, "H").advance);
    // a value outside the range is held at the end
    expect(ink(f.instance({ wght: 99999 }), "H").advance).toBe(ink(bold, "H").advance);
  });
});

describe.skipIf(!existsSync(CFF2))("variable PostScript (CFF2) (v0.18.1)", () => {
  it("is read, and a weight changes it", async () => {
    const f = await load(CFF2);
    closed(f, "AaBbg&");
    const wght = f.axes.find((a) => a.tag === "wght")!;
    expect(wght).toBeDefined();
    const bold = f.instance({ wght: wght.max });
    closed(bold, "AaBbg&");
    expect(ink(bold, "H").xMax - ink(bold, "H").xMin).toBeGreaterThan(ink(f, "H").xMax - ink(f, "H").xMin);
    const thin = f.instance({ wght: wght.min });
    expect(ink(thin, "H").xMax - ink(thin, "H").xMin).toBeLessThan(ink(f, "H").xMax - ink(f, "H").xMin);
  });
});

describe.skipIf(!existsSync(INTER))("kerning and features (v0.18.1)", () => {
  it("kerns a pair that sits close (A V) and not one that does not, and knows the features of the font", async () => {
    const f = await load(INTER);
    expect(f.kern(gid(f, "A"), gid(f, "V"))).toBeLessThan(-20);
    expect(f.kern(gid(f, "H"), gid(f, "H"))).toBe(0);
    const tags = f.features();
    expect(tags).toEqual(expect.arrayContaining(["case"]));
    // the glyphs after a feature: with nothing asked they are the same
    const gs = [..."office"].map((c) => gid(f, c));
    expect(f.shape(gs, []).map((x) => x.gid)).toEqual(gs);
    const tnum = f.shape([...("0123")].map((c) => gid(f, c)), ["tnum"]);
    if (tags.includes("tnum")) expect(tnum.map((x) => x.gid)).not.toEqual([...("0123")].map((c) => gid(f, c)));
  });
});

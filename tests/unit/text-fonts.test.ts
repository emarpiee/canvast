import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseFont } from "../../src/text/font";
import type { Font } from "../../src/text/font";
import { faceStyleOf, glyphFont, registerFont, variantOf } from "../../src/text/fonts";
import { layoutText, setFont } from "../../src/text/layout";

const INTER = "node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf";
const NOTO = (style: string): string => `/usr/share/fonts/google-noto/NotoSans-${style}.ttf`;
const NOTO_VF = "/usr/share/fonts/google-noto-vf/NotoSans[wght].ttf";
const load = (p: string): Font => parseFont(new Uint8Array(readFileSync(p)));

let inter: Font;
beforeAll(() => {
  inter = load(INTER);
  setFont(inter);
});

describe("kerning and features in the layout (v0.18.1)", () => {
  it("kerning is off unless asked, then a pair that sits close moves in; a feature changes the glyphs it names", () => {
    const plain = layoutText("AVAV", Infinity);
    const kerned = layoutText("AVAV", Infinity, { kerning: true });
    expect(kerned.width).toBeLessThan(plain.width - 0.05);
    expect(layoutText("HHHH", Infinity, { kerning: true }).width).toBeCloseTo(layoutText("HHHH", Infinity).width, 6);
    // the glyph of a numeral under `tnum` is another glyph when the font has that feature
    if (inter.features().includes("tnum")) {
      const a = layoutText("1111", Infinity).lines[0]!.glyphs;
      const b = layoutText("1111", Infinity, { features: ["tnum"] }).lines[0]!.glyphs;
      expect(b[0]!.gid).not.toBe(a[0]!.gid);
      expect(b[0]!.sub).toBe(true);
      expect(a[0]!.sub).toBeUndefined();
    }
    // a feature the font does not have changes nothing
    expect(layoutText("abc", Infinity, { features: ["zzzz"] }).width).toBeCloseTo(layoutText("abc", Infinity).width, 9);
  });
});

describe.skipIf(!existsSync(NOTO("Bold")))("a family's own bold and italic files (v0.18.1)", () => {
  it("bold words are set in the family's bold file, not thickened, when the library has one; else they are thickened", () => {
    const regular = load(NOTO("Regular")), bold = load(NOTO("Bold"));
    registerFont("a".repeat(64), regular, "canvast-fam-noto-sans", true);
    // before the bold file is there: the words are thickened
    const lone = variantOf("a".repeat(64), true, false);
    expect(lone).toEqual({ ref: "a".repeat(64), fakeBold: true, fakeItalic: false });
    registerFont("b".repeat(64), bold, "canvast-fam-noto-sans", true);
    const v = variantOf("a".repeat(64), true, false);
    expect(v).toEqual({ ref: "b".repeat(64), fakeBold: false, fakeItalic: false });
    expect(faceStyleOf("b".repeat(64)).weight).toBe(700);
    // a plain text asks for no other file
    expect(variantOf("a".repeat(64), false, false)).toEqual({ ref: "a".repeat(64), fakeBold: false, fakeItalic: false });
    // italic: no italic file, so it is slanted
    expect(variantOf("a".repeat(64), false, true).fakeItalic).toBe(true);
    // in the layout: the bold word's glyphs name the bold file, are wider than the regular ones, and carry no synthetic bold
    const lay = layoutText("aa **aa**", Infinity, { assetId: "a".repeat(64) });
    const g = lay.lines[0]!.glyphs;
    expect(g[0]!.face).toBeUndefined();
    expect(g[3]!.face).toBe("b".repeat(64));
    expect(g[3]!.bold).toBe(false);
    expect(g[3]!.adv).toBeGreaterThan(g[0]!.adv);
    expect(glyphFont({ assetId: "a".repeat(64) }, g[3]!)).toBe(bold);
  });
});

describe.skipIf(!existsSync(NOTO_VF))("a variable font in the layout (v0.18.1)", () => {
  it("a weight is wider than the default and keeps the layout deterministic", () => {
    const vf = load(NOTO_VF);
    registerFont("c".repeat(64), vf, "canvast-fam-noto-sans", true);
    const base = layoutText("Hamburg", Infinity, { assetId: "c".repeat(64) });
    const heavy = layoutText("Hamburg", Infinity, { assetId: "c".repeat(64), axes: { wght: 700 } });
    expect(heavy.width).toBeGreaterThan(base.width);
    expect(layoutText("Hamburg", Infinity, { assetId: "c".repeat(64), axes: { wght: 700 } })).toBe(heavy); // cached
    expect(glyphFont({ assetId: "c".repeat(64), axes: { wght: 700 } }, {}).glyph(vf.glyphId(72)).advance).toBeGreaterThan(vf.glyph(vf.glyphId(72)).advance);
  });
});

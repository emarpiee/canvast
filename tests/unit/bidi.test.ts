import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { arabicForms, bidiLevels, hasRtl, joiningOf, mirrored, visualOrder } from "../../src/text/bidi";
import { parseFont } from "../../src/text/font";
import { registerFont } from "../../src/text/fonts";
import { layoutText, setFont } from "../../src/text/layout";

const cps = (s: string): number[] => [...s].map((c) => c.codePointAt(0)!);
const shown = (s: string): string => {
  const c = cps(s);
  const { levels } = bidiLevels(c);
  return visualOrder(levels, 0, c.length).map((i) => String.fromCodePoint(c[i]!)).join("");
};

describe("bidirectional text (v0.18.1)", () => {
  it("puts Hebrew in reading order inside Latin text, and Latin and numbers inside Hebrew", () => {
    expect(hasRtl(cps("abc"))).toBe(false);
    expect(hasRtl(cps("abc אבג"))).toBe(true);
    expect(shown("abc def")).toBe("abc def");
    expect(shown("abc אבג def")).toBe("abc גבא def");
    expect(shown("אבג abc")).toBe("abc גבא"); // a right to left paragraph: the first word is at the right
    expect(shown("אבג 123")).toBe("123 גבא"); // numbers stay left to right
    expect(shown("אבג, abc")).toBe("abc ,גבא");
    expect(shown("12 אבג")).toBe("גבא 12");
    // a number after a Latin letter is left to right text; a minus between numbers belongs to them
    expect(shown("a 1-2 b")).toBe("a 1-2 b");
    expect(bidiLevels(cps("אבג")).paragraph).toBe(1);
    expect(bidiLevels(cps("abc")).paragraph).toBe(0);
    expect(bidiLevels(cps("123")).paragraph).toBe(0);
  });

  it("turns brackets round in right to left runs", () => {
    expect(mirrored(0x28)).toBe(0x29);
    expect(mirrored(0xbb)).toBe(0xab);
    expect(mirrored(0x61)).toBeNull();
  });

  it("knows how Arabic letters join: a word has an initial, medial and final form; letters that join only to the one before end the join", () => {
    expect(joiningOf(0x628)).toBe("D"); // beh
    expect(joiningOf(0x627)).toBe("R"); // alef
    expect(joiningOf(0x621)).toBe("U"); // hamza
    expect(joiningOf(0x64e)).toBe("T"); // a mark
    expect(arabicForms(cps("بيت"))).toEqual(["init", "medi", "fina"]);
    expect(arabicForms(cps("ار"))).toEqual(["isol", "isol"]);
    expect(arabicForms(cps("با"))).toEqual(["init", "fina"]);
    expect(arabicForms(cps("ب"))).toEqual(["isol"]);
    expect(arabicForms(cps("a ب"))).toEqual([null, null, "isol"]);
  });
});

const VAZIR = "/usr/share/fonts/vazirmatn-vf-fonts/Vazirmatn[wght].ttf";
describe("bidirectional text in the layout (v0.18.1)", () => {
  beforeAll(() => setFont(parseFont(new Uint8Array(readFileSync("node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf")))));

  it("a line is set in reading order: the first Hebrew letter of a word is at the right of the word", () => {
    const g = layoutText("abc אבג", Infinity).lines[0]!.glyphs;
    const hebrew = g.filter((x) => x.cp >= 0x5d0 && x.cp <= 0x5ea);
    expect(hebrew.map((x) => String.fromCodePoint(x.cp)).join("")).toBe("גבא"); // drawn left to right: gimel, bet, alef
    expect(hebrew[0]!.x).toBeGreaterThan(g[2]!.x); // after the Latin word
    // text without any Hebrew or Arabic is untouched
    expect(layoutText("abc def", Infinity).lines[0]!.glyphs.map((x) => String.fromCodePoint(x.cp)).join("")).toBe("abc def");
  });

  it("brackets in a right to left run are the mirrored ones", () => {
    const g = layoutText("א(ב)", Infinity).lines[0]!.glyphs.map((x) => String.fromCodePoint(x.cp)).join("");
    expect(g).toBe("(ב)א"); // drawn left to right: the brackets are the mirrored ones, so it reads right to left as א(ב)
  });

  it.skipIf(!existsSync(VAZIR))("Arabic letters take their joined forms from the font and are set right to left", () => {
    const f = parseFont(new Uint8Array(readFileSync(VAZIR)));
    registerFont("d".repeat(64), f, "canvast-fam-vazirmatn", true);
    const g = layoutText("بيت", Infinity, { assetId: "d".repeat(64) }).lines[0]!.glyphs;
    expect(g).toHaveLength(3);
    // each letter is a form the font substituted, and none is the plain glyph of its character
    for (const x of g) expect(x.sub).toBe(true);
    // set right to left: the first letter of the word (beh) is the rightmost glyph
    const beh = f.glyphId(0x628);
    expect(g[2]!.gid).not.toBe(beh);
    expect(g[2]!.x).toBeGreaterThan(g[0]!.x);
    // the joined forms differ from the isolated forms of the same letters
    const isolated = layoutText("ب", Infinity, { assetId: "d".repeat(64) }).lines[0]!.glyphs[0]!;
    expect(g[2]!.gid).not.toBe(isolated.gid);
  });
});

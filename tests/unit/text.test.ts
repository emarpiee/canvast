import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { parseFont } from "../../src/text/font";
import type { Font } from "../../src/text/font";
import { layoutText, setFont, LINE_HEIGHT } from "../../src/text/layout";
import { canonical, normalizeSpans, parse, serialize } from "../../src/text/markdown";
import type { Block } from "../../src/text/markdown";
import { deserializeObject, localBounds, serializeObject, validateObject } from "../../src/doc/model";
import type { TextObject } from "../../src/doc/model";
import { scaleAbout } from "../../src/doc/edit-ops";

let font: Font;
beforeAll(() => {
  font = parseFont(new Uint8Array(readFileSync("node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf")));
  setFont(font);
});

describe("font", () => {
  it("reads metrics, the character map and closed quadratic outlines", () => {
    expect(font.unitsPerEm).toBe(2048);
    expect(font.ascender).toBeGreaterThan(0);
    expect(font.descender).toBeLessThan(0);
    const gid = font.glyphId("A".codePointAt(0)!);
    expect(gid).toBeGreaterThan(0);
    expect(font.glyphId(0x4e2d)).toBe(0); // CJK: not in the font, drawn with a system font
    for (const ch of "AOgé&%Ж") {
      const g = font.glyph(font.glyphId(ch.codePointAt(0)!));
      expect(g.advance, ch).toBeGreaterThan(0);
      expect(g.contours.length, ch).toBeGreaterThan(0);
      for (const c of g.contours) {
        // Each piece starts where the previous one ended, and the contour closes.
        for (let i = 0; i < c.length; i++) {
          const prev = c[(i - 1 + c.length) % c.length]!;
          expect([c[i]![0], c[i]![1]], ch).toEqual([prev[prev.length - 2], prev[prev.length - 1]]);
          expect(c[i]!.length === 4 || c[i]!.length === 6).toBe(true);
          // Coordinates are exact dyadics (integers or halves, scaled by 2.14 fixed point at most).
          for (const v of c[i]!) expect(Number.isInteger(v * 2 ** 15)).toBe(true);
        }
      }
    }
    // "é" is a composite glyph (base + accent) in most fonts: it has more contours than "e".
    const e = font.glyph(font.glyphId(101)).contours.length;
    expect(font.glyph(font.glyphId(0xe9)).contours.length).toBeGreaterThan(e);
  });
});

describe("markdown", () => {
  const blocks: Block[] = [
    { type: "h1", spans: [{ text: "Title ", bold: false, italic: false }, { text: "here", bold: true, italic: false }] },
    { type: "p", spans: [{ text: "a ", bold: false, italic: false }, { text: "b c", bold: true, italic: true }, { text: " d", bold: false, italic: true }] },
    { type: "ul", spans: [{ text: "one", bold: false, italic: false }] },
    { type: "ul", spans: [{ text: "two * star _ under \\ back", bold: false, italic: false }] },
    { type: "ol", spans: [{ text: "first", bold: false, italic: false }] },
    { type: "ol", spans: [{ text: "second", bold: false, italic: false }] },
    { type: "p", spans: [{ text: "# not a heading, 1. not a list, - not a bullet", bold: false, italic: false }] },
    { type: "h3", spans: [{ text: "<tag> & [link](x) `code` ~strike~", bold: false, italic: false }] },
  ];

  it("serializes to canonical Markdown and parses back to the same blocks", () => {
    const md = serialize(blocks);
    expect(md).toBe(
      [
        "# Title **here**",
        "",
        "a ***b c** d*",
        "",
        "- one",
        "- two \\* star \\_ under \\\\ back",
        "",
        "1. first",
        "2. second",
        "",
        "\\# not a heading, 1. not a list, - not a bullet",
        "",
        "### \\<tag> \\& \\[link\\](x) \\`code\\` \\~strike\\~",
      ].join("\n"),
    );
    expect(parse(md)).toEqual(blocks.map((b) => ({ type: b.type, spans: normalizeSpans(b.spans) })));
    expect(canonical(md)).toBe(md);
  });

  it("keeps whitespace outside emphasis and drops empty blocks", () => {
    expect(serialize([{ type: "p", spans: [{ text: "x", bold: false, italic: false }, { text: " y ", bold: true, italic: false }, { text: "z", bold: false, italic: false }] }])).toBe("x **y** z");
    expect(serialize([{ type: "p", spans: [{ text: "  ", bold: true, italic: false }] }, { type: "p", spans: [{ text: "k", bold: false, italic: false }] }])).toBe("k");
  });

  it("reads and writes mentions by stable id", () => {
    const md = "see [[item:ab12|the \\] plan]] now";
    const [b] = parse(md);
    expect(b!.spans.map((s) => [s.text, s.ref])).toEqual([["see ", undefined], ["the ] plan", "ab12"], [" now", undefined]]);
    expect(canonical(md)).toBe(md);
    expect(canonical("\\[\\[item:ab12|x]]")).toBe("\\[\\[item:ab12|x\\]\\]"); // plain brackets stay text
  });

  it("reads hand-written Markdown into canonical form", () => {
    expect(canonical("Hello\nworld  \n\n* item\n+ item 2\n3) three\n\n#### deep\n__b__ _i_")).toBe("Hello world\n\n- item\n- item 2\n\n1. three\n\n### deep\n\n**b** *i*");
    expect(canonical("****")).toBe("\\*\\*\\*\\*");
  });

  it("round-trips arbitrary text exactly (canonical form is a fixed point)", () => {
    let seed = 7;
    const rnd = (n: number): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const alphabet = "ab *_\\#-+1.)[]<>&`~ é中";
    const types = ["p", "h1", "h2", "h3", "ul", "ol"] as const;
    for (let t = 0; t < 300; t++) {
      const bs: Block[] = [];
      for (let b = rnd(4) + 1; b > 0; b--) {
        const spans = [];
        for (let s = rnd(4) + 1; s > 0; s--) {
          let text = "";
          for (let c = rnd(6) + 1; c > 0; c--) text += alphabet[rnd(alphabet.length)];
          if (rnd(5) === 0) spans.push({ text: "x" + text, bold: false, italic: false, ref: `id${rnd(9)}-_` }); // a mention
          else spans.push({ text, bold: rnd(2) === 1, italic: rnd(2) === 1 });
        }
        bs.push({ type: types[rnd(types.length)]!, spans });
      }
      const md = serialize(bs);
      expect(serialize(parse(md)), md).toBe(md);
      expect(parse(md).map((b) => b.spans.map((s) => s.text).join("")), md).toEqual(
        bs.map((b) => b.spans.map((s) => s.text).join("").replace(/\s+/g, " ").trim()).filter((s) => s),
      );
    }
  });
});

describe("layout", () => {
  it("wraps greedily at spaces and breaks long words by character", () => {
    const one = layoutText("hello", 100);
    expect(one.lines).toHaveLength(1);
    expect(one.height).toBe(LINE_HEIGHT);
    const wrapped = layoutText("aaa bbb ccc ddd eee", 4);
    expect(wrapped.lines.length).toBeGreaterThan(1);
    for (const l of wrapped.lines) {
      const last = l.glyphs[l.glyphs.length - 1]!;
      expect(last.x + last.adv).toBeLessThanOrEqual(4 + 1e-9);
      expect(l.glyphs[0]!.cp).not.toBe(32); // no leading space after a break
    }
    const long = layoutText("x".repeat(50), 3);
    expect(long.lines.length).toBeGreaterThan(5);
  });

  it("sizes headings and indents list items", () => {
    const l = layoutText("# Big\n\n- item", 50);
    expect(l.lines[0]!.scale).toBe(2);
    expect(l.lines[0]!.bottom - l.lines[0]!.top).toBeCloseTo(2 * LINE_HEIGHT);
    expect(l.lines[1]!.glyphs[0]!.cp).toBe(0x2022); // bullet
    expect(l.lines[1]!.glyphs[1]!.x).toBeGreaterThan(1);
  });

  it("is independent of the absolute size (layout is in em)", () => {
    const md = "The quick brown fox jumps over the lazy dog. ".repeat(4);
    const a = layoutText(md, 12);
    expect(layoutText(md, 12)).toBe(a); // cached
    expect(a.lines.length).toBeGreaterThan(2);
  });
});

describe("text objects", () => {
  const text = (md: string): TextObject => ({
    id: "a".repeat(32),
    kind: "text",
    anchor: { x: D.fromNumber(3), y: D.fromNumber(-5) },
    unit: -4,
    z: 1,
    opacity: 1,
    attachmentTargetId: null,
    md,
    w: 200,
    size: 16,
    color: "#1f2329",
  });

  it("validates, serializes and canonicalizes on load", () => {
    const o = text("Hello **world**");
    expect(validateObject(o)).toBe(o);
    const back = deserializeObject(JSON.parse(JSON.stringify(serializeObject(o))));
    expect(back).toEqual(o);
    const loose = deserializeObject({ ...serializeObject(o), md: "Hello __world__" });
    expect((loose as TextObject).md).toBe("Hello **world**");
    expect(() => deserializeObject({ ...serializeObject(o), md: "   " })).toThrow();
    expect(() => validateObject({ ...o, size: 0 })).toThrow();
  });

  it("has bounds from its layout and scales uniformly", () => {
    const o = text("line one\n\nline two");
    const b = localBounds(o);
    expect(b.minX).toBeLessThan(0);
    expect(b.maxY).toBeGreaterThan(2 * LINE_HEIGHT * 16);
    const s = scaleAbout(o, o.anchor, 2, 2) as TextObject;
    expect(s.size * 2 ** s.unit).toBe(o.size * 2 ** o.unit * 2);
    expect(() => scaleAbout(o, o.anchor, 2, 3)).toThrow();
  });
});

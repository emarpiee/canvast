import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { parseFont } from "../../src/text/font";
import type { Font } from "../../src/text/font";
import { layoutOf, layoutText, setFont, LINE_HEIGHT } from "../../src/text/layout";
import { LOOK_LIMITS, lookOf, withLook } from "../../src/text/text-style";
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
          spans.push({ text, bold: rnd(2) === 1, italic: rnd(2) === 1 });
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

  it("aligns lines, justifies all but the last line of a paragraph, and does not wrap without a width (ADR 0126)", () => {
    const md = "aaa bbb ccc ddd eee fff";
    const right = (l: ReturnType<typeof layoutText>, i: number): number => l.lines[i]!.glyphs.reduce((m, g) => Math.max(m, g.x + g.adv), 0);
    const left = layoutText(md, 6);
    expect(left.lines.length).toBeGreaterThan(1);
    const centre = layoutText(md, 6, { align: "center" });
    const end = layoutText(md, 6, { align: "right" });
    for (let i = 0; i < left.lines.length; i++) {
      expect(right(end, i)).toBeCloseTo(6, 6);
      expect(right(centre, i)).toBeCloseTo((6 + right(left, i)) / 2, 6);
    }
    const just = layoutText(md, 6, { align: "justify" });
    for (let i = 0; i < just.lines.length - 1; i++) expect(right(just, i)).toBeCloseTo(6, 6);
    expect(right(just, just.lines.length - 1)).toBeCloseTo(right(left, left.lines.length - 1), 6);
    const none = layoutText("one\n\ntwo words here", Infinity);
    expect(none.lines).toHaveLength(2); // only the paragraph break
    expect(none.width).toBeCloseTo(right(none, 1), 6);
  });

  it("is independent of the absolute size (layout is in em)", () => {
    const md = "The quick brown fox jumps over the lazy dog. ".repeat(4);
    const a = layoutText(md, 12);
    expect(layoutText(md, 12)).toBe(a); // cached
    expect(a.lines.length).toBeGreaterThan(2);
  });
});

describe("text look", () => {
  const base = { id: "a", kind: "text", anchor: { x: { m: 0n, e: 0 }, y: { m: 0n, e: 0 } }, unit: 0, z: 0, opacity: 1, attachmentTargetId: null, md: "one two three", w: 4, size: 2, color: "#112233" } as unknown as import("../../src/doc/model").TextObject;
  it("keeps defaults out of the stored form, refits an auto width, and turns a size in px into a local size", () => {
    const auto = withLook(base, { autoWidth: true, align: "center" });
    expect(auto).toMatchObject({ autoWidth: true, align: "center" });
    expect(auto.w).toBeCloseTo(layoutOf(auto).width * auto.size, 9);
    expect(auto.w).not.toBe(base.w);
    const back = withLook(auto, { autoWidth: false, align: "left", lineHeight: 1.3, tracking: 0 });
    expect("autoWidth" in back || "align" in back || "lineHeight" in back || "tracking" in back).toBe(false);
    expect(back.w).toBe(auto.w); // turning auto width off keeps the width it had
    expect(withLook(base, { sizePx: 32 }, 4).size).toBe(8); // 32 px at 4 px per unit
    expect(withLook(base, { sizePx: 1e9 }, 1).size).toBe(LOOK_LIMITS.sizePx[1]);
    expect(lookOf(base, 3).sizePx).toBe(6);
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

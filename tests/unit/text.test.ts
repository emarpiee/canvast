import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { parseFont } from "../../src/text/font";
import type { Font } from "../../src/text/font";
import { layoutOf, layoutText, setFont, LINE_HEIGHT } from "../../src/text/layout";
import { LOOK_LIMITS, lookOf, withLook } from "../../src/text/text-style";
import { canonical, listNumbers, normalizeSpans, parse, serialize } from "../../src/text/markdown";
import type { Block } from "../../src/text/markdown";
import { deserializeObject, localBounds, newObjectId, serializeObject, validateObject } from "../../src/doc/model";
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

  it("reads and writes underline, strikethrough, a colour and a size of a range as the forms other readers know", () => {
    const md = 'a ~~b~~ <u>c</u> <span style="color:#ff0000;font-size:150%">**d**</span> e \\<u> ~~';
    const spans = parse(md)[0]!.spans;
    expect(spans.find((x) => x.text === "b")).toMatchObject({ strike: true });
    expect(spans.find((x) => x.text === "c")).toMatchObject({ underline: true });
    expect(spans.find((x) => x.text === "d")).toMatchObject({ color: "#ff0000", scale: 1.5, bold: true });
    expect(spans.find((x) => x.text.startsWith(" e"))?.color).toBeUndefined();
    expect(canonical(md)).toBe(canonical(canonical(md)));
    expect(canonical('<span style="color:#00f;font-size:5%">x</span>')).toBe('<span style="font-size:10%">x</span>'); // a colour of 3 digits is dropped; a size under 10% is raised
  });

  it("links: [words](address) for a web or mail address only, anything else stays words; the address is kept safe (v0.18.1)", () => {
    const spans = parse("go [here **now**](https://e.com/a b) or [there](https://e.com/x%20y) not [this](javascript:alert(1)) nor [that](ftp://x)")[0]!.spans;
    expect(spans.filter((x) => x.link).map((x) => [x.text, x.link, x.bold])).toEqual([["there", "https://e.com/x%20y", false]]); // (an address with a space in it is not one)
    expect(spans.map((x) => x.text).join("")).toContain("[this](javascript:alert(1))"); // (the words stay as typed, escaped on writing)
    const md = canonical("a [one **two** three](https://e.com/p?q=1) b");
    expect(md).toBe("a [one **two** three](https://e.com/p?q=1) b");
    expect(parse(md)[0]!.spans.filter((x) => x.link)).toHaveLength(3); // one, two (bold), three
    expect(parse("[x](mailto:a@b.c)")[0]!.spans[0]!.link).toBe("mailto:a@b.c");
    expect(canonical("[x](https://e.com/a%29b)")).toBe("[x](https://e.com/a%29b)");
    const lay = layoutText("[ab](https://e.com)", 50).lines[0]!;
    expect(lay.glyphs[0]!.link).toBe("https://e.com");
    expect(lay.decos.map((d) => d.kind)).toEqual(["under"]); // a link is underlined
  });

  it("nested lists: two spaces of indent are a level, numbers count on per level (v0.18.1)", () => {
    const md = "1. one\n  - a\n  - b\n    1. deep\n2. two\n  1. x\n3. three";
    const blocks = parse(md);
    expect(blocks.map((b) => b.level ?? 0)).toEqual([0, 1, 1, 2, 0, 1, 0]);
    expect(serialize(blocks)).toBe(md);
    expect(listNumbers(blocks)).toEqual([1, 0, 0, 1, 2, 1, 3]);
    expect(canonical("- a\n\t- b")).toBe("- a\n  - b"); // a tab is two spaces
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
          spans.push({
            text,
            bold: rnd(2) === 1,
            italic: rnd(2) === 1,
            ...(rnd(3) === 0 ? { underline: true } : {}),
            ...(rnd(3) === 0 ? { strike: true } : {}),
            ...(rnd(3) === 0 ? { color: ["#ff0000", "#00ff0080"][rnd(2)]! } : {}),
            ...(rnd(3) === 0 ? { scale: [0.5, 1.5, 2][rnd(3)]! } : {}),
            ...(rnd(5) === 0 ? { link: "https://e.com/p%28q" } : {}),
          });
        }
        const type = types[rnd(types.length)]!;
        bs.push({ type, spans, ...((type === "ul" || type === "ol") && rnd(3) === 0 ? { level: rnd(4) + 1 } : {}) });
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

  it("a range with its own size is wider and makes its line taller; underline and strikethrough are runs under the glyphs (v0.18.1)", () => {
    const plain = layoutText("ab cd", Infinity);
    const big = layoutText('ab <span style="font-size:200%">cd</span>', Infinity);
    expect(big.width).toBeGreaterThan(plain.width);
    expect(big.lines[0]!.bottom - big.lines[0]!.top).toBeCloseTo(2 * LINE_HEIGHT); // as tall as its biggest range
    expect(big.lines[0]!.glyphs.map((g) => g.k ?? 1)).toEqual([1, 1, 1, 2, 2]);
    const small = layoutText('<span style="font-size:50%">cd</span>', 50);
    expect(small.lines[0]!.bottom - small.lines[0]!.top).toBeCloseTo(0.5 * LINE_HEIGHT); // a line of small text is small
    const u = layoutText("ab <u>cd ef</u> gh", 50).lines[0]!;
    expect(u.decos).toHaveLength(1);
    expect(u.decos[0]!.kind).toBe("under");
    const g = u.glyphs;
    expect(u.decos[0]!.x0).toBeCloseTo(g[3]!.x); // from the first underlined letter...
    expect(u.decos[0]!.x1).toBeCloseTo(g[7]!.x + g[7]!.adv); // ...to the end of the last, spaces between included
    expect(layoutText("~~ab~~ ~~cd~~", 50).lines[0]!.decos).toHaveLength(1); // the space between is struck too: one run
    expect(layoutText("~~ab~~ cd", 50).lines[0]!.decos).toHaveLength(1);
    expect(layoutText("ab", 50).lines[0]!.decos).toEqual([]);
  });

  it("paragraph space, first-line indent, case, a line limit with an ellipsis, a set height and where the words sit in it, nested list items (v0.18.1)", () => {
    // paragraph space: the gap between two paragraphs is the setting
    const two = (gap?: number) => layoutText("aa\n\nbb", 50, gap === undefined ? {} : { paraGap: gap }).lines;
    expect(two()[1]!.top - two()[0]!.bottom).toBeCloseTo(0.6);
    expect(two(2)[1]!.top - two(2)[0]!.bottom).toBeCloseTo(2);
    // first-line indent: the first line of a paragraph (not a heading, not a list item) starts further in, the others do not
    const ind = layoutText("aaa bbb ccc ddd eee fff", 5, { indent: 1 }).lines;
    expect(ind.length).toBeGreaterThan(1);
    expect(ind[0]!.glyphs[0]!.x).toBeCloseTo(1);
    expect(ind[1]!.glyphs[0]!.x).toBeCloseTo(0);
    expect(layoutText("# aaa", 50, { indent: 1 }).lines[0]!.glyphs[0]!.x).toBeCloseTo(0);
    // case: the letters change, the words stay as typed (the text is the same)
    const cps = (md: string, caps?: "upper" | "lower" | "title" | "small") => layoutText(md, 50, caps ? { caps } : {}).lines[0]!.glyphs.map((g) => String.fromCodePoint(g.cp)).join("");
    expect(cps("ab Cd", "upper")).toBe("AB CD");
    expect(cps("ab Cd", "lower")).toBe("ab cd");
    expect(cps("ab cD", "title")).toBe("Ab CD");
    expect(cps("ab Cd", "small")).toBe("AB CD");
    expect(layoutText("ab Cd", 50, { caps: "small" }).lines[0]!.glyphs.map((g) => g.k ?? 1)).toEqual([0.8, 0.8, 1, 1, 0.8]); // the capital stays full size
    expect(cps("straße", "upper")).toBe("STRASSE");
    // a line limit: cut at the limit, the last line ends in an ellipsis inside the width
    const cut = layoutText("aaa bbb ccc ddd eee fff", 4, { maxLines: 2 });
    expect(cut.lines).toHaveLength(2);
    const last = cut.lines[1]!.glyphs;
    expect(last[last.length - 1]!.cp).toBe(0x2026);
    expect(last[last.length - 1]!.x + last[last.length - 1]!.adv).toBeLessThanOrEqual(4 + 1e-9);
    expect(layoutText("aaa bbb", 50, { maxLines: 3 }).lines).toHaveLength(1); // not cut: no ellipsis
    expect(layoutText("aaa", 50, { maxLines: 3 }).lines[0]!.glyphs.map((g) => g.cp)).not.toContain(0x2026);
    // nested list items: deeper indent, and the bullet changes with the level
    const nest = layoutText("- a\n  - b\n    - c", 50).lines;
    expect(nest[1]!.glyphs[1]!.x).toBeGreaterThan(nest[0]!.glyphs[1]!.x);
    expect(nest[2]!.glyphs[1]!.x).toBeGreaterThan(nest[1]!.glyphs[1]!.x);
    expect(nest[0]!.glyphs[0]!.cp).toBe(0x2022);
    expect(nest[1]!.glyphs[0]!.cp).toBe(0x2013);
    const num = layoutText("1. a\n  1. b\n2. c", 50).lines.map((l) => String.fromCodePoint(l.glyphs[0]!.cp));
    expect(num).toEqual(["1", "1", "2"]);
  });

  it("a set height is the box's height, and the words sit at the top, in the middle or at the bottom of it (v0.18.1)", () => {
    const o = (extra: Partial<TextObject>): TextObject => ({ id: newObjectId(), kind: "text", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, md: "ab", w: 100, size: 10, color: "#000000", ...extra });
    const auto = layoutOf(o({}));
    expect(auto.height).toBeCloseTo(LINE_HEIGHT);
    const tall = (valign?: "middle" | "bottom") => layoutOf(o({ h: 100, ...(valign ? { valign } : {}) }));
    expect(tall().height).toBe(10); // em of the size
    expect(tall().lines[0]!.top).toBe(auto.lines[0]!.top); // top
    expect(tall("middle").lines[0]!.top).toBeCloseTo((10 - LINE_HEIGHT) / 2);
    expect(tall("bottom").lines[0]!.bottom).toBeCloseTo(10);
    expect(layoutOf(o({ h: 5, valign: "bottom" })).lines[0]!.top).toBe(0); // words taller than the box start at the top and run past it
    expect(layoutOf(o({ h: 100 }))).toBe(layoutOf(o({ h: 100 }))); // cached
    expect(localBounds(o({ h: 100 })).maxY - localBounds(o({ h: 100 })).minY).toBeCloseTo(100 + 2 * 0.25 * 10); // (the padding the box has)
    expect(validateObject(deserializeObject(serializeObject(o({ h: 100, valign: "middle", paraGap: 1, indent: 2, caps: "small", maxLines: 3 })))).kind).toBe("text");
    expect(() => validateObject(o({ h: -1 }))).toThrow();
    expect(() => validateObject(o({ maxLines: 0 }))).toThrow();
    expect(scaleAbout(o({ h: 100 }), { x: D.ZERO, y: D.ZERO }, 2, 2)).toMatchObject({ h: 200, size: 20, w: 200 });
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

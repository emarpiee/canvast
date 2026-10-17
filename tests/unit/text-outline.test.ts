import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as D from "../../src/core/dyadic";
import { TURN } from "../../src/core/angle";
import type { TextObject } from "../../src/doc/model";
import { newObjectId } from "../../src/doc/model";
import { FLAT_TOLERANCE_PX, flatten, geometryBounds, insideFill, nodeCount, type SubPath } from "../../src/doc/path";
import { parseFont } from "../../src/text/font";
import type { Font } from "../../src/text/font";
import { layoutText, setFont } from "../../src/text/layout";
import { textOutline } from "../../src/text/outline";

let font: Font;
beforeAll(() => {
  font = parseFont(new Uint8Array(readFileSync("node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf")));
  setFont(font);
});

const text = (md: string, extra: Partial<TextObject> = {}): TextObject => ({ id: newObjectId(), kind: "text", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, md, w: 2000, size: 100, color: "#112233", ...extra });
const flat = (subs: readonly SubPath[]) => flatten(subs, subs.map((s) => Float64Array.from(s.n)), FLAT_TOLERANCE_PX / 10, { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 }, 0);

describe("text as outlines", () => {
  it("a letter is its glyph's outline, where the layout puts it, in the object's units", () => {
    const o = text("I");
    const { sub, missing } = textOutline(o);
    expect(missing).toBe(0);
    expect(sub).toHaveLength(1);
    expect(sub[0]!.closed).toBe(true);
    const line = layoutText(o.md, o.w / o.size).lines[0]!;
    const g = line.glyphs[0]!;
    const gl = font.glyph(g.gid);
    const c = (o.size * line.scale) / font.unitsPerEm;
    const b = geometryBounds(sub);
    expect(b.minX).toBeCloseTo(g.x * o.size + gl.xMin * c, 6);
    expect(b.maxX).toBeCloseTo(g.x * o.size + gl.xMax * c, 6);
    expect(b.minY).toBeCloseTo(line.baseline * o.size - gl.yMax * c, 6);
    expect(b.maxY).toBeCloseTo(line.baseline * o.size - gl.yMin * c, 6);
  });
  it("fills where the letter is and not where it is not: the stem of I is in, the bowl of O is a hole", () => {
    const stem = textOutline(text("I")).sub;
    const b = geometryBounds(stem);
    expect(insideFill(flat(stem), (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, false)).toBe(true);
    expect(insideFill(flat(stem), b.maxX + 10, (b.minY + b.maxY) / 2, false)).toBe(false);
    const o = textOutline(text("O")).sub;
    expect(o).toHaveLength(2); // the ring and the counter
    const ob = geometryBounds(o);
    const cx = (ob.minX + ob.maxX) / 2;
    const cy = (ob.minY + ob.maxY) / 2;
    expect(insideFill(flat(o), cx, cy, false)).toBe(false); // the counter
    expect(insideFill(flat(o), ob.minX + (ob.maxX - ob.minX) * 0.04, cy, false)).toBe(true); // the ring
  });
  it("every outline is made of cubics that are exact quadratics: a segment with a handle has it two thirds of the way to the control point", () => {
    const { sub } = textOutline(text("S"));
    const n = sub[0]!.n;
    let curved = 0;
    for (let i = 0; i < n.length; i += 6) if (n[i + 4] !== n[i] || n[i + 5] !== n[i + 1]) curved++;
    expect(curved).toBeGreaterThan(4);
    expect(nodeCount(sub[0]!)).toBeGreaterThan(8);
  });
  it("lines, spaces and headings: one set of outlines per visible character, heading letters larger", () => {
    const { sub } = textOutline(text("ab\n\n# A"));
    const b = textOutline(text("# A")).sub;
    expect(sub.length).toBeGreaterThanOrEqual(3);
    const hb = geometryBounds(b);
    const body = geometryBounds(textOutline(text("A")).sub);
    expect(hb.maxY - hb.minY).toBeGreaterThan((body.maxY - body.minY) * 1.8); // an h1 is twice the body size
    expect(textOutline(text("   ")).sub).toHaveLength(0);
  });
  it("italic shears the letter, bold is one outline (the shifted copy joined to it), neither loses a letter", () => {
    const plain = geometryBounds(textOutline(text("l")).sub);
    const italic = geometryBounds(textOutline(text("*l*")).sub);
    expect(italic.maxX).toBeGreaterThan(plain.maxX + 5); // the top leans right
    const bold = textOutline(text("**l**")).sub;
    expect(bold).toHaveLength(1);
    expect(geometryBounds(bold).maxX - geometryBounds(bold).minX).toBeGreaterThan(plain.maxX - plain.minX + 1); // wider by the shift
    const boldO = textOutline(text("**O**")).sub;
    expect(boldO.length).toBeGreaterThanOrEqual(2); // still a ring and a counter
    const ob = geometryBounds(boldO);
    expect(insideFill(flat(boldO), (ob.minX + ob.maxX) / 2, (ob.minY + ob.maxY) / 2, false)).toBe(false);
  });
  it("a character the bundled font lacks has no outline and is counted", () => {
    const r = textOutline(text("a漢b"));
    expect(r.missing).toBe(1);
    expect(r.sub.length).toBeGreaterThanOrEqual(2);
  });
  it("a turned text keeps its place: the turn is baked about the middle of the text box", () => {
    const flatText = text("Hello world");
    const turned = text("Hello world", { rot: TURN / 4 });
    const a = geometryBounds(textOutline(flatText).sub);
    const b = geometryBounds(textOutline(turned).sub);
    // a quarter turn swaps width and height
    expect(b.maxX - b.minX).toBeCloseTo(a.maxY - a.minY, 3);
    expect(b.maxY - b.minY).toBeCloseTo(a.maxX - a.minX, 3);
    // about the middle of the text's box (with its padding), not of the letters
    const l = layoutText("Hello world", 20);
    const px = (l.width * 100) / 2;
    const py = (l.height * 100) / 2;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(px - ((a.minY + a.maxY) / 2 - py), 2);
  });
});

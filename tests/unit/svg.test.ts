import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { DocumentStore } from "../../src/doc/document-store";
import type { PathObject } from "../../src/doc/model";
import { deserializeObject, newObjectId, serializeObject } from "../../src/doc/model";
import { geometryBounds, rectSubs } from "../../src/doc/path";
import { arcToCubics, parsePathData } from "../../src/doc/svg-path";
import { exportSvg, pathData } from "../../src/app/svg-export";
import { dashChoice, lookFromChoices } from "../../src/doc/stroke-look";

const ORIGIN = { x: D.ZERO, y: D.ZERO };
const rect = (x: number, y: number, w: number, h: number, extra: Partial<PathObject> = {}): PathObject => ({ id: newObjectId(), kind: "path", anchor: ORIGIN, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub: rectSubs(x, y, w, h), fill: "#2563eb", stroke: "#1f2329", width: 2, ...extra });

describe("SVG path data", () => {
  it("reads lines, close and relative commands into nodes", () => {
    const [s] = parsePathData("M10 10 h20 v20 H10 z");
    expect(s!.closed).toBe(true);
    expect(s!.n.length / 6).toBe(4); // the last point equals the first: closed by the first node
    expect([s!.n[0], s!.n[1]]).toEqual([10, 10]);
    expect(geometryBounds([s!])).toMatchObject({ minX: 10, minY: 10, maxX: 30, maxY: 30 });
  });
  it("makes a cubic of a quadratic and keeps smooth shorthands smooth", () => {
    const [q] = parsePathData("M0 0 Q 30 60 60 0");
    expect(q!.n.slice(4, 6)).toEqual([20, 40]); // 2/3 of the way to the control point
    const [c] = parsePathData("M0 0 C 0 10 10 10 10 0 S 20 -10 20 0");
    expect(c!.n.slice(10, 12)).toEqual([10, -10]); // reflected handle
  });
  it("turns an arc into quarter-turn cubics that end where it ends, and a half circle stays round", () => {
    const segs = arcToCubics(0, 0, 10, 10, 0, false, true, 20, 0);
    expect(segs.length).toBe(2);
    expect(segs[1]!.slice(4)).toEqual([20, 0]);
    const [s] = parsePathData("M0 0 A10 10 0 0 1 20 0");
    const b = geometryBounds([s!]);
    expect(b.maxY - b.minY).toBeCloseTo(10, 1); // bulges by the radius
  });
  it("starts a new sub-path after close, drops a malformed tail, and refuses non-path text", () => {
    expect(parsePathData("M0 0 L10 0 L10 10 Z L20 20 L30 20").length).toBe(2);
    expect(parsePathData("M0 0 L10 0 L5").length).toBe(1);
    expect(parsePathData("hello")).toEqual([]);
  });
});

describe("SVG export", () => {
  const doc = new DocumentStore();
  it("writes a path, its paint, width, dashes and rule, scaled to a 1000-unit box", () => {
    const a = rect(0, 0, 100, 50, { fill: "#ff000080", stroke: "#00ff00", width: 4, dash: [3, 2], join: "miter", evenodd: true, name: "my box" });
    const svg = exportSvg([a], doc.space)!;
    expect(svg).toContain('fill="#ff0000" fill-opacity="0.502"');
    expect(svg).toContain('stroke="#00ff00"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('stroke-linejoin="miter"');
    expect(svg).toContain('id="my-box"');
    const w = Number(/stroke-width="([\d.]+)"/.exec(svg)![1]);
    const [d0, d1] = /stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number);
    expect(d0! / w).toBeCloseTo(3, 2); // dash and gap are in widths
    expect(d1! / w).toBeCloseTo(2, 2);
    expect(svg).toMatch(/viewBox="0 0 (1000|\d+\.?\d*) /);
  });
  it("writes arrow heads of an open line as shapes beside it, turned along the line, and the dash start", () => {
    const line = rect(0, 0, 0, 0, { sub: [{ n: [0, 0, 0, 0, 0, 0, 100, 0, 100, 0, 100, 0], closed: false }], fill: null, width: 4, arrowEnd: "triangle", arrowStart: "dot", dash: [3, 2], dashOffset: 1.5 });
    const svg = exportSvg([line], doc.space)!;
    expect(svg).toMatch(/<polygon points="[\d. -]+"/);
    expect(svg).toMatch(/<circle cx="[\d.]+" cy="[\d.]+" r="/);
    const w = Number(/stroke-width="([\d.]+)"/.exec(svg)![1]);
    expect(Number(/stroke-dashoffset="([\d.]+)"/.exec(svg)![1]) / w).toBeCloseTo(1.5, 2);
    // the triangle's tip is the end of the line (the right-most point), its base to the left of it
    const pts = /<polygon points="([^"]+)"/.exec(svg)![1]!.split(" ").map(Number);
    expect(pts[2]).toBeGreaterThan(pts[0]!);
    expect(pts[2]).toBeGreaterThan(pts[4]!);
  });
  it("places paths of different units together exactly, and leaves hidden ones out", () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(0, 0, 50, 50, { unit: 1, anchor: { x: D.fromNumber(200), y: D.ZERO } }); // unit 1: twice as big, 200 to the right
    const svg = exportSvg([a, b, rect(0, 0, 1, 1, { hidden: true })], doc.space)!;
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
    const second = /<path d="M([\d.]+) /g;
    const xs = [...svg.matchAll(second)].map((m) => Number(m[1]));
    expect(xs[1]! / xs[0]!).toBeGreaterThan(1); // b starts to the right of a
    expect(exportSvg([], doc.space)).toBeNull();
  });
  it("writes a mask as an SVG mask on its object, a black sheet under a brightness mask, a filter when inverted", () => {
    const m = rect(10, 10, 30, 30, { isMask: true, fill: "#ffffff", stroke: null });
    const a = rect(0, 0, 100, 50, { mask: { by: "g1", mode: "luminance" } });
    const svg = exportSvg([a], doc.space, () => [m])!;
    expect(svg).toMatch(/<mask id="m0"[^>]*>.*fill="#000"\/>.*<path/s);
    expect(svg).toContain('<g mask="url(#m0)">');
    expect(exportSvg([{ ...a, mask: { by: "g1", mode: "alpha", invert: true } }], doc.space, () => [m])).toMatch(/<filter id="i0">.*<g filter="url\(#i0\)">/s);
    expect(exportSvg([a], doc.space)).not.toContain("<mask");
  });
  it("writes gradients as defs and a cubic where a segment is curved", () => {
    const g = rect(0, 0, 10, 10, { fill: { type: "linear", x0: 0, y0: 0, x1: 1, y1: 0, stops: [{ o: 0, c: "#000000" }, { o: 1, c: "#ffffff" }] } });
    expect(exportSvg([g], doc.space)).toMatch(/<linearGradient id="g0" gradientUnits="userSpaceOnUse".*<stop offset="1" stop-color="#ffffff"\/>/);
    expect(pathData([{ n: [0, 0, 0, 0, 5, 5, 10, 0, 5, 5, 10, 0], closed: false }])).toBe("M0 0C5 5 5 5 10 0");
  });
});

describe("dashes", () => {
  it("are stored only when set, survive a save and load, and bad ones are refused", () => {
    expect(lookFromChoices(null, "round", "centre")).toEqual({});
    expect(lookFromChoices(null, "round", "centre", undefined, "dashed")).toEqual({ dash: [3, 2] });
    expect(dashChoice({ dash: [0, 2] })).toBe("dotted");
    expect(dashChoice({})).toBe("solid");
    const o = rect(0, 0, 10, 10, { dash: [3, 2] });
    expect((deserializeObject(serializeObject(o)) as PathObject).dash).toEqual([3, 2]);
    expect(() => deserializeObject({ ...serializeObject(o), dash: [0, 0] })).toThrow();
    expect(() => deserializeObject({ ...serializeObject(o), dash: [1] })).toThrow();
  });
});

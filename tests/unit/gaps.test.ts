import { describe, expect, it } from "vitest";
import { booleanOp } from "../../src/doc/boolean";
import { gapsOfLoops, insidePolygon } from "../../src/doc/gaps";
import type { SubPath } from "../../src/doc/path";

const rect = (x0: number, y0: number, x1: number, y1: number): SubPath => ({ closed: true, n: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].flatMap(([x, y]) => [x!, y!, x!, y!, x!, y!]) });
const union = (...rs: SubPath[]): SubPath[] => booleanOp("union", rs.map((r) => ({ subs: [r], evenodd: false })))!;

describe("gaps between shapes (ADR 0172)", () => {
  // four bars making a frame round a 10 × 10 hole
  const frame = [rect(0, 0, 30, 10), rect(0, 20, 30, 30), rect(0, 0, 10, 30), rect(20, 0, 30, 30)];

  it("the hole the shapes close in is a gap, found under a point inside it", () => {
    const gaps = gapsOfLoops(union(...frame));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.area).toBeCloseTo(100, 6);
    expect(insidePolygon(gaps[0]!.poly, 15, 15)).toBe(true);
    expect(insidePolygon(gaps[0]!.poly, 5, 5)).toBe(false);
  });

  it("a shape inside the gap is an island, left out of the fill; shapes that do not close in leave no gap", () => {
    const gaps = gapsOfLoops(union(...frame, rect(13, 13, 17, 17)));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.subs).toHaveLength(2);
    expect(gapsOfLoops(union(...frame.slice(0, 3)))).toHaveLength(0); // (the right bar gone: the place is open)
  });

  it("one shape with a hole in it (a ring): its hole is a gap", () => {
    const r = { subs: [rect(0, 0, 30, 30), rect(10, 10, 20, 20)], evenodd: true };
    const ring = booleanOp("union", [r, r])!;
    expect(gapsOfLoops(ring).map((g) => Math.round(g.area))).toEqual([100]);
  });
});

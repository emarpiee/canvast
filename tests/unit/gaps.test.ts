import { describe, expect, it } from "vitest";
import { booleanOp } from "../../src/doc/boolean";
import { bridgesOf, gapsOfLoops, insidePolygon } from "../../src/doc/gaps";
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

  it("shapes that touch only at their corners close in the place between them (the loop goes round the outside at a shared corner)", () => {
    const poly = (...p: number[][]): SubPath => ({ closed: true, n: p.flatMap(([x, y]) => [x!, y!, x!, y!, x!, y!]) });
    const h = 17.320508075688775; // (a triangle of side 20 cut into four: the middle one is the gap)
    const gaps = gapsOfLoops(union(poly([0, 0], [10, 0], [5, h / 2]), poly([10, 0], [20, 0], [15, h / 2]), poly([5, h / 2], [15, h / 2], [10, h])));
    expect(gaps.map((g) => g.area)).toEqual([expect.closeTo(43.30127, 4)]);
  });

  it("openings narrower than the closing distance are bridged: the place behind them is a gap that ends at them; with less, nothing", () => {
    // the frame again, with the top and bottom bars 1 short of the right one: two slits 1 wide
    const loops = union(rect(0, 0, 20, 10), rect(0, 20, 20, 30), rect(0, 0, 10, 30), rect(21, 0, 30, 30));
    expect(gapsOfLoops(loops)).toHaveLength(0);
    const shut = booleanOp("union", [{ subs: loops, evenodd: false }, { subs: bridgesOf(loops, 1.5), evenodd: false }])!;
    const big = Math.max(...gapsOfLoops(shut).map((g) => g.area));
    expect(big).toBeCloseTo(110, 0); // (10 to 21 across, 10 to 20 down: up to the bridges at the slits)
    expect(bridgesOf(loops, 0.5)).toHaveLength(0);
  });

  it("one shape with a hole in it (a ring): its hole is a gap", () => {
    const r = { subs: [rect(0, 0, 30, 30), rect(10, 10, 20, 20)], evenodd: true };
    const ring = booleanOp("union", [r, r])!;
    expect(gapsOfLoops(ring).map((g) => Math.round(g.area))).toEqual([100]);
  });
});

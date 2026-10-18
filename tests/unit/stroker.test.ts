import { describe, expect, it } from "vitest";
import { WIDTH_PROFILES, strokeToSubs } from "../../src/doc/stroker";
import type { SubPath } from "../../src/doc/path";

/** The winding number of the pieces round a point: non-zero is inside the stroke. */
function winding(subs: readonly SubPath[], x: number, y: number): number {
  let w = 0;
  for (const s of subs) {
    const c = s.n.length / 6;
    for (let i = 0; i < c; i++) {
      const ax = s.n[i * 6]!, ay = s.n[i * 6 + 1]!;
      const bx = s.n[((i + 1) % c) * 6]!, by = s.n[((i + 1) % c) * 6 + 1]!;
      if (ay <= y) {
        if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++;
      } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
    }
  }
  return w;
}
const line = (pts: Array<[number, number]>, closed = false): SubPath => ({ n: pts.flatMap(([x, y]) => [x, y, x, y, x, y]), closed });
const base = { width: 10, join: "round", cap: "butt", miterLimit: 4 } as const;

describe("stroke to shapes", () => {
  it("a straight line is a band of the width, with flat ends", () => {
    const s = strokeToSubs([line([[0, 0], [100, 0]])], base);
    expect(winding(s, 50, 4)).not.toBe(0);
    expect(winding(s, 50, 6)).toBe(0);
    expect(winding(s, -1, 0)).toBe(0);
    expect(winding(s, 101, 0)).toBe(0);
  });
  it("square and round caps reach past the end; the round one is round", () => {
    const sq = strokeToSubs([line([[0, 0], [100, 0]])], { ...base, cap: "square" });
    expect(winding(sq, 104, 4)).not.toBe(0);
    const rd = strokeToSubs([line([[0, 0], [100, 0]])], { ...base, cap: "round" });
    expect(winding(rd, 104, 0)).not.toBe(0);
    expect(winding(rd, 104, 4)).toBe(0);
  });
  it("joins: miter reaches the point, bevel cuts it, round is round; a sharp corner past the limit is bevelled", () => {
    const l = line([[0, 0], [100, 0], [100, 100]]);
    expect(winding(strokeToSubs([l], { ...base, join: "miter" }), 104, -4)).not.toBe(0);
    expect(winding(strokeToSubs([l], { ...base, join: "bevel" }), 104, -4)).toBe(0);
    expect(winding(strokeToSubs([l], { ...base, join: "round" }), 104, -4)).toBe(0);
    expect(winding(strokeToSubs([l], { ...base, join: "round" }), 102, -2)).not.toBe(0);
    const sharp = line([[0, 0], [100, 0], [0, 6]]);
    expect(winding(strokeToSubs([sharp], { ...base, join: "miter" }), 160, -2), "the point is cut").toBe(0);
  });
  it("a closed shape has no ends and the join at its first node", () => {
    const sq = line([[0, 0], [100, 0], [100, 100], [0, 100]], true);
    const s = strokeToSubs([sq], { ...base, join: "miter" });
    expect(winding(s, -4, -4)).not.toBe(0);
    expect(winding(s, 50, 50)).toBe(0);
  });
  it("a curve is followed within the tolerance", () => {
    const arc: SubPath = { n: [0, 0, 0, 0, 0, 55, 100, 0, 100, 55, 100, 0], closed: false };
    const s = strokeToSubs([arc], base);
    // the curve passes (50, 41.25); the band is 5 each side
    expect(winding(s, 50, 41.25)).not.toBe(0);
    expect(winding(s, 50, 41.25 + 8)).toBe(0);
  });
  it("dashes leave gaps, a dash of no length is a dot, and the start moves the pattern", () => {
    const l = line([[0, 0], [100, 0]]);
    const d = strokeToSubs([l], { ...base, dash: [3, 2] }); // 30 on, 20 off
    expect(winding(d, 10, 0)).not.toBe(0);
    expect(winding(d, 40, 0)).toBe(0);
    expect(winding(d, 60, 0)).not.toBe(0);
    const moved = strokeToSubs([l], { ...base, dash: [3, 2], dashOffset: 3 });
    expect(winding(moved, 10, 0), "the pattern starts in the gap").toBe(0);
    const dots = strokeToSubs([l], { ...base, cap: "round", dash: [0, 3] });
    expect(winding(dots, 30, 0)).not.toBe(0);
    expect(winding(dots, 15, 0)).toBe(0);
  });
  it("a width profile makes the line thinner where it is small", () => {
    const l = line([[0, 0], [100, 0]]);
    const t = strokeToSubs([l], { ...base, width: 20, profile: WIDTH_PROFILES["taper-end"] });
    expect(winding(t, 5, 8)).not.toBe(0);
    expect(winding(t, 90, 8)).toBe(0);
    expect(winding(t, 90, 0)).not.toBe(0);
  });
  it("a point with a round cap is a dot, and no width is nothing", () => {
    expect(strokeToSubs([line([[5, 5]])], { ...base, cap: "round" }).length).toBe(1);
    expect(strokeToSubs([line([[0, 0], [1, 0]])], { ...base, width: 0 })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { fitPolyline, polylineOf, simplifySub } from "../../src/doc/fit-curve";
import { ellipseSubs } from "../../src/doc/path";

/** The farthest any of `pts` is from the polyline of the fitted path. */
function farthest(pts: number[], path: { n: number[]; closed: boolean }, tol: number): number {
  const line = polylineOf(path, tol / 2000);
  let worst = 0;
  for (let i = 0; i < pts.length; i += 2) {
    let best = Infinity;
    for (let j = 0; j < line.length; j += 2) best = Math.min(best, Math.hypot(line[j]! - pts[i]!, line[j + 1]! - pts[i + 1]!));
    worst = Math.max(worst, best);
  }
  return worst;
}

describe("curve fitting", () => {
  it("a half circle of 100 points becomes a few nodes within the tolerance, keeping both ends", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 100; i++) pts.push(100 * Math.cos((Math.PI * i) / 100), 100 * Math.sin((Math.PI * i) / 100));
    const f = fitPolyline(pts, 0.5);
    expect(f.n.length / 6).toBeLessThan(8);
    expect(f.n.slice(0, 2)).toEqual([100, 0]);
    expect(f.n[f.n.length - 6]).toBeCloseTo(-100, 6);
    expect(farthest(pts, f as { n: number[]; closed: boolean }, 0.5)).toBeLessThan(0.75);
  });
  it("collinear points are two nodes, one point is one node, nothing is nothing", () => {
    expect(fitPolyline([0, 0, 1, 1, 2, 2, 3, 3], 0.1).n.length / 6).toBe(2);
    expect(fitPolyline([5, 5], 0.1).n.length / 6).toBe(1);
    expect(fitPolyline([], 0.1).n.length).toBe(0);
  });
  it("simplifying a shape with many nodes keeps its outline and a closed path stays closed", () => {
    const e = ellipseSubs(0, 0, 200, 100)[0]!;
    const dense = fitPolyline(polylineOf(e, 0.05), 0.02); // many nodes
    const d: { n: number[]; closed: boolean } = { n: [...dense.n], closed: false };
    const s = simplifySub(e, 0.5);
    expect(s.closed).toBe(true);
    expect(s.n.length / 6).toBeLessThanOrEqual(e.n.length / 6);
    expect(farthest(polylineOf(e, 0.05), s as { n: number[]; closed: boolean }, 0.5)).toBeLessThan(1);
    expect(simplifySub(d, 0.5).n.length).toBeLessThanOrEqual(d.n.length);
  });
});

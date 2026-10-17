import { describe, expect, it } from "vitest";
import {
  NODE, corner, cubicOf, distanceToOutline, ellipseSubs, flatten, geometryBounds, insideFill, lineSubs, mapSubs, moveHandle, moveNode, nodeCount,
  paintBounds, polygonSubs, rectSubs, rotateSubs, scaleSubs, shapeSubs, smooth, splitSegment, starSubs, toggleSmooth, winding, withNode, FLAT_TOLERANCE_PX,
  MAX_FLAT_POINTS, type Box, type SubPath,
} from "../../src/doc/path";

const view: Box = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
const flat = (subs: readonly SubPath[], tol = FLAT_TOLERANCE_PX) => flatten(subs, subs.map((s) => Float64Array.from(s.n)), tol, view, 1e9);
const at = (c: readonly number[], t: number): [number, number] => {
  const u = 1 - t;
  const f = (a: number, b: number, cc: number, d: number) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * cc + t * t * t * d;
  return [f(c[0]!, c[2]!, c[4]!, c[6]!), f(c[1]!, c[3]!, c[5]!, c[7]!)];
};

describe("path bounds", () => {
  it("an ellipse is bounded by its box, not by its handles", () => {
    const b = geometryBounds(ellipseSubs(10, 20, 100, 60));
    for (const [got, want] of [[b.minX, 10], [b.minY, 20], [b.maxX, 110], [b.maxY, 80]] as const) expect(got).toBeCloseTo(want, 6);
  });
  it("a bulging curve is bounded by its extreme, which lies off the nodes", () => {
    const s: SubPath = { n: [...smooth(0, 0, 0, 50), ...smooth(100, 0, 0, -50)], closed: false };
    const b = geometryBounds([s]);
    expect(b.minY).toBe(0);
    expect(b.maxY).toBeGreaterThan(30); // the curve rises 3/4 of the way to its handles (37.5), well past both nodes at y = 0
  });
  it("the stroke grows the bounds by half its width, and a miter tip by more at a sharp corner", () => {
    const sq = paintBounds(rectSubs(0, 0, 100, 100), { width: 10, join: "miter" });
    expect([sq.minX, sq.minY, sq.maxX, sq.maxY]).toEqual([-5, -5, 105, 105].map((v) => expect.closeTo(v, 6)));
    const eq: SubPath[] = [{ n: [...corner(0, 0), ...corner(100, 0), ...corner(50, 86.6)], closed: true }];
    const round = paintBounds(eq, { width: 8 });
    const miter = paintBounds(eq, { width: 8, join: "miter" });
    expect(miter.maxX).toBeGreaterThan(round.maxX + 1); // the tips of a 60 degree corner stick out past the round join
    expect(miter.maxY).toBeGreaterThan(round.maxY + 1);
    // a very sharp corner is past the miter limit: drawn as a bevel, so it adds nothing
    const thin: SubPath[] = [{ n: [...corner(0, 0), ...corner(100, 4), ...corner(0, 8)], closed: true }];
    expect(paintBounds(thin, { width: 4, join: "miter" }).maxX).toBeCloseTo(paintBounds(thin, { width: 4 }).maxX, 6);
  });
  it("square caps add their corners, butt caps nothing", () => {
    const line = lineSubs(0, 0, 100, 0);
    const butt = paintBounds(line, { width: 10, cap: "butt" });
    const square = paintBounds(line, { width: 10, cap: "square" });
    expect(butt.minX).toBeCloseTo(-5, 6);
    expect(square.minX).toBeCloseTo(-5, 6); // a square cap on a horizontal line reaches h past the end
    expect(square.maxX).toBeCloseTo(105, 6);
    const diagonal = lineSubs(0, 0, 100, 100);
    expect(paintBounds(diagonal, { width: 10, cap: "square" }).minX).toBeLessThan(paintBounds(diagonal, { width: 10, cap: "butt" }).minX);
  });
});

describe("flattening", () => {
  it("an ellipse stays within the tolerance of the true curve and does not need many points", () => {
    const [f] = flat(ellipseSubs(0, 0, 400, 300));
    const p = f!.pts;
    expect(p.length / 2).toBeGreaterThan(12);
    expect(p.length / 2).toBeLessThan(200);
    // every vertex is on the ellipse; every chord midpoint within the tolerance of it
    const r = (x: number, y: number) => Math.hypot((x - 200) / 200, (y - 150) / 150);
    for (let i = 0; i < p.length; i += 2) expect(Math.abs(r(p[i]!, p[i + 1]!) - 1)).toBeLessThan(2e-3);
    for (let i = 0; i < p.length / 2; i++) {
      const j = (i + 1) % (p.length / 2);
      const mx = (p[i * 2]! + p[j * 2]!) / 2;
      const my = (p[i * 2 + 1]! + p[j * 2 + 1]!) / 2;
      const d = (1 - r(mx, my)) * 150; // about, in px (the smaller radius)
      expect(Math.abs(d)).toBeLessThan(FLAT_TOLERANCE_PX * 2 + 0.05);
    }
  });
  it("straight lines are not subdivided, and a closed outline does not repeat its first vertex", () => {
    const [f] = flat(rectSubs(10, 10, 50, 40));
    expect(Array.from(f!.pts)).toEqual([10, 10, 60, 10, 60, 50, 10, 50]);
    expect(f!.closed).toBe(true);
  });
  it("a curve far outside the view becomes its chord (cheap), one inside is flattened", () => {
    const far: SubPath = { n: [...smooth(5000, 5000, 0, 800), ...smooth(6000, 5000, 0, -800)], closed: false };
    const near: SubPath = { n: [...smooth(100, 100, 0, 80), ...smooth(300, 100, 0, -80)], closed: false };
    const cull = flatten([far, near], [Float64Array.from(far.n), Float64Array.from(near.n)], 0.1, view, 50);
    expect(cull[0]!.pts.length / 2).toBeLessThan(4);
    expect(cull[1]!.pts.length / 2).toBeGreaterThan(10);
  });
  it("a huge curve is capped, not endless", () => {
    const s: SubPath = { n: [...smooth(0, 0, 0, 1e9), ...smooth(1e9, 0, 0, -1e9)], closed: false };
    const [f] = flatten([s], [Float64Array.from(s.n)], 0.001, { minX: -1e12, minY: -1e12, maxX: 1e12, maxY: 1e12 }, 0);
    expect(f!.pts.length / 2).toBeLessThanOrEqual(MAX_FLAT_POINTS + 64); // the guard stops subdividing; pieces already queued still end in one point each
  });
});

describe("filling and picking", () => {
  const hole: SubPath[] = [...rectSubs(0, 0, 100, 100), ...rectSubs(25, 25, 50, 50)];
  it("winding: same direction nests (the hole is filled by non-zero, empty by even-odd)", () => {
    const f = flat(hole);
    expect(insideFill(f, 10, 10, false)).toBe(true);
    expect(insideFill(f, 50, 50, false)).toBe(true); // both turn the same way: winding 2
    expect(insideFill(f, 50, 50, true)).toBe(false);
    expect(insideFill(f, 150, 50, false)).toBe(false);
  });
  it("an opposite inner outline cuts a hole in non-zero too", () => {
    const inner = rectSubs(25, 25, 50, 50)[0]!;
    // reverse its order
    const nodes: number[] = [];
    for (let i = nodeCount(inner) - 1; i >= 0; i--) nodes.push(...inner.n.slice(i * NODE, i * NODE + NODE));
    const f = flat([...rectSubs(0, 0, 100, 100), { n: nodes, closed: true }]);
    expect(winding(f, 50, 50)).toBe(0);
    expect(insideFill(f, 10, 10, false)).toBe(true);
  });
  it("an ellipse contains its centre and not a corner of its box; the outline distance is zero on the line", () => {
    const f = flat(ellipseSubs(0, 0, 200, 100));
    expect(insideFill(f, 100, 50, false)).toBe(true);
    expect(insideFill(f, 3, 3, false)).toBe(false);
    expect(distanceToOutline(f, 100, 0)).toBeLessThan(0.2);
    expect(distanceToOutline(f, 100, 50)).toBeCloseTo(50, 0);
  });
  it("star and polygon have the corners asked for", () => {
    expect(nodeCount(polygonSubs(0, 0, 100, 100, 7)[0]!)).toBe(7);
    expect(nodeCount(starSubs(0, 0, 100, 100, 5, 0.4)[0]!)).toBe(10);
    expect(shapeSubs("line", 0, 0, 50, 20)[0]!.closed).toBe(false);
  });
});

describe("editing nodes", () => {
  const curve: SubPath[] = [{ n: [...smooth(0, 0, 0, 60), ...smooth(100, 0, 0, -60), ...corner(200, 0)], closed: false }];
  it("splitting a curve leaves its shape exactly where it was", () => {
    for (const t of [0.2, 0.5, 0.85]) {
      const split = splitSegment(curve, 0, 0, t);
      expect(nodeCount(split[0]!)).toBe(4);
      const c0 = cubicOf(curve[0]!.n, 0, 1);
      const a = cubicOf(split[0]!.n, 0, 1);
      const b = cubicOf(split[0]!.n, 1, 2);
      for (let s = 0; s <= 10; s++) {
        const u = s / 10;
        const [ex, ey] = at(c0, t * u);
        const [gx, gy] = at(a, u);
        expect(gx).toBeCloseTo(ex, 9);
        expect(gy).toBeCloseTo(ey, 9);
        const [ex2, ey2] = at(c0, t + (1 - t) * u);
        const [hx, hy] = at(b, u);
        expect(hx).toBeCloseTo(ex2, 9);
        expect(hy).toBeCloseTo(ey2, 9);
      }
    }
  });
  it("splitting the closing segment of a closed path works", () => {
    const closed: SubPath[] = [{ ...rectSubs(0, 0, 10, 10)[0]!, closed: true }];
    const split = splitSegment(closed, 0, 3, 0.5);
    expect(nodeCount(split[0]!)).toBe(5);
    expect(Array.from(split[0]!.n.slice(4 * NODE, 4 * NODE + 2))).toEqual([0, 5]);
  });
  it("a node moves with its handles; a handle moves alone or mirrored", () => {
    const m = moveNode(curve, 0, 1, 10, 5);
    // smooth(100, 0, 0, -60) has its in handle at (100, 60) and its out handle at (100, -60); all three move together
    expect(Array.from(m[0]!.n.slice(NODE, NODE + 6))).toEqual([110, 5, 110, 65, 110, -55]);
    const h = moveHandle(curve, 0, 0, 4, 20, 30, true);
    expect(Array.from(h[0]!.n.slice(0, 6))).toEqual([0, 0, -20, -30, 20, 30]);
    const alone = moveHandle(curve, 0, 0, 4, 20, 30, false);
    expect(alone[0]!.n[2]).toBe(0);
    expect(alone[0]!.n[3]).toBe(-60);
  });
  it("a corner becomes smooth and back; removing a node keeps the others; a closed path with two nodes opens", () => {
    const sm = toggleSmooth(rectSubs(0, 0, 100, 100), 0, 1);
    const n = sm[0]!.n;
    expect(n[NODE + 2] === n[NODE] && n[NODE + 3] === n[NODE + 1]).toBe(false);
    expect(toggleSmooth(sm, 0, 1)[0]!.n.slice(NODE, NODE + 6).every((v, i) => v === (i % 2 === 0 ? n[NODE]! : n[NODE + 1]!))).toBe(true);
    const fewer = withNode(rectSubs(0, 0, 100, 100), 0, 2, null);
    expect(nodeCount(fewer[0]!)).toBe(3);
    expect(fewer[0]!.closed).toBe(true);
    expect(withNode(fewer, 0, 0, null)[0]!.closed).toBe(false);
    expect(withNode([{ n: corner(1, 1), closed: false }], 0, 0, null)).toEqual([]);
  });
});

describe("affine maps", () => {
  it("rotating by a quarter turn and back, and scaling, move every point of every node", () => {
    const subs = ellipseSubs(0, 0, 100, 50);
    const turned = rotateSubs(subs, 50, 25, 0, 1);
    const back = rotateSubs(turned, 50, 25, 0, -1);
    subs[0]!.n.forEach((v, i) => expect(back[0]!.n[i]!).toBeCloseTo(v, 9));
    const b = geometryBounds(turned);
    expect(b.maxX - b.minX).toBeCloseTo(50, 6);
    expect(b.maxY - b.minY).toBeCloseTo(100, 6);
    const scaled = geometryBounds(scaleSubs(subs, 2, 3));
    expect(scaled.maxX).toBeCloseTo(200, 6);
    expect(scaled.maxY).toBeCloseTo(150, 6);
    expect(mapSubs(subs, (x, y) => [x + 1, y]).length).toBe(1);
  });
});

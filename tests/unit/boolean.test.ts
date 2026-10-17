import { describe, expect, it } from "vitest";
import { BOOL_OPS, booleanOp, type BoolOp, type Region } from "../../src/doc/boolean";
import { corner, distanceToOutline, ellipseSubs, flatten, mapSubs, nodeCount, polygonSubs, rectSubs, rotateSubs, starSubs, winding, type FlatPath, type SubPath } from "../../src/doc/path";

const VIEW = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };
const flat = (subs: readonly SubPath[], tol: number): FlatPath[] => flatten(subs, subs.map((s) => Float64Array.from(s.n)), tol, VIEW, 0);
const region = (subs: SubPath[], evenodd = false): Region => ({ subs, evenodd });
const member: Record<BoolOp, (a: boolean, b: boolean) => boolean> = { union: (a, b) => a || b, intersect: (a, b) => a && b, subtract: (a, b) => a && !b, exclude: (a, b) => a !== b };

/** Compare a result with the set operation, point by point, away from every outline. Returns the number of points checked. */
function agree(op: BoolOp, parts: Region[], result: SubPath[], rnd: () => number, points = 400): number {
  const tol = 5e-4;
  const ins = parts.map((r) => flat(r.subs, tol));
  const res = flat(result, tol);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of ins.flat()) for (let i = 0; i < f.pts.length; i += 2) {
    x0 = Math.min(x0, f.pts[i]!); x1 = Math.max(x1, f.pts[i]!); y0 = Math.min(y0, f.pts[i + 1]!); y1 = Math.max(y1, f.pts[i + 1]!);
  }
  const size = Math.max(x1 - x0, y1 - y0);
  let checked = 0;
  for (let k = 0; k < points; k++) {
    const x = x0 - size * 0.1 + rnd() * size * 1.2;
    const y = y0 - size * 0.1 + rnd() * size * 1.2;
    if ([...ins, res].some((f) => distanceToOutline(f, x, y) < size * 2e-3)) continue;
    const inside = parts.map((r, i) => {
      const w = winding(ins[i]!, x, y);
      return r.evenodd ? (w & 1) !== 0 : w !== 0;
    });
    const want = inside.slice(1).reduce((acc, b) => member[op](acc, b), inside[0]!);
    expect(winding(res, x, y) !== 0, `${op} at (${x.toFixed(3)}, ${y.toFixed(3)}) of ${size.toFixed(2)}`).toBe(want);
    checked++;
  }
  return checked;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomShape(rnd: () => number): SubPath[] {
  const x = rnd() * 100;
  const y = rnd() * 100;
  const w = 30 + rnd() * 90;
  const h = 30 + rnd() * 90;
  const kind = Math.floor(rnd() * 5);
  let s: SubPath[] =
    kind === 0 ? rectSubs(x, y, w, h)
    : kind === 1 ? ellipseSubs(x, y, w, h)
    : kind === 2 ? polygonSubs(x, y, w, h, 3 + Math.floor(rnd() * 6))
    : kind === 3 ? starSubs(x, y, w, h, 3 + Math.floor(rnd() * 5), 0.3 + rnd() * 0.4)
    : [{ n: [...corner(x, y), ...corner(x + w, y + h * 0.2), ...corner(x + w * 0.7, y + h), ...corner(x + w * 0.1, y + h * 0.8)], closed: true }];
  if (rnd() < 0.6) s = rotateSubs(s, x + w / 2, y + h / 2, Math.cos(rnd() * 6.28), Math.sin(rnd() * 6.28));
  return s;
}

describe("boolean operations", () => {
  it("fuzz: pairs of random shapes, every operation, agree with the set operation at 400 points each (50 pairs, 200 operations)", () => {
    const rnd = lcg(2024);
    let checked = 0;
    let failed = 0;
    for (let n = 0; n < 50; n++) {
      const a = randomShape(rnd);
      const b = randomShape(rnd);
      for (const op of BOOL_OPS) {
        const r = booleanOp(op, [region(a), region(b)]);
        if (!r) {
          failed++;
          continue;
        }
        checked += agree(op, [region(a), region(b)], r, rnd);
      }
    }
    expect(failed, "operations that could not close their loops").toBe(0);
    expect(checked).toBeGreaterThan(12000);
  });
  it("fuzz: three operands, folded", () => {
    const rnd = lcg(7);
    let checked = 0;
    for (let n = 0; n < 25; n++) {
      const parts = [randomShape(rnd), randomShape(rnd), randomShape(rnd)].map((s) => region(s));
      for (const op of BOOL_OPS) {
        const r = booleanOp(op, parts);
        if (r) checked += agree(op, parts, r, rnd, 200);
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  const A = rectSubs(0, 0, 100, 100);
  const B = rectSubs(50, 50, 100, 100);
  it("two overlapping squares: the corner counts of each result", () => {
    const sizes = (op: BoolOp) => booleanOp(op, [region(A), region(B)])!.map(nodeCount).sort();
    expect(sizes("union")).toEqual([8]);
    expect(sizes("intersect")).toEqual([4]);
    expect(sizes("subtract")).toEqual([6]);
    expect(sizes("exclude").reduce((a, b) => a + b, 0)).toBe(12); // two L shapes, however the touching corners are paired
  });
  it("curves stay curves: a circle and a rectangle, the result keeps handles on its arcs and none on its straight sides", () => {
    const r = booleanOp("intersect", [region(ellipseSubs(0, 0, 200, 200)), region(rectSubs(100, 50, 200, 100))])!;
    expect(r).toHaveLength(1);
    const n = r[0]!.n;
    let curved = 0, straight = 0;
    for (let i = 0; i < n.length; i += 6) (n[i + 4] !== n[i] || n[i + 5] !== n[i + 1] ? curved++ : straight++);
    expect(curved).toBeGreaterThan(0);
    expect(straight).toBeGreaterThan(0);
  });
  it("a hole: a circle minus a smaller one is two loops; the smaller one inside the larger leaves the larger on union", () => {
    const big = ellipseSubs(0, 0, 200, 200);
    const small = ellipseSubs(50, 50, 100, 100);
    expect(booleanOp("subtract", [region(big), region(small)])).toHaveLength(2);
    expect(booleanOp("union", [region(big), region(small)])).toHaveLength(1);
    expect(booleanOp("intersect", [region(big), region(small)])!.map(nodeCount)).toEqual([4]);
  });
  it("identical shapes: union is one of them, subtract and exclude leave nothing", () => {
    expect(booleanOp("union", [region(A), region(A)])).toHaveLength(1);
    expect(booleanOp("intersect", [region(A), region(A)])).toHaveLength(1);
    expect(booleanOp("subtract", [region(A), region(A)])).toEqual([]);
    expect(booleanOp("exclude", [region(A), region(A)])).toEqual([]);
    const e = ellipseSubs(0, 0, 100, 60);
    expect(booleanOp("subtract", [region(e), region(e)])).toEqual([]);
  });
  it("shapes that do not meet: union keeps both, intersect and a subtract of a far one change nothing or leave nothing", () => {
    const far = rectSubs(500, 500, 10, 10);
    expect(booleanOp("union", [region(A), region(far)])).toHaveLength(2);
    expect(booleanOp("intersect", [region(A), region(far)])).toEqual([]);
    expect(booleanOp("subtract", [region(A), region(far)])).toHaveLength(1);
  });
  it("shapes that share an edge join into one loop; the shared edge is not left behind", () => {
    const right = rectSubs(100, 0, 100, 100);
    const r = booleanOp("union", [region(A), region(right)])!;
    expect(r).toHaveLength(1);
    expect(flat(r, 1e-3)[0]!.pts.length / 2).toBeLessThanOrEqual(6);
    expect(winding(flat(r, 1e-3), 100, 50) !== 0).toBe(true); // the old shared edge is inside now
  });
  it("circles touching at one point, and a rectangle laid along a circle's tangent, do not break it", () => {
    const left = ellipseSubs(0, 0, 100, 100);
    const rightC = ellipseSubs(100, 0, 100, 100);
    expect(booleanOp("union", [region(left), region(rightC)])).not.toBeNull();
    expect(booleanOp("intersect", [region(left), region(rightC)])).toSatisfy((r: SubPath[] | null) => r !== null);
    const tangent = rectSubs(-50, 100, 200, 50);
    expect(booleanOp("union", [region(left), region(tangent)])).not.toBeNull();
  });
  it("even-odd operands, and open paths (closed by a line)", () => {
    const ring = [...rectSubs(0, 0, 100, 100), ...rectSubs(25, 25, 50, 50)];
    const rnd = lcg(5);
    const parts = [region(ring, true), region(rectSubs(40, 40, 100, 20))];
    agree("union", parts, booleanOp("union", parts)!, rnd);
    const open: SubPath[] = [{ n: [...corner(0, 0), ...corner(100, 0), ...corner(100, 100)], closed: false }]; // a triangle once closed
    const r = booleanOp("intersect", [region(open), region(rectSubs(50, -10, 100, 200))])!;
    expect(r).toHaveLength(1);
  });
  it("refuses fewer than two operands", () => {
    expect(booleanOp("union", [region(A)])).toBeNull();
  });
});

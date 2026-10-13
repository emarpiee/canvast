import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { lookAt } from "../../src/core/camera";
import type { Camera } from "../../src/core/camera";
import type { StrokeObject } from "../../src/doc/model";
import { newObjectId } from "../../src/doc/model";
import { localToWorld } from "../../src/doc/edit-ops";
import { fromPx, projectObject } from "../../src/render/projection";
import { exactStrokeCoverage, exactStrokeEdgeDistancePx, orientPositive } from "../../src/render/stroke-coverage";
import { pointInPolygon } from "../../src/render/geometry2d";
import { rng } from "./rng";

const VP = { width: 320, height: 200 };

function stroke(points: number[], width: number, unit = 0): StrokeObject {
  return {
    id: newObjectId(),
    kind: "stroke",
    anchor: { x: D.fromBigInt(5n, 700), y: D.fromBigInt(-3n, -700) },
    unit,
    z: 0,
    opacity: 1,
    attachmentTargetId: null,
    points,
    width,
    color: "#000000",
  };
}

/**
 * Independent exact classification (no square roots, no doubles): is the
 * local point p within distance `r` of the polyline? Compares squared
 * distances as exact dyadic rationals.
 */
function within(o: StrokeObject, px: D.Dyadic, py: D.Dyadic, r: D.Dyadic): boolean {
  const r2 = D.mul(r, r);
  const n = o.points.length / 2;
  const v = (i: number) => ({ x: D.fromNumber(o.points[2 * i]!), y: D.fromNumber(o.points[2 * i + 1]!) });
  for (let i = 0; i < n; i++) {
    const a = v(i);
    const wx = D.sub(px, a.x);
    const wy = D.sub(py, a.y);
    if (D.cmp(D.add(D.mul(wx, wx), D.mul(wy, wy)), r2) <= 0) return true;
    if (i + 1 < n) {
      const b = v(i + 1);
      const ux = D.sub(b.x, a.x);
      const uy = D.sub(b.y, a.y);
      const uu = D.add(D.mul(ux, ux), D.mul(uy, uy));
      const dot = D.add(D.mul(ux, wx), D.mul(uy, wy));
      if (D.sign(dot) > 0 && D.cmp(dot, uu) < 0) {
        // dist² = |W|² − dot²/uu  ⇒  |W|²·uu − dot² ≤ r²·uu
        const lhs = D.sub(D.mul(D.add(D.mul(wx, wx), D.mul(wy, wy)), uu), D.mul(dot, dot));
        if (D.cmp(lhs, D.mul(r2, uu)) <= 0) return true;
      }
    }
  }
  return false;
}

/** Classify a grid of screen samples and compare with the coverage polygons. */
function check(o: StrokeObject, cam: Camera): { inside: number; outside: number; wrong: number } {
  const po = projectObject(o, cam, VP, { keepTiny: true });
  if (!po) return { inside: 0, outside: 0, wrong: 0 };
  const polys = exactStrokeCoverage(po, VP);
  const r = o.width / 2;
  // Ambiguity band of ±0.02 px around the edge, in local units.
  const band = fromPx(po.proj, 0.02);
  let inside = 0;
  let outside = 0;
  let wrong = 0;
  for (let sy = 3.5; sy < VP.height; sy += 7) {
    for (let sx = 3.5; sx < VP.width; sx += 7) {
      // zf = 0 in these tests, so the px → local conversion is exact.
      const lx = D.add(po.proj.lx, fromPx(po.proj, sx - VP.width / 2));
      const ly = D.add(po.proj.ly, fromPx(po.proj, sy - VP.height / 2));
      const rr = D.fromNumber(r);
      const inner = within(o, lx, ly, D.sub(rr, band));
      const outer = within(o, lx, ly, D.add(rr, band));
      if (inner === outer) {
        const covered = polys.some((p) => pointInPolygon(sx, sy, p));
        if (inner) inside++;
        else outside++;
        if (covered !== inner) wrong++;
      }
    }
  }
  return { inside, outside, wrong };
}

describe("exact stroke coverage", () => {
  it("matches exact geometry when the viewport sits on an edge, from 2^0 to 2^5000 magnification", () => {
    const o = stroke([0, 0, 100, 0, 150, 40, 80, 90], 6);
    let total = { inside: 0, outside: 0, wrong: 0 };
    const depths = [...Array.from({ length: 76 }, (_, i) => i * 4), 899, 900, 901, 1023, 1024, 1025, 1100, 2000, 3500, 5000];
    for (const k of depths) {
      // Camera centred exactly on the upper edge of the first segment (y = -r).
      const edge = localToWorld(o, 37.25, -3);
      const res = check(o, lookAt(edge, k - o.unit));
      total = { inside: total.inside + res.inside, outside: total.outside + res.outside, wrong: total.wrong + res.wrong };
    }
    expect(total.inside).toBeGreaterThan(1000);
    expect(total.outside).toBeGreaterThan(1000);
    expect(total.wrong).toBe(0);
  });

  it("matches exact geometry at a cap, a joint, and random points of random strokes", () => {
    const r = rng(90);
    let wrong = 0;
    let classified = 0;
    for (let trial = 0; trial < 80; trial++) {
      const pts: number[] = [];
      let x = 0;
      let y = 0;
      for (let i = 0; i < 6; i++) {
        pts.push(x, y);
        x += (r() - 0.3) * 80;
        y += (r() - 0.5) * 80;
      }
      const o = stroke(pts, 1 + r() * 10, Math.floor((r() - 0.5) * 200));
      const vi = Math.floor(r() * 6);
      // Around a vertex (joint or cap), offset by about one radius.
      const focus = localToWorld(o, pts[2 * vi]! + (r() - 0.5) * o.width, pts[2 * vi + 1]! + (r() - 0.5) * o.width);
      const k = trial < 60 ? Math.floor(r() * 200) : 900 + Math.floor(r() * 3000);
      const res = check(o, lookAt(focus, k - o.unit));
      wrong += res.wrong;
      classified += res.inside + res.outside;
    }
    expect(classified).toBeGreaterThan(20000);
    expect(wrong).toBe(0);
  }, 60_000);

  it("produces consistently oriented polygons (so one nonzero fill paints the union once)", () => {
    const o = stroke([0, 0, 100, 0, 50, -50, 50, 50], 8); // self-crossing
    const cam = lookAt(localToWorld(o, 50, 0), 1); // crossing point, mildly magnified
    const po = projectObject(o, cam, VP)!;
    // Force the exact path on a projected object (keeps its lazy `proj` getter).
    const polys = exactStrokeCoverage(Object.assign(Object.create(Object.getPrototypeOf(po)), po, { exact: true }), VP);
    expect(polys.length).toBeGreaterThan(2);
    for (const p of polys) expect(orientPositive(p)).toBe(p);
  });

  it("exact edge distance is accurate to the pixel far beyond double precision", () => {
    const o = stroke([0, 0, 100, 0], 4);
    for (const k of [0, 60, 200, 400, 1100, 5000]) {
      // Centred on the upper edge (local y = -2). The camera centre is rounded
      // to 2^-(k+96) local units, so the edge is within ~2^-96 px of the centre row.
      const po = projectObject(o, lookAt(localToWorld(o, 50, -2), k), VP, { keepTiny: true })!;
      expect(exactStrokeEdgeDistancePx(po, VP.width / 2, VP.height / 2)).toBeCloseTo(0, 6);
      expect(exactStrokeEdgeDistancePx(po, VP.width / 2, VP.height / 2 - 1)).toBeCloseTo(1, 6);
      expect(exactStrokeEdgeDistancePx(po, VP.width / 2, VP.height / 2 + 1)).toBeCloseTo(-1, 6);
      // On the round cap at the segment end (local x = 102).
      const pc = projectObject(o, lookAt(localToWorld(o, 102, 0), k), VP, { keepTiny: true })!;
      expect(exactStrokeEdgeDistancePx(pc, VP.width / 2 + 3, VP.height / 2)).toBeCloseTo(3, 6);
      // 3 px inside the cap; at k = 0 the side lines (2 px away) are nearer.
      expect(exactStrokeEdgeDistancePx(pc, VP.width / 2 - 3, VP.height / 2)).toBeCloseTo(-Math.min(3, pc.radius), 6);
    }
  });
});

describe("projection at any magnification", () => {
  it("never drops a visible object: boxes stay exact far beyond the double range", () => {
    const o = stroke([0, 0, 10, 0], 4, -50);
    for (const k of [12, 500, 899, 901, 1024, 1500, 4000, 20000]) {
      const cam = lookAt(localToWorld(o, 5, 0), k + 50); // magnified 2^k beyond the stroke's unit
      const po = projectObject(o, cam, VP);
      expect(po, `k=${k}`).not.toBeNull();
      expect(po!.box.minX).toBeLessThan(0);
      expect(po!.box.maxX).toBeGreaterThan(VP.width);
      expect(Number.isNaN(po!.box.minY)).toBe(false);
      const polys = exactStrokeCoverage(po!, VP);
      expect(polys.some((p) => pointInPolygon(VP.width / 2, VP.height / 2, p)), `centre covered at k=${k}`).toBe(true);
    }
  });
});

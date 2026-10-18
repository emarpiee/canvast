import { describe, expect, it } from "vitest";
import type { PathObject } from "../../src/doc/model";
import { outlineOf } from "../../src/doc/outline-stroke";
import * as D from "../../src/core/dyadic";
import { geometryBounds } from "../../src/doc/path";

const path = (extra: Partial<PathObject> = {}): PathObject => ({ id: "a", kind: "path", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub: [{ n: [0, 0, 0, 0, 0, 0, 100, 0, 100, 0, 100, 0], closed: false }], fill: null, stroke: "#000000", width: 10, ...extra });

describe("outline of a path's stroke", () => {
  it("covers the line's width and nothing more", () => {
    const b = geometryBounds(outlineOf(path({ cap: "butt" })));
    expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([0, 100, -5, 5]);
  });
  it("includes the ends it has: round caps, arrow heads", () => {
    const round = geometryBounds(outlineOf(path()));
    expect(round.maxX).toBeCloseTo(105, 5);
    const arrow = geometryBounds(outlineOf(path({ cap: "butt", arrowEnd: "triangle", arrowStart: "dot" })));
    expect(arrow.maxX).toBeCloseTo(100, 5); // the tip is the end of the line
    expect(arrow.minX).toBeCloseTo(-16, 3); // a dot of 0.4 heads (4 widths) round the start
    expect(arrow.maxY).toBeCloseTo(20, 5); // the head is as wide as it is long
  });
  it("dashes and a profile both change the pieces", () => {
    expect(outlineOf(path({ dash: [3, 2], cap: "butt" })).length).toBeGreaterThan(1);
    const t = geometryBounds(outlineOf(path({ cap: "butt" }), "taper-end"));
    expect(t.maxY).toBeLessThanOrEqual(5.0001);
  });
});

import { rectSubs } from "../../src/doc/path";
import { roundCorners } from "../../src/doc/rounding";

describe("corner smoothing", () => {
  const points = (s: number): Array<[number, number]> => {
    const n = roundCorners(rectSubs(0, 0, 100, 100), 10, s)[0]!.n;
    return Array.from({ length: n.length / 6 }, (_, i): [number, number] => [n[i * 6]!, n[i * 6 + 1]!]);
  };
  it("a plain arc starts a radius from the corner; a smoothed one farther out, with the same box", () => {
    expect(points(0).some(([x, y]) => Math.abs(x) < 1e-9 && Math.abs(y - 10) < 0.1)).toBe(true);
    expect(points(1).some(([x, y]) => Math.abs(x) < 1e-9 && Math.abs(y - 16) < 0.1)).toBe(true);
    for (const s of [0, 1]) {
      const xs = points(s).map((p) => p[0]);
      expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 100]);
    }
  });
  it("on a small shape the corners share the edges instead of overlapping", () => {
    const n = roundCorners(rectSubs(0, 0, 20, 20), 30, 1)[0]!.n;
    expect(n.every((v) => Number.isFinite(v) && v >= -1e-6 && v <= 20 + 1e-6)).toBe(true);
  });
});

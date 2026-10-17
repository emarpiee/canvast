import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { deserializeObject, newObjectId, serializeObject } from "../../src/doc/model";
import type { PathObject } from "../../src/doc/model";
import { drawnParams, drawnSubs, geometryBounds, nodeCount, polygonSubs, rectSubs, roundCorners, scaleParams } from "../../src/doc/path";
import { paramsOf, withShapeParams } from "../../src/doc/shape-params";
import { scaleAbout } from "../../src/doc/edit-ops";

const ORIGIN = { x: D.ZERO, y: D.ZERO };
const base = { id: "", kind: "path" as const, anchor: ORIGIN, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, fill: "#2563eb", stroke: "#1f2329", width: 2 };
const drawn = (kind: "rect" | "polygon" | "star", w = 200, h = 100): PathObject => {
  const p = drawnParams(kind, 10, 20, w, h, 6, 5)!;
  return { ...base, id: newObjectId(), sub: drawnSubs(kind, 10, 20, w, h, 6, 5), shape: kind, params: p };
};

describe("parametric shapes", () => {
  it("a drawn polygon or star fills its box exactly", () => {
    for (const kind of ["rect", "polygon", "star"] as const) {
      const b = geometryBounds(drawn(kind).sub);
      expect([b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 20, 210, 120]);
    }
  });
  it("changing sides or points remakes the shape in the same box", () => {
    const hex = withShapeParams(drawn("polygon"), { sides: 8 })!;
    expect(nodeCount(hex.sub[0]!)).toBe(8);
    const b = geometryBounds(hex.sub);
    expect([b.minX, b.maxX].map(Math.round)).toEqual([10, 210]);
    expect(nodeCount(withShapeParams(drawn("star"), { tips: 7 })!.sub[0]!)).toBe(14);
    const thin = withShapeParams(drawn("star"), { inner: 0.2 })!;
    expect(thin.params!.inner).toBe(0.2);
  });
  it("a corner radius rounds the corners, keeps the bounds of a rectangle, and is cut down on short sides", () => {
    const r = withShapeParams(drawn("rect"), { radius: 20 })!;
    expect(nodeCount(r.sub[0]!)).toBe(8); // each corner became two nodes
    const b = geometryBounds(r.sub);
    expect([b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 1e3) / 1e3)).toEqual([10, 20, 210, 120]);
    const big = withShapeParams(drawn("rect"), { radius: 1000 })!; // a pill: half the short side
    const pill = geometryBounds(big.sub);
    expect([pill.minX, pill.maxX].map(Math.round)).toEqual([10, 210]); // still its box: the corners met in the middle of the short sides, no further
    expect(withShapeParams(r, { radius: 0 })!.params!.radius).toBeUndefined();
    expect(nodeCount(withShapeParams(r, { radius: 0 })!.sub[0]!)).toBe(4);
  });
  it("rounding leaves nodes with handles and open sub-paths alone", () => {
    const open = [{ n: rectSubs(0, 0, 10, 10)[0]!.n, closed: false }];
    expect(roundCorners(open, 3)).toEqual(open);
  });
  it("a shape drawn before parameters were kept is found out from its nodes, and one edited by hand is not", () => {
    const legacy: PathObject = { ...base, id: newObjectId(), sub: polygonSubs(0, 0, 100, 100, 5), shape: "polygon" };
    const p = paramsOf(legacy)!;
    expect(p.sides).toBe(5);
    expect(nodeCount(withShapeParams(legacy, { sides: 7 })!.sub[0]!)).toBe(7);
    const moved = { ...legacy, sub: [{ n: legacy.sub[0]!.n.map((v, i) => (i === 0 ? v + 9 : v)), closed: true }] };
    expect(paramsOf(moved)).toBeNull();
    expect(withShapeParams(moved, { sides: 7 })).toBeNull();
  });
  it("stretching scales the box and the radius with the shape", () => {
    const o = withShapeParams(drawn("rect"), { radius: 10 })!;
    const s = scaleAbout(o, { x: D.ZERO, y: D.ZERO }, 2, 2) as PathObject;
    const f = 2 * 2 ** (o.unit - s.unit); // (the unit may be renormalised)
    expect(s.params!.box.map((v) => v / f)).toEqual([10, 20, 200, 100]);
    expect(s.params!.radius! / f).toBeCloseTo(10, 9);
    expect(scaleParams(o.params!, 1, 4).radius).toBeCloseTo(20, 9);
  });
  it("is saved and read back, and bad numbers are refused", () => {
    const o = withShapeParams(drawn("star"), { radius: 3 })!;
    expect((deserializeObject(serializeObject(o)) as PathObject).params).toEqual(o.params);
    expect(() => deserializeObject({ ...serializeObject(o), params: { ...o.params, sides: 2 } })).toThrow();
    expect(() => deserializeObject({ ...serializeObject(o), params: { ...o.params, radius: -1 } })).toThrow();
  });
});

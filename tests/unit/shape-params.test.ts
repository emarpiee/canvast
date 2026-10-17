import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { deserializeObject, newObjectId, serializeObject } from "../../src/doc/model";
import type { PathObject } from "../../src/doc/model";
import { drawnParams, drawnSubs, geometryBounds, nodeCount, polygonSubs, rectSubs, scaleParams } from "../../src/doc/path";
import { hasCorners, paramsOf, withRadius, withShapeParams } from "../../src/doc/shape-params";
import { canRound, cornerAt, maxFor, maxUniform, roundCorners } from "../../src/doc/rounding";
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
  it("a corner radius rounds the corners, keeps the bounds of a rectangle, and is cut down on short sides (a pill)", () => {
    const r = withRadius(drawn("rect"), 20);
    expect(nodeCount(r.sub[0]!)).toBe(8); // each corner became two nodes
    expect(nodeCount(r.base![0]!)).toBe(4); // the sharp nodes are kept
    const b = geometryBounds(r.sub);
    expect([b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 1e3) / 1e3)).toEqual([10, 20, 210, 120]);
    const pill = geometryBounds(withRadius(drawn("rect"), 1000).sub);
    expect([pill.minX, pill.maxX].map(Math.round)).toEqual([10, 210]);
    const flat = withRadius(r, 0);
    expect(flat.radius).toBeUndefined();
    expect(flat.base).toBeUndefined();
    expect(nodeCount(flat.sub[0]!)).toBe(4);
  });
  it("a rectangle takes one radius per corner; a star and a polygon round every corner, inner ones too", () => {
    const r = withRadius(drawn("rect"), [30, 0, 30, 0]);
    expect(nodeCount(r.sub[0]!)).toBe(6); // two rounded, two sharp
    expect(nodeCount(withRadius(drawn("star"), 5).sub[0]!)).toBe(20);
    expect(nodeCount(withRadius(drawn("polygon"), 5).sub[0]!)).toBe(12);
  });
  it("any path with sharp corners can be rounded, open paths at their inner nodes only, and is sharp again at 0", () => {
    const tri: PathObject = { ...base, id: newObjectId(), sub: [{ n: [0, 0, 0, 0, 0, 0, 100, 0, 100, 0, 100, 0, 50, 80, 50, 80, 50, 80], closed: true }] };
    expect(hasCorners(tri)).toBe(true);
    expect(nodeCount(withRadius(tri, 10).sub[0]!)).toBe(6);
    const open: PathObject = { ...tri, id: newObjectId(), sub: [{ ...tri.sub[0]!, closed: false }] };
    expect(nodeCount(withRadius(open, 10).sub[0]!)).toBe(4); // the two ends stay, the middle corner is two nodes
    expect(withRadius(withRadius(tri, 10), 0).sub).toEqual(tri.sub);
    expect(hasCorners({ ...base, id: newObjectId(), sub: [{ n: [0, 0, 0, 0, 0, 0, 10, 0, 10, 0, 10, 0], closed: false }] })).toBe(false); // a line has none
  });
  it("sides and points keep the rounding; the rounding of a boolean result is a number only", () => {
    const hex = withShapeParams(withRadius(drawn("polygon"), 4), { sides: 5 })!;
    expect(nodeCount(hex.sub[0]!)).toBe(10);
    expect(nodeCount(hex.base![0]!)).toBe(5);
    const result = withRadius({ ...drawn("rect"), result: "g" }, 6);
    expect(result.radius).toBe(6);
    expect(result.base).toBeUndefined(); // derived, never stored
  });
  it("corners between curves are rounded too, and a smooth node is not a corner", () => {
    const lens = { n: [0, 0, 0, 0, 40, -40, 100, 0, 60, -40, 100, 0, 100, 80, 100, 80, 100, 80, 0, 80, 0, 80, 0, 80], closed: true }; // two curved edges meeting at a point
    const r = roundCorners([lens], 10)[0]!;
    expect(r.n.length).toBeGreaterThan(lens.n.length);
    const ellipse = drawn("rect") && drawnSubs("ellipse", 0, 0, 100, 60, 6, 5);
    expect(roundCorners(ellipse, 20)).toEqual(ellipse); // every node is smooth: nothing to round
    expect(canRound(ellipse)).toBe(false);
  });
  it("the largest radius shares a segment between the corners at its two ends, so a star can go further than half a segment, and more changes nothing", () => {
    const star = drawn("star").sub;
    const old = Math.min(...Array.from({ length: nodeCount(star[0]!) }, (_, k) => { const c = cornerAt(star[0]!, k)!; return (Math.min(c.lenIn, c.lenOut) / 2) * Math.tan(c.theta / 2); }));
    const max = maxUniform(star);
    expect(max).toBeGreaterThan(old * 1.2);
    const same = (a: number, b: number) => roundCorners(star, a)[0]!.n.every((v, i) => Math.abs(v - roundCorners(star, b)[0]!.n[i]!) < 1e-6);
    expect(same(max, max * 3)).toBe(true);
    expect(same(max * 0.9, max)).toBe(false);
    // one corner on its own may use what its neighbours leave
    const radii = new Array<number>(10).fill(0);
    expect(maxFor(star, radii, 0)).toBeGreaterThan(max);
    radii[1] = max;
    expect(maxFor(star, radii, 0)).toBeLessThan(maxFor(star, new Array<number>(10).fill(0), 0));
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
  it("stretching scales the box and the radius with the shape, so it keeps its look; with the radius lock it keeps its size", () => {
    const o = withRadius(drawn("rect"), 10);
    const at = { x: D.ZERO, y: D.ZERO };
    const s = scaleAbout(o, at, 2, 2) as PathObject;
    const f = 2 ** (o.unit - s.unit); // (the unit may be renormalised: sizes in local units follow it)
    expect(s.params!.box.map((v) => v * f)).toEqual([20, 40, 400, 200]);
    expect((s.radius as number) * f).toBeCloseTo(20, 9); // scaled with it
    expect(nodeCount(s.sub[0]!)).toBe(8);
    const locked = scaleAbout(o, at, 2, 2, false, true) as PathObject;
    expect((locked.radius as number) * 2 ** (o.unit - locked.unit)).toBeCloseTo(10, 9); // the same size on the canvas
    // there and back again gives the same shape
    const back = scaleAbout(scaleAbout(o, at, 0.2, 0.2), at, 5, 5) as PathObject;
    const g = 2 ** (o.unit - back.unit);
    expect(back.sub[0]!.n.every((v, i) => Math.abs(v * g - o.sub[0]!.n[i]!) < 1e-6)).toBe(true);
    expect(scaleParams(o.params!, 1, 4).box[3]).toBe(400);
  });
  it("is saved and read back, and bad numbers are refused", () => {
    const o = withRadius(drawn("star"), 3);
    const back = deserializeObject(serializeObject(o)) as PathObject;
    expect(back.params).toEqual(o.params);
    expect(back.radius).toBe(3);
    expect(back.base).toEqual(o.base);
    expect(() => deserializeObject({ ...serializeObject(o), params: { ...o.params, sides: 2 } })).toThrow();
    expect(() => deserializeObject({ ...serializeObject(o), radius: -1 })).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { TURN } from "../../src/core/angle";
import { lookAt } from "../../src/core/camera";
import type { CanvasObject, PathObject } from "../../src/doc/model";
import { InvalidObjectError, deserializeObject, localBounds, newObjectId, pathSubs, serializeObject, unrotatedBounds, validateObject } from "../../src/doc/model";
import { ellipseSubs, geometryBounds, rectSubs, smooth, corner, type SubPath } from "../../src/doc/path";
import { normalizeUnit, rotateAbout, scaleAbout } from "../../src/doc/edit-ops";
import { projectObject } from "../../src/render/projection";
import { boxSelect, hitsObject, lassoSelect, sweepHits } from "../../src/render/hit-test";
import { itemCorners } from "../../src/render/selection-frame";
import { classifyCoarse } from "../../src/render/coarse";
import { SAMPLERS } from "../../src/render/coarse";

const VP = { width: 800, height: 600 };
const ORIGIN = { x: D.ZERO, y: D.ZERO };
const INFO = { errLog2: -208, zTrue: 5000 };

function path(sub: SubPath[], extra: Partial<PathObject> = {}): PathObject {
  return { id: newObjectId(), kind: "path", anchor: ORIGIN, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub, fill: "#2563eb", stroke: null, width: 4, ...extra };
}
/** A camera that puts local point (x, y) of an object at the centre of the screen, at 1 px per unit. */
const camAt = (x: number, y: number) => lookAt({ x: D.fromNumber(x), y: D.fromNumber(y) }, 0, 0);

describe("path objects in the document", () => {
  it("validate: the paint, the nodes and the options", () => {
    const ok = path(rectSubs(0, 0, 10, 10), { fill: "#11223344", stroke: "#aabbcc", join: "miter", cap: "square", evenodd: true, shape: "rect" });
    expect(validateObject(ok)).toBe(ok);
    const bad = (o: PathObject) => expect(() => validateObject(o)).toThrow(InvalidObjectError);
    bad(path(rectSubs(0, 0, 10, 10), { fill: "red" }));
    bad(path(rectSubs(0, 0, 10, 10), { stroke: "#12345" }));
    bad(path([]));
    bad(path([{ n: [1, 2, 3], closed: false }]));
    bad(path([{ n: [...corner(0, 0).slice(0, 5), NaN], closed: false }]));
    bad(path(rectSubs(0, 0, 10, 10), { width: 0 }));
    bad(path(rectSubs(0, 0, 10, 10), { join: "round" as never }));
    bad(path(rectSubs(0, 0, 10, 10), { shape: "blob" as never }));
  });
  it("serialize and deserialize keep every field, and the stored form is plain JSON", () => {
    const o = path([...ellipseSubs(0, 0, 100, 60), ...rectSubs(10, 10, 5, 5)], { fill: null, stroke: "#10203080", width: 3.5, join: "bevel", cap: "butt", rot: 12345, name: "Moon", shape: "ellipse" });
    const stored = JSON.parse(JSON.stringify(serializeObject(o)));
    const back = deserializeObject(stored);
    expect(back).toEqual(o);
    expect(() => deserializeObject({ ...stored, sub: "nope" })).toThrow(InvalidObjectError);
  });
  it("bounds: an ellipse is its box plus half the outline; a turned path is bounded by its turned geometry", () => {
    const o = path(ellipseSubs(0, 0, 100, 40), { stroke: "#000000", width: 10 });
    const b = localBounds(o);
    expect([b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 1000) / 1000)).toEqual([-5, -5, 105, 45]);
    const turned = { ...path(rectSubs(0, 0, 100, 40)), rot: TURN / 4 } as PathObject;
    const tb = localBounds(turned);
    expect(tb.maxX - tb.minX).toBeCloseTo(40, 6);
    expect(tb.maxY - tb.minY).toBeCloseTo(100, 6);
    const ub = unrotatedBounds(turned);
    expect(ub.maxX - ub.minX).toBeCloseTo(100, 6);
    // the turn is about the centre of the unturned bounds
    expect((tb.minX + tb.maxX) / 2).toBeCloseTo((ub.minX + ub.maxX) / 2, 6);
    expect(pathSubs(turned)).toBe(pathSubs(turned)); // cached
  });
});

describe("path objects: editing", () => {
  it("a stretch scales the geometry on each axis and the outline by the geometric mean; keepWidth keeps it", () => {
    const o = path(rectSubs(0, 0, 100, 50), { stroke: "#000000", width: 8 });
    const s = scaleAbout(o, ORIGIN, 2, 0.5) as PathObject;
    const b = geometryBounds((s as PathObject).sub);
    expect([b.maxX, b.maxY]).toEqual([200, 25]);
    expect(s.width).toBeCloseTo(8, 9); // sqrt(2 * 0.5) = 1
    expect((scaleAbout(o, ORIGIN, 3, 3, true) as PathObject).width).toBe(8);
    expect((scaleAbout(o, ORIGIN, 3, 3) as PathObject).width).toBe(24);
  });
  it("a turned path stretches along its own axes (and keeps its turn)", () => {
    const o = { ...path(rectSubs(0, 0, 10, 10)), rot: 1000 } as PathObject;
    const wide = scaleAbout(o, ORIGIN, 2, 1) as PathObject;
    expect(wide.rot).toBe(1000);
    expect(geometryBounds(wide.sub).maxX * 2 ** wide.unit).toBeCloseTo(20, 9);
    expect(geometryBounds(wide.sub).maxY * 2 ** wide.unit).toBeCloseTo(10, 9);
    expect(() => scaleAbout(o, ORIGIN, 2, 2)).not.toThrow();
  });
  it("a path far outside the comfortable size is re-expressed in another unit, exactly", () => {
    const o = path(rectSubs(0, 0, 2 ** 30, 2 ** 30), { stroke: "#000000", width: 2 ** 20 });
    const n = normalizeUnit(o) as PathObject;
    expect(n.unit).toBeGreaterThan(o.unit);
    expect(geometryBounds(n.sub).maxX * 2 ** n.unit).toBe(2 ** 30);
    expect(n.width * 2 ** n.unit).toBe(2 ** 20);
  });
  it("turning by an angle and by its opposite returns the same object", () => {
    const o = path(ellipseSubs(0, 0, 100, 40));
    const there = rotateAbout(o, ORIGIN, 123456789);
    const back = rotateAbout(there, ORIGIN, -123456789);
    expect(back.rot).toBeUndefined();
    expect((back as PathObject).sub).toBe(o.sub);
  });
});

describe("path objects on screen", () => {
  const rect = path(rectSubs(100, 100, 200, 100)); // filled, no outline
  const ring = path(ellipseSubs(0, 0, 200, 200), { fill: null, stroke: "#000000", width: 6 }); // an outline only
  const proj = (o: PathObject, x = 100, y = 100) => projectObject(o, camAt(x, y), VP, { keepTiny: true })!;

  it("projects to flattened outlines in screen space, with the stroke's width in px", () => {
    const po = proj(rect, 200, 150);
    expect(po.path).toHaveLength(1);
    expect(Array.from(po.path![0]!.pts)).toEqual([100 - 200 + 400, 100 - 150 + 300, 300 - 200 + 400, 100 - 150 + 300, 300 - 200 + 400, 200 - 150 + 300, 100 - 200 + 400, 200 - 150 + 300]);
    expect(proj(ring).radius).toBeCloseTo(3, 9);
    expect(po.exact).toBe(false);
    expect(po.cover).toBeUndefined();
  });
  it("picks a filled shape anywhere inside it, and an outline only on the line", () => {
    const po = proj(rect, 200, 150); // the shape's centre is at (400, 300)
    expect(hitsObject(po, 400, 300)).toBe(true);
    expect(hitsObject(po, 310, 260)).toBe(true);
    expect(hitsObject(po, 290, 300)).toBe(false); // 10 px outside the left edge at 300
    const r = proj(ring, 100, 100); // the centre of the circle is at (400, 300), radius 100
    expect(hitsObject(r, 400, 300)).toBe(false); // the inside of an unfilled shape is not picked
    expect(hitsObject(r, 400 + 100, 300)).toBe(true); // on the line
    expect(hitsObject(r, 400 + 100 + 12, 300)).toBe(false); // 12 px from the line: past its half-width and the pointer's reach
    expect(sweepHits(r, 380, 300, 520, 300, 4)).toBe(true); // an eraser swipe across it
  });
  it("lasso and box take a path when they touch its outline, not when they sit wholly inside its fill", () => {
    const po = proj(rect, 200, 150);
    expect(boxSelect([po], { minX: 280, minY: 250, maxX: 330, maxY: 280 })).toEqual([rect.id]); // crosses the right edge
    expect(boxSelect([po], { minX: 350, minY: 280, maxX: 380, maxY: 300 })).toEqual([]); // wholly inside the fill
    expect(lassoSelect([po], [0, 0, 800, 0, 800, 600, 0, 600], "strokes")).toEqual([rect.id]); // around it
  });
  it("a turned path has its own turned corners as the selection outline", () => {
    const turned = { ...rect, rot: TURN / 4 } as PathObject;
    const po = proj(turned, 200, 150);
    const c = itemCorners(po);
    expect(c).toHaveLength(4);
    const xs = c.map((p) => p[0]);
    const ys = c.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 6); // 200 x 100, quarter turn
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(200, 6);
  });
  it("a path out of reach of doubles: exact colour where the whole view is inside it, nothing where it misses, an edge in view placed exactly", () => {
    // 2^76 px wide: far past what doubles can place an edge of.
    const huge = path(rectSubs(0, 0, 2 ** 16, 2 ** 16), { fill: "#ff0000" });
    const at = (x: number, y: number) => projectObject(huge, lookAt({ x: D.fromNumber(x), y: D.fromNumber(y) }, 60, 0), VP, { keepTiny: true });
    expect(at(2 ** 15, 2 ** 15)!.cover).toEqual({ color: "#ff0000" }); // deep inside: exact, not dimmed
    const outside = at(2 ** 16 + 8, 2 ** 15);
    expect(outside === null || outside.cover === undefined).toBe(true); // outside it: nothing drawn
    const edge = at(2 ** 16 - 1e-10, 2 ** 15)!; // the edge is in the view: placed exactly (render/path-exact.ts), not approximated
    expect(edge.cover).toBeUndefined();
    expect(edge.fillPath).toBeDefined();
  });
});

describe("path objects far below the camera (render/coarse.ts)", () => {
  const at = (x: number, y: number) => ({ x: D.fromNumber(x), y: D.fromNumber(y) });
  it("covers the view inside its fill, misses outside it, asks for the exact path near an edge", () => {
    const o = path(rectSubs(0, 0, 100, 100), { fill: "#00aa00" });
    expect(classifyCoarse(o, at(50, 50), INFO, VP)).toEqual({ color: "#00aa00" });
    expect(classifyCoarse(o, at(150, 50), INFO, VP)).toBe("miss");
    // At this zoom the view is a speck: only a point within about 1e-12 of the edge is "near" it.
    expect(classifyCoarse(o, at(1e-13, 50), INFO, VP)).toBe("exact");
    expect(classifyCoarse(o, at(1e-4, 50), INFO, VP)).toEqual({ color: "#00aa00" });
  });
  it("an outline covers where the view lies inside the line, and a filled shape with one has both", () => {
    const o = path(rectSubs(0, 0, 100, 100), { fill: "#00aa00", stroke: "#aa0000", width: 20 });
    expect(classifyCoarse(o, at(50, 50), INFO, VP)).toEqual({ color: "#00aa00" });
    expect(classifyCoarse(o, at(0, 50), INFO, VP)).toEqual({ color: "#aa0000" });
    expect(classifyCoarse(o, at(-10 + 1e-13, 50), INFO, VP)).toBe("exact"); // on the outer edge of the 20 wide line
    expect(classifyCoarse(o, at(-30, 50), INFO, VP)).toBe("miss");
  });
  it("a hole (even-odd, or an opposite inner outline) is missed", () => {
    const o = path([...rectSubs(0, 0, 100, 100), ...rectSubs(25, 25, 50, 50)], { evenodd: true });
    expect(classifyCoarse(o, at(50, 50), INFO, VP)).toBe("miss");
    expect(classifyCoarse(o, at(10, 10), INFO, VP)).toEqual({ color: "#2563eb" });
    expect(SAMPLERS.path.approx(o, { lx: 10, ly: 10, m: 0, vp: VP, info: INFO, terms: () => null })).toEqual({ color: "#2563eb" });
  });
});

describe("a sheet's Scale contents (ADR 0133)", () => {
  it("is stored with the sheet, survives a save and load, and only `true` is accepted", () => {
    const sheet = path(rectSubs(0, 0, 10, 10), { container: { clip: true, scale: true } });
    expect((deserializeObject(serializeObject(sheet)) as PathObject).container).toEqual({ clip: true, scale: true });
    expect(() => validateObject({ ...sheet, container: { clip: true, scale: false as unknown as true } })).toThrow(InvalidObjectError);
  });
});

// keep the unused helpers honest
void smooth;
void ({} as CanvasObject);

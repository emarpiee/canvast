import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { DocumentStore } from "../../src/doc/document-store";
import type { BoolOp } from "../../src/doc/boolean";
import { isBoolMember, isResult, operandsOf, resultOf } from "../../src/doc/boolean-group";
import { groupObjects } from "../../src/doc/groups";
import type { CanvasObject, PathObject } from "../../src/doc/model";
import { deserializeObject, newObjectId, serializeObject } from "../../src/doc/model";
import { instantiate } from "../../src/doc/clipboard";
import { FLAT_TOLERANCE_PX, flatten, geometryBounds, insideFill, rectSubs, type SubPath } from "../../src/doc/path";
import { rotateAbout, scaleAbout, translate } from "../../src/doc/edit-ops";
import { pathSubs } from "../../src/doc/model";
import { nodeCount, ellipseSubs } from "../../src/doc/path";
import { TURN } from "../../src/core/angle";

const ORIGIN = { x: D.ZERO, y: D.ZERO };
const rect = (x: number, y: number, w: number, h: number, z: number, extra: Partial<PathObject> = {}): PathObject => ({ id: newObjectId(), kind: "path", anchor: ORIGIN, unit: 0, z, opacity: 1, attachmentTargetId: null, sub: rectSubs(x, y, w, h), fill: "#2563eb", stroke: "#1f2329", width: 2, ...extra });
const flat = (subs: readonly SubPath[]) => flatten(subs, subs.map((s) => Float64Array.from(s.n)), FLAT_TOLERANCE_PX / 10, { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 }, 0);
const inside = (o: PathObject, x: number, y: number) => insideFill(flat(o.sub), x, y, !!o.evenodd);

/** A document with the shapes combined: what the Combine action does. */
function combined(shapes: PathObject[], op: BoolOp): { doc: DocumentStore; gid: string } {
  const doc = new DocumentStore();
  doc.load(shapes);
  const gid = newObjectId();
  const next = groupObjects(shapes, 0, gid).map((o) => ({ ...o, boolOps: { ...(o.boolOps ?? {}), [gid]: op } }) as CanvasObject);
  doc.commit(doc.transaction("Union", next));
  return { doc, gid };
}
const result = (doc: DocumentStore, gid: string) => resultOf(doc.all(), gid)!;

describe("boolean groups: the result is derived inside the transaction", () => {
  it("combining makes a group, keeps the shapes, and adds the result with the back shape's look", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2, { fill: "#ff0000" });
    const { doc, gid } = combined([a, b], "union");
    expect(doc.size).toBe(3);
    const r = result(doc, gid);
    expect(r.fill).toBe("#2563eb"); // the back one's
    expect(r.sub[0]!.n.length / 6).toBe(8);
    expect(r.groups).toEqual([gid]);
    expect(r.boolOps).toEqual({ [gid]: "union" });
    expect(doc.get(a.id)!.groups).toEqual([gid]);
    expect(operandsOf(doc.all(), gid).map((o) => o.id)).toEqual([a.id, b.id]);
    expect(isBoolMember(doc.get(a.id)!)).toBe(true);
    expect(isBoolMember(r)).toBe(false);
    expect(isResult(r)).toBe(true);
  });
  it("editing a member updates the result in the same transaction, and one undo takes both back", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2);
    const { doc, gid } = combined([a, b], "union");
    expect(inside(result(doc, gid), 175, 175)).toBe(false);
    expect(inside(result(doc, gid), 60, 140)).toBe(true);
    doc.commit(doc.transaction("Move", [translate(doc.get(b.id)!, D.fromNumber(50), D.fromNumber(50))]));
    expect(inside(result(doc, gid), 175, 175)).toBe(true); // the moved shape is part of it now
    expect(inside(result(doc, gid), 60, 140)).toBe(false); // and where it was (x 50 to 150) is not, except what the back one covers
    const afterMove = result(doc, gid).sub;
    doc.undo();
    expect(inside(result(doc, gid), 175, 175)).toBe(false);
    expect(inside(result(doc, gid), 60, 140)).toBe(true);
    doc.redo();
    expect(result(doc, gid).sub).toEqual(afterMove);
  });
  it("the operation can be changed later and the result follows", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2);
    const { doc, gid } = combined([a, b], "union");
    const members = [...doc.all()].filter((o) => o.boolOps);
    for (const op of ["intersect", "subtract", "exclude"] as const) {
      doc.commit(doc.transaction(op, [...doc.all()].filter((o) => o.boolOps).map((o) => ({ ...o, boolOps: { ...o.boolOps, [gid]: op } }) as CanvasObject)));
      const r = result(doc, gid);
      expect(inside(r, 75, 75), `${op} at the overlap`).toBe(op === "intersect");
      expect(inside(r, 25, 25), `${op} in the back one only`).toBe(op !== "intersect");
      expect(inside(r, 125, 125), `${op} in the front one only`).toBe(op === "exclude");
    }
    expect(members.length).toBe(3);
  });
  it("the result keeps the look it was given: changing the shapes does not reset it", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2);
    const { doc, gid } = combined([a, b], "union");
    doc.commit(doc.transaction("Paint", [{ ...result(doc, gid), fill: "#00ff00", stroke: null }]));
    doc.commit(doc.transaction("Move", [translate(doc.get(b.id)!, D.fromNumber(10), D.ZERO)]));
    expect(result(doc, gid)).toMatchObject({ fill: "#00ff00", stroke: null });
  });
  it("a hidden member is left out; showing it brings it back", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2);
    const { doc, gid } = combined([a, b], "union");
    doc.commit(doc.transaction("Hide", [{ ...doc.get(b.id)!, hidden: true }]));
    expect(inside(result(doc, gid), 125, 125)).toBe(false);
    expect(result(doc, gid).sub[0]!.n.length / 6).toBe(4);
    const { hidden: _h, ...shown } = doc.get(b.id)!;
    doc.commit(doc.transaction("Show", [shown as CanvasObject]));
    expect(inside(result(doc, gid), 125, 125)).toBe(true);
  });
  it("an empty result takes the result object away (the shapes stay), and it comes back when they overlap again", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(500, 500, 10, 10, 2);
    const { doc, gid } = combined([a, b], "intersect");
    expect(resultOf(doc.all(), gid)).toBeUndefined();
    expect(doc.size).toBe(2);
    doc.commit(doc.transaction("Move", [translate(doc.get(b.id)!, D.fromNumber(-480), D.fromNumber(-480))]));
    expect(resultOf(doc.all(), gid)).toBeDefined();
    expect(doc.size).toBe(3);
  });
  it("deleting a member recomputes; deleting them all removes the result", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2);
    const { doc, gid } = combined([a, b], "union");
    doc.commit(doc.transaction("Delete", [], [b.id]));
    expect(result(doc, gid).sub[0]!.n.length / 6).toBe(4);
    doc.commit(doc.transaction("Delete", [], [a.id]));
    expect(resultOf(doc.all(), gid)).toBeUndefined();
    expect(doc.size).toBe(0);
  });
  it("a boolean group inside another: its result is an operand of the outer one, and a change reaches both", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 0, 100, 100, 2);
    const c = rect(0, 150, 100, 100, 3);
    const doc = new DocumentStore();
    doc.load([a, b, c]);
    const inner = newObjectId();
    doc.commit(doc.transaction("Union", groupObjects([a, b], 0, inner).map((o) => ({ ...o, boolOps: { [inner]: "union" } }) as CanvasObject)));
    const innerResult = resultOf(doc.all(), inner)!;
    const outer = newObjectId();
    // the whole inner group (its shapes and its result) and the other shape, as one more level
    const unit = [...doc.all()].filter((o) => o.groups?.includes(inner) || o.id === c.id);
    doc.commit(doc.transaction("Subtract", groupObjects(unit, 0, outer).map((o) => ({ ...o, boolOps: { ...(o.boolOps ?? {}), [outer]: "subtract" } }) as CanvasObject)));
    const outerResult = resultOf(doc.all(), outer)!;
    expect(outerResult.groups).toEqual([outer]);
    expect(operandsOf(doc.all(), outer).map((o) => o.id).sort()).toEqual([innerResult.id, c.id].sort());
    expect(isBoolMember(doc.get(a.id)!)).toBe(true);
    expect(isBoolMember(doc.get(innerResult.id)!)).toBe(true); // inside the outer group now
    // subtract c from the union of a and b: c does not overlap them, so the result is the union
    expect(inside(outerResult, 125, 50)).toBe(true);
    expect(inside(outerResult, 50, 200)).toBe(false);
    // moving c onto the union cuts a piece out of it, through both levels
    doc.commit(doc.transaction("Move", [translate(doc.get(c.id)!, D.ZERO, D.fromNumber(-150))]));
    expect(inside(resultOf(doc.all(), outer)!, 50, 50)).toBe(false);
    // and editing a shape of the inner group changes the inner result and so the outer one
    doc.commit(doc.transaction("Move", [translate(doc.get(b.id)!, D.fromNumber(200), D.ZERO)]));
    expect(inside(resultOf(doc.all(), inner)!, 250, 50)).toBe(true);
    expect(inside(resultOf(doc.all(), outer)!, 250, 50)).toBe(true);
    doc.undo();
    expect(inside(resultOf(doc.all(), outer)!, 250, 50)).toBe(false);
  });
  it("the stored form round-trips, and pasting remaps the group, its operations and its result", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2);
    const { doc, gid } = combined([a, b], "subtract");
    const objs = [...doc.all()];
    for (const o of objs) expect(deserializeObject(JSON.parse(JSON.stringify(serializeObject(o))))).toEqual(o);
    const payload = { objects: objs.map((o) => serializeObject(o)), centre: null, depth: 0, viewFrame: "" } as unknown as Parameters<typeof instantiate>[0];
    const { objects } = instantiate(payload, doc.space, 10);
    const copy = new DocumentStore();
    copy.load(objects);
    const ngid = objects.find((o) => o.groups)!.groups![0]!;
    expect(ngid).not.toBe(gid);
    expect(objects.every((o) => o.boolOps?.[ngid] === "subtract")).toBe(true);
    expect(resultOf(copy.all(), ngid)).toBeDefined();
    // the copy is a working group: moving one of its shapes updates its result
    const first = operandsOf(copy.all(), ngid)[0]!;
    copy.commit(copy.transaction("Move", [translate(first, D.fromNumber(300), D.ZERO)]));
    const moved = resultOf(copy.all(), ngid)!;
    expect(D.toNumber(moved.anchor.x) + geometryBounds(moved.sub).maxX).toBeGreaterThan(300); // (placed by its anchor)
  });
});

describe("boolean groups nest", () => {
  it("a group combined with a shape: the inner result is an operand of the outer, and editing an inner member updates both", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2);
    const c = rect(200, 0, 100, 100, 3);
    const { doc, gid: inner } = combined([a, b], "union");
    const unit = [...doc.all()];
    const outer = newObjectId();
    const next = groupObjects([...unit, c].map((o) => (doc.get(o.id) ?? o)), 0, outer).map((o) => ({ ...o, boolOps: { ...(o.boolOps ?? {}), [outer]: "subtract" } }) as CanvasObject);
    doc.commit(doc.transaction("Subtract", next));
    expect(doc.size).toBe(5);
    expect(operandsOf(doc.all(), outer)).toHaveLength(2);
    expect(operandsOf(doc.all(), inner)).toHaveLength(2);
    expect(result(doc, outer)).toBeDefined();
    doc.commit(doc.transaction("Move", [translate(doc.get(c.id)!, D.fromNumber(-150), D.ZERO)]));
    expect(inside(result(doc, outer), 60, 60)).toBe(false);
    expect(result(doc, inner)).toBeDefined();
  });
});

/** As drawn: the turn of a path included. */
const drawnInside = (o: PathObject, x: number, y: number) => {
  // (x, y) in the world: each object has its own anchor and unit, and a turned one has been moved by the turn)
  const lx = D.toNumber(D.shift(D.sub(D.fromNumber(x), o.anchor.x), -o.unit));
  const ly = D.toNumber(D.shift(D.sub(D.fromNumber(y), o.anchor.y), -o.unit));
  return insideFill(flat(pathSubs(o)), lx, ly, !!o.evenodd);
};
const turnAll = (doc: DocumentStore, about: { x: D.Dyadic; y: D.Dyadic }, delta: number) =>
  doc.commit(doc.transaction("Rotate", [...doc.all()].map((o) => rotateAbout(o, about, delta))));

describe("boolean groups turn with their shapes", () => {
  const points = Array.from({ length: 13 * 13 }, (_, i) => [-100 + (i % 13) * 20 + 3, -100 + Math.floor(i / 13) * 20 + 3] as const);
  const agrees = (doc: DocumentStore, gid: string, ids: string[]) => {
    const members = ids.map((id) => doc.get(id) as PathObject);
    const r = result(doc, gid);
    for (const [x, y] of points) expect(drawnInside(r, x, y), `at ${x},${y}`).toBe(members.some((m) => drawnInside(m, x, y)));
  };
  it("the result is turned like the shapes (so its box turns with them) and is exactly their union as drawn", () => {
    const a = rect(0, 0, 100, 60, 1);
    const b = rect(50, 30, 100, 60, 2);
    const { doc, gid } = combined([a, b], "union");
    const about = { x: D.fromNumber(60), y: D.fromNumber(40) };
    turnAll(doc, about, Math.round(TURN / 8)); // 45 degrees
    expect(result(doc, gid).rot).toBe(doc.get(a.id)!.rot);
    expect(result(doc, gid).rot).toBeGreaterThan(0);
    agrees(doc, gid, [a.id, b.id]);
    turnAll(doc, about, Math.round(TURN / 12)); // and again: it goes on from where it is
    expect(result(doc, gid).rot).toBe(doc.get(b.id)!.rot);
    agrees(doc, gid, [a.id, b.id]);
    doc.undo();
    agrees(doc, gid, [a.id, b.id]);
  });
  it("shapes turned differently make an upright result, and it follows when one is turned", () => {
    const a = rect(0, 0, 100, 60, 1);
    const b = rect(50, 30, 100, 60, 2);
    const { doc, gid } = combined([a, b], "subtract");
    doc.commit(doc.transaction("Turn", [rotateAbout(doc.get(b.id)!, { x: D.fromNumber(100), y: D.fromNumber(60) }, Math.round(TURN / 6))]));
    expect(result(doc, gid).rot).toBeUndefined();
    const r = result(doc, gid);
    for (const [x, y] of points) expect(drawnInside(r, x, y)).toBe(drawnInside(doc.get(a.id) as PathObject, x, y) && !drawnInside(doc.get(b.id) as PathObject, x, y));
  });
  it("a turned group inside another turns with it, at both levels", () => {
    const a = rect(0, 0, 100, 60, 1);
    const b = rect(50, 30, 100, 60, 2);
    const c = rect(120, 0, 60, 60, 3);
    const doc = new DocumentStore();
    doc.load([a, b, c]);
    const inner = newObjectId();
    doc.commit(doc.transaction("Union", groupObjects([a, b], 0, inner).map((o) => ({ ...o, boolOps: { [inner]: "union" } }) as CanvasObject)));
    const outer = newObjectId();
    const unit = [...doc.all()].filter((o) => o.groups?.includes(inner) || o.id === c.id);
    doc.commit(doc.transaction("Union", groupObjects(unit, 0, outer).map((o) => ({ ...o, boolOps: { ...(o.boolOps ?? {}), [outer]: "union" } }) as CanvasObject)));
    turnAll(doc, { x: D.fromNumber(90), y: D.fromNumber(45) }, Math.round(TURN / 5));
    expect(resultOf(doc.all(), inner)!.rot).toBe(doc.get(a.id)!.rot);
    expect(resultOf(doc.all(), outer)!.rot).toBe(doc.get(a.id)!.rot);
    const ro = resultOf(doc.all(), outer)!;
    const ri = resultOf(doc.all(), inner)!;
    for (const [x, y] of points) expect(drawnInside(ro, x, y), `${x},${y}`).toBe(drawnInside(ri, x, y) || drawnInside(doc.get(c.id) as PathObject, x, y));
  });
});

describe("corner radius of a boolean group", () => {
  it("rounds the corners of the result only, between lines and curves, and the shapes keep theirs", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2);
    const { doc, gid } = combined([a, b], "union");
    expect(nodeCount(result(doc, gid).sub[0]!)).toBe(8);
    doc.commit(doc.transaction("Radius", [{ ...result(doc, gid), radius: 10 } as PathObject]));
    expect(nodeCount(result(doc, gid).sub[0]!)).toBe(16);
    expect(nodeCount((doc.get(a.id) as PathObject).sub[0]!)).toBe(4);
    doc.commit(doc.transaction("Move", [translate(doc.get(b.id)!, D.fromNumber(10), D.ZERO)]));
    expect(result(doc, gid).radius).toBe(10); // it stays with the group as the shapes change
    expect(nodeCount(result(doc, gid).sub[0]!)).toBe(16);
    doc.undo();
    doc.undo();
    expect(nodeCount(result(doc, gid).sub[0]!)).toBe(8);
    doc.redo();
    expect(nodeCount(result(doc, gid).sub[0]!)).toBe(16);
  });
  it("rounds the corners where a curve meets a line, which a union of a rectangle and an ellipse has", () => {
    const a = rect(0, 0, 100, 100, 1);
    const ell: PathObject = { ...rect(0, 0, 1, 1, 2), sub: ellipseSubs(60, 20, 100, 60) };
    const { doc, gid } = combined([a, ell], "union");
    const sharp = nodeCount(result(doc, gid).sub[0]!);
    doc.commit(doc.transaction("Radius", [{ ...result(doc, gid), radius: 6 } as PathObject]));
    expect(nodeCount(result(doc, gid).sub[0]!)).toBeGreaterThan(sharp);
  });
  it("is kept when the group is stretched and when the result's units are renamed", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2);
    const { doc, gid } = combined([a, b], "union");
    doc.commit(doc.transaction("Radius", [{ ...result(doc, gid), radius: 10 } as PathObject]));
    doc.commit(doc.transaction("Stretch", [...doc.all()].map((o) => scaleAbout(o, { x: D.ZERO, y: D.ZERO }, 3, 3))));
    const r = result(doc, gid);
    expect(nodeCount(r.sub[0]!)).toBe(16);
    const f = 2 ** (r.unit); // local units to world units
    expect((r.radius as number) * f).toBeCloseTo(10, 6); // a bigger group keeps its corner
  });
  it("a nested group's radius rounds its own result, which the outer group then combines as it is", () => {
    const a = rect(0, 0, 100, 100, 1);
    const b = rect(50, 50, 100, 100, 2);
    const c = rect(300, 0, 50, 50, 3);
    const doc = new DocumentStore();
    doc.load([a, b, c]);
    const inner = newObjectId();
    doc.commit(doc.transaction("Union", groupObjects([a, b], 0, inner).map((o) => ({ ...o, boolOps: { [inner]: "union" } }) as CanvasObject)));
    doc.commit(doc.transaction("Radius", [{ ...resultOf(doc.all(), inner)!, radius: 10 } as PathObject]));
    const outer = newObjectId();
    const unit = [...doc.all()].filter((o) => o.groups?.includes(inner) || o.id === c.id);
    doc.commit(doc.transaction("Union", groupObjects(unit, 0, outer).map((o) => ({ ...o, boolOps: { ...(o.boolOps ?? {}), [outer]: "union" } }) as CanvasObject)));
    const ro = resultOf(doc.all(), outer)!;
    expect(ro.sub.reduce((n, s) => n + nodeCount(s), 0)).toBe(16 + 4); // the rounded inner result and the plain rectangle
    doc.commit(doc.transaction("Radius", [{ ...ro, radius: 5 } as PathObject]));
    expect(resultOf(doc.all(), outer)!.sub.reduce((n, s) => n + nodeCount(s), 0)).toBeGreaterThan(20);
  });
});

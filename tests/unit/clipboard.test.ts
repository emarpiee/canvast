import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { FrameSpace } from "../../src/core/frames";
import { buildPayload, instantiate, parsePayload } from "../../src/doc/clipboard";
import { groupObjects } from "../../src/doc/groups";
import type { CanvasObject, StrokeObject } from "../../src/doc/model";
import { expressObjectIn, newObjectId, serializeObject } from "../../src/doc/model";
import { unionBounds } from "../../src/doc/edit-ops";

const stroke = (x: number, y: number, z: number, extra: Partial<StrokeObject> = {}): StrokeObject => ({
  id: newObjectId(),
  kind: "stroke",
  anchor: { x: D.fromNumber(x), y: D.fromNumber(y) },
  unit: 0,
  z,
  opacity: 1,
  attachmentTargetId: null,
  points: [0, 0, 10, 4],
  width: 2,
  color: "#112233",
  ...extra,
});

describe("clipboard (ADR 0038)", () => {
  const space = new FrameSpace();
  const world = space.world;

  it("pastes new objects centred on the target, with new ids, groups renamed together and the stacking order kept", () => {
    const [a, b, c] = groupObjects([stroke(0, 0, 1), stroke(100, 0, 2), stroke(200, 50, 3)], 0) as StrokeObject[];
    const p = buildPayload([a!, b!, c!], world, 4);
    const { objects, moved } = instantiate(p, space, 10, { frame: world, at: { x: D.fromNumber(1000), y: D.fromNumber(2000) }, depth: 4 });
    expect(moved).toBe(true);
    expect(objects.map((o) => o.z)).toEqual([11, 12, 13]);
    expect(new Set(objects.map((o) => o.id)).size).toBe(3);
    expect([a!.id, b!.id, c!.id].some((id) => objects.some((o) => o.id === id))).toBe(false);
    expect(new Set(objects.map((o) => o.groups![0])).size).toBe(1);
    expect(objects[0]!.groups![0]).not.toBe(a!.groups![0]);
    const box = unionBounds(objects)!;
    const old = unionBounds([a!, b!, c!])!;
    expect(D.toNumber(D.sub(box.max.x, box.min.x))).toBe(D.toNumber(D.sub(old.max.x, old.min.x)));
    expect(D.toNumber(D.shift(D.add(box.min.x, box.max.x), -1))).toBeCloseTo(1000, 6);
    expect(D.toNumber(D.shift(D.add(box.min.y, box.max.y), -1))).toBeCloseTo(2000, 6);
  });

  it("keeps the size it had on screen: pasting 3 levels deeper makes it 2^-3 the world size, exactly", () => {
    const a = stroke(0, 0, 1);
    const p = buildPayload([a], world, 0);
    const { objects } = instantiate(p, space, 0, { frame: world, at: { x: D.ZERO, y: D.ZERO }, depth: 3 });
    const o = objects[0] as StrokeObject;
    expect(o.unit).toBe(-3);
    expect(o.points).toEqual(a.points); // the local geometry is untouched
    expect(D.toNumber(D.shift(D.fromNumber(o.width), o.unit))).toBe(2 / 8);
  });

  it("works at extreme depth: pasting a million levels deeper re-homes the object into a deeper frame without error", () => {
    const a = stroke(3, 4, 1);
    const p = buildPayload([a], world, 0);
    const { objects, moved } = instantiate(p, space, 0, { frame: world, at: { x: D.ZERO, y: D.ZERO }, depth: 1e6 });
    expect(moved).toBe(true);
    expect(objects).toHaveLength(1);
    expect(objects[0]!.frame).toBeDefined();
    expect(objects[0]!.frame).not.toBe(world);
  });

  it("round-trips through text, drops hidden and locked, and refuses what is not a payload", () => {
    const a = stroke(0, 0, 1, { hidden: true, locked: true });
    const p = buildPayload([a], world, 0);
    expect(p.objects[0]!["hidden"]).toBeUndefined();
    expect(p.objects[0]!["locked"]).toBeUndefined();
    expect(parsePayload(JSON.stringify(p))).toEqual(p);
    expect(parsePayload("hello")).toBeNull();
    expect(parsePayload(JSON.stringify({ v: 1, objects: [] }))).toBeNull();
    expect(serializeObject(a)["id"]).toBe(a.id);
  });

  it("pastes under the target from any frame or canvas: objects in another frame than the view, and on a canvas that has no such frame", () => {
    const deep = space.child(world, 40n, D.fromNumber(3), D.fromNumber(5));
    const a: CanvasObject = { ...stroke(7, 9, 1), frame: deep };
    const at = { x: D.fromNumber(1000), y: D.fromNumber(2000) };
    const p = buildPayload([a], world, 4);
    expect(p.centre).not.toBeNull();
    for (const s of [space, new FrameSpace()]) {
      const { objects, moved } = instantiate(parsePayload(JSON.stringify(p))!, s, 0, { frame: s.world, at, depth: 4 });
      expect(moved).toBe(true);
      const c = unionBounds(objects.map((o) => expressObjectIn(o, s.world))); // (a tiny object lives in a frame of its size)
      expect(D.equals(D.shift(D.add(c!.min.x, c!.max.x), -1), at.x)).toBe(true);
      expect(D.equals(D.shift(D.add(c!.min.y, c!.max.y), -1), at.y)).toBe(true);
    }
  });

  it("comes back in place when there is no target frame match", () => {
    const a: CanvasObject = stroke(5, 6, 1);
    const p = buildPayload([a], world, 0);
    const { objects, moved } = instantiate(p, space, 0);
    expect(moved).toBe(false);
    expect(D.equals(objects[0]!.anchor.x, a.anchor.x)).toBe(true);
  });
});

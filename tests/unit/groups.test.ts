import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { restack } from "../../src/doc/edit-ops";
import { expandToUnits, groupObjects, ungroupObjects } from "../../src/doc/groups";
import type { CanvasObject, StrokeObject } from "../../src/doc/model";
import { deserializeObject, newObjectId, serializeObject, validateObject } from "../../src/doc/model";

const stroke = (z: number): StrokeObject => ({ id: newObjectId(), kind: "stroke", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z, opacity: 1, attachmentTargetId: null, points: [0, 0, 10, 0], width: 1, color: "#000000" });
const ids = (xs: readonly CanvasObject[]) => xs.map((o) => o.id);

describe("groups (ADR 0020)", () => {
  it("group, nest, expand to whole units and ungroup one level at a time", () => {
    const [a, b, c] = [stroke(1), stroke(2), stroke(3)];
    const ab = groupObjects([a!, b!], 0);
    const all = [...ab, c!];
    expect(expandToUnits(all, [ab[0]!], [])).toEqual(ids(ab)); // picking one member picks the group
    expect(expandToUnits(all, [c!], [])).toEqual([c!.id]);
    const abc = groupObjects(all, 0); // a group of a group and a loose stroke
    expect(abc[0]!.groups).toHaveLength(2);
    expect(expandToUnits(abc, [abc[0]!], [])).toEqual(ids(abc)); // outermost unit
    expect(expandToUnits(abc, [abc[0]!], [abc[0]!.groups![0]!])).toEqual(ids(abc.slice(0, 2))); // entered: the inner group
    const flat = ungroupObjects(abc, 0);
    expect(flat.map((o) => o.groups?.length)).toEqual([1, 1, undefined]); // the outer group is gone, the inner one stays
    expect(ungroupObjects(flat, 0).every((o) => !o.groups)).toBe(true);
  });

  it("is stored, restored and validated; restack keeps the order among the moved objects", () => {
    const g = groupObjects([stroke(1)], 0)[0]!;
    expect(deserializeObject(serializeObject(g)).groups).toEqual(g.groups);
    expect(() => validateObject({ ...g, groups: ["nope"] })).toThrow();
    const [a, b, c] = [stroke(1), stroke(2), stroke(3)];
    expect(restack([a!, b!], [a!, b!, c!], "front").map((o) => o.z)).toEqual([4, 5]);
    expect(restack([c!], [a!, b!, c!], "back").map((o) => o.z)).toEqual([0]);
  });
});

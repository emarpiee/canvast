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

describe("layers panel data (ADR 0024)", () => {
  it("places objects just in front of another without touching the rest, and builds the group tree front first", async () => {
    const { placeAbove } = await import("../../src/doc/edit-ops");
    const { layerTree } = await import("../../src/ui/layers-panel");
    const [a, b, c, d] = [stroke(1), stroke(2), stroke(3), stroke(4)];
    const moved = placeAbove([a!, b!, c!, d!], [d!], a!); // d goes just above a
    expect(moved).toHaveLength(1);
    expect(moved[0]!.z).toBeGreaterThan(1);
    expect(moved[0]!.z).toBeLessThan(2);
    const grouped = [...groupObjects([a!, c!], 0), b!];
    const tree = layerTree(grouped);
    expect(tree.map((n) => n.group)).toEqual([true, false]); // the group (its top member is c) in front of b
    expect(tree[0]!.children.map((n) => n.id)).toEqual([c!.id, a!.id]);
  });
});

describe("import grid (ADR 0030)", () => {
  it("lays a batch out in a roughly square grid, centred, in order, never overlapping, scaled down to fit and never up", async () => {
    const { gridLayout } = await import("../../src/app/actions");
    const vp = { width: 1280, height: 800 };
    const hd = (n: number) => Array.from({ length: n }, () => ({ w: 1920, h: 1080 }));
    const g300 = gridLayout(hd(300), vp);
    const cols = g300.filter((c) => c.y === g300[0]!.y).length;
    expect(cols, "13 columns by 24 rows is as square as 16:9 cells allow").toBe(13);
    expect(Math.ceil(300 / cols)).toBe(24);
    const right = Math.max(...g300.map((c) => c.x + c.w));
    const bottom = Math.max(...g300.map((c) => c.y + c.h));
    const left = Math.min(...g300.map((c) => c.x));
    const top = Math.min(...g300.map((c) => c.y));
    expect(bottom - top, "fits 90% of the viewport").toBeLessThanOrEqual(0.9 * 800 + 1e-6);
    expect(right - left).toBeLessThanOrEqual(0.9 * 1280 + 1e-6);
    expect((left + right) / 2).toBeCloseTo(640, 6);
    expect((top + bottom) / 2).toBeCloseTo(400, 6);
    expect(g300[1]!.x).toBeGreaterThan(g300[0]!.x + g300[0]!.w - 1e-9); // in reading order, a gap between neighbours
    expect(g300[13]!.y).toBeGreaterThan(g300[0]!.y + g300[0]!.h - 1e-9);
    // Four squares make a 2 x 2 grid; small images are not scaled up; images keep their aspect ratio inside a cell.
    const sq = gridLayout([{ w: 100, h: 100 }, { w: 100, h: 100 }, { w: 100, h: 100 }, { w: 100, h: 100 }], vp);
    expect(new Set(sq.map((c) => c.x)).size).toBe(2);
    expect(sq[0]!.w).toBe(100);
    const mixed = gridLayout([{ w: 200, h: 100 }, { w: 100, h: 100 }], vp);
    expect(mixed[1]!.w / mixed[1]!.h).toBe(1);
  });
});

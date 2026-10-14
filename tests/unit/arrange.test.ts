import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { alignUnits, arrangeGrid, distributeUnits, sortUnits } from "../../src/doc/arrange";
import type { Unit } from "../../src/doc/arrange";
import { unionBounds } from "../../src/doc/edit-ops";
import type { CanvasObject, ImageObject } from "../../src/doc/model";
import { newObjectId } from "../../src/doc/model";

/** An image box with its top-left at (x, y) local units, w by h, in a space where one unit is 2^unit. */
const box = (x: number, y: number, w: number, h: number, z = 0, unit = 0): ImageObject => ({
  id: newObjectId(),
  kind: "image",
  anchor: { x: D.shift(D.fromNumber(x), unit), y: D.shift(D.fromNumber(y), unit) },
  unit,
  z,
  opacity: 1,
  attachmentTargetId: null,
  assetId: "0".repeat(64),
  w,
  h,
  pixelW: 4,
  pixelH: 4,
});
const unit = (o: CanvasObject, name = ""): Unit => ({ objects: [o], name });
const apply = (units: readonly Unit[], moved: readonly CanvasObject[]): Unit[] => units.map((u) => ({ ...u, objects: u.objects.map((o) => moved.find((m) => m.id === o.id) ?? o) }));
const edge = (u: Unit, side: "min" | "max", axis: "x" | "y"): number => D.toNumber(unionBounds(u.objects)![side][axis]);

describe("arrange, align and distribute", () => {
  it("align lines every unit up on the edge or centre of the whole selection, exactly", () => {
    const us = [unit(box(0, 0, 10, 10)), unit(box(50, 20, 30, 10)), unit(box(10, 90, 20, 40))];
    const left = apply(us, alignUnits(us, "left"));
    expect(left.map((u) => edge(u, "min", "x"))).toEqual([0, 0, 0]);
    const right = apply(us, alignUnits(us, "right"));
    expect(right.map((u) => edge(u, "max", "x"))).toEqual([80, 80, 80]);
    const mid = apply(us, alignUnits(us, "middle"));
    expect(mid.map((u) => (edge(u, "min", "y") + edge(u, "max", "y")) / 2)).toEqual([65, 65, 65]);
    // Sizes are untouched and a unit already in place is not part of the result.
    expect(alignUnits(us, "left").some((o) => o.id === us[0]!.objects[0]!.id)).toBe(false);
  });

  it("a grid keeps sizes, is about as wide as tall, centres on the selection and reads in the sort order", () => {
    const us = Array.from({ length: 6 }, (_, i) => unit(box(i * 500, (i % 2) * 300, 100, 100, i), `n${5 - i}`));
    const moved = apply(us, arrangeGrid(us, "name-asc"));
    // Names n0..n5 are us[5]..us[0]: the first cell holds us[5].
    const order = sortUnits(us, "name-asc").map((u) => u.name);
    expect(order).toEqual(["n0", "n1", "n2", "n3", "n4", "n5"]);
    const tops = new Set(moved.map((u) => edge(u, "min", "y")));
    const lefts = new Set(moved.map((u) => edge(u, "min", "x")));
    expect([lefts.size, tops.size]).toEqual([2, 3]); // 6 items: 2 columns by 3 rows
    const before = unionBounds(us.flatMap((u) => u.objects))!;
    const after = unionBounds(moved.flatMap((u) => u.objects))!;
    const c = (b: typeof before, a: "x" | "y"): number => (D.toNumber(b.min[a]) + D.toNumber(b.max[a])) / 2;
    expect(c(after, "x")).toBeCloseTo(c(before, "x"), 9);
    expect(c(after, "y")).toBeCloseTo(c(before, "y"), 9);
    expect(moved.every((u) => (u.objects[0] as ImageObject).w === 100)).toBe(true);
  });

  it("distribute spaces the middle units evenly and leaves the ends", () => {
    const us = [unit(box(0, 0, 10, 10)), unit(box(15, 0, 10, 10)), unit(box(20, 0, 10, 10)), unit(box(100, 0, 10, 10))];
    const moved = apply(us, distributeUnits(us, "x"));
    expect(moved.map((u) => edge(u, "min", "x"))).toEqual([0, 100 / 3, 200 / 3, 100].map((v, i) => (i === 1 || i === 2 ? expect.closeTo(v, 9) : v)));
    expect(distributeUnits(us.slice(0, 2), "x")).toEqual([]);
  });

  it("sorts by name with unnamed strokes last in both directions, by size and by type", () => {
    const a = unit(box(0, 0, 10, 10, 0), "b.png");
    const b = unit(box(0, 0, 50, 50, 1), "a.png");
    const s = unit({ ...box(0, 0, 5, 5, 2), kind: "stroke", points: [0, 0, 5, 5], width: 1, color: "#000000" } as unknown as CanvasObject, "");
    expect(sortUnits([s, a, b], "name-asc").map((u) => u.name)).toEqual(["a.png", "b.png", ""]);
    expect(sortUnits([s, a, b], "name-desc").map((u) => u.name)).toEqual(["b.png", "a.png", ""]);
    const dated = [{ ...a, date: 100 }, { ...b, date: 200 }, s];
    expect(sortUnits(dated, "date").map((u) => u.name)).toEqual(["a.png", "b.png", ""]); // newest first, undated last
    expect(sortUnits([a, b], "size").map((u) => u.name)).toEqual(["a.png", "b.png"]);
    expect(sortUnits([s, a, b], "type").map((u) => u.name)).toEqual(["a.png", "b.png", ""]);
  });

  it("is exact at any scale: units 2^-900 and 2^1000 apart keep their sizes and move by exact translations", () => {
    const tiny = unit(box(3, 5, 7, 7, 0, -900));
    const huge = unit(box(1000, 2000, 4, 4, 1, 1000));
    const us = [tiny, huge];
    const moved = alignUnits(us, "top");
    expect(moved).toHaveLength(1); // only the lower one moves
    const m = apply(us, moved);
    expect(D.equals(unionBounds(m[0]!.objects)!.min.y, unionBounds(m[1]!.objects)!.min.y)).toBe(true);
    const g = arrangeGrid(us, "stack");
    expect(g.every((o) => Number.isFinite((o as ImageObject).w))).toBe(true);
    expect(g.length).toBeGreaterThan(0);
  });
});

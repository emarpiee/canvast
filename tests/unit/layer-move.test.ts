import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import type { CanvasObject, PathObject } from "../../src/doc/model";
import { newObjectId } from "../../src/doc/model";
import { MAX_GROUP_DEPTH } from "../../src/doc/groups";
import { planLayerMove } from "../../src/doc/layer-move";

const ORIGIN = { x: D.ZERO, y: D.ZERO };
const shape = (z: number, extra: Partial<PathObject> = {}): PathObject => ({ id: newObjectId(), kind: "path", anchor: ORIGIN, unit: 0, z, opacity: 1, attachmentTargetId: null, sub: [{ n: [0, 0, 0, 0, 10, 0, 10, 0, 10, 10, 10, 10], closed: true }], fill: "#000000", stroke: null, width: 1, ...extra });
const sheet = (z: number, extra: Partial<PathObject> = {}): PathObject => shape(z, { container: { clip: true }, ...extra });
const ok = (r: ReturnType<typeof planLayerMove>): CanvasObject[] => {
  if ("problem" in r) throw new Error(r.problem);
  return r.next;
};
const of = (list: readonly CanvasObject[], id: string): CanvasObject => list.find((o) => o.id === id)!;

describe("moving rows of the Layers panel (doc/layer-move.ts)", () => {
  it("puts an object inside a group, then out next to a row at the top, and keeps it on the canvas where it is", () => {
    const g = newObjectId();
    const a = shape(0, { groups: [g], groupNames: { [g]: "Pair" } }), b = shape(1, { groups: [g] }), c = shape(2);
    const inside = ok(planLayerMove([a, b, c], [c.id], g, "inside"));
    expect(of(inside, c.id).groups).toEqual([g]);
    expect(of(inside, c.id).groupNames).toEqual({ [g]: "Pair" });
    expect(of(inside, c.id).anchor).toBe(c.anchor);
    const all = [a, b, of(inside, c.id)];
    const out = ok(planLayerMove(all, [c.id], g, "after"));
    expect(of(out, c.id).groups).toBeUndefined();
    expect(of(out, c.id).z, "after the group: behind it").toBeLessThan(Math.min(...out.filter((o) => o.id !== c.id).map((o) => o.z)));
  });

  it("moves a whole group into another group, as deep as groups go, keeping its own groups inside", () => {
    const outer = newObjectId(), inner = newObjectId();
    const a = shape(0, { groups: [outer] }), b = shape(1, { groups: [inner] }), c = shape(2, { groups: [inner] });
    const next = ok(planLayerMove([a, b, c], [inner], outer, "inside"));
    expect(of(next, b.id).groups).toEqual([outer, inner]);
    expect(of(next, c.id).groups).toEqual([outer, inner]);
    const deep = Array.from({ length: MAX_GROUP_DEPTH }, () => newObjectId());
    const d = shape(3, { groups: deep }), e = shape(4);
    expect(ok(planLayerMove([d, e], [e.id], deep.at(-1)!, "inside")).find((o) => o.id === e.id)!.groups).toHaveLength(MAX_GROUP_DEPTH);
    const f = shape(5, { groups: [newObjectId()] });
    expect(planLayerMove([d, f], [f.groups![0]!], deep.at(-1)!, "inside")).toEqual({ problem: `Groups go ${MAX_GROUP_DEPTH} deep at most.` });
  });

  it("never puts a group inside itself", () => {
    const outer = newObjectId(), inner = newObjectId();
    const a = shape(0, { groups: [outer, inner] }), b = shape(1, { groups: [outer] });
    expect(planLayerMove([a, b], [outer], inner, "inside")).toEqual({ problem: "A group cannot go inside itself." });
  });

  it("a shape joins a boolean group with the group's operation, and leaves it without it", () => {
    const g = newObjectId();
    const a = shape(0, { groups: [g], boolOps: { [g]: "union" } }), b = shape(1, { groups: [g], boolOps: { [g]: "union" } }), c = shape(2);
    const inside = ok(planLayerMove([a, b, c], [c.id], g, "inside"));
    expect(of(inside, c.id).boolOps).toEqual({ [g]: "union" });
    const out = ok(planLayerMove([a, b, of(inside, c.id)], [c.id], b.id, "after"));
    expect(of(out, c.id).groups, "next to a member: still in the group").toEqual([g]);
    const away = ok(planLayerMove([a, b, of(inside, c.id), shape(3)], [c.id], g, "before"));
    expect(of(away, c.id).boolOps).toBeUndefined();
    const stroke = { ...c, id: newObjectId(), kind: "stroke", points: [0, 0, 1, 1], color: "#000000" } as unknown as CanvasObject;
    expect(planLayerMove([a, b, stroke], [stroke.id], g, "inside")).toEqual({ problem: "Only shapes can go in a boolean group." });
  });

  it("puts an object, a group or a sheet with what is on it onto a sheet, and never a sheet onto itself or onto what is on it", () => {
    const s = sheet(0), t = sheet(1), on = shape(2, { parent: t.id }), g = newObjectId(), a = shape(3, { groups: [g] });
    const next = ok(planLayerMove([s, t, on, a], [g], s.id, "inside"));
    expect(of(next, a.id).parent).toBe(s.id);
    expect(of(next, a.id).groups).toEqual([g]);
    const sheets = ok(planLayerMove([s, t, on], [t.id], s.id, "inside"));
    expect(of(sheets, t.id).parent).toBe(s.id);
    expect(of(sheets, on.id).parent, "what is on it stays on it").toBe(t.id);
    expect(planLayerMove([s, t, on], [t.id], on.id, "after")).toEqual({ problem: "A sheet cannot go onto itself or onto what is on it." });
    const nested = { ...t, parent: s.id } as CanvasObject;
    expect(planLayerMove([s, nested, on], [s.id], t.id, "inside")).toEqual({ problem: "A sheet cannot go onto itself or onto what is on it." });
    const out = ok(planLayerMove([s, nested, on], [on.id], s.id, "before"));
    expect(of(out, on.id).parent, "next to a sheet at the top: on the canvas").toBeUndefined();
  });

  it("refuses a locked layer and a drop on a plain object's middle", () => {
    const a = shape(0, { locked: true }), b = shape(1);
    expect(planLayerMove([a, b], [a.id], b.id, "before")).toEqual({ problem: "A locked layer cannot be moved: unlock it first." });
    expect(planLayerMove([a, b], [b.id], a.id, "inside")).toEqual({ problem: "Only a group or a sheet can hold layers." });
  });
});

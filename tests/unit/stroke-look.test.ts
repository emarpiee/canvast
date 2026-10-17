import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { alignOf, inkStyle, newObjectId, deserializeObject, serializeObject } from "../../src/doc/model";
import type { PathObject } from "../../src/doc/model";
import { geometryBounds, paintBounds, rectSubs, lineSubs } from "../../src/doc/path";
import { alignChoice, lookFromChoices } from "../../src/doc/stroke-look";

const ORIGIN = { x: D.ZERO, y: D.ZERO };
const path = (extra: Partial<PathObject> = {}, sub = rectSubs(0, 0, 100, 50)): PathObject => ({ id: newObjectId(), kind: "path", anchor: ORIGIN, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub, fill: "#2563eb", stroke: "#1f2329", width: 10, ...extra });

describe("outline look: corners, ends, position", () => {
  it("stores only what differs from the default", () => {
    expect(lookFromChoices(null, "round", "centre")).toEqual({});
    expect(lookFromChoices(null, "round", "centre", "miter")).toEqual({ join: "miter" });
    expect(lookFromChoices("round", "round", "centre", "miter")).toEqual({}); // a choice of round beats the tool's own sharp corners
    expect(lookFromChoices("bevel", "butt", "outside")).toEqual({ join: "bevel", cap: "butt", align: "outside" });
    expect(alignChoice({})).toBe("centre");
  });
  it("only a closed outline can sit inside or outside", () => {
    expect(alignOf(path({ align: "outside" }))).toBe("outside");
    expect(alignOf(path({ align: "inside" }, lineSubs(0, 0, 100, 0)))).toBeUndefined();
    expect(alignOf(path({ align: "inside", stroke: null }))).toBeUndefined();
    expect(alignOf(path())).toBeUndefined();
  });
  it("the ink reaches a whole width past the edge outside, half a width centred, nothing inside", () => {
    const g = geometryBounds(path().sub);
    const reach = (o: PathObject) => g.minX - paintBounds(o.sub, inkStyle(o)).minX;
    expect(reach(path({ join: "bevel" }))).toBeCloseTo(5, 6);
    expect(reach(path({ join: "bevel", align: "outside" }))).toBeCloseTo(10, 6);
    expect(reach(path({ align: "inside" }))).toBeCloseTo(0, 6);
  });
  it("is saved and read back, and a bad value is refused", () => {
    const o = path({ align: "inside", join: "miter" });
    expect((deserializeObject(serializeObject(o)) as PathObject).align).toBe("inside");
    expect(() => deserializeObject({ ...serializeObject(o), align: "middle" })).toThrow();
  });
});

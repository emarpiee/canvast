import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { TURN } from "../../src/core/angle";
import type { PathObject } from "../../src/doc/model";
import type { Gradient } from "../../src/doc/paint";
import { asKind, gradientFrom, isPaint, paintCss } from "../../src/doc/paint";
import { rectSubs } from "../../src/doc/path";
import { boxToLocal, localGradient, offsetAt } from "../../src/render/gradient";
import { moveGradientHandle } from "../../src/interaction/path-edit";

const stops = [{ o: 0, c: "#ff0000" }, { o: 1, c: "#0000ff" }];
const g: Gradient = { type: "angular", cx: 0.5, cy: 0.5, angle: 0, stops };
const path = (extra: Partial<PathObject> = {}): PathObject => ({ id: "a", kind: "path", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub: rectSubs(0, 0, 100, 100), fill: g, stroke: null, width: 1, ...extra });

describe("angular gradient", () => {
  it("is a paint when its centre and start are numbers and the start is a turn or less", () => {
    expect(isPaint(g)).toBe(true);
    expect(isPaint({ ...g, angle: 360 })).toBe(false);
    expect(isPaint({ type: "angular", cx: 0.5, angle: 0, stops })).toBe(false);
    expect(paintCss(g)).toMatch(/^conic-gradient\(from 90deg at 50% 50%, #ff0000 0%, #0000ff 100%\)$/);
  });
  it("is made from a colour and converts to and from the other kinds, keeping the centre", () => {
    expect(gradientFrom("#336699", "angular")).toMatchObject({ type: "angular", cx: 0.5, cy: 0.5, angle: 0 });
    const radial = asKind({ type: "radial", cx: 0.2, cy: 0.7, r: 0.5, stops }, "angular");
    expect(radial).toMatchObject({ type: "angular", cx: 0.2, cy: 0.7 });
    expect(asKind(g, "radial")).toMatchObject({ type: "radial", cx: 0.5, cy: 0.5 });
  });
  it("goes clockwise from pointing right: right 0, below a quarter, left a half, above three quarters", () => {
    const l = localGradient(path(), g);
    expect(l.type).toBe("angular");
    const at = (x: number, y: number): number => offsetAt(l, x, y);
    expect(at(90, 50)).toBeCloseTo(0, 6);
    expect(at(50, 90)).toBeCloseTo(0.25, 6);
    expect(at(10, 50)).toBeCloseTo(0.5, 6);
    expect(at(50, 10)).toBeCloseTo(0.75, 6);
  });
  it("starts where the angle says, and turns with the path", () => {
    expect(offsetAt(localGradient(path(), { ...g, angle: 90 }), 50, 90)).toBeCloseTo(0, 6);
    expect(offsetAt(localGradient(path({ rot: TURN / 4 }), g), 50, 90)).toBeCloseTo(0, 6);
  });
  it("its angle handle sets the angle from the pointer, less the path's turn", () => {
    const p = path();
    expect((moveGradientHandle(p, g, "r", 50, 90) as { angle: number }).angle).toBeCloseTo(90, 6);
    expect((moveGradientHandle(path({ rot: TURN / 4 }), g, "r", 50, 90) as { angle: number }).angle).toBeCloseTo(0, 6);
    const [cx, cy] = boxToLocal(p, 0.5, 0.5);
    expect([cx, cy]).toEqual([50, 50]);
  });
});

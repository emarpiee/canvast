import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { TURN, cosSin } from "../../src/core/angle";
import { rotateAbout } from "../../src/doc/edit-ops";
import type { StrokeObject } from "../../src/doc/model";
import { deserializeObject, newObjectId, serializeObject, strokePoints, validateObject } from "../../src/doc/model";
import { rng } from "./rng";

const stroke = (extra: Partial<StrokeObject> = {}): StrokeObject => ({
  id: newObjectId(),
  kind: "stroke",
  anchor: { x: D.fromBigInt(5n, -3), y: D.fromBigInt(-7n, -2) },
  unit: -4,
  z: 0,
  opacity: 1,
  attachmentTargetId: null,
  points: [0, 0, 40, 0, 40, 10],
  width: 2,
  color: "#102030",
  ...extra,
});

describe("rotation (ADR 0018)", () => {
  it("cos and sin are exact at quarter turns and agree with Math to rounding", () => {
    expect(cosSin(0)).toEqual({ c: 1, s: 0 });
    const quarter = cosSin(TURN / 4);
    expect([quarter.c + 0, quarter.s]).toEqual([0, 1]);
    const half = cosSin(TURN / 2);
    expect([half.c, half.s + 0]).toEqual([-1, 0]);
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const q = Math.floor(r() * TURN);
      const { c, s } = cosSin(q);
      expect(Math.abs(c - Math.cos((q / TURN) * 2 * Math.PI))).toBeLessThan(1e-14);
      expect(Math.abs(s - Math.sin((q / TURN) * 2 * Math.PI))).toBeLessThan(1e-14);
    }
  });

  it("a quarter turn maps (x, y) about the pivot to (-y, x), and rotating back returns the identical object", () => {
    const o = stroke();
    const q = rotateAbout(o, { x: D.ZERO, y: D.ZERO }, TURN / 4) as StrokeObject;
    // pivot of the points is (20, 5); (0,0) is (-20,-5) from it, which turns into (5,-20).
    const p = strokePoints(q);
    expect(p[0]).toBeCloseTo(20 + 5, 12);
    expect(p[1]).toBeCloseTo(5 - 20, 12);
    // About its own pivot, nothing moves and the angle returns to exactly none.
    const own = (x: StrokeObject) => ({ x: D.add(x.anchor.x, D.shift(D.fromNumber(20), x.unit)), y: D.add(x.anchor.y, D.shift(D.fromNumber(5), x.unit)) });
    const there = rotateAbout(o, own(o), 12345) as StrokeObject;
    const home = rotateAbout(there, own(there), -12345) as StrokeObject;
    expect(home.rot).toBeUndefined();
    expect(D.toString(home.anchor.x)).toBe(D.toString(o.anchor.x));
    expect(D.toString(home.anchor.y)).toBe(D.toString(o.anchor.y));
  });

  it("is stored, restored and validated", () => {
    const o = stroke({ rot: 98765 });
    const r = deserializeObject(serializeObject(o)) as StrokeObject;
    expect(r.rot).toBe(98765);
    expect(strokePoints(r)).toEqual(strokePoints(o));
    expect(() => validateObject(stroke({ rot: 0.5 }))).toThrow();
    expect(() => validateObject(stroke({ rot: TURN }))).toThrow();
  });
});

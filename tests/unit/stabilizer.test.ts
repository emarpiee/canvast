import { describe, expect, it } from "vitest";
import { STABILIZER_MAX_ROPE_PX, ropeFor, ropeStep } from "../../src/interaction/stabilizer";
import { rng } from "./rng";

const len = (pts: Array<{ x: number; y: number }>): number => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y), 0);

describe("pen stabilizer (lazy rope)", () => {
  it("stays put inside the rope, is pulled taut outside it, and without a rope is the pointer", () => {
    const tip = { x: 100, y: 100 };
    expect(ropeStep(tip, { x: 110, y: 100 }, 20)).toBe(tip);
    const pulled = ropeStep(tip, { x: 150, y: 100 }, 20);
    expect(pulled).toEqual({ x: 130, y: 100 });
    expect(ropeStep(tip, { x: 130, y: 40 }, 0)).toEqual({ x: 130, y: 40 });
    expect(ropeFor(0)).toBe(0);
    expect(ropeFor(100)).toBe(STABILIZER_MAX_ROPE_PX);
    expect(ropeFor(-5)).toBe(0);
    expect(ropeFor(500)).toBe(STABILIZER_MAX_ROPE_PX);
  });

  it("random wobble: the rope never exceeds its length, the path is shorter, and it does not depend on how often the pointer reports", () => {
    const r = rng(11);
    for (const rope of [3, 12, 40]) {
      // A slow drag to the right with ±4 px of hand wobble.
      const pointer = Array.from({ length: 400 }, (_, i) => ({ x: i * 2, y: (r() - 0.5) * 8 }));
      let tip = pointer[0]!;
      const path = [tip];
      for (const p of pointer) {
        tip = ropeStep(tip, p, rope);
        expect(Math.hypot(p.x - tip.x, p.y - tip.y)).toBeLessThanOrEqual(rope + 1e-9);
        path.push(tip);
      }
      expect(len(path), `rope ${rope}`).toBeLessThan(len(pointer));
      if (rope >= 12) expect(Math.max(...path.map((p) => Math.abs(p.y))), `rope ${rope}: the wobble does not reach the stroke`).toBeLessThan(4);
      // The same drag reported twice as often (extra points between): the same end point to within the rope.
      let dense = pointer[0]!;
      for (const p of pointer) {
        dense = ropeStep(dense, { x: (p.x + dense.x) / 2, y: (p.y + dense.y) / 2 }, rope);
        dense = ropeStep(dense, p, rope);
      }
      expect(Math.abs(dense.x - tip.x)).toBeLessThan(rope + 1);
    }
  });
});

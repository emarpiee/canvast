import { describe, expect, it } from "vitest";
import { expandStroke } from "../../src/interaction/pens";
import type { RawStroke } from "../../src/interaction/pens";

/** A wavy line of n points, 40 local units wide, width 4. */
const wave = (n = 60): RawStroke => ({ points: Array.from({ length: n }, (_, i) => [i * 2, 20 * Math.sin(i / 6)]).flat(), width: 4 });

describe("pens (ADR 0037)", () => {
  it("the fine pen is the plain stroke", () => {
    const s = wave();
    expect(expandStroke("fine", s)).toEqual([{ points: [...s.points], width: 4, opacity: 1 }]);
    expect(expandStroke("fine", { points: [], width: 4 })).toEqual([]);
  });

  it("the marker is one wide translucent stroke", () => {
    const [p, ...rest] = expandStroke("marker", wave());
    expect(rest).toEqual([]);
    expect(p!.width).toBeGreaterThan(8);
    expect(p!.opacity).toBeLessThan(0.5);
  });

  it("the pencil makes three thin translucent passes that wander a little and are the same every time", () => {
    const s = wave();
    const passes = expandStroke("pencil", s);
    expect(passes).toHaveLength(3);
    expect(expandStroke("pencil", s)).toEqual(passes);
    for (const p of passes) {
      expect(p.width).toBeLessThan(4);
      expect(p.opacity).toBeLessThan(1);
      expect(p.points).toHaveLength(s.points.length);
      // Each point stays within the wander amplitude of the original.
      for (let i = 0; i < s.points.length; i += 2) expect(Math.hypot(p.points[i]! - s.points[i]!, p.points[i + 1]! - s.points[i + 1]!)).toBeLessThanOrEqual(0.5 * 4 + 1e-9);
    }
    expect(passes[0]!.points).not.toEqual(passes[1]!.points);
  });

  it("the ink pen is thick across its nib and thin along it, and pressure thickens it", () => {
    const along = Array.from({ length: 30 }, (_, i) => [i * 3, i * 3]).flat(); // 45 degrees: along the nib
    const across = Array.from({ length: 30 }, (_, i) => [i * 3, -i * 3]).flat(); // -45 degrees: across it
    const widest = (pts: number[], pressure?: number[]) => Math.max(...expandStroke("ink", { points: pts, width: 4, ...(pressure ? { pressure } : {}) }).map((p) => p.width));
    expect(widest(across)).toBeGreaterThan(2 * widest(along));
    const hard = Array.from({ length: 30 }, () => 1);
    const soft = Array.from({ length: 30 }, () => 0.1);
    expect(widest(across, hard)).toBeGreaterThan(1.5 * widest(across, soft));
    // Without pressure a quick stroke is thinner than a slow one.
    const speed = (v: number) => Math.max(...expandStroke("ink", { points: across, width: 4, speed: Array.from({ length: 30 }, () => v) }).map((p) => p.width));
    expect(speed(0.1)).toBeGreaterThan(speed(3));
  });

  it("ink pieces join end to start, cover every point, and are far fewer than the segments", () => {
    const s = wave(200);
    const pieces = expandStroke("ink", s);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.length).toBeLessThan(60);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]!.points.slice(0, 2)).toEqual(pieces[i - 1]!.points.slice(-2));
    expect(pieces[0]!.points.slice(0, 2)).toEqual(s.points.slice(0, 2));
    expect(pieces[pieces.length - 1]!.points.slice(-2)).toEqual(s.points.slice(-2));
    expect(new Set(pieces.map((p) => Math.round(p.width * 100))).size).toBeGreaterThan(2);
  });

  it("the four pens give four different results for the same input", () => {
    const s = wave();
    const sig = (k: "fine" | "pencil" | "ink" | "marker") => JSON.stringify(expandStroke(k, s).map((p) => [p.points.length, Math.round(p.width * 10), p.opacity]));
    expect(new Set([sig("fine"), sig("pencil"), sig("ink"), sig("marker")]).size).toBe(4);
  });
});

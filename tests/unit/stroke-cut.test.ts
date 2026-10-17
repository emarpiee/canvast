import { describe, expect, it } from "vitest";
import { cutStroke } from "../../src/doc/stroke-cut";

const line = [0, 0, 100, 0]; // a long segment with no point near the middle

describe("erasing part of a stroke (ADR 0111)", () => {
  it("leaves the line alone when the brush misses it", () => {
    expect(cutStroke(line, 5, [{ x: 50, y: 40 }])).toBeNull();
  });
  it("cuts the middle out of a long segment, however few points it has", () => {
    const runs = cutStroke(line, 5, [{ x: 50, y: 0 }])!;
    expect(runs.length).toBe(2);
    expect(runs[0]![runs[0]!.length - 2]).toBeLessThan(46);
    expect(runs[1]![0]).toBeGreaterThan(54);
    expect(runs[0]![0]).toBe(0); // the ends are kept as they were
    expect(runs[1]![runs[1]!.length - 2]).toBe(100);
  });
  it("takes a sweep along the line from one end, and all of it when the brush covers it", () => {
    const part = cutStroke(line, 5, [{ x: -10, y: 0 }, { x: 30, y: 0 }])!;
    expect(part.length).toBe(1);
    expect(part[0]![0]).toBeGreaterThan(34);
    expect(cutStroke(line, 5, [{ x: -10, y: 0 }, { x: 110, y: 0 }])).toEqual([]);
  });
  it("works on a single point, and keeps the short piece that is left", () => {
    expect(cutStroke([0, 0], 5, [{ x: 20, y: 0 }])).toBeNull();
    expect(cutStroke([0, 0], 5, [{ x: 2, y: 0 }])).toEqual([]);
    expect(cutStroke([0, 0, 3, 0], 2, [{ x: 4, y: 0 }])!).toEqual([[0, 0, 1, 0]]);
  });
});

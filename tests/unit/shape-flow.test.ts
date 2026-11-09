import { describe, expect, it } from "vitest";
import { flowOf, outlineBox } from "../../src/text/shape-flow";

// A diamond 20 wide and 20 tall, its box at 0, 0 (nodes of six numbers: point, handle in, handle out).
const node = (x: number, y: number): number[] => [x, y, x, y, x, y];
const n = [...node(10, 0), ...node(20, 10), ...node(10, 20), ...node(0, 10)];

describe("words inside a shape", () => {
  it("each line is as wide as the shape over its whole height, less the padding; none past the shape", () => {
    expect(outlineBox(n)).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
    const f = flowOf({ n, closed: true, padX: 1, padY: 0 }, 1);
    const mid = f.span(9, 11)!;
    expect(mid.x0).toBeCloseTo(2);
    expect(mid.x1).toBeCloseTo(18);
    expect(f.span(0.1, 1), "too narrow for a line").toBeNull();
    expect(f.span(21, 22)).toBeNull();
  });
  it("padding at the top and bottom narrows a line as if it were taller, and the size scales the shape", () => {
    expect(flowOf({ n, closed: true, padX: 0, padY: 2 }, 1).span(9, 11)!.x0).toBeCloseTo(3);
    expect(flowOf({ n, closed: true, padX: 0 }, 2).height).toBe(10);
  });
});

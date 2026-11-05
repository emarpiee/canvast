import { describe, expect, it } from "vitest";
import { holesOf, piecesOf } from "../../src/doc/path-pieces";
import type { SubPath } from "../../src/doc/path";

const square = (x: number, y: number, w: number): SubPath => {
  const n: number[] = [];
  for (const [a, b] of [[x, y], [x + w, y], [x + w, y + w], [x, y + w]]) n.push(a!, b!, a!, b!, a!, b!);
  return { n, closed: true };
};
const outerA = square(0, 0, 10), holeA = square(3, 3, 4), outerB = square(20, 0, 10), island = square(4, 4, 2);

describe("the pieces of a shape", () => {
  it("two letters, one with a hole: two pieces, the hole with its letter", () => {
    expect(piecesOf([outerA, holeA, outerB])).toEqual([[0, 1], [2]]);
    expect(holesOf([outerA, holeA, outerB], 0)).toEqual([1]);
    expect(holesOf([outerA, holeA, outerB], 2)).toEqual([]);
  });
  it("a hole moves alone when it is what was chosen; an island in a hole is a piece of its own", () => {
    expect(holesOf([outerA, holeA], 1)).toEqual([]);
    expect(piecesOf([outerA, holeA, island])).toEqual([[0, 1], [2]]);
  });
  it("an open line lies in no piece's way", () => {
    const open: SubPath = { n: [40, 0, 40, 0, 40, 0, 50, 0, 50, 0, 50, 0], closed: false };
    expect(piecesOf([outerA, open])).toEqual([[0], [1]]);
  });
});

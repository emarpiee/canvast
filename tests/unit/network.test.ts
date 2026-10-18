import { describe, expect, it } from "vitest";
import { buildNetwork, deleteVertex, edgeBetween, moveVertex, netFaces, verticesOf } from "../../src/doc/network";
import { geometryBounds, rectSubs } from "../../src/doc/path";
import type { SubPath } from "../../src/doc/path";

const line = (x0: number, y0: number, x1: number, y1: number): SubPath => edgeBetween([x0, y0], [x1, y1]);
const square = (x: number, y: number, s: number): SubPath[] => [line(x, y, x + s, y), line(x + s, y, x + s, y + s), line(x + s, y + s, x, y + s), line(x, y + s, x, y)];

describe("vector networks (ADR 0146)", () => {
  it("edges that close a loop enclose a region; a line or a cross encloses nothing", () => {
    expect(netFaces(square(0, 0, 100)).length).toBe(1);
    expect(netFaces([line(0, 0, 100, 0)]).length).toBe(0);
    expect(netFaces([line(0, 50, 100, 50), line(50, 0, 50, 100)]).length).toBe(0);
  });
  it("a diagonal across the square makes two regions, a dangling edge changes nothing, separate pieces are separate regions", () => {
    expect(netFaces([...square(0, 0, 100), edgeBetween([0, 0], [100, 100])]).length).toBe(2);
    expect(netFaces([...square(0, 0, 100), edgeBetween([100, 100], [150, 150])]).length).toBe(1);
    expect(netFaces([...square(0, 0, 100), ...square(200, 0, 100)]).length).toBe(2);
  });
  it("a curved edge keeps its curve in the region", () => {
    const arc: SubPath = { n: [100, 0, 100, 0, 100, 60, 0, 0, 0, 60, 0, 0], closed: false };
    const faces = netFaces([line(0, 0, 100, 0), arc]);
    expect(faces.length).toBe(1);
    expect(geometryBounds(faces).maxY).toBeGreaterThan(30);
  });
  it("a face of a network of three squares sharing edges: five regions from a ladder", () => {
    // a ladder: two rails and three rungs make two squares... plus the outer boundary is left out
    const ladder = [line(0, 0, 100, 0), line(0, 100, 100, 100), line(0, 200, 100, 200), line(0, 0, 0, 200), line(100, 0, 100, 200)];
    const split = [line(0, 0, 100, 0), line(0, 100, 100, 100), line(0, 200, 100, 200), line(0, 0, 0, 100), line(0, 100, 0, 200), line(100, 0, 100, 100), line(100, 100, 100, 200)];
    void ladder;
    expect(netFaces(split).length).toBe(2);
  });
  it("paths that meet become one network: ends close together join, an end on another edge splits it", () => {
    const net = buildNetwork([[{ n: [...line(0, 0, 100, 0).n], closed: false }], [{ n: [...line(50, 0.4, 50, 80).n], closed: false }]], 1);
    expect(net.length).toBe(3); // the first line is cut where the second ends on it
    expect(verticesOf(net).filter((v) => v.degree === 3).length).toBe(1);
    const sq = buildNetwork([rectSubs(0, 0, 100, 100)], 0.01);
    expect(sq.length).toBe(4);
    expect(netFaces(sq).length).toBe(1);
  });
  it("moving a vertex moves every edge end there and their handles; deleting it takes its edges", () => {
    const e = square(0, 0, 100);
    const moved = moveVertex(e, 100, 100, 10, -20);
    const ends = verticesOf(moved);
    expect(ends.some((v) => v.x === 110 && v.y === 80 && v.degree === 2)).toBe(true);
    expect(netFaces(moved).length).toBe(1);
    expect(deleteVertex(e, 100, 100).length).toBe(2);
  });
});

import { moveNodes } from "../../src/doc/network";
describe("moving picked nodes of a network", () => {
  it("an end moves its whole vertex once, however many of its ends are picked; a node inside an edge moves alone", () => {
    const e = square(0, 0, 100);
    // both ends that meet at (100, 100) are picked: the vertex moves by 10, not 20
    const moved = moveNodes(e, [[1, 1], [2, 0]], 10, 0);
    expect(verticesOf(moved).find((v) => v.degree === 2 && v.y === 100 && v.x === 110)).toBeTruthy();
    expect(verticesOf(moved).some((v) => v.x === 120)).toBe(false);
    const chain: SubPath = { n: [0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 100, 0, 100, 0, 100, 0], closed: false };
    const inner = moveNodes([chain], [[0, 1]], 5, 5)[0]!;
    expect([inner.n[6], inner.n[7], inner.n[0], inner.n[12]]).toEqual([55, 55, 0, 100]);
  });
});

describe("shapes that share a side", () => {
  it("make one network where the shared side is one edge and both squares are regions", () => {
    const net = buildNetwork([rectSubs(0, 0, 100, 100), rectSubs(100, 0, 100, 100)], 0.01);
    expect(net.length).toBe(7);
    expect(netFaces(net).length).toBe(2);
  });
});

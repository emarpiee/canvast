import { describe, expect, it } from "vitest";
import { extractLines, linesSvg } from "../../src/assets/model-lines";

// A unit cube's twelve triangles.
const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
const position = new Float32Array(faces.flat().flatMap((i) => v[i]!));
/** Looking along -z from far away, flat: x and y scaled to pixels. */
const front = { position, viewProj: [0.2, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, -0.1, 0, -0.1, -0.1, 0, 1], camera: [0.5, 0.5, 10] as [number, number, number], flatDir: [0, 0, -1] as [number, number, number], w: 1000, h: 1000, depth: null, creaseDeg: 40, shortest: 0, simplify: 0.5, most: 1000 };

describe("the lines of a 3D view", () => {
  it("from the front a cube is its outline: one closed square", () => {
    const { lines } = extractLines(front);
    const points = lines.flat().length / 2;
    const xs = lines.flatMap((l) => l.filter((_, i) => i % 2 === 0));
    expect(Math.min(...xs)).toBeCloseTo(450, 0);
    expect(Math.max(...xs)).toBeCloseTo(550, 0);
    expect(lines).toHaveLength(1);
    expect(points).toBe(5);
  });
  it("a flat seam between two triangles of a face is no line; a gentle crease only with a low angle", () => {
    const { lines } = extractLines({ ...front, creaseDeg: 100 });
    expect(lines).toHaveLength(1);
  });
  it("keeps the longest when it must, and says how many went; short ones go", () => {
    expect(extractLines({ ...front, shortest: 100000 }).lines).toHaveLength(0);
    expect(extractLines({ ...front, most: 0 }).dropped).toBe(1);
  });
  it("what stands behind something nearer does not show", () => {
    const depth = new Float32Array(1000 * 1000).fill(0);
    expect(extractLines({ ...front, depth }).lines).toHaveLength(0);
  });
  it("makes real paths, split when one would hold too many", () => {
    const svg = linesSvg([[0, 0, 10, 10], [5, 5, 6, 6]], 20, 20, "#111111", 2, 1);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('d="M0 0L10 10"');
    expect(svg).toContain('stroke-width="2"');
  });
});

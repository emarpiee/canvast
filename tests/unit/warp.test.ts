import { describe, expect, it } from "vitest";
import { isAffine, quadPoint, type Quad } from "../../src/paint/warp";

describe("warp (free and perspective transform)", () => {
  const persp: Quad = [[10, 20], [300, 0], [260, 240], [0, 200]];
  it("maps the unit square's corners onto the quad's, in order", () => {
    for (const [u, v, i] of [[0, 0, 0], [1, 0, 1], [1, 1, 2], [0, 1, 3]] as const) {
      const [x, y] = quadPoint(persp, u, v);
      expect(x).toBeCloseTo(persp[i][0], 9);
      expect(y).toBeCloseTo(persp[i][1], 9);
    }
  });
  it("is affine (the middle at the mean of the corners) only for a parallelogram", () => {
    const par: Quad = [[0, 0], [100, 20], [130, 120], [30, 100]];
    expect(isAffine(par)).toBe(true);
    expect(isAffine(persp)).toBe(false);
    const [mx, my] = quadPoint(par, 0.5, 0.5);
    expect(mx).toBeCloseTo(65, 9);
    expect(my).toBeCloseTo(60, 9);
  });
});

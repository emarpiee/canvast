import { describe, expect, it } from "vitest";
import { VARY_PERIOD, copyAt, isTextureValid, isVaried, newTexture, noVary, varyPeriod } from "../../src/doc/texture";

describe("varied copies of a repeated texture (ADR 0173)", () => {
  const v = { ...noVary(7), rotation: 45, size: 0.5, jitter: 0.25, flip: true, skip: 0.3, order: "shuffle" as const };

  it("with nothing varied every copy is plain, the objects in turn, and the texture draws as before", () => {
    const plain = noVary(3);
    for (let i = -3; i < 3; i++) expect(copyAt(plain, 3, i, 0, 0)).toEqual({ src: ((i % 3) + 3) % 3, dx: 0, dy: 0, rot: 0, k: 1, flip: false });
    const t = newTexture({ kind: "objects", ids: ["a"] });
    expect(isVaried(t)).toBe(false);
    expect(isVaried({ ...t, vary: { ...plain, each: false } })).toBe(false);
    expect(isVaried({ ...t, vary: { ...plain, each: false, size: 0.2 } })).toBe(true);
  });

  it("a copy depends on the seed and its cell only: the same every time, again after a period of cells, different for another seed", () => {
    expect(copyAt(v, 4, 5, 9, 1)).toEqual(copyAt(v, 4, 5, 9, 1));
    expect(copyAt(v, 4, 5 + VARY_PERIOD, 9 - VARY_PERIOD, 1)).toEqual(copyAt(v, 4, 5, 9, 1));
    expect(varyPeriod(v, 3)).toBe(18); // (a whole number of turns of 3 objects)
    expect(copyAt(v, 3, 5 + 18, 9, 1)).toEqual(copyAt(v, 3, 5, 9, 1));
    const cells = (seed: number) => Array.from({ length: 64 }, (_, i) => copyAt({ ...v, seed }, 4, i % 8, i >> 3, 0));
    expect(cells(8)).not.toEqual(cells(7));
  });

  it("values stay in their ranges, turns go in whole steps, and about the share asked for is left empty", () => {
    const all = Array.from({ length: VARY_PERIOD * VARY_PERIOD }, (_, i) => copyAt({ ...v, rotStep: 15 }, 4, i % VARY_PERIOD, Math.floor(i / VARY_PERIOD), 0));
    const kept = all.filter((c) => c.src >= 0);
    expect(kept.every((c) => Math.abs(c.rot) <= 45 && c.rot % 15 === 0 && c.k >= 0.5 && c.k <= 1.5 && Math.abs(c.dx) <= 0.25 && c.src < 4)).toBe(true);
    expect(1 - kept.length / all.length).toBeGreaterThan(0.2);
    expect(1 - kept.length / all.length).toBeLessThan(0.4);
    expect(new Set(kept.map((c) => c.src)).size).toBe(4);
  });

  it("a stored Vary is checked like the rest of the texture", () => {
    const t = { ...newTexture({ kind: "objects", ids: ["a"] }), vary: v };
    expect(isTextureValid(t)).toBe(true);
    expect(isTextureValid({ ...t, vary: { ...v, skip: 2 } })).toBe(false);
    expect(isTextureValid({ ...t, vary: { ...v, seed: 1.5 } })).toBe(false);
  });
});

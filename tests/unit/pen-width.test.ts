import { describe, expect, it } from "vitest";
import { LOCK_MAX_LEVELS, PEN_MAX_PX, PEN_MIN_PX, penFromSlider, penWidthNow, sliderFromPen } from "../../src/interaction/pen-width";

const at = (levels: bigint, frac = 0) => ({ levels, frac });

describe("pen width with the thickness lock", () => {
  it("without the lock the size is the pen size at any zoom", () => {
    for (const l of [-1000n, 0n, 5n, 10n ** 12n]) expect(penWidthNow(6, null, at(l, 0.3))).toBe(6);
  });

  it("with the lock the size follows the zoom, so the stroke has the same width on the canvas", () => {
    const lock = { ...at(10n, 0.25), px: 8 };
    expect(penWidthNow(8, lock, at(10n, 0.25))).toBe(8);
    expect(penWidthNow(8, lock, at(13n, 0.25))).toBe(64); // 3 levels in: 8 times wider on screen
    expect(penWidthNow(8, lock, at(8n, 0.25))).toBe(2);
    expect(penWidthNow(8, lock, at(11n, 0.75))).toBeCloseTo(8 * 2 ** 1.5, 9);
    // Canvas width = px / 2^zoom stays equal.
    for (const d of [-3, -1, 0, 2, 7]) {
      const z = 10 + d;
      expect(penWidthNow(8, lock, at(BigInt(z), 0.25)) / 2 ** (z + 0.25)).toBeCloseTo(8 / 2 ** 10.25, 12);
    }
  });

  it("keeps following the zoom for 1,000 levels either way, then holds, never overflowing (also astronomically far)", () => {
    const lock = { ...at(0n), px: 8 };
    expect(penWidthNow(8, lock, at(60n))).toBe(8 * 2 ** 60);
    expect(penWidthNow(8, lock, at(-60n))).toBe(8 * 2 ** -60);
    expect(penWidthNow(8, lock, at(BigInt(LOCK_MAX_LEVELS)))).toBe(8 * 2 ** LOCK_MAX_LEVELS);
    for (const far of [1001n, 10n ** 6n, 10n ** 15n, 10n ** 400n]) {
      expect(penWidthNow(8, lock, at(far))).toBe(8 * 2 ** LOCK_MAX_LEVELS);
      expect(penWidthNow(8, lock, at(-far))).toBe(8 * 2 ** -LOCK_MAX_LEVELS);
    }
    for (const far of [10n ** 15n, -(10n ** 400n)]) {
      const w = penWidthNow(8, lock, at(far));
      expect(Number.isFinite(w) && w > 0).toBe(true);
    }
  });

  it("the size slider covers 0.5 to 128 px on a log scale and round-trips", () => {
    expect(penFromSlider(0)).toBe(PEN_MIN_PX);
    expect(penFromSlider(100)).toBe(PEN_MAX_PX);
    for (let v = 0; v <= 100; v++) {
      const px = penFromSlider(v);
      expect(Math.abs(sliderFromPen(px) - v), `${v} -> ${px}`).toBeLessThanOrEqual(1);
      if (v) expect(px).toBeGreaterThanOrEqual(penFromSlider(v - 1));
    }
    expect(sliderFromPen(8)).toBeGreaterThan(sliderFromPen(3));
  });
});

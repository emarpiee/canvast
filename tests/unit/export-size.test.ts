import { describe, expect, it } from "vitest";
import { MAX_AREA, MAX_SIDE, clampSize, formatRatio, fromPx, parseRatio, presetOf, sizeSuggestions, toPx } from "../../src/app/export-size";

describe("ratios", () => {
  it("are read from what people type", () => {
    expect(parseRatio("16:9")).toBeCloseTo(16 / 9, 10);
    expect(parseRatio("16 / 9")).toBeCloseTo(16 / 9, 10);
    expect(parseRatio("1600 x 900")).toBeCloseTo(16 / 9, 10);
    expect(parseRatio("1,5")).toBe(1.5);
    expect(parseRatio("A4")).toBeCloseTo(Math.SQRT2, 10);
    expect(parseRatio("A4 portrait")).toBeCloseTo(1 / Math.SQRT2, 10);
    expect(parseRatio("9:16 landscape")).toBeCloseTo(16 / 9, 10);
    expect(parseRatio("square")).toBe(1);
    for (const bad of ["", "abc", "0", "1:0", "-2", "500:1"]) expect(parseRatio(bad), bad).toBeNull();
  });
  it("are shown as short words, upright ones with the short side first", () => {
    expect(formatRatio(1)).toBe("1 : 1");
    expect(formatRatio(16 / 9)).toBe("16 : 9");
    expect(formatRatio(9 / 16)).toBe("9 : 16");
    expect(formatRatio(1.5)).toBe("3 : 2");
    expect(formatRatio(Math.SQRT2)).toBe("1.414 : 1");
    expect(formatRatio(1 / Math.SQRT2)).toBe("1 : 1.414");
    expect(formatRatio(parseRatio("2000x1920")!), "px typed: the reduced ratio").toBe("25 : 24");
    expect(formatRatio(parseRatio("1920 x 1080")!)).toBe("16 : 9");
    for (const t of ["2000x1920px", "2000 x 1920 px", "2000px x 1920px", "2000 px × 1920 px"]) expect(formatRatio(parseRatio(t)!), `px at the end: ${t}`).toBe("25 : 24");
    expect(formatRatio(1.989), "a dragged shape keeps its decimals").toBe("1.989 : 1");
    expect(presetOf(16 / 9)?.id).toBe("16:9");
    expect(presetOf(9 / 16)?.id).toBe("16:9"); // (upright is the same shape)
    expect(presetOf(1.234)).toBeNull();
  });
});

describe("lengths", () => {
  it("convert between px, in, cm and mm at a resolution, and back", () => {
    expect(fromPx(300, "in", 300)).toBe(1);
    expect(fromPx(300, "mm", 300)).toBeCloseTo(25.4, 10);
    expect(toPx(5, "in", 96)).toBe(480);
    expect(toPx(fromPx(1234, "cm", 150), "cm", 150)).toBeCloseTo(1234, 8);
    expect(fromPx(77, "px", 300)).toBe(77);
  });
  it("are kept to what a picture may be, keeping the ratio", () => {
    expect(clampSize(1000, 500)).toEqual({ w: 1000, h: 500, capped: false });
    const big = clampSize(40000, 20000);
    expect(big.capped).toBe(true);
    expect(big.w).toBeLessThanOrEqual(MAX_SIDE);
    expect(big.w * big.h).toBeLessThanOrEqual(MAX_AREA);
    expect(big.w / big.h).toBeCloseTo(2, 3);
  });
});

describe("suggested sizes", () => {
  it("a square offers the square formats, then widths and print sizes with the height that keeps the ratio", () => {
    const s = sizeSuggestions(1);
    expect(s[0]).toMatchObject({ label: "Instagram square", w: 1080, h: 1080, exact: true });
    expect(s.every((x) => Math.abs(x.w / x.h - 1) < 0.002)).toBe(true);
    expect(s.some((x) => x.w === 2400 && x.dpi === 300), "8 in at 300 ppi").toBe(true);
  });
  it("a sheet shaped like A4 offers A4 itself at 300 ppi, upright or on its side", () => {
    const up = sizeSuggestions(210 / 297)[0]!;
    expect(up).toMatchObject({ label: "A4 · 210 × 297 mm", w: 2480, h: 3508, dpi: 300, exact: true });
    const side = sizeSuggestions(297 / 210)[0]!;
    expect(side).toMatchObject({ w: 3508, h: 2480 });
  });
  it("16 : 9 offers Full HD and 4K, and 9 : 16 offers the story, at their own pixels", () => {
    const wide = sizeSuggestions(16 / 9);
    expect(wide.some((x) => x.label === "Full HD" && x.w === 1920 && x.h === 1080)).toBe(true);
    expect(wide.some((x) => x.label === "4K" && x.w === 3840)).toBe(true);
    expect(sizeSuggestions(9 / 16).some((x) => x.label === "Story" && x.w === 1080 && x.h === 1920)).toBe(true);
  });
  it("a shape with no standard still gets widths, never more than asked for, none over the limits", () => {
    const s = sizeSuggestions(1.234, 5);
    expect(s).toHaveLength(5);
    expect(s.every((x) => !x.exact)).toBe(true);
    expect(sizeSuggestions(60).every((x) => x.w <= MAX_SIDE && x.h <= MAX_SIDE)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { adjustKey, adjustPixel, cleanAdjust, cropOf, cssFilter, isNeutral, needsNeighbours, validMap } from "../../src/doc/adjust";

describe("adjustments of a picture (ADR 0118)", () => {
  it("none is none: no change to any pixel", () => {
    expect(isNeutral(undefined)).toBe(true);
    expect(isNeutral({ exposure: 0 })).toBe(true);
    for (const c of [[0, 0, 0], [255, 255, 255], [12, 130, 240]] as const) expect(adjustPixel(c[0], c[1], c[2], {}).map(Math.round)).toEqual([...c]);
  });
  it("exposure brightens or darkens, contrast spreads from the middle, saturation goes to grey and back", () => {
    const mid = [120, 120, 120] as const;
    expect(adjustPixel(...mid, { exposure: 50 })[0]).toBeGreaterThan(120);
    expect(adjustPixel(...mid, { exposure: -50 })[0]).toBeLessThan(120);
    expect(adjustPixel(200, 200, 200, { contrast: 50 })[0]).toBeGreaterThan(200);
    expect(adjustPixel(60, 60, 60, { contrast: 50 })[0]).toBeLessThan(60);
    const [r, g, b] = adjustPixel(200, 60, 60, { saturation: -100 });
    expect(Math.abs(r - g)).toBeLessThan(1);
    expect(Math.abs(g - b)).toBeLessThan(1);
    expect(adjustPixel(200, 60, 60, { saturation: 50 })[0] - adjustPixel(200, 60, 60, { saturation: 50 })[1]).toBeGreaterThan(140);
  });
  it("temperature warms or cools, shadows lift the dark and highlights pull down the light", () => {
    expect(adjustPixel(100, 100, 100, { temperature: 60 }).map(Math.round)[0]).toBeGreaterThan(adjustPixel(100, 100, 100, { temperature: 60 }).map(Math.round)[2]!);
    expect(adjustPixel(30, 30, 30, { shadows: 80 })[0]).toBeGreaterThan(30);
    expect(adjustPixel(240, 240, 240, { highlights: 80 })[0]).toBeLessThan(240);
    expect(Math.abs(adjustPixel(128, 128, 128, { shadows: 80 })[0] - 128)).toBeLessThan(adjustPixel(30, 30, 30, { shadows: 80 })[0] - 30 + 5);
  });
  it("vibrance lifts a dull colour more than a vivid one", () => {
    const dull = adjustPixel(130, 120, 120, { vibrance: 100 });
    const vivid = adjustPixel(250, 20, 20, { vibrance: 100 });
    expect(dull[0] - dull[1]).toBeGreaterThan(130 - 120 + 8);
    expect(Math.abs(vivid[0] - vivid[1] - (250 - 20))).toBeLessThan(dull[0] - dull[1]);
  });
  it("is kept clean: zeros go, numbers are rounded and held in range, neighbours are told apart", () => {
    expect(cleanAdjust({ exposure: 0, contrast: 33.4, blur: -20, grain: 140 })).toEqual({ contrast: 33, grain: 100 });
    expect(cleanAdjust({ exposure: 0.2 })).toBeUndefined();
    expect(needsNeighbours({ blur: 5 })).toBe(true);
    expect(needsNeighbours({ exposure: 5 })).toBe(false);
    expect(adjustKey({ exposure: 5 })).not.toBe(adjustKey({ exposure: 6 }));
  });
  it("gives a CSS filter for playing pictures, empty when nothing applies", () => {
    expect(cssFilter(undefined)).toBe("");
    expect(cssFilter({ shadows: 20 })).toBe("");
    expect(cssFilter({ exposure: 40, contrast: -20, blur: 10 })).toMatch(/^brightness\(.*\) contrast\(0\.800\) blur\(/);
  });
  it("a crop is the window of the source it shows, all of it when there is none", () => {
    expect(cropOf({ pixelW: 40, pixelH: 30 })).toEqual({ x: 0, y: 0, w: 40, h: 30 });
    expect(cropOf({ pixelW: 40, pixelH: 30, crop: { x: 5, y: 6, w: 7, h: 8 } })).toEqual({ x: 5, y: 6, w: 7, h: 8 });
  });

  it("a gradient map looks the brightness of each pixel up in the gradient, by its amount (ADR 0122)", () => {
    const map = { stops: [{ o: 0, c: "#ff0000" }, { o: 1, c: "#0000ff" }], amount: 100 };
    expect(validMap(map)).toBe(true);
    expect(validMap({ ...map, amount: 0 })).toBe(false);
    expect(validMap({ ...map, stops: [map.stops[0]] })).toBe(false);
    expect(isNeutral({ map })).toBe(false);
    expect(cleanAdjust({ map: { ...map, amount: 40.4 } })!.map!.amount).toBe(40);
    expect(adjustKey({ map })).not.toBe(adjustKey({ map: { ...map, amount: 50 } }));
    expect(adjustPixel(0, 0, 0, { map })).toEqual([255, 0, 0]);
    expect(adjustPixel(255, 255, 255, { map })).toEqual([0, 0, 255]);
    const half = adjustPixel(0, 0, 0, { map: { ...map, amount: 50 } });
    expect(half[0]).toBeGreaterThan(120);
    expect(half[0]).toBeLessThan(135); // half way from black to red
  });
});

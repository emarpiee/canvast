import { describe, expect, it } from "vitest";
import { MODELS, convert, fromRgb, hexToTriple, parseHex, rgbToHex, toRgb, tripleToHex } from "../../src/colour-picker/colour";

const SAMPLES: [number, number, number][] = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255], [31, 35, 41], [37, 99, 235], [220, 38, 38], [22, 163, 74], [128, 128, 128], [250, 240, 10], [3, 2, 1]];

describe("colour maths", () => {
  for (const model of MODELS) {
    it(`${model}: sRGB -> triple -> sRGB returns the same bytes`, () => {
      for (const [r, g, b] of SAMPLES) {
        const t = fromRgb(model, r, g, b, 40);
        const back = toRgb(model, t.h, t.s, t.x);
        expect(Math.abs(back[0] - r) <= 1 && Math.abs(back[1] - g) <= 1 && Math.abs(back[2] - b) <= 1, `${model} ${r},${g},${b} -> ${back}`).toBe(true);
      }
    });
    it(`${model}: every triple on a grid is a displayable colour and the channels move the right way`, () => {
      for (let h = 0; h < 360; h += 30) for (let s = 0; s <= 1; s += 0.25) for (let x = 0; x <= 1; x += 0.25) {
        const c = toRgb(model, h, s, x);
        expect(c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
      }
      const dark = toRgb(model, 200, 0.5, 0.2);
      const light = toRgb(model, 200, 0.5, 0.8);
      expect(light[0] + light[1] + light[2]).toBeGreaterThan(dark[0] + dark[1] + dark[2]);
    });
    it(`${model}: a grey keeps the hue it was given`, () => {
      expect(fromRgb(model, 90, 90, 90, 123).h).toBe(123);
      expect(fromRgb(model, 90, 90, 90, 123).s).toBe(0);
    });
    it(`${model}: random colours round trip (fuzz)`, () => {
      let seed = 7;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      for (let i = 0; i < 400; i++) {
        const c: [number, number, number] = [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)];
        const t = fromRgb(model, ...c, 0);
        const back = toRgb(model, t.h, t.s, t.x);
        expect(Math.max(Math.abs(back[0] - c[0]), Math.abs(back[1] - c[1]), Math.abs(back[2] - c[2])), `${model} ${c}`).toBeLessThanOrEqual(1);
      }
    });
  }
  it("pure sRGB red is OKLab hue about 29 degrees; white is lightness 1 in every model", () => {
    expect(fromRgb("okhsl", 255, 0, 0).h).toBeGreaterThan(28);
    expect(fromRgb("okhsl", 255, 0, 0).h).toBeLessThan(30);
    for (const m of MODELS) expect(fromRgb(m, 255, 255, 255, 0).x).toBeCloseTo(1, 3);
  });
  it("hex parsing and writing", () => {
    expect(parseHex("#1F2329")).toEqual([31, 35, 41]);
    expect(parseHex("abc")).toEqual([170, 187, 204]);
    expect(parseHex("#12")).toBeNull();
    expect(parseHex("#gggggg")).toBeNull();
    expect(rgbToHex([31, 35, 41])).toBe("#1f2329");
    expect(hexToTriple("okhsv", "nope")).toBeNull();
    expect(tripleToHex("okhsl", hexToTriple("okhsl", "#2563eb")!)).toBe("#2563eb");
  });
  it("converting between models keeps the colour", () => {
    const t = hexToTriple("okhsl", "#16a34a")!;
    for (const to of MODELS) expect(tripleToHex(to, convert("okhsl", to, t))).toBe("#16a34a");
  });
});

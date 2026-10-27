import { describe, expect, it } from "vitest";
import { CHROMA_REF, MODELS, TEXT_FORMATS, colourToHex, contrastRatio, convert, formatColour, fromRgb, harmonies, hexToTriple, oklchEdge, oklchToRgb, paintPlane, parseColour, parseHex, rgbToHex, rgbToOklch, toRgb, tripleToHex } from "../../src/colour-picker/colour";

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

describe("OKLCH is the standard OKLab polar form, with the chroma asked for clipped to what sRGB can show", () => {
  it("lightness, chroma and hue are those of oklch(): the same colour as oklchToRgb, and the model reads them back", () => {
    for (const [h, c, L] of [[29, 0.1, 0.55], [145, 0.12, 0.7], [264, 0.15, 0.5], [90, 0.08, 0.9], [330, 0.1, 0.4]] as const) {
      const t = { h, s: c / CHROMA_REF, x: L };
      expect(toRgb("oklch", t.h, t.s, t.x)).toEqual(oklchToRgb(L, c, h)); // (the same maths as CSS oklch(), in gamut)
      const back = rgbToOklch(oklchToRgb(L, c, h));
      const r = fromRgb("oklch", ...oklchToRgb(L, c, h));
      expect(Math.abs(r.x - back.L)).toBeLessThan(1e-9);
      expect(Math.abs(r.s * CHROMA_REF - back.C)).toBeLessThan(1e-9);
      expect(Math.abs(r.h - back.h)).toBeLessThan(1e-6);
    }
  });
  it("chroma beyond the gamut is reduced at the same lightness and hue (clipped), never changing either", () => {
    for (const [h, L] of [[29, 0.6], [145, 0.8], [264, 0.45], [100, 0.95], [330, 0.2]] as const) {
      const edge = oklchEdge(h, L);
      expect(edge).toBeGreaterThan(0);
      expect(edge).toBeLessThan(1);
      const over = toRgb("oklch", h, 1, L);               // asks for 0.4: more than any sRGB colour has
      const atEdge = toRgb("oklch", h, edge, L);
      expect(Math.max(...over.map((v, i) => Math.abs(v - atEdge[i]!)))).toBeLessThanOrEqual(1);
      const o = rgbToOklch(over);
      expect(Math.abs(o.L - L)).toBeLessThan(0.01);
      expect(Math.abs(((o.h - h + 540) % 360) - 180)).toBeLessThan(3);
    }
  });
});

describe("the fast plane painter", () => {
  for (const model of MODELS) {
    it(`${model}: every pixel of the plane is within 2 bytes of the exact conversion, at many hues`, () => {
      const w = 33;
      const h = 29;
      const out = new Uint8ClampedArray(w * h * 4);
      for (const hue of [0, 29, 90, 142, 210, 264, 330, 359.5]) {
        paintPlane(model, hue, w, h, out);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const s = x / (w - 1), L = 1 - y / (h - 1);
          // OKLCH leaves transparent what sRGB cannot show at that lightness and hue (a little slack at the edge itself)
          if (model === "oklch" && L > 0 && L < 1 && Math.abs(s - oklchEdge(hue, L)) > 0.03) {
            expect(out[i + 3], `${model} hue ${hue} (${x},${y}) alpha`).toBe(s <= oklchEdge(hue, L) ? 255 : 0);
          }
          if (model === "oklch" && out[i + 3] === 0) continue;
          const want = toRgb(model, hue, s, L);
          for (let c = 0; c < 3; c++) expect(Math.abs(out[i + c]! - want[c]!), `${model} hue ${hue} (${x},${y}) channel ${c}`).toBeLessThanOrEqual(2);
          expect(out[i + 3]).toBe(255);
        }
      }
    });
  }
});

describe("colour text and alpha", () => {
  it("parses hex of 3, 4, 6 and 8 digits, rgb() and oklch(), and refuses the rest", () => {
    expect(parseColour("#fff")).toEqual({ rgb: [255, 255, 255], alpha: 1 });
    expect(parseColour("#f008")!.alpha).toBeCloseTo(0x88 / 255, 5);
    expect(parseColour("2563eb80")!.rgb).toEqual([37, 99, 235]);
    expect(parseColour("rgb(37, 99, 235)")).toEqual({ rgb: [37, 99, 235], alpha: 1 });
    expect(parseColour("rgb(37 99 235 / 50%)")).toEqual({ rgb: [37, 99, 235], alpha: 0.5 });
    expect(parseColour("rgba(100%, 0%, 0%, 0.25)")).toEqual({ rgb: [255, 0, 0], alpha: 0.25 });
    expect(parseColour("oklch(0.628 0.2577 29.23)")!.rgb[0]).toBeGreaterThan(250); // sRGB red
    expect(parseColour("oklch(62.8% 0.2577 29.23 / 0.5)")!.alpha).toBe(0.5);
    for (const bad of ["", "#12", "#ggg", "rgb(1 2)", "rgb(a b c)", "blue", "oklch(1 2)"]) expect(parseColour(bad), bad).toBeNull();
  });
  it("every format writes text that parses back to the same colour", () => {
    for (const rgb of [[37, 99, 235], [0, 0, 0], [255, 255, 255], [12, 200, 90]] as const) for (const alpha of [1, 0.5]) for (const f of TEXT_FORMATS) {
      const back = parseColour(formatColour({ rgb, alpha }, f))!;
      expect(Math.max(...back.rgb.map((v, i) => Math.abs(v - rgb[i]!))), `${f} ${rgb}`).toBeLessThanOrEqual(f === "oklch" ? 1 : 0);
      expect(Math.abs(back.alpha - alpha)).toBeLessThan(0.01);
    }
    expect(colourToHex({ rgb: [255, 0, 0], alpha: 1 })).toBe("#ff0000");
    expect(colourToHex({ rgb: [255, 0, 0], alpha: 0 })).toBe("#ff000000");
  });
  it("contrast follows WCAG, and a harmony keeps lightness while it turns the hue", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1);
    const [opposite] = harmonies([37, 99, 235], "complementary");
    const a = fromRgb("oklch", 37, 99, 235);
    const b = fromRgb("oklch", opposite![0], opposite![1], opposite![2]);
    expect(Math.abs(b.x - a.x)).toBeLessThan(0.01);
    expect(Math.abs(((b.h - a.h + 360) % 360) - 180)).toBeLessThan(2);
    expect(harmonies([37, 99, 235], "triad")).toHaveLength(2);
  });
});

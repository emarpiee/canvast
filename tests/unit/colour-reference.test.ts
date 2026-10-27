import { describe, expect, it } from "vitest";
import { fromRgb, toRgb } from "../../src/colour-picker/colour";
import reference from "./colour-reference.json";

/**
 * The OKHSL and OKHSV of the colour package follow Bjorn Ottosson's reference (https://bottosson.github.io/posts/colorpicker/). The numbers in
 * colour-reference.json are what his own JavaScript answers (made by scripts/gen-colour-reference.mjs); the picker must keep agreeing.
 * The one difference is deliberate: the picker keeps saturation and lightness inside 0 to 1, where the reference gives up to about 1.01
 * for a few saturated blues.
 */
type Model = "okhsl" | "okhsv";
const cases = reference.cases as {
  toRgb: Array<{ model: Model; h: number; s: number; x: number; rgb: number[] }>;
  fromRgb: Array<{ model: Model; rgb: [number, number, number]; h: number; s: number; x: number }>;
};

describe("colour package against Ottosson's reference", () => {
  it("OKHSL and OKHSV to sRGB: the same bytes", () => {
    for (const c of cases.toRgb) expect(toRgb(c.model, c.h * 360, c.s, c.x), JSON.stringify(c)).toEqual(c.rgb);
  });

  it("sRGB to OKHSL and OKHSV: the same lightness, saturation and hue", () => {
    for (const c of cases.fromRgb) {
      const t = fromRgb(c.model, ...c.rgb);
      const msg = JSON.stringify(c);
      expect(Math.abs(t.x - Math.min(1, c.x)), msg).toBeLessThan(1e-4);
      expect(Math.abs(t.s - Math.min(1, c.s)), msg).toBeLessThan(1e-4);
      if (c.s > 0.02 && c.x > 0.02 && c.x < 0.98) expect(Math.abs((((t.h / 360 - c.h + 1.5) % 1) + 1) % 1 - 0.5), msg).toBeLessThan(1e-6); // (a grey has no hue)
    }
  });
});

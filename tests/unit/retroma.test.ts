// Retroma looks as the reviewed demo does: for every built-in preset, in light and in dark, the engine gives every custom property and
// switch the demo set on its page (tests/unit/fixtures/retroma-golden.json, taken from the demo with the same presets).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeRetroma, presetSettings, PRESETS } from "../../src/theme/retroma/engine";

/** Where the app departs from the demo on the owner's word (each value then follows the app, not the fixture). */
const OWNER_CHANGES: Record<string, string> = {
  "--mat": "2026-11-12: the picture mat follows the theme's paper by default, not white (white glared in dark mode)",
};
const gold = JSON.parse(readFileSync(resolve(__dirname, "fixtures/retroma-golden.json"), "utf8")) as { cases: Record<string, { vars: Record<string, string>; data: Record<string, string> }> };

describe("Retroma engine", () => {
  it("has the demo's eight presets", () => {
    expect(PRESETS.slice(0, 8).map((p) => p[0])).toEqual(["Retroma", "Warm Earthy Vintage", "Blancka", "Warm Strawberry", "Y2K Holographic", "Green CRT Terminal", "Gray Newspaper", "Warm Newspaper"]);
  });
  for (const [key, want] of Object.entries(gold.cases)) {
    it(`gives the demo's values for ${key}`, () => {
      const [name, mode] = key.split("|") as [string, string];
      const s = presetSettings(name);
      s.mode = mode;
      s.em = mode === "dark" ? "dk" : "lt";
      const got = computeRetroma(s, { dark: mode === "dark", reducedMotion: false });
      for (const [k, v] of Object.entries(want.vars)) if (!(k in OWNER_CHANGES)) expect([k, got.vars[k]]).toEqual([k, v]);
      expect(got.data).toEqual(want.data);
    });
  }
});

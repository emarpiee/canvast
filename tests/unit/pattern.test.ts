import { describe, expect, it } from "vitest";
import { GENERATORS, MAX_SHAPES, cleanValues, defaultValues, generate, makeRng, pathData, randomValues, settingsOf, toSvg } from "../../src/gen";
import * as D from "../../src/core/dyadic";
import { duplicateRecords } from "../../src/doc/duplicate";
import { deserializeObject, newObjectId, serializeObject, validateObject } from "../../src/doc/model";
import type { PathObject } from "../../src/doc/model";
import { isPaint } from "../../src/doc/paint";
import { NODE } from "../../src/doc/path";
import type { GenShape } from "../../src/gen";

const sound = (shapes: readonly GenShape[], w: number, h: number): void => {
  expect(shapes.length).toBeGreaterThan(0);
  expect(shapes.length).toBeLessThanOrEqual(MAX_SHAPES);
  for (const s of shapes) {
    expect(s.fill !== null || s.stroke !== null).toBe(true);
    if (s.fill !== null) expect(isPaint(s.fill)).toBe(true);
    if (s.stroke !== null) expect(isPaint(s.stroke)).toBe(true);
    expect(Number.isFinite(s.width) && s.width > 0).toBe(true);
    for (const p of s.sub) {
      expect(p.n.length % NODE).toBe(0);
      expect(p.n.length).toBeGreaterThan(0);
      for (const v of p.n) expect(Number.isFinite(v) && Math.abs(v) < 20 * Math.max(w, h)).toBe(true);
    }
  }
};

describe("pattern generators (ADR 0162)", () => {
  it("has unique ids, unique setting keys, and defaults that are valid", () => {
    expect(new Set(GENERATORS.map((g) => g.id)).size).toBe(GENERATORS.length);
    for (const g of GENERATORS) {
      const keys = settingsOf(g).map((s) => s.k);
      expect(new Set(keys).size, g.id).toBe(keys.length);
      expect(cleanValues(g, defaultValues(g)), g.id).toEqual(defaultValues(g));
    }
  });

  it("makes sound shapes from the defaults, and the same shapes for the same seed", () => {
    for (const g of GENERATORS) {
      const a = generate(g, defaultValues(g), 7, 900, 600);
      sound(a, 900, 600);
      expect(JSON.stringify(generate(g, defaultValues(g), 7, 900, 600)), g.id).toBe(JSON.stringify(a));
    }
  });

  it("makes sound shapes from random values, in a wide, a tall and a tiny box, and from the extremes of every range", () => {
    for (const g of GENERATORS) {
      for (let seed = 1; seed <= 2; seed++) {
        const v = randomValues(g, makeRng(seed));
        expect(cleanValues(g, v), g.id).toEqual(v); // random values are valid ones
        for (const [w, h] of [[900, 600], [300, 800], [3, 2]] as const) sound(generate(g, v, seed, w, h), w, h);
      }
      for (const pick of ["min", "max"] as const) {
        const v = defaultValues(g);
        for (const s of settingsOf(g)) if (s.t === "range") v[s.k] = s[pick];
        sound(generate(g, v, 3, 900, 600), 900, 600);
      }
    }
  }, 60_000); // (the slowest test of the unit suite: every generator at the extremes, which shares the machine with the other workers)

  it("a different seed changes the shapes of the generators that use chance", () => {
    for (const id of ["tides", "drift", "confetti", "cells", "flow", "maze", "ribbons", "contours"]) {
      const g = GENERATORS.find((x) => x.id === id)!;
      expect(JSON.stringify(generate(g, defaultValues(g), 1, 900, 600)), id).not.toBe(JSON.stringify(generate(g, defaultValues(g), 2, 900, 600)));
    }
  });

  it("hides the background when its colour is none, and holds a bad value to the default or range", () => {
    const g = GENERATORS[0]!;
    expect(generate(g, { ...defaultValues(g), bg: "" }, 1, 100, 100).some((s) => s.name === "Background")).toBe(false);
    expect(generate(g, defaultValues(g), 1, 100, 100)[0]!.name).toBe("Background");
    const c = cleanValues(g, { crests: 999, amp: "x", bg: "red", flip: 3 });
    expect(c["crests"]).toBe(10);
    expect(c["amp"]).toBe(14);
    expect(c["bg"]).toBe("#0b1f33");
    expect(c["flip"]).toBe(false);
  });

  it("keeps the settings on a shape: saved, read back, copied with the group renamed, and a bad one refused", () => {
    const gid = newObjectId();
    const o: PathObject = { id: newObjectId(), kind: "path", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub: [{ n: [0, 0, 0, 0, 0, 0], closed: false }], fill: "#ff0000", stroke: null, width: 1, groups: [gid], gen: { id: "tides", gid, seed: 42, v: { layers: 4, bg: "#0b1f33", flip: false } } };
    expect(deserializeObject(serializeObject(validateObject(o)) as never).gen).toEqual(o.gen);
    const [copy] = duplicateRecords([serializeObject(o)]);
    expect((copy!["gen"] as { gid: string }).gid).toBe((copy!["groups"] as string[])[0]);
    expect((copy!["gen"] as { gid: string }).gid).not.toBe(gid);
    expect(() => validateObject({ ...o, gen: { ...o.gen!, seed: 1.5 } })).toThrow();
    expect(() => validateObject({ ...o, gen: { ...o.gen!, v: { x: {} as never } } })).toThrow();
  });

  it("writes a standalone SVG: viewBox, one path for each shape, gradients with their own ids, and the same text for the same seed", () => {
    for (const id of ["tides", "glow", "stripes", "contours"]) {
      const g = GENERATORS.find((x) => x.id === id)!;
      const shapes = generate(g, defaultValues(g), 5, 300, 200);
      const svg = toSvg(shapes, 300, 200, { width: 150, height: 100 });
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="150" height="100"'), id).toBe(true);
      expect(svg.match(/<path /g)!.length, id).toBe(shapes.length);
      expect(toSvg(generate(g, defaultValues(g), 5, 300, 200), 300, 200, { width: 150, height: 100 }), id).toBe(svg);
      for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) expect(svg, id).toContain(`id="${m[1]}"`);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
    const glow = GENERATORS.find((x) => x.id === "glow")!;
    expect(toSvg(generate(glow, defaultValues(glow), 5, 100, 100), 100, 100, { idPrefix: "x" })).toContain('<radialGradient id="x0"');
    expect(pathData({ n: [0, 0, 0, 0, 0, 0, 10, 0, 10, 0, 10, 0, 10, 10, 10, 10, 10, 10], closed: true })).toBe("M0 0L10 0L10 10L0 0Z");
  });
});

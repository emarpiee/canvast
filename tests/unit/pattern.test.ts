import { describe, expect, it } from "vitest";
import { MAX_SUBPATHS } from "../../src/doc/model";
import { MAX_SUBPATHS as GEN_MAX_SUBPATHS } from "../../src/gen";
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
    expect(s.sub.length).toBeLessThanOrEqual(MAX_SUBPATHS); // (a path over this is refused, and the pattern vanishes)
    expect(s.fill !== null || s.stroke !== null).toBe(true);
    if (s.fill !== null) expect(isPaint(s.fill)).toBe(true);
    if (s.stroke !== null) expect(isPaint(s.stroke)).toBe(true);
    expect(Number.isFinite(s.width) && s.width > 0).toBe(true);
    for (const p of s.sub) {
      expect(p.n.length % NODE).toBe(0);
      expect(p.n.length).toBeGreaterThan(0);
      // (one check per path: at a setting's far end a path holds millions of numbers)
      expect(p.n.every((v) => Number.isFinite(v) && Math.abs(v) < 20 * Math.max(w, h))).toBe(true);
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
        const t = performance.now();
        const shapes = generate(g, v, 3, 900, 600);
        expect(performance.now() - t, `${g.id} all at ${pick}: a typed value must not hang the panel`).toBeLessThan(20_000);
        sound(shapes, 900, 600);
      }
    }
  }, 60_000); // (the slowest test of the unit suite: every generator at the extremes, which shares the machine with the other workers)

  it("keeps to the document's limit on one path", () => expect(GEN_MAX_SUBPATHS).toBe(MAX_SUBPATHS));

  it("Grid: rows follow its Cells choice, line width stays when the count changes, and Randomize keeps the layout", () => {
    const g = GENERATORS.find((x) => x.id === "grid")!;
    const made = (o: Record<string, string | number | boolean>, w = 800, h = 400) => generate(g, { ...defaultValues(g), bg: "", every: 0, ...o }, 1, w, h)[0]!;
    const lines = (o: Record<string, string | number | boolean>): number => made(o).sub.length;
    expect(lines({})).toBe(17 + 9); // (16 across of 50: 8 rows)
    expect(made({}, 900, 600).sub.length).toBe(17 + 12); // (10.67 rows round to 11: 12 lines)
    expect(lines({ cells: "equal" })).toBe(17 + 17);
    expect(lines({ cells: "rows", rows: 5 })).toBe(17 + 6);
    expect(lines({ cells: "size", size: 100 })).toBe(9 + 5);
    expect(g.readout!({ ...defaultValues(g), cells: "size", size: 100 }, 800, 400)).toBe("8 across, 4 down · cell 100 × 100");
    expect(made({ cols: 40 }).width).toBe(made({ cols: 8 }).width);
    // Every line is in the box, the edges too; the last row's line is on the edge.
    const ys = made({}).sub.flatMap((s) => (s.n[1] === s.n[NODE + 1] ? [s.n[1]!] : []));
    const w = made({}).width;
    expect(Math.min(...ys)).toBeCloseTo(w / 2, 6);
    expect(Math.max(...ys)).toBeCloseTo(400 - w / 2, 6);
    expect(made({ frame: true }).sub.length).toBe(17 + 9 + 1);
    expect(lines({ dash: 50 })).toBeGreaterThan(17 + 9);
    expect(lines({ margin: 25, cols: 4 })).toBe(5 + 2); // (inside the margin: 600 by 200, cells of 150: 1.33 rows round to 1)
    expect(lines({ shiftX: 50, shiftY: 50 })).toBe(16 + 8); // (half a cell along: one line fewer each way)
    sound(generate(g, { ...defaultValues(g), dash: 1, cols: 240 }, 1, 900, 600), 900, 600); // (the shortest dashes on the most lines: over one path's limit, so in several)
    const current = { ...defaultValues(g), cells: "rows", rows: 7, margin: 5, dash: 20, angle: 15, jitter: 30 };
    for (const k of ["cells", "rows", "margin", "dash", "angle", "jitter"] as const) expect(randomValues(g, makeRng(7), current)[k]).toBe(current[k]);
    // Strong lines are counted from Strong start.
    const strong = (at: number) => generate(g, { ...defaultValues(g), bg: "", every: 4, strongAt: at, rowsToo: false, major: "#ffffff" }, 1, 800, 400)[1]!.sub.map((s) => Math.round(s.n[0]!));
    expect(strong(0)[1]).toBe(200);
    expect(strong(1)[0]).toBe(50);
  });

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
    expect(c["crests"]).toBe(100);
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

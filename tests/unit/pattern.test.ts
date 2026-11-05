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

  describe("guides", () => {
    const G = (id: string) => GENERATORS.find((x) => x.id === id)!;
    const all = (id: string, o: Record<string, string | number | boolean> = {}, w = 900, h = 600) => generate(G(id), { ...defaultValues(G(id)), frame: false, ...o }, 1, w, h).filter((s) => s.stroke !== null).flatMap((s) => s.sub);
    /** Where upright lines stand, in order. */
    const uprights = (subs: readonly { n: readonly number[] }[]): number[] => [...new Set(subs.filter((s) => s.n.length === 2 * NODE && Math.abs(s.n[0]! - s.n[NODE]!) < 1e-9).map((s) => s.n[0]!))].sort((a, b) => a - b);
    const ends = (s: { n: readonly number[] }) => [s.n[0]!, s.n[1]!, s.n[s.n.length - NODE]!, s.n[s.n.length - NODE + 1]!] as const;
    const PHI = (1 + Math.sqrt(5)) / 2;

    it("are 29, each starting with no background and able to have one", () => {
      const guides = GENERATORS.filter((g) => g.guide);
      expect(guides).toHaveLength(29);
      for (const g of guides) {
        const bg = settingsOf(g).find((s) => s.k === "bg")!;
        expect(bg.t === "colour" && bg.def === "" && bg.hide === true && bg.shown === "#ffffff", g.id).toBe(true);
        expect(generate(g, defaultValues(g), 1, 900, 600).some((s) => s.name === "Background"), g.id).toBe(false);
        expect(generate(g, { ...defaultValues(g), bg: "#123456" }, 1, 900, 600)[0]!.name, g.id).toBe("Background");
        expect(randomValues(g, makeRng(5)).bg, g.id).toBe("");
      }
      expect(GENERATORS.filter((g) => !g.guide)).toHaveLength(38);
      for (const g of GENERATORS.filter((x) => !x.guide)) expect(settingsOf(g).find((s) => s.k === "bg")!.def, g.id).not.toBe("");
    });

    it("go far past their usual span, and Randomize keeps to it", () => {
      const span = (id: string, k: string) => { const r = settingsOf(G(id)).find((x) => x.k === k)!; return r.t === "range" ? [r.min, r.max, ...r.usual] : []; };
      expect(span("golden-ratio", "depth")).toEqual([1, 8, 1, 5]);
      expect(span("rule-of-thirds", "parts")).toEqual([1, 100, 2, 12]);
      expect(span("perspective", "rays")).toEqual([1, 400, 1, 40]);
      expect(span("polar-grid", "rings")[1]).toBe(400);
      expect(span("grid", "dash")[1]).toBe(1000);
      expect(span("fisheye-grid", "bulge")).toEqual([-1000, 1000, -100, 100]);
      // Stronger bends further, whichever way; the corners stay put.
      const bow = (bulge: number) => { const lines = all("fisheye-grid", { bulge, cols: 4, rows: 4 }); return { corner: lines[0]!.n[1]!, mid: lines[1]!.n[32 * NODE]! }; };
      expect(bow(0).mid).toBeCloseTo(225, 6);
      expect(bow(60).mid).toBeLessThan(225);
      expect(bow(1000).mid).toBeLessThan(bow(60).mid);
      expect(bow(-60).mid).toBeGreaterThan(225);
      expect(bow(-1000).mid).toBeGreaterThan(bow(-60).mid);
      expect(bow(1000).corner).toBeCloseTo(0, 6);
      expect(bow(-1000).corner).toBeCloseTo(0, 6);
    });

    it("draw with dashes, flipped and with a margin, in every guide", () => {
      for (const g of GENERATORS.filter((x) => x.guide)) sound(generate(g, { ...defaultValues(g), dash: 20, margin: 10, flipX: true, flipY: true, frame: true }, 3, 900, 600), 900, 600);
    });

    it("Golden Ratio and Rule of Thirds: lines where they say", () => {
      const xs = uprights(all("golden-ratio", { axis: "x" }));
      expect(xs).toHaveLength(2);
      expect(900 / xs[1]!).toBeCloseTo(PHI, 6);
      expect(xs[1]! / xs[0]!).toBeCloseTo(PHI, 6);
      expect(uprights(all("rule-of-thirds", { points: false }))).toEqual([300, 600]);
    });

    it("Golden Spiral: a golden rectangle, whose squares each leave a golden one", () => {
      const subs = all("golden-spiral", { showSpiral: false, squares: 2 }, 1000, 1000);
      const size = (s: { n: readonly number[] }) => [s.n[NODE]! - s.n[0]!, s.n[2 * NODE + 1]! - s.n[1]!];
      const [w, h] = size(subs[0]!);
      expect(w! / h!).toBeCloseTo(PHI, 6);
      expect(size(subs[1]!)[0]).toBeCloseTo(h!, 6); // (the first square's side is the rectangle's height)
      expect(size(subs[2]!)[0]! / h!).toBeCloseTo(1 / PHI, 6); // (and the next is smaller by the ratio)
    });

    it("Fibonacci Grid and Modular Scale: each part to the last as they say", () => {
      const f = [0, ...uprights(all("fibonacci-grid", { axis: "x", fib: 6 })), 900];
      const parts = f.slice(1).map((x, i) => x - f[i]!);
      for (const [i, want] of [1, 1, 2, 3, 5, 8].entries()) expect(parts[i]! / parts[0]!).toBeCloseTo(want, 6);
      const m = [0, ...uprights(all("modular-scale", { axis: "x", step: "1.5", mods: 5 })), 900];
      for (let i = 2; i < m.length; i++) expect((m[i]! - m[i - 1]!) / (m[i - 1]! - m[i - 2]!)).toBeCloseTo(1.5, 6);
    });

    it("Root Rectangles: uprights at the root of each whole number", () => {
      const xs = uprights(all("root-rectangles", { root: 3, diagonals: false, arcs: false }, 1000, 500));
      expect((xs[1]! - xs[0]!)).toBeCloseTo(500 * (Math.sqrt(2) - 1), 6);
    });

    it("Dynamic Symmetry: each reciprocal is square to its diagonal", () => {
      const subs = all("dynamic-symmetry", { which: "baroque" });
      const dir = (s: { n: readonly number[] }) => { const [a, b, c, d] = ends(s); return [c - a, d - b] as const; };
      expect(subs).toHaveLength(3);
      const [dx, dy] = dir(subs[2]!); // (the diagonal is strong, so it comes after the others)
      for (const r of subs.slice(0, 2)) { const [x, y] = dir(r); expect((dx * x + dy * y) / (Math.hypot(dx, dy) * Math.hypot(x, y))).toBeCloseTo(0, 6); }
    });

    it("Harmonic Armature: 14 lines, the half-diagonals ending at the middles of sides", () => {
      const subs = all("harmonic-armature");
      expect(subs).toHaveLength(14);
      const middles = subs.filter((s) => { const [, , c, d] = ends(s); return c === 450 || d === 300; });
      expect(middles).toHaveLength(12); // (all but the two diagonals)
    });

    it("Van de Graaf: a block of two thirds, with margins of 1, 1, 2 and 2 ninths", () => {
      const subs = generate(G("van-de-graaf"), { ...defaultValues(G("van-de-graaf")), frame: false, pages: "single", building: false, bands: false }, 1, 900, 900).flatMap((s) => s.sub);
      const xs = subs[0]!.n.filter((_, i) => i % NODE === 0), ys = subs[0]!.n.filter((_, i) => i % NODE === 1);
      expect(Math.min(...xs)).toBeCloseTo(100, 6);
      expect(Math.max(...xs)).toBeCloseTo(700, 6);
      expect(Math.min(...ys)).toBeCloseTo(100, 6);
      expect(Math.max(...ys)).toBeCloseTo(700, 6);
    });

    it("Isometric and Dimetric: lines at their angle, meeting on the uprights", () => {
      const slopes = new Set(all("isometric-grid", { uprights: false, every: 0 }).map((s) => { const [a, b, c, d] = ends(s); return Math.round((Math.atan2(Math.abs(d - b), Math.abs(c - a)) * 180) / Math.PI * 100) / 100; }));
      expect([...slopes]).toEqual([30]);
      const tilt = new Set(all("dimetric-grid", { uprights: false, tilt: 26.57, every: 0 }).map((s) => { const [a, b, c, d] = ends(s); return Math.round((Math.abs(d - b) / Math.abs(c - a)) * 100) / 100; }));
      expect([...tilt]).toEqual([0.5]);
    });

    it("Perspective: every line runs to a vanishing point", () => {
      const subs = all("perspective", { points: "1", x1: 50, horizon: 50, uprightN: 0 });
      for (const s of subs.slice(1)) { const [a, b, c, d] = ends(s); expect(Math.abs((c - a) * (300 - b) - (d - b) * (450 - a)) / Math.hypot(c - a, d - b)).toBeCloseTo(0, 6); }
    });

    it("Sacred Circles, Polar Grid, Pixel Grid and Modular Grid: how many, and how far apart", () => {
      expect(all("sacred-circles", { figure: "flower", rings: 2, axes: false })).toHaveLength(19);
      expect(all("sacred-circles", { figure: "flower", rings: 3, axes: false })).toHaveLength(37);
      expect(all("sacred-circles", { figure: "vesica", axes: false })).toHaveLength(2);
      expect(all("polar-grid", { rings: 5, spokes: 8 })).toHaveLength(13);
      const px = uprights(all("pixel-grid", { size: 16, every: 0 }, 160, 160));
      expect(px[2]! - px[1]!).toBe(16);
      expect(G("pixel-grid").readout!({ ...defaultValues(G("pixel-grid")), size: 16 }, 160, 80)).toBe("10 across, 5 down · cell 16 × 16");
      expect(G("column-grid").readout!({ ...defaultValues(G("column-grid")), cols: 2, gutter: 0 }, 800, 400)).toBe("2 across · column 400");
      expect(all("modular-grid", { cols: 3, rows: 2 })).toHaveLength(6);
    });

    it("Comic Panels: Random follows the seed", () => {
      const v = { ...defaultValues(G("comic-panels")), layout: "random" };
      expect(generate(G("comic-panels"), v, 4, 900, 600)).toEqual(generate(G("comic-panels"), v, 4, 900, 600));
    });
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

import { under, poly, solid } from "./geom";
import type { P } from "./geom";
import { C, R, T, Ch, reader } from "./kit";
import { alpha, mix } from "./rng";
import type { Rng } from "./rng";
import type { Generator, GenShape } from "./types";

/** Points of a wavy line across the box: `crests` crests, each a different height. */
function wavy(rng: Rng, w: number, y: number, amp: number, crests: number): P[] {
  const m = crests * 2 + 1;
  return Array.from({ length: m }, (_, i): P => [(w * i) / (m - 1), y + (i % 2 ? 1 : -1) * (0.45 + 0.55 * rng()) * amp * 0.5]);
}

const WAVE = [R("crests", "Waves", 1, 10, 3), R("amp", "Height", 2, 40, 14), R("smooth", "Smooth", 0, 100, 100)] as const;

export const ripple: Generator = {
  id: "ripple", label: "Ripple", family: "Waves", about: "One wavy edge",
  sections: [
    { title: "Colour", items: [C("fill", "Fill", "#0a6cff")] },
    { title: "Wave", items: [R("level", "Level", 10, 90, 62), ...WAVE, T("flip", "Fill from the top", false)] },
  ],
  run(v, rng, w, h) {
    const { n, b, c } = reader(v);
    const pts = wavy(rng, w, (n("level") / 100) * h, (n("amp") / 100) * h, n("crests"));
    return [solid([under(pts, b("flip") ? 0 : h, 0, w, n("smooth") / 100)], c("fill")!, "Wave")];
  },
};

function layers(v: Record<string, number | string | boolean>, rng: Rng, w: number, h: number, soft: boolean): GenShape[] {
  const { n, c } = reader(v);
  const L = n("layers"), out: GenShape[] = [];
  for (let i = 0; i < L; i++) {
    const t = L === 1 ? 0 : i / (L - 1);
    const y = (n("start") / 100 + (0.92 - n("start") / 100) * t) * h;
    const col = mix(c("from")!, c("to")!, t);
    const pts = wavy(rng, w, y, (n("amp") / 100) * h * (soft ? 2.2 : 1), soft ? Math.max(1, Math.round(n("crests") / 2)) : n("crests"));
    out.push(solid([under(pts, h, 0, w, n("smooth") / 100)], soft ? alpha(col, 0.35 + 0.65 * t) : col, `Layer ${i + 1}`));
  }
  return out;
}

const LAYER_COLOURS = { title: "Colour", items: [C("from", "Back", "#ff5d73"), C("to", "Front", "#3b2bff")] } as const;

export const tides: Generator = {
  id: "tides", label: "Tides", family: "Waves", about: "Wavy bands stacked from back to front",
  sections: [LAYER_COLOURS, { title: "Layers", items: [R("layers", "Layers", 2, 14, 6), R("start", "Start at", 5, 70, 28)] }, { title: "Wave", items: [...WAVE] }],
  run: (v, rng, w, h) => layers(v, rng, w, h, false),
};

export const dunes: Generator = {
  id: "dunes", label: "Dunes", family: "Waves", about: "Soft overlapping hills",
  sections: [LAYER_COLOURS, { title: "Layers", items: [R("layers", "Layers", 2, 10, 5), R("start", "Start at", 5, 70, 35)] }, { title: "Wave", items: [R("crests", "Hills", 1, 6, 2), R("amp", "Height", 2, 40, 16), R("smooth", "Smooth", 0, 100, 100)] }],
  run: (v, rng, w, h) => layers(v, rng, w, h, true),
};

export const terraces: Generator = {
  id: "terraces", label: "Terraces", family: "Waves", about: "Stepped layers like stairs",
  sections: [
    LAYER_COLOURS,
    { title: "Layers", items: [R("layers", "Layers", 2, 12, 5), R("start", "Start at", 5, 70, 30)] },
    { title: "Steps", items: [R("steps", "Steps", 2, 16, 6), R("rise", "Rise", 0, 60, 24), Ch("dir", "Direction", [["up", "Up"], ["down", "Down"], ["mixed", "Mixed"]], "up")] },
  ],
  run(v, rng, w, h) {
    const { n, c, s } = reader(v);
    const L = n("layers"), S = n("steps"), out: GenShape[] = [];
    for (let i = 0; i < L; i++) {
      const t = L === 1 ? 0 : i / (L - 1);
      const y = (n("start") / 100 + (0.92 - n("start") / 100) * t) * h;
      const pts: P[] = [[0, h]];
      let level = y;
      for (let j = 0; j < S; j++) {
        const d = s("dir") === "up" ? -1 : s("dir") === "down" ? 1 : rng.chance(0.5) ? -1 : 1;
        level += d * (n("rise") / 100) * (h / S) * (0.5 + rng());
        pts.push([(w * j) / S, level], [(w * (j + 1)) / S, level]);
      }
      pts.push([w, h]);
      out.push(solid([poly(pts)], mix(c("from")!, c("to")!, t), `Layer ${i + 1}`));
    }
    return out;
  },
};

export const ridges: Generator = {
  id: "ridges", label: "Ridges", family: "Waves", about: "Mountain layers with peaks",
  sections: [
    LAYER_COLOURS,
    { title: "Layers", items: [R("layers", "Layers", 2, 10, 4), R("start", "Start at", 5, 70, 32)] },
    { title: "Peaks", items: [R("peaks", "Peaks", 2, 20, 7), R("amp", "Height", 4, 50, 22), Ch("kind", "Peaks are", [["sharp", "Sharp"], ["soft", "Soft"]], "sharp")] },
  ],
  run(v, rng, w, h) {
    const { n, c, s } = reader(v);
    const L = n("layers"), out: GenShape[] = [];
    for (let i = 0; i < L; i++) {
      const t = L === 1 ? 0 : i / (L - 1);
      const y = (n("start") / 100 + (0.92 - n("start") / 100) * t) * h;
      const m = n("peaks") * 2 + 1;
      const pts = Array.from({ length: m }, (_, j): P => [(w * j) / (m - 1), y + (j % 2 ? -1 : 0.4) * (0.4 + 0.6 * rng()) * (n("amp") / 100) * h]);
      const sub = s("kind") === "soft" ? under(pts, h, 0, w, 1) : poly([[0, h], ...pts, [w, h]]);
      out.push(solid([sub], mix(c("from")!, c("to")!, t), `Layer ${i + 1}`));
    }
    return out;
  },
};

export const WAVES = [ripple, tides, dunes, terraces, ridges];

import { ellipse, merged, regular, through, poly } from "./geom";
import type { P } from "./geom";
import { C, R, T, STYLE, reader } from "./kit";
import { mix, quant } from "./rng";
import type { Rng } from "./rng";
import type { Generator, GenShape, Values } from "./types";
import type { SubPath } from "./core";

/** A closed smooth blob about (cx, cy) with radius about r. */
export function blob(rng: Rng, cx: number, cy: number, r: number, points: number, wobble: number): SubPath {
  const rot = rng() * Math.PI * 2;
  const pts = Array.from({ length: points }, (_, i): P => {
    const a = rot + (i * Math.PI * 2) / points, rr = r * (1 - wobble * 0.6 * rng());
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  });
  return { n: through(pts, true), closed: true };
}

const look = (v: Values, sub: SubPath[], fill: string, w: number): GenShape => (v["style"] === "outline" ? { sub, fill: null, stroke: fill, width: w } : { sub, fill, stroke: null, width: 1 });

export const pebble: Generator = {
  id: "pebble", label: "Pebble", family: "Blobs", about: "One organic blob",
  sections: [
    { title: "Variants", items: [STYLE] },
    { title: "Colour", items: [C("fill", "Fill", "#ff0066")] },
    { title: "Blob", items: [R("size", "Size", 10, 100, 58), R("points", "Points", 3, 12, 6), R("wobble", "Wobble", 0, 100, 55), R("x", "Position across", 0, 100, 50), R("y", "Position down", 0, 100, 50), R("line", "Outline width", 1, 30, 6)] },
  ],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const s = Math.min(w, h);
    return [look(v, [blob(rng, (n("x") / 100) * w, (n("y") / 100) * h, (n("size") / 200) * s, n("points"), n("wobble") / 100)], c("fill")!, (n("line") / 100) * s * 0.2)];
  },
};

type Make = (cx: number, cy: number, r: number, i: number) => SubPath;

function scatter(v: Values, rng: Rng, w: number, h: number, make: Make, colour: (i: number) => string): GenShape[] {
  const { n, b } = reader(v);
  const s = Math.min(w, h), base = (n("size") / 100) * s * 0.35, out: GenShape[] = [];
  for (let i = 0; i < n("count"); i++) {
    const r = Math.max(base * 0.06, base * (1 - (n("contrast") / 100) * rng() * 0.95));
    const cx = b("contain") ? r + rng() * Math.max(0, w - 2 * r) : rng() * w, cy = b("contain") ? r + rng() * Math.max(0, h - 2 * r) : rng() * h;
    out.push(look(v, [make(cx, cy, r, i)], colour(i), s * 0.006 * (n("line") || 1)));
  }
  return out;
}

const SCATTER = [T("contain", "Contain to the sheet", false), R("count", "Count", 1, 80, 14), R("contrast", "Contrast", 0, 100, 60), R("size", "Size", 5, 100, 50), R("line", "Outline width", 1, 20, 4)];
const TWO = { title: "Colour", items: [C("from", "From", "#ff4d6d"), C("to", "To", "#ffb703")] } as const;

export const drift: Generator = {
  id: "drift", label: "Drift", family: "Blobs", about: "Many blobs placed at random",
  sections: [{ title: "Variants", items: [STYLE] }, TWO, { title: "Scatter", items: [...SCATTER, R("wobble", "Wobble", 0, 100, 50)] }],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    return merged(scatter(v, rng, w, h, (cx, cy, r) => blob(rng, cx, cy, r, rng.int(5, 8), n("wobble") / 100), (i) => mix(c("from")!, c("to")!, quant((i * 0.61803) % 1, 6))));
  },
};

export const bubbles: Generator = {
  id: "bubbles", label: "Bubbles", family: "Blobs", about: "Circles of different sizes",
  sections: [{ title: "Variants", items: [STYLE] }, { title: "Colour", items: [C("fill", "Fill", "#a7233a")] }, { title: "Scatter", items: SCATTER }],
  run: (v, rng, w, h) => merged(scatter(v, rng, w, h, (cx, cy, r) => ellipse(cx, cy, r, r), () => reader(v).c("fill")!)),
};

export const shards: Generator = {
  id: "shards", label: "Shards", family: "Blobs", about: "Scattered polygons and triangles",
  sections: [{ title: "Variants", items: [STYLE] }, TWO, { title: "Scatter", items: [...SCATTER, R("sides", "Sides", 3, 8, 3)] }],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    return merged(scatter(v, rng, w, h, (cx, cy, r) => poly(regular(cx, cy, r, n("sides"), rng() * Math.PI * 2)), (i) => mix(c("from")!, c("to")!, quant((i * 0.61803) % 1, 6))));
  },
};

export const BLOBS = [pebble, drift, bubbles, shards];

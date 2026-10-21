import { ellipse, inset, merged, poly, rect, solid } from "./geom";
import type { P } from "./geom";
import { C, Ch, LOOSE, R, reader } from "./kit";
import { mix, quant } from "./rng";
import type { Generator, GenShape } from "./types";

const TWO = { title: "Colour", items: [C("from", "From", "#0ea5e9"), C("to", "To", "#6366f1")] } as const;
const tint = (v: Record<string, number | string | boolean>, t: number, steps: number): string => mix(v["from"] as string, v["to"] as string, quant(t, steps));

export const tiles: Generator = {
  id: "tiles", label: "Tiles", family: "Tiles", about: "Hexagons, triangles or squares",
  sections: [
    TWO,
    { title: "Tiles", items: [Ch("shape", "Shape", [["hex", "Hexagons"], ["tri", "Triangles"], ["square", "Squares"]], "hex"), R("across", "Across", 3, 30, 9), R("gap", "Gap", 0, 40, 6), R("mixup", "Colour change", 0, 100, 70)] },
  ],
  run(v, rng, w, h) {
    const { n, s } = reader(v);
    const a = w / n("across"), k = 1 - n("gap") / 100, out: GenShape[] = [];
    const add = (pts: P[]): void => void out.push(solid([poly(inset(pts, k))], tint(v, (pts[0]![0] / w) * (1 - n("mixup") / 100) + rng() * (n("mixup") / 100), 6)));
    if (s("shape") === "square") for (let j = 0; j * a < h; j++) for (let i = 0; i < n("across"); i++) add([[i * a, j * a], [(i + 1) * a, j * a], [(i + 1) * a, (j + 1) * a], [i * a, (j + 1) * a]]);
    else if (s("shape") === "tri") {
      const th = (a * Math.sqrt(3)) / 2;
      for (let j = 0; j * th < h; j++) for (let i = -1; i <= n("across"); i++) {
        const x = (i + (j % 2 ? 0.5 : 0)) * a, y = j * th;
        add([[x, y + th], [x + a / 2, y], [x + a, y + th]]);
        add([[x + a / 2, y], [x + a * 1.5, y], [x + a, y + th]]);
      }
    } else {
      const r = a / Math.sqrt(3), dy = r * 1.5;
      for (let j = -1; j * dy < h + r; j++) for (let i = -1; i <= n("across"); i++) {
        const cx = (i + (j % 2 ? 0.5 : 0)) * a + a / 2, cy = j * dy + r;
        add(Array.from({ length: 6 }, (_, m): P => [cx + r * Math.cos(Math.PI / 6 + (m * Math.PI) / 3), cy + r * Math.sin(Math.PI / 6 + (m * Math.PI) / 3)]));
      }
    }
    return merged(out);
  },
};

export const bricks: Generator = {
  id: "bricks", label: "Bricks", family: "Tiles", about: "Offset rows of bricks",
  sections: [TWO, { title: "Bricks", items: [R("rows", "Rows", 2, 24, 8), R("across", "Across", 1, 16, 5), R("gap", "Gap", 0, 40, 8), R("mixup", "Colour change", 0, 100, 70)] }],
  run(v, rng, w, h) {
    const { n } = reader(v);
    const bh = h / n("rows"), bw = w / n("across"), g = (n("gap") / 100) * bh, out: GenShape[] = [];
    for (let j = 0; j < n("rows"); j++) for (let i = -1; i <= n("across"); i++) {
      const x = (i + (j % 2 ? 0.5 : 0)) * bw;
      out.push(solid([rect(x + g / 2, j * bh + g / 2, bw - g, bh - g)], tint(v, rng() * (n("mixup") / 100) + (j / n("rows")) * (1 - n("mixup") / 100), 6)));
    }
    return merged(out);
  },
};

export const scales: Generator = {
  id: "scales", label: "Scales", family: "Tiles", about: "Overlapping fish scales",
  sections: [{ title: "Colour", items: [C("from", "From", "#14b8a6"), C("to", "To", "#2563eb"), C("edge", "Edge", "#0b1f33", true)] }, { title: "Scales", items: [R("across", "Across", 2, 12, 8), R("overlap", "Overlap", 0, 80, 50), R("edgew", "Edge width", 1, 20, 5), LOOSE] }],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const lj = n("jitter") / 100; // (looseness: each scale off its place, its size and its colour)
    const r = w / n("across") / 2, dy = r * (1 - n("overlap") / 100), out: GenShape[] = [];
    for (let j = 0; j * dy < h + r * 2; j++) for (let i = -1; i <= n("across"); i++) {
      const k = lj ? 1 + (rng() - 0.5) * 0.4 * lj : 1, ox = lj ? (rng() - 0.5) * r * 0.6 * lj : 0, oy = lj ? (rng() - 0.5) * dy * 0.6 * lj : 0, dt = lj ? (rng() - 0.5) * 0.5 * lj : 0;
      const sub = [ellipse(i * 2 * r + (j % 2 ? r : 0) + r + ox, j * dy + oy, r * k, r * k)];
      out.push({ sub, fill: mix(c("from")!, c("to")!, Math.min(1, Math.max(0, (j * dy) / h + dt))), stroke: c("edge"), width: r * 0.04 * n("edgew") });
    }
    return out;
  },
};

export const weave: Generator = {
  id: "weave", label: "Weave", family: "Tiles", about: "Bands woven over and under",
  sections: [{ title: "Colour", items: [C("from", "Across", "#f97316"), C("to", "Down", "#2563eb")] }, { title: "Weave", items: [R("across", "Bands across", 2, 20, 7), R("gap", "Gap", 0, 60, 14), LOOSE] }],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const a = w / n("across"), g0 = (n("gap") / 100) * a, rows = Math.ceil(h / a), across: P[][] = [], down: P[][] = [];
    // (looseness: every band has a gap of its own)
    const gap = (): number => Math.min(a * 0.9, Math.max(0, g0 * (1 + (rng() - 0.5) * 1.6 * (n("jitter") / 100))));
    for (let j = 0; j < rows; j++) {
      const g = gap();
      across.push([[0, j * a + g / 2], [w, j * a + g / 2], [w, (j + 1) * a - g / 2], [0, (j + 1) * a - g / 2]]);
    }
    for (let i = 0; i < n("across"); i++) {
      const g = gap();
      for (let j = 0; j < rows; j++) if ((i + j) % 2 === 0) down.push([[i * a + g / 2, j * a], [(i + 1) * a - g / 2, j * a], [(i + 1) * a - g / 2, (j + 1) * a], [i * a + g / 2, (j + 1) * a]]);
    }
    return [solid(across.map((p) => poly(p)), c("from")!, "Across"), solid(down.map((p) => poly(p)), c("to")!, "Down")];
  },
};

export const TILES = [tiles, bricks, scales, weave];

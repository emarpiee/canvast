import { curve, inset, line, merged, poly, solid, through } from "./geom";
import type { P } from "./geom";
import { C, Ch, R, reader } from "./kit";
import { alpha, makeNoise, mix, quant } from "./rng";
import type { Rng } from "./rng";
import type { Generator, GenShape } from "./types";
import type { SubPath } from "./core";

const TAU = Math.PI * 2;
const TWO = { title: "Colour", items: [C("from", "From", "#38bdf8"), C("to", "To", "#c026d3")] } as const;

// ---- Contours ---------------------------------------------------------------------------------------------------------------------

/** Pairs of cell edges (T, R, B, L) a contour joins, for each of the 16 corner patterns (tl 8, tr 4, br 2, bl 1). */
const CASES: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [[], [["L", "B"]], [["B", "R"]], [["L", "R"]], [["T", "R"]], [["T", "L"], ["B", "R"]], [["T", "B"]], [["T", "L"]], [["T", "L"]], [["T", "B"]], [["T", "R"], ["L", "B"]], [["T", "R"]], [["L", "R"]], [["B", "R"]], [["L", "B"]], []];

export const contours: Generator = {
  id: "contours", label: "Contours", family: "Fields", about: "Map-like lines of equal height",
  sections: [TWO, { title: "Lines", items: [R("levels", "Lines", 2, 24, 10), R("scale", "Scale", 1, 10, 3), R("weight", "Line width", 1, 20, 4), Ch("kind", "Lines are", [["smooth", "Smooth"], ["straight", "Straight"]], "smooth")] }],
  run(v, rng, w, h) {
    const { n, s } = reader(v);
    const noise = makeNoise(rng.int(1, 1e9));
    const cols = 56, rows = Math.max(2, Math.round((cols * h) / w)), cw = w / cols, ch = h / rows, sc = n("scale") / cols;
    const val = (i: number, j: number): number => noise(i * sc, j * sc);
    const out: GenShape[] = [];
    for (let L = 1; L <= n("levels"); L++) {
      const lv = L / (n("levels") + 1), at = new Map<string, P>(), adj = new Map<string, string[]>();
      const point = (e: string, i: number, j: number): string => {
        const id = e === "T" ? `h${i},${j}` : e === "B" ? `h${i},${j + 1}` : e === "L" ? `v${i},${j}` : `v${i + 1},${j}`;
        if (!at.has(id)) {
          const [a, b]: [[number, number], [number, number]] = e === "T" || e === "B" ? [[i, e === "T" ? j : j + 1], [i + 1, e === "T" ? j : j + 1]] : [[e === "L" ? i : i + 1, j], [e === "L" ? i : i + 1, j + 1]];
          const va = val(a[0], a[1]), vb = val(b[0], b[1]), t = va === vb ? 0.5 : (lv - va) / (vb - va);
          at.set(id, [(a[0] + (b[0] - a[0]) * t) * cw, (a[1] + (b[1] - a[1]) * t) * ch]);
        }
        return id;
      };
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const k = (val(i, j) >= lv ? 8 : 0) | (val(i + 1, j) >= lv ? 4 : 0) | (val(i + 1, j + 1) >= lv ? 2 : 0) | (val(i, j + 1) >= lv ? 1 : 0);
        for (const [e1, e2] of CASES[k]!) {
          const a = point(e1, i, j), b = point(e2, i, j);
          (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
          (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
        }
      }
      const seen = new Set<string>(), subs: SubPath[] = [];
      const walk = (start: string): void => {
        const ids = [start];
        seen.add(start);
        for (let cur = start; ;) {
          const next = adj.get(cur)!.find((x) => !seen.has(x));
          if (next === undefined) break;
          seen.add(next);
          ids.push(next);
          cur = next;
        }
        const pts = ids.map((id) => at.get(id)!);
        const closed = ids.length > 3 && adj.get(ids[0]!)!.includes(ids[ids.length - 1]!);
        if (pts.length < 2) return;
        subs.push(s("kind") === "smooth" ? (closed ? { n: through(pts, true), closed: true } : curve(pts)) : poly(pts, closed));
      };
      for (const [id, nb] of adj) if (nb.length === 1 && !seen.has(id)) walk(id);
      for (const id of adj.keys()) if (!seen.has(id)) walk(id);
      if (subs.length) out.push(line(subs, mix(v["from"] as string, v["to"] as string, L / n("levels")), (n("weight") / 100) * Math.min(w, h) * 0.09, `Level ${L}`));
    }
    return out;
  },
};

// ---- Cells ------------------------------------------------------------------------------------------------------------------------

function clip(poly0: P[], a: P, b: P): P[] {
  // keep the side of the bisector between a and b that is nearer to a
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1];
  const f = (p: P): number => (p[0] - mx) * dx + (p[1] - my) * dy;
  const out: P[] = [];
  for (let i = 0; i < poly0.length; i++) {
    const p = poly0[i]!, q = poly0[(i + 1) % poly0.length]!, fp = f(p), fq = f(q);
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) out.push([p[0] + ((q[0] - p[0]) * fp) / (fp - fq), p[1] + ((q[1] - p[1]) * fp) / (fp - fq)]);
  }
  return out;
}

function voronoi(rng: Rng, count: number, relax: number, w: number, h: number): P[][] {
  let sites: P[] = Array.from({ length: count }, (): P => [rng() * w, rng() * h]);
  let cells: P[][] = [];
  for (let it = 0; it <= relax; it++) {
    cells = sites.map((a) => sites.reduce((c, b) => (b === a || c.length < 3 ? c : clip(c, a, b)), [[0, 0], [w, 0], [w, h], [0, h]] as P[]));
    if (it < relax) sites = sites.map((a, i) => (cells[i]!.length >= 3 ? [cells[i]!.reduce((s, p) => s + p[0], 0) / cells[i]!.length, cells[i]!.reduce((s, p) => s + p[1], 0) / cells[i]!.length] : a));
  }
  return cells.filter((c) => c.length >= 3);
}

export const cells: Generator = {
  id: "cells", label: "Cells", family: "Fields", about: "Irregular cells that fit together",
  sections: [TWO, { title: "Cells", items: [R("count", "Count", 4, 120, 30), R("even", "Evenness", 0, 4, 1), R("gap", "Gap", 0, 40, 4), R("mixup", "Colour change", 0, 100, 60)] }],
  run(v, rng, w, h) {
    const { n } = reader(v);
    return merged(voronoi(rng, n("count"), n("even"), w, h).map((c) => solid([poly(inset(c, 1 - n("gap") / 100))], mix(v["from"] as string, v["to"] as string, quant((c[0]![0] / w) * (1 - n("mixup") / 100) + rng() * (n("mixup") / 100), 8)))));
  },
};

export const cracks: Generator = {
  id: "cracks", label: "Cracks", family: "Fields", about: "The seams between irregular cells",
  sections: [{ title: "Colour", items: [C("line", "Lines", "#e2e8f0")] }, { title: "Cells", items: [R("count", "Count", 4, 120, 30), R("even", "Evenness", 0, 4, 1), R("weight", "Line width", 1, 20, 3)] }],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    return [line(voronoi(rng, n("count"), n("even"), w, h).map((p) => poly(p)), c("line")!, (n("weight") / 100) * Math.min(w, h) * 0.1, "Cracks")];
  },
};

export const triangulate: Generator = {
  id: "triangulate", label: "Facets", family: "Fields", about: "A low-poly field of triangles",
  sections: [TWO, { title: "Facets", items: [R("cols", "Across", 2, 24, 8), R("jitter", "Looseness", 0, 100, 60), R("var", "Colour change", 0, 100, 25), R("angle", "Angle", 0, 360, 45)] }],
  run(v, rng, w, h) {
    const { n } = reader(v);
    const cols = n("cols"), rows = Math.max(2, Math.round((cols * h) / w)), cw = w / cols, ch = h / rows, a = (n("angle") * Math.PI) / 180;
    const pt = (i: number, j: number): P => [i * cw + (i > 0 && i < cols ? (rng() - 0.5) * cw * (n("jitter") / 100) : 0), j * ch + (j > 0 && j < rows ? (rng() - 0.5) * ch * (n("jitter") / 100) : 0)];
    const g = Array.from({ length: rows + 1 }, (_, j) => Array.from({ length: cols + 1 }, (_, i) => pt(i, j)));
    const out: GenShape[] = [];
    const tri = (p: P, q: P, r: P): void => {
      const x = (p[0] + q[0] + r[0]) / 3 / w - 0.5, y = (p[1] + q[1] + r[1]) / 3 / h - 0.5;
      out.push(solid([poly([p, q, r])], mix(v["from"] as string, v["to"] as string, quant(0.5 + x * Math.cos(a) + y * Math.sin(a) + (rng() - 0.5) * (n("var") / 100), 12))));
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const A = g[j]![i]!, B = g[j]![i + 1]!, Cc = g[j + 1]![i + 1]!, D = g[j + 1]![i]!;
      if ((i + j) % 2) { tri(A, B, Cc); tri(A, Cc, D); } else { tri(A, B, D); tri(B, Cc, D); }
    }
    return merged(out);
  },
};

export const flow: Generator = {
  id: "flow", label: "Flow", family: "Fields", about: "Lines that follow a wind",
  sections: [TWO, { title: "Lines", items: [R("count", "Count", 10, 400, 120, 5), R("length", "Length", 5, 80, 30), R("scale", "Scale", 1, 10, 3), R("turns", "Swirl", 1, 20, 6), R("weight", "Line width", 1, 20, 3)] }],
  run(v, rng, w, h) {
    const { n } = reader(v);
    const noise = makeNoise(rng.int(1, 1e9)), s = Math.min(w, h), step = s * 0.012, sc = n("scale") / Math.max(w, h), out: GenShape[] = [];
    for (let i = 0; i < n("count"); i++) {
      let x = rng() * w, y = rng() * h;
      const pts: P[] = [[x, y]];
      for (let k = 0; k < n("length"); k++) {
        const a = noise(x * sc, y * sc) * TAU * (n("turns") / 3);
        x += Math.cos(a) * step; y += Math.sin(a) * step;
        pts.push([x, y]);
      }
      out.push(line([curve(pts)], mix(v["from"] as string, v["to"] as string, quant(rng(), 6)), (n("weight") / 100) * s * 0.06));
    }
    return merged(out);
  },
};

export const branches: Generator = {
  id: "branches", label: "Branches", family: "Fields", about: "A tree or a bolt of lightning",
  sections: [
    { title: "Colour", items: [C("from", "Trunk", "#f8fafc"), C("to", "Tips", "#22d3ee")] },
    { title: "Branches", items: [Ch("origin", "Grows from", [["bottom", "Bottom"], ["top", "Top"], ["left", "Left"], ["right", "Right"], ["centre", "Centre"]], "bottom"), R("depth", "Depth", 2, 9, 7), R("spread", "Spread", 10, 90, 35), R("decay", "Shrink", 50, 90, 72), R("weight", "Line width", 1, 20, 6)] },
  ],
  run(v, rng, w, h) {
    const { n, s } = reader(v);
    const D = n("depth"), size = Math.min(w, h), by: SubPath[][] = Array.from({ length: D }, () => []);
    const grow = (x: number, y: number, a: number, len: number, d: number): void => {
      if (d >= D) return;
      const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
      by[d]!.push(poly([[x, y], [x1, y1]], false));
      const sp = (n("spread") * Math.PI) / 180;
      grow(x1, y1, a - sp * (0.4 + 0.6 * rng()), len * (n("decay") / 100) * (0.85 + 0.3 * rng()), d + 1);
      grow(x1, y1, a + sp * (0.4 + 0.6 * rng()), len * (n("decay") / 100) * (0.85 + 0.3 * rng()), d + 1);
    };
    const len = size * 0.3, o = s("origin");
    if (o === "centre") for (let i = 0; i < 5; i++) grow(w / 2, h / 2, (i * TAU) / 5 + rng(), len * 0.8, 0);
    else grow(o === "left" ? 0 : o === "right" ? w : w / 2, o === "top" ? 0 : o === "bottom" ? h : h / 2, o === "bottom" ? -Math.PI / 2 : o === "top" ? Math.PI / 2 : o === "left" ? 0 : Math.PI, len * 1.2, 0);
    return by.filter((l) => l.length).map((l, d) => line(l, mix(v["from"] as string, v["to"] as string, d / Math.max(1, D - 1)), (n("weight") / 100) * size * 0.12 * Math.pow(0.78, d), `Level ${d + 1}`));
  },
};

export const maze: Generator = {
  id: "maze", label: "Maze", family: "Fields", about: "A random maze of walls",
  sections: [{ title: "Colour", items: [C("line", "Walls", "#e2e8f0")] }, { title: "Maze", items: [R("cols", "Across", 4, 40, 14), R("weight", "Wall width", 1, 20, 6)] }],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const cols = n("cols"), rows = Math.max(2, Math.round((cols * h) / w)), cw = w / cols, ch = h / rows;
    const right = Array.from({ length: rows }, () => Array<boolean>(cols).fill(true)), down = Array.from({ length: rows }, () => Array<boolean>(cols).fill(true));
    const seen = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false)), stack: Array<[number, number]> = [[0, 0]];
    seen[0]![0] = true;
    while (stack.length) {
      const [i, j] = stack[stack.length - 1]!;
      const nb = ([[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as Array<[number, number]>).filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows && !seen[b]![a]);
      if (!nb.length) { stack.pop(); continue; }
      const [a, b] = rng.pick(nb);
      if (a > i) right[j]![i] = false; else if (a < i) right[b]![a] = false; else if (b > j) down[j]![i] = false; else down[b]![a] = false;
      seen[b]![a] = true;
      stack.push([a, b]);
    }
    const walls: SubPath[] = [poly([[0, 0], [w, 0], [w, h], [0, h]])];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (right[j]![i] && i < cols - 1) walls.push(poly([[(i + 1) * cw, j * ch], [(i + 1) * cw, (j + 1) * ch]], false));
      if (down[j]![i] && j < rows - 1) walls.push(poly([[i * cw, (j + 1) * ch], [(i + 1) * cw, (j + 1) * ch]], false));
    }
    return [line(walls, c("line")!, (n("weight") / 100) * Math.min(cw, ch) * 0.5, "Walls")];
  },
};

export const ribbons: Generator = {
  id: "ribbons", label: "Ribbons", family: "Fields", about: "Flowing swooshes across the sheet",
  sections: [TWO, { title: "Ribbons", items: [R("count", "Count", 1, 14, 5), R("thick", "Thickness", 2, 60, 18), R("curl", "Curl", 0, 100, 50), R("opacity", "Opacity", 10, 100, 70)] }],
  run(v, rng, w, h) {
    const { n } = reader(v);
    const out: GenShape[] = [];
    for (let i = 0; i < n("count"); i++) {
      const m = 6, base = rng.range(0.1, 0.9) * h, pts: Array<[number, number, number]> = [];
      let y = base;
      for (let k = 0; k < m; k++) {
        y = Math.min(h * 1.1, Math.max(-h * 0.1, y + (rng() - 0.5) * h * (n("curl") / 100) * 0.9));
        const x = (w * 1.2 * k) / (m - 1) - w * 0.1;
        pts.push([x, y, (n("thick") / 100) * h * (0.35 + 0.65 * Math.sin((Math.PI * k) / (m - 1))) * (0.6 + 0.8 * rng())]);
      }
      const top = pts.map(([x, yy, t]): P => [x, yy - t / 2]), bot = pts.map(([x, yy, t]): P => [x, yy + t / 2]).reverse();
      out.push(solid([{ n: through([...top, ...bot], true), closed: true }], alpha(mix(v["from"] as string, v["to"] as string, n("count") === 1 ? 0 : i / (n("count") - 1)), n("opacity") / 100), `Ribbon ${i + 1}`));
    }
    return out;
  },
};

export const FIELDS = [contours, cells, cracks, triangulate, flow, branches, maze, ribbons];

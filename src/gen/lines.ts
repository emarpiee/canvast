import { ellipse, merged, poly, regular, rotated, solid, line, star as starPts, curve } from "./geom";
import type { P } from "./geom";
import { C, Ch, R, T, reader } from "./kit";
import type { Rng } from "./rng";
import type { Generator, GenShape, Values } from "./types";
import { mix } from "./rng";
import type { SubPath } from "./core";

const TAU = Math.PI * 2;
const rad = (d: number): number => (d * Math.PI) / 180;
/** The box's centre, and the length of its diagonal (what a turned band must reach to cover it). */
const geo = (w: number, h: number) => ({ cx: w / 2, cy: h / 2, d: Math.hypot(w, h) });
const TWO_COLOURS = { title: "Colour", items: [C("fill", "Colour", "#ff5d73"), C("fill2", "Second colour", "#ffb703", true)] } as const;

/** Bands of two colours across the box, turned by `angle`; `make(i, u0, u1)` returns the band's points in the unturned frame (u across, v along). */
function bands(v: Values, w: number, h: number, count: number, make: (i: number, u0: number, u1: number, d: number) => P[]): GenShape[] {
  const { c, n } = reader(v);
  const { cx, cy, d } = geo(w, h);
  const out: GenShape[] = [];
  const step = (2 * d) / count, a = rad(n("angle"));
  for (let i = 0; i < count; i++) {
    const col = i % 2 && c("fill2") ? c("fill2")! : i % 2 ? null : c("fill")!;
    if (!col) continue;
    const u0 = cx - d + i * step, u1 = u0 + step * (1 - n("gap") / 100);
    out.push(solid([poly(rotated(make(i, u0, u1, d), cx, cy, a))], col));
  }
  return merged(out);
}

export const stripes: Generator = {
  id: "stripes", label: "Stripes", family: "Lines", about: "Parallel bands, straight or tilted",
  sections: [TWO_COLOURS, { title: "Stripes", items: [R("count", "Count", 2, 60, 14), R("angle", "Angle", 0, 180, 30), R("gap", "Gap", 0, 90, 0)] }],
  run: (v, _rng, w, h) => bands(v, w, h, reader(v).n("count") * 2, (_i, u0, u1, d) => [[u0, h / 2 - d], [u1, h / 2 - d], [u1, h / 2 + d], [u0, h / 2 + d]]),
};

export const chevrons: Generator = {
  id: "chevrons", label: "Chevrons", family: "Lines", about: "Zigzag bands",
  sections: [TWO_COLOURS, { title: "Chevrons", items: [R("count", "Bands", 2, 30, 8), R("teeth", "Zigzags", 1, 16, 5), R("depth", "Depth", 5, 100, 40), R("angle", "Angle", 0, 180, 0), R("gap", "Gap", 0, 90, 0)] }],
  run(v, _rng, w, h) {
    const { n } = reader(v);
    const T2 = n("teeth") * 2, { d } = geo(w, h);
    return bands(v, w, h, n("count") * 2, (_i, u0, u1) => {
      const vk = (k: number): number => h / 2 - d + (2 * d * k) / T2, off = (k: number): number => (k % 2 ? (n("depth") / 100) * (u1 - u0) : 0);
      const top = Array.from({ length: T2 + 1 }, (_, k): P => [u0 + off(k), vk(k)]);
      const bot = Array.from({ length: T2 + 1 }, (_, k): P => [u1 + off(k), vk(k)]).reverse();
      return [...top, ...bot];
    });
  },
};

export const dots: Generator = {
  id: "dots", label: "Dots", family: "Lines", about: "A grid of dots, regular or loose",
  sections: [
    { title: "Colour", items: [C("fill", "Dots", "#ffd166")] },
    { title: "Dots", items: [R("cols", "Across", 3, 40, 14), R("size", "Size", 10, 100, 55), R("jitter", "Looseness", 0, 100, 0), Ch("layout", "Layout", [["grid", "Grid"], ["stagger", "Staggered"]], "grid"), R("fade", "Size change", 0, 100, 0)] },
  ],
  run(v, rng, w, h) {
    const { n, s, c } = reader(v);
    const cell = w / n("cols"), rows = Math.ceil(h / cell) + 1, out: SubPath[] = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i <= n("cols"); i++) {
        const x = (i + 0.5 + (s("layout") === "stagger" && j % 2 ? 0.5 : 0)) * cell + (rng() - 0.5) * cell * (n("jitter") / 100), y = (j + 0.5) * cell + (rng() - 0.5) * cell * (n("jitter") / 100);
        const r = (cell / 2) * (n("size") / 100) * (1 - (n("fade") / 100) * (x / w));
        if (r > 0.01) out.push(ellipse(x, y, r, r));
      }
    return [solid(out, c("fill")!, "Dots")];
  },
};

export const checks: Generator = {
  id: "checks", label: "Checks", family: "Lines", about: "A checkerboard, straight or turned",
  sections: [{ title: "Colour", items: [C("fill", "Squares", "#ff5d73")] }, { title: "Checks", items: [R("cells", "Across", 2, 30, 8), R("angle", "Angle", 0, 90, 0)] }],
  run(v, _rng, w, h) {
    const { n, c } = reader(v);
    const { cx, cy, d } = geo(w, h), cell = w / n("cells"), m = Math.ceil(d / cell) + 1, out: SubPath[] = [], a = rad(n("angle"));
    for (let j = -m; j <= m; j++)
      for (let i = -m; i <= m; i++) if ((i + j) % 2 === 0) out.push(poly(rotated([[cx + i * cell, cy + j * cell], [cx + (i + 1) * cell, cy + j * cell], [cx + (i + 1) * cell, cy + (j + 1) * cell], [cx + i * cell, cy + (j + 1) * cell]], cx, cy, a)));
    return [solid(out, c("fill")!, "Squares")];
  },
};

export const rings: Generator = {
  id: "rings", label: "Rings", family: "Lines", about: "Concentric circles",
  sections: [
    { title: "Variants", items: [Ch("style", "Style", [["bands", "Bands"], ["outline", "Outline"]], "bands")] },
    { title: "Colour", items: [C("from", "Inside", "#ff4d6d"), C("to", "Outside", "#3b2bff")] },
    { title: "Rings", items: [R("count", "Count", 2, 30, 9), R("x", "Centre across", 0, 100, 50), R("y", "Centre down", 0, 100, 50), R("ease", "Spacing change", 0, 100, 0), R("line", "Outline width", 1, 20, 4)] },
  ],
  run(v, _rng, w, h) {
    const { n, s, c } = reader(v);
    const cx = (n("x") / 100) * w, cy = (n("y") / 100) * h, far = Math.max(cx, w - cx) ** 2 + Math.max(cy, h - cy) ** 2, R0 = Math.sqrt(far), out: GenShape[] = [];
    const radius = (i: number): number => R0 * Math.pow((i + 1) / n("count"), 1 + (n("ease") / 100) * 1.5);
    for (let i = n("count") - 1; i >= 0; i--) {
      const col = mix(c("from")!, c("to")!, n("count") === 1 ? 0 : i / (n("count") - 1));
      out.push(s("style") === "bands" ? solid([ellipse(cx, cy, radius(i), radius(i))], col) : line([ellipse(cx, cy, radius(i), radius(i))], col, (n("line") / 100) * Math.min(w, h) * 0.12));
    }
    return out;
  },
};

export const rays: Generator = {
  id: "rays", label: "Rays", family: "Lines", about: "A sunburst from one point",
  sections: [TWO_COLOURS, { title: "Rays", items: [R("count", "Rays", 3, 60, 16), R("x", "Centre across", -50, 150, 50), R("y", "Centre down", -50, 150, 50), R("jitter", "Looseness", 0, 100, 0), R("turn", "Turn", 0, 360, 0)] }],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const cx = (n("x") / 100) * w, cy = (n("y") / 100) * h, R2 = geo(w, h).d * 3, N = n("count") * 2, out: GenShape[] = [];
    const a = (i: number): number => rad(n("turn")) + ((i + (rng() - 0.5) * (n("jitter") / 100)) * TAU) / N;
    const edge = Array.from({ length: N + 1 }, (_, i) => (i === N ? a(0) + TAU : a(i)));
    for (let i = 0; i < N; i++) {
      const col = i % 2 ? c("fill2") : c("fill");
      if (col) out.push(solid([poly([[cx, cy], [cx + R2 * Math.cos(edge[i]!), cy + R2 * Math.sin(edge[i]!)], [cx + R2 * Math.cos(edge[i + 1]!), cy + R2 * Math.sin(edge[i + 1]!)]])], col));
    }
    return merged(out);
  },
};

export const spiral: Generator = {
  id: "spiral", label: "Spiral", family: "Lines", about: "A spiral line",
  sections: [
    { title: "Colour", items: [C("fill", "Line", "#ffd166")] },
    { title: "Spiral", items: [R("turns", "Turns", 1, 14, 5), R("thick", "Thickness", 1, 40, 8), R("x", "Centre across", 0, 100, 50), R("y", "Centre down", 0, 100, 50), Ch("kind", "Kind", [["even", "Even"], ["grow", "Growing"]], "even"), T("cw", "Clockwise", true)] },
  ],
  run(v, _rng, w, h) {
    const { n, s, b, c } = reader(v);
    const cx = (n("x") / 100) * w, cy = (n("y") / 100) * h, R0 = geo(w, h).d / 2, N = Math.round(n("turns") * 16), pts: P[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, rr = R0 * (s("kind") === "even" ? t : (Math.exp(2.2 * t) - 1) / (Math.exp(2.2) - 1)), a = (b("cw") ? 1 : -1) * t * n("turns") * TAU;
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
    return [line([curve(pts)], c("fill")!, (n("thick") / 100) * Math.min(w, h) * 0.2, "Spiral")];
  },
};

export const orbits: Generator = {
  id: "orbits", label: "Orbits", family: "Lines", about: "Rings with dots travelling on them",
  sections: [
    { title: "Colour", items: [C("dot", "Dots", "#ffd166"), C("ring", "Rings", "#ffffff", true)] },
    { title: "Orbits", items: [R("rings", "Rings", 1, 12, 5), R("dots", "Dots on a ring", 1, 12, 3), R("size", "Dot size", 5, 100, 40), R("x", "Centre across", 0, 100, 50), R("y", "Centre down", 0, 100, 50)] },
  ],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const cx = (n("x") / 100) * w, cy = (n("y") / 100) * h, R0 = Math.sqrt(Math.max(cx, w - cx) ** 2 + Math.max(cy, h - cy) ** 2), out: GenShape[] = [], dots: SubPath[] = [], rs: SubPath[] = [];
    for (let i = 1; i <= n("rings"); i++) {
      const r = (R0 * i) / n("rings");
      rs.push(ellipse(cx, cy, r, r));
      const k = rng.int(1, n("dots")), a0 = rng() * TAU, dr = (R0 / n("rings")) * 0.45 * (n("size") / 100);
      for (let j = 0; j < k; j++) dots.push(ellipse(cx + r * Math.cos(a0 + (j * TAU) / k), cy + r * Math.sin(a0 + (j * TAU) / k), dr, dr));
    }
    if (c("ring")) out.push(line(rs, c("ring")!, Math.min(w, h) * 0.003, "Rings"));
    out.push(solid(dots, c("dot")!, "Dots"));
    return out;
  },
};

const MARKS = ["rect", "circle", "triangle"] as const;

function confettiPiece(rng: Rng, kind: string, x: number, y: number, r: number): SubPath {
  const k = kind === "mixed" ? rng.pick(MARKS) : kind, rot = rng() * TAU;
  if (k === "circle") return ellipse(x, y, r, r);
  if (k === "triangle") return poly(regular(x, y, r * 1.2, 3, rot));
  return poly(rotated([[x - r, y - r * 0.5], [x + r, y - r * 0.5], [x + r, y + r * 0.5], [x - r, y + r * 0.5]], x, y, rot));
}

export const confetti: Generator = {
  id: "confetti", label: "Confetti", family: "Lines", about: "Small shapes thrown at random",
  sections: [
    { title: "Colour", items: [C("c1", "Colour 1", "#ff5d73"), C("c2", "Colour 2", "#ffd166"), C("c3", "Colour 3", "#06d6a0", true), C("c4", "Colour 4", "#4cc9f0", true)] },
    { title: "Confetti", items: [R("count", "Count", 10, 400, 120, 5), R("size", "Size", 2, 40, 12), R("contrast", "Contrast", 0, 100, 40), Ch("shape", "Shape", [["mixed", "Mixed"], ["rect", "Strips"], ["circle", "Dots"], ["triangle", "Triangles"]], "mixed")] },
  ],
  run(v, rng, w, h) {
    const { n, s, c } = reader(v);
    const cols = ["c1", "c2", "c3", "c4"].map(c).filter((x): x is string => !!x), out: GenShape[] = [];
    for (let i = 0; i < n("count"); i++) {
      const r = (n("size") / 100) * Math.min(w, h) * 0.5 * (1 - (n("contrast") / 100) * rng() * 0.8);
      out.push(solid([confettiPiece(rng, s("shape"), rng() * w, rng() * h, r)], cols[i % cols.length]!));
    }
    return merged(out);
  },
};

export const stars: Generator = {
  id: "stars", label: "Stars", family: "Lines", about: "Scattered stars and sparkles",
  sections: [
    { title: "Colour", items: [C("fill", "Stars", "#ffe066"), C("fill2", "Second colour", "#ffffff", true)] },
    { title: "Stars", items: [R("count", "Count", 3, 150, 30), R("size", "Size", 2, 40, 10), R("contrast", "Contrast", 0, 100, 60), R("points", "Points", 3, 10, 4), R("ratio", "Sharpness", 10, 90, 40)] },
  ],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const out: GenShape[] = [];
    for (let i = 0; i < n("count"); i++) {
      const r = (n("size") / 100) * Math.min(w, h) * 0.5 * (1 - (n("contrast") / 100) * rng() * 0.9);
      out.push(solid([poly(starPts(rng() * w, rng() * h, r, n("points"), n("ratio") / 100, -Math.PI / 2))], (i % 2 ? c("fill2") : null) ?? c("fill")!));
    }
    return merged(out);
  },
};

export const grid: Generator = {
  id: "grid", label: "Grid", family: "Lines", about: "Lines in a lattice with stronger lines now and then",
  sections: [
    { title: "Colour", items: [C("line", "Lines", "#5f7a99"), C("major", "Strong lines", "#ffffff", true)] },
    { title: "Grid", items: [R("cols", "Across", 2, 60, 16), R("weight", "Line width", 1, 20, 3), R("every", "Strong every", 0, 12, 4), T("rowsToo", "Rows too", true)] },
  ],
  run(v, _rng, w, h) {
    const { n, b, c } = reader(v);
    const cell = w / n("cols"), minor: SubPath[] = [], major: SubPath[] = [], wd = (n("weight") / 100) * cell * 0.5;
    const add = (i: number, sub: SubPath): void => void ((n("every") > 0 && c("major") && i % n("every") === 0 ? major : minor).push(sub));
    for (let i = 0; i <= n("cols"); i++) add(i, poly([[i * cell, 0], [i * cell, h]], false));
    if (b("rowsToo")) for (let j = 0; j * cell <= h + 1e-6; j++) add(j, poly([[0, j * cell], [w, j * cell]], false));
    return [line(minor, c("line")!, wd, "Lines"), ...(major.length ? [line(major, c("major")!, wd * 1.8, "Strong lines")] : [])];
  },
};

export const LINES = [stripes, chevrons, dots, checks, rings, rays, spiral, orbits, confetti, stars, grid];

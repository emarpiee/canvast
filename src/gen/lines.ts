import { ellipse, merged, poly, regular, rotated, solid, line, star as starPts, curve } from "./geom";
import type { P } from "./geom";
import { C, Ch, LOOSE, R, T, reader, steady, when } from "./kit";
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
function bands(v: Values, rng: Rng, w: number, h: number, count: number, make: (i: number, u0: number, u1: number, d: number) => P[]): GenShape[] {
  const { c, n } = reader(v);
  const { cx, cy, d } = geo(w, h);
  const out: GenShape[] = [];
  const step = (2 * d) / count, a = rad(n("angle"));
  for (let i = 0; i < count; i++) {
    const col = i % 2 && c("fill2") ? c("fill2")! : i % 2 ? null : c("fill")!;
    if (!col) continue;
    const j = n("jitter") / 100; // (looseness: the band moves and changes width)
    const sh = j ? (rng() - 0.5) * step * j : 0, wd = j ? (rng() - 0.5) * step * j * 0.6 : 0;
    const u0 = cx - d + i * step + sh, u1 = u0 + step * (1 - n("gap") / 100) + wd;
    out.push(solid([poly(rotated(make(i, u0, u1, d), cx, cy, a))], col));
  }
  return merged(out);
}

export const stripes: Generator = {
  id: "stripes", label: "Stripes", family: "Lines", about: "Parallel bands, straight or tilted",
  sections: [TWO_COLOURS, { title: "Stripes", items: [R("count", "Count", 2, 60, 14), R("angle", "Angle", 0, 180, 30), R("gap", "Gap", 0, 90, 0), LOOSE] }],
  run: (v, rng, w, h) => bands(v, rng, w, h, reader(v).n("count") * 2, (_i, u0, u1, d) => [[u0, h / 2 - d], [u1, h / 2 - d], [u1, h / 2 + d], [u0, h / 2 + d]]),
};

export const chevrons: Generator = {
  id: "chevrons", label: "Chevrons", family: "Lines", about: "Zigzag bands",
  sections: [TWO_COLOURS, { title: "Chevrons", items: [R("count", "Bands", 2, 30, 8), R("teeth", "Zigzags", 1, 16, 5), R("depth", "Depth", 5, 100, 40), R("angle", "Angle", 0, 180, 0), R("gap", "Gap", 0, 90, 0), LOOSE] }],
  run(v, rng, w, h) {
    const { n } = reader(v);
    const T2 = n("teeth") * 2, { d } = geo(w, h);
    return bands(v, rng, w, h, n("count") * 2, (_i, u0, u1) => {
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
  sections: [{ title: "Colour", items: [C("fill", "Squares", "#ff5d73")] }, { title: "Checks", items: [R("cells", "Across", 2, 30, 8), R("angle", "Angle", 0, 90, 0), LOOSE] }],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const { cx, cy, d } = geo(w, h), cell = w / n("cells"), m = Math.ceil(d / cell) + 1, out: SubPath[] = [], a = rad(n("angle"));
    for (let j = -m; j <= m; j++)
      for (let i = -m; i <= m; i++) if (((i + j) % 2 === 0) !== (rng() < (n("jitter") / 100) * 0.5)) out.push(poly(rotated([[cx + i * cell, cy + j * cell], [cx + (i + 1) * cell, cy + j * cell], [cx + (i + 1) * cell, cy + (j + 1) * cell], [cx + i * cell, cy + (j + 1) * cell]], cx, cy, a)));
    return [solid(out, c("fill")!, "Squares")];
  },
};

export const rings: Generator = {
  id: "rings", label: "Rings", family: "Lines", about: "Concentric circles",
  sections: [
    { title: "Variants", items: [Ch("style", "Style", [["bands", "Bands"], ["outline", "Outline"]], "bands")] },
    { title: "Colour", items: [C("from", "Inside", "#ff4d6d"), C("to", "Outside", "#3b2bff")] },
    { title: "Rings", items: [R("count", "Count", 2, 30, 9), R("x", "Centre across", 0, 100, 50), R("y", "Centre down", 0, 100, 50), R("ease", "Spacing change", 0, 100, 0), R("line", "Outline width", 1, 20, 4), LOOSE] },
  ],
  run(v, rng, w, h) {
    const { n, s, c } = reader(v);
    const cx = (n("x") / 100) * w, cy = (n("y") / 100) * h, far = Math.max(cx, w - cx) ** 2 + Math.max(cy, h - cy) ** 2, R0 = Math.sqrt(far), out: GenShape[] = [];
    const wob = Array.from({ length: n("count") }, () => (rng() - 0.5) * 0.9 * (n("jitter") / 100)); // (looseness: each ring off its place by up to under half a step, so they never cross)
    const radius = (i: number): number => R0 * Math.pow((i + 1 + wob[i]!) / n("count"), 1 + (n("ease") / 100) * 1.5);
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
    { title: "Spiral", items: [R("turns", "Turns", 1, 14, 5), R("thick", "Thickness", 1, 40, 8), R("x", "Centre across", 0, 100, 50), R("y", "Centre down", 0, 100, 50), Ch("kind", "Kind", [["even", "Even"], ["grow", "Growing"]], "even"), T("cw", "Clockwise", true), LOOSE] },
  ],
  run(v, rng, w, h) {
    const { n, s, b, c } = reader(v);
    const cx = (n("x") / 100) * w, cy = (n("y") / 100) * h, R0 = geo(w, h).d / 2, N = Math.round(n("turns") * 16), pts: P[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, rr = R0 * (s("kind") === "even" ? t : (Math.exp(2.2 * t) - 1) / (Math.exp(2.2) - 1)) * (1 + (rng() - 0.5) * 0.1 * (n("jitter") / 100) * (1 - t)), a = (b("cw") ? 1 : -1) * t * n("turns") * TAU;
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

/** Where a grid's lines go: the same reckoning for drawing them and for saying what they come to. */
function gridLayout(v: Values, w: number, h: number): { m: number; cols: number; rows: number; cellX: number; cellY: number } {
  const { n, s } = reader(v);
  const m = (n("margin") / 100) * Math.min(w, h), iw = w - 2 * m, ih = h - 2 * m, kind = s("cells");
  if (kind === "size") {
    const size = Math.max(n("size"), Math.max(iw, ih) / 1000); // (a tiny cell on a huge sheet would be more lines than can be held)
    return { m, cols: Math.max(1, Math.floor(iw / size)), rows: Math.max(1, Math.floor(ih / size)), cellX: size, cellY: size };
  }
  const cols = n("cols"), cellX = iw / cols;
  // Square: the whole rows nearest to square cells, so that the last line is on the edge.
  const rows = kind === "equal" ? cols : kind === "rows" ? n("rows") : Math.max(1, Math.round(ih / cellX));
  return { m, cols, rows, cellX, cellY: ih / rows };
}
const SOME_CELLS = ["square", "equal", "rows"] as const;
export const grid: Generator = {
  id: "grid", label: "Grid", family: "Lines", about: "Lines in a lattice with stronger lines now and then",
  sections: [
    { title: "Colour", items: [C("line", "Lines", "#5f7a99"), C("major", "Strong lines", "#ffffff", true)] },
    { title: "Grid", items: [steady(Ch("cells", "Cells", [["square", "Square"], ["equal", "Equal"], ["rows", "Rows"], ["size", "Size"]], "square")), steady(when("cells", SOME_CELLS, R("cols", "Across", 2, 60, 16))), steady(when("cells", ["rows"], R("rows", "Rows", 2, 60, 16))), steady(when("cells", ["size"], R("size", "Cell size", 4, 200, 32))), R("weight", "Line width", 1, 20, 3), R("every", "Strong every", 0, 12, 4), steady(R("strongAt", "Strong start", 0, 12, 0)), R("strong", "Strong width", 100, 500, 180, 10), steady(T("rowsToo", "Rows too", true)), steady(LOOSE)] },
    { title: "Layout", items: [steady(R("margin", "Margin", 0, 45, 0)), steady(T("frame", "Frame", false)), steady(R("shiftX", "Shift across", 0, 100, 0)), steady(R("shiftY", "Shift down", 0, 100, 0)), steady(R("dash", "Dash length", 0, 100, 0)), steady(R("angle", "Angle", 0, 90, 0))] },
  ],
  readout(v, w, h) {
    const { cols, rows, cellX, cellY } = gridLayout(v, w, h);
    return `${cols} across, ${rows} down · cell ${Math.round(cellX)} × ${Math.round(cellY)}`;
  },
  run(v, rng, w, h) {
    const { n, b, c } = reader(v);
    const { m, cellX: cell, cellY } = gridLayout(v, w, h), a = rad(n("angle"));
    const { cx, cy, d } = geo(w, h), extra = a && !m ? d : 0; // (turned with no margin: past the box on all sides, for it to stay covered)
    const off = (): number => (rng() - 0.5) * cell * 0.6 * (n("jitter") / 100); // (looseness: each line off its place)
    // Line width and dash length go by the box, not the cell: changing the count leaves them as they are. (A 16th of the width: what a default grid's cell is.)
    const unit = w / 16, minor: SubPath[] = [], major: SubPath[] = [], wd = (n("weight") / 100) * unit * 0.5;
    const isStrong = (i: number): boolean => n("every") > 0 && !!c("major") && (i - n("strongAt")) % n("every") === 0;
    const widthOf = (i: number): number => (isStrong(i) ? (wd * n("strong")) / 100 : wd);
    const turned = (p: P[]): P[] => (a ? rotated(p, cx, cy, a) : p);
    const add = (i: number, x0: number, y0: number, x1: number, y1: number): void => {
      const to = isStrong(i) ? major : minor;
      const len = Math.hypot(x1 - x0, y1 - y0), step = Math.max(2 * Math.max((n("dash") / 100) * unit, wd * 1.5), len / 400); // (a dash is never shorter than it can be seen; its gap is as long)
      if (!n("dash")) return void to.push(poly(turned([[x0, y0], [x1, y1]]), false));
      for (let t = 0; t < len; t += step) {
        const e = Math.min(len, t + step / 2);
        to.push(poly(turned([[x0 + ((x1 - x0) * t) / len, y0 + ((y1 - y0) * t) / len], [x0 + ((x1 - x0) * e) / len, y0 + ((y1 - y0) * e) / len]]), false));
      }
    };
    /** Each line's place along an axis of `size`, `step` apart, from the margin, shifted by a share of a step. A line on the box's edge sits just inside it (the sheet would cut it in half). */
    const lines = (step: number, size: number, shift: number, draw: (i: number, at: number) => void): void => {
      for (let i = -Math.ceil(extra / step) - (shift ? 1 : 0); m + i * step + shift * step <= size - m + extra + 1e-6; i++) {
        const at = m + i * step + shift * step;
        if (at < m - extra - 1e-6) continue;
        const inset = m || a ? 0 : at <= 1e-6 ? widthOf(i) / 2 : at >= size - 1e-6 ? -widthOf(i) / 2 : 0;
        draw(i, at + inset + off());
      }
    };
    lines(cell, w, n("shiftX") / 100, (i, x) => add(i, x, m - extra, x, h - m + extra));
    if (b("rowsToo")) lines(cellY, h, n("shiftY") / 100, (j, y) => add(j, m - extra, y, w - m + extra, y));
    if (b("frame")) {
      const e = m + (m || a ? 0 : wd / 2);
      minor.push(poly(turned([[e, e], [w - e, e], [w - e, h - e], [e, h - e]])));
    }
    return [line(minor, c("line")!, wd, "Lines"), ...(major.length ? [line(major, c("major")!, (wd * n("strong")) / 100, "Strong lines")] : [])];
  },
};

export const LINES = [stripes, chevrons, dots, checks, rings, rays, spiral, orbits, confetti, stars, grid];

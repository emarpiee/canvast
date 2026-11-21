import type { SubPath } from "./path";
import { NODE } from "./path";

/**
 * Comic pages (ADR 0206): the geometry of panels, pure. A page is a sheet; its panels are convex outlines on it, apart by a gutter. A cut
 * across a panel makes two, the gutter between them; a gutter moved moves the edges on both sides of it (every panel along it); two panels
 * across a gutter merge into the outline round both. Everything is in the page's own units.
 */
export type Pt = readonly [number, number];
export type Poly = readonly Pt[];

const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Twice the signed area (positive: clockwise on a screen, y down). */
export const area2 = (p: Poly): number => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length]!;
  return s + a[0] * b[1] - b[0] * a[1];
}, 0);

/** The points as a closed sub-path of corners (no handles). */
export const polySub = (p: Poly): SubPath => ({ n: p.flatMap(([x, y]) => [x, y, x, y, x, y]), closed: true });
/** The corners of a sub-path. */
export const subPoly = (s: SubPath): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < s.n.length; i += NODE) out.push([s.n[i]!, s.n[i + 1]!]);
  return out;
};

/** The part of `p` on the side of the line a→b where `cross` is at least `off` (Sutherland–Hodgman, one edge). */
function keepSide(p: Poly, a: Pt, b: Pt, off: number): Pt[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const d = (q: Pt): number => cross(a, b, q) / len - off;
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!, n = p[(i + 1) % p.length]!, dc = d(c), dn = d(n);
    if (dc >= 0) out.push(c);
    if ((dc >= 0) !== (dn >= 0)) {
      const t = dc / (dc - dn);
      out.push([c[0] + (n[0] - c[0]) * t, c[1] + (n[1] - c[1]) * t]);
    }
  }
  return dedupe(out);
}

const dedupe = (p: Pt[]): Pt[] => p.filter((q, i) => {
  const r = p[(i + 1) % p.length]!;
  return p.length < 2 || Math.hypot(q[0] - r[0], q[1] - r[1]) > 1e-9;
});

/** The smallest panel worth making: a sliver thinner than this many units is no panel. */
const big = (p: Poly, min: number): boolean => p.length >= 3 && Math.abs(area2(p)) / 2 > min * min;

/**
 * Cut a panel along the line through `a` and `b` (as far as it goes, both ways), leaving `gutter` between the two parts: the two panels,
 * or null when the line misses it or a part would be too thin (`min`).
 */
export function splitPanel(p: Poly, a: Pt, b: Pt, gutter: number, min: number): [Pt[], Pt[]] | null {
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) return null;
  const one = keepSide(p, a, b, gutter / 2), two = keepSide(p, b, a, gutter / 2);
  return big(one, min) && big(two, min) ? [one, two] : null;
}

/** Where two lines (each through a point, along a direction) meet; null when they are parallel. */
function meet(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/** The polygon with its edge `i` (from corner i to i + 1) moved by `(dx, dy)`: its two corners slide along the edges beside it. Null when it would fold. */
export function moveEdge(p: Poly, i: number, dx: number, dy: number): Pt[] | null {
  const n = p.length, a = p[i]!, b = p[(i + 1) % n]!, before = p[(i - 1 + n) % n]!, after = p[(i + 2) % n]!;
  const d: Pt = [b[0] - a[0], b[1] - a[1]];
  const a2: Pt = [a[0] + dx, a[1] + dy];
  const na = meet(a2, d, before, [a[0] - before[0], a[1] - before[1]]);
  const nb = meet(a2, d, after, [b[0] - after[0], b[1] - after[1]]);
  if (!na || !nb) return null;
  const out = p.map((q) => q as Pt);
  out[i] = na;
  out[(i + 1) % n] = nb;
  // (the outline keeps its turn and stays convex: an edge pushed past its neighbours would fold it)
  const s = Math.sign(area2(p));
  for (let k = 0; k < n; k++) if (Math.sign(cross(out[k]!, out[(k + 1) % n]!, out[(k + 2) % n]!)) === -s && Math.abs(cross(out[k]!, out[(k + 1) % n]!, out[(k + 2) % n]!)) > 1e-9) return null;
  return Math.sign(area2(out)) === s ? out : null;
}

/** The outline round both panels (their convex hull): two panels across a gutter become one. */
export function mergePanels(a: Poly, b: Poly): Pt[] {
  const pts = [...a, ...b].map((q) => q as Pt).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const half = (list: Pt[]): Pt[] => {
    const h: Pt[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    return h.slice(0, -1);
  };
  const hull = [...half(pts), ...half([...pts].reverse())];
  // (the same turn as the panels had)
  return Math.sign(area2(hull)) === Math.sign(area2(a)) ? hull : hull.reverse();
}

/** An edge of a panel: which panel, which edge, its unit normal pointing out of the panel, and its line's offset along that normal. */
export interface Edge {
  readonly panel: number;
  readonly edge: number;
  readonly nx: number;
  readonly ny: number;
  readonly off: number;
  /** Where it starts and ends along the line (the coordinate across the normal). */
  readonly from: number;
  readonly to: number;
}

function edgesOf(panels: readonly Poly[]): Edge[] {
  const out: Edge[] = [];
  panels.forEach((p, k) => {
    const turn = Math.sign(area2(p)) || 1;
    p.forEach((a, i) => {
      const b = p[(i + 1) % p.length]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-9) return;
      // (outward: to the right of the edge's direction for a clockwise outline on a y-down screen)
      const nx = (turn * (b[1] - a[1])) / len, ny = (-turn * (b[0] - a[0])) / len;
      const along = (q: Pt): number => -ny * q[0] + nx * q[1];
      const [s, e] = [along(a), along(b)];
      out.push({ panel: k, edge: i, nx, ny, off: nx * a[0] + ny * a[1], from: Math.min(s, e), to: Math.max(s, e) });
    });
  });
  return out;
}

/**
 * The gutter at a point: the edges on its two sides (every panel's edge along it, as far as the gutter goes), and the direction across it.
 * Null when the point is not between two panels' facing edges (`reach`: how far a gutter may be, for one wider than drawn).
 */
export function gutterAt(panels: readonly Poly[], at: Pt, reach: number): { a: Edge[]; b: Edge[]; nx: number; ny: number; width: number } | null {
  const edges = edgesOf(panels);
  let best: { e: Edge; f: Edge; d: number } | null = null;
  for (const e of edges) {
    const de = e.nx * at[0] + e.ny * at[1] - e.off; // (out of e's panel, toward the gutter: positive)
    const along = -e.ny * at[0] + e.nx * at[1];
    if (de < -1e-9 || de > reach || along < e.from - 1e-9 || along > e.to + 1e-9) continue;
    for (const f of edges) {
      if (f.panel === e.panel || e.nx * f.nx + e.ny * f.ny > -0.9999) continue; // (facing it: the normals point at each other)
      const df = f.nx * at[0] + f.ny * at[1] - f.off;
      const fAlong = -f.ny * at[0] + f.nx * at[1];
      if (df < -1e-9 || df > reach || fAlong < f.from - 1e-9 || fAlong > f.to + 1e-9) continue;
      if (!best || de + df < best.d) best = { e, f, d: de + df };
    }
  }
  if (!best) return null;
  // every edge on either line that faces an edge of the other side (one panel above, two below: all three), grown until none is left; two
  // gutters on one line apart (the gutters of two rows, one under the other) stay two, as their edges face no edge of the other row
  const onLine = (seed: Edge): Edge[] => edges.filter((x) => Math.abs(x.nx - seed.nx) < 1e-6 && Math.abs(x.ny - seed.ny) < 1e-6 && Math.abs(x.off - seed.off) < 1e-6 * Math.max(1, Math.abs(seed.off)));
  // (the two sides' normals point at each other, so one side's span runs the other way along the line)
  const faces = (x: Edge, y: Edge): boolean => -y.to < x.to - 1e-9 && -y.from > x.from + 1e-9;
  const lineA = onLine(best.e), lineB = onLine(best.f), a = [best.e], b = [best.f];
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of lineA) if (!a.includes(x) && b.some((y) => faces(x, y))) a.push(x), (grew = true);
    for (const y of lineB) if (!b.includes(y) && a.some((x) => faces(y, x))) b.push(y), (grew = true);
  }
  return { a, b, nx: best.e.nx, ny: best.e.ny, width: best.d };
}

/**
 * The panels with a gutter moved by `d` across it (along the normal of side `a`): side a's edges go out by `d`, side b's in by `d`; null
 * when a panel would fold or grow thinner than `min`.
 */
export function moveGutter(panels: readonly Poly[], g: { a: readonly Edge[]; b: readonly Edge[]; nx: number; ny: number }, d: number, min: number): Pt[][] | null {
  const out = panels.map((p) => p.map((q) => q as Pt));
  for (const e of [...g.a, ...g.b]) {
    const next = moveEdge(out[e.panel]!, e.edge, g.nx * d, g.ny * d);
    if (!next || !big(next, min)) return null;
    out[e.panel] = next;
  }
  return out;
}

/** The panels with every gutter `by` wider (narrower when negative): each edge that faces another panel's moves back by half of it. */
export function widenGutters(panels: readonly Poly[], gutter: number, by: number, min: number): Pt[][] | null {
  const edges = edgesOf(panels);
  let out = panels.map((p) => p.map((q) => q as Pt));
  for (const e of edges) {
    const faces = edges.some((f) => f.panel !== e.panel && e.nx * f.nx + e.ny * f.ny < -0.9999 && -(e.off + f.off) > -1e-9 && -(e.off + f.off) <= gutter * 2 + 1e-6 && -f.to < e.to && -f.from > e.from); // (across a gutter about this wide; f's span runs the other way along the line)
    if (!faces) continue;
    const next = moveEdge(out[e.panel]!, e.edge, (-e.nx * by) / 2, (-e.ny * by) / 2);
    if (!next || !big(next, min)) return null;
    out = out.map((p, k) => (k === e.panel ? next : p));
  }
  return out;
}

/** Panels of a page laid out in rows (each row the widths of its panels as shares), inside `margin`, apart by `gutter`, clockwise outlines. */
export function layoutPanels(w: number, h: number, margin: number, gutter: number, rows: readonly (readonly number[])[]): Pt[][] {
  const out: Pt[][] = [];
  const [iw, ih] = [w - 2 * margin, h - 2 * margin];
  const rh = (ih - (rows.length - 1) * gutter) / Math.max(1, rows.length);
  rows.forEach((row, j) => {
    const y = margin + j * (rh + gutter), room = iw - (row.length - 1) * gutter, all = row.reduce((s, c) => s + c, 0);
    let x = margin;
    for (const c of row) {
      const pw = (room * c) / all;
      out.push([[x, y], [x + pw, y], [x + pw, y + rh], [x, y + rh]]);
      x += pw + gutter;
    }
  });
  return out;
}

/** Whether a point is inside a convex outline. */
export const insidePoly = (p: Poly, q: Pt): boolean => {
  const s = Math.sign(area2(p));
  return p.every((a, i) => s * cross(a, p[(i + 1) % p.length]!, q) >= -1e-9);
};

/** Whether the segment a–b touches the outline: an end inside it, or a crossing of one of its edges. */
export function segmentHits(p: Poly, a: Pt, b: Pt): boolean {
  if (insidePoly(p, a) || insidePoly(p, b)) return true;
  const side = (o: Pt, q: Pt, r: Pt): number => Math.sign(cross(o, q, r));
  return p.some((c, i) => {
    const d = p[(i + 1) % p.length]!;
    return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
  });
}

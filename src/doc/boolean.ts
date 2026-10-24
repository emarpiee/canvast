/**
 * Boolean operations on vector paths (ADR 0101): union, intersect, subtract, exclude. Pure functions over plain numbers.
 *
 * Curves stay curves. The outlines are taken apart where they cross (the crossings are found on the Bézier curves themselves, by
 * halving until the pieces are tiny and then a few Newton steps, and each curve is split there exactly, by de Casteljau), and every
 * piece is then asked a question that has no corner cases: "is the result on one side of you and not on the other?". The answer
 * comes from the winding number of each operand at a point a hair to the left and to the right of the middle of the piece (counted on
 * the curves, not on a flattened copy), so a piece inside an operand, outside it, or lying along an edge of the other is treated the
 * same way, and so is an interior edge of a shape that overlaps itself. A piece with the result on one side only is kept, turned so the
 * result is on its left; the pieces are joined end to end into closed loops, holes running the other way round the outer loops.
 *
 * Operands are closed regions given by a fill rule (non-zero or even-odd); an open sub-path is closed by a straight line, as when it is
 * filled. The loops are in the same coordinates as the operands. Failure (a loop that will not close: shapes whose outlines graze each
 * other in a way the tolerances cannot tell apart) returns null.
 */
import type { SubPath } from "./path";
import { NODE, cubicOf, extrema, isLine, nodeCount, segmentsOf } from "./path";

export type BoolOp = "union" | "intersect" | "subtract" | "exclude";
export const BOOL_OPS: readonly BoolOp[] = ["union", "intersect", "subtract", "exclude"];

export interface Region {
  readonly subs: readonly SubPath[];
  readonly evenodd: boolean;
}

type Cubic = readonly [number, number, number, number, number, number, number, number];
interface Seg {
  readonly c: Cubic;
  readonly line: boolean;
}

// ---- Curves ----------------------------------------------------------------------------------------------------------------------

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function at(c: Cubic, t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
}

function derivative(c: Cubic, t: number): [number, number] {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const d = 3 * t * t;
  return [a * (c[2] - c[0]) + b * (c[4] - c[2]) + d * (c[6] - c[4]), a * (c[3] - c[1]) + b * (c[5] - c[3]) + d * (c[7] - c[5])];
}

/** Both halves of a cubic cut at t (de Casteljau). */
function split(c: Cubic, t: number): [Cubic, Cubic] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  const ax = lerp(x0, x1, t), ay = lerp(y0, y1, t);
  const bx = lerp(x1, x2, t), by = lerp(y1, y2, t);
  const cx = lerp(x2, x3, t), cy = lerp(y2, y3, t);
  const dx = lerp(ax, bx, t), dy = lerp(ay, by, t);
  const ex = lerp(bx, cx, t), ey = lerp(by, cy, t);
  const mx = lerp(dx, ex, t), my = lerp(dy, ey, t);
  return [[x0, y0, ax, ay, dx, dy, mx, my], [mx, my, ex, ey, cx, cy, x3, y3]];
}

const reverse = (c: Cubic): Cubic => [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]];

function box(c: Cubic): [number, number, number, number] {
  return [Math.min(c[0], c[2], c[4], c[6]), Math.min(c[1], c[3], c[5], c[7]), Math.max(c[0], c[2], c[4], c[6]), Math.max(c[1], c[3], c[5], c[7])];
}

/** A straight segment as a cubic whose parameter runs evenly along it (a cubic with handles on its ends does not), so a cut at t is where t says. */
const straight = (x0: number, y0: number, x3: number, y3: number): Cubic => [x0, y0, lerp(x0, x3, 1 / 3), lerp(y0, y3, 1 / 3), lerp(x0, x3, 2 / 3), lerp(y0, y3, 2 / 3), x3, y3];

/** The loops of the sub-paths as lists of segments, each closed back to its first node by a line when it is not already. */
function loopsOfRegion(subs: readonly SubPath[]): Seg[][] {
  const loops: Seg[][] = [];
  for (const s of subs) {
    const n = nodeCount(s);
    if (n < 2) continue;
    const out: Seg[] = [];
    for (const [i, j] of segmentsOf(s)) {
      const c = cubicOf(s.n, i, j);
      const line = isLine(s.n, i, j);
      out.push({ c: line ? straight(c[0], c[1], c[6], c[7]) : c, line });
    }
    if (!s.closed) {
      const a = (n - 1) * NODE;
      if (s.n[a] !== s.n[0] || s.n[a + 1] !== s.n[1]) out.push({ c: straight(s.n[a]!, s.n[a + 1]!, s.n[0]!, s.n[1]!), line: true });
    }
    loops.push(out);
  }
  return loops;
}

// ---- Winding ---------------------------------------------------------------------------------------------------------------------

/** The winding number of the outline round (px, py): crossings of a ray to the right, +1 going down the page and -1 going up. Counted on the curves. */
function winding(segs: readonly Seg[], px: number, py: number): number {
  let w = 0;
  for (const { c } of segs) {
    if (Math.max(c[1], c[3], c[5], c[7]) <= py || Math.min(c[1], c[3], c[5], c[7]) > py || Math.max(c[0], c[2], c[4], c[6]) <= px) continue;
    // Cut where y turns round, so each piece is monotone in y and crosses the ray at most once.
    const cuts = [0, ...extrema(c[1], c[3], c[5], c[7]), 1].sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const ta = cuts[k]!;
      const tb = cuts[k + 1]!;
      const ya = at(c, ta)[1];
      const yb = at(c, tb)[1];
      const up = ya <= py && yb > py;
      const down = yb <= py && ya > py;
      if (!up && !down) continue;
      let lo = ta;
      let hi = tb;
      for (let i = 0; i < 56; i++) {
        const mid = (lo + hi) / 2;
        if ((at(c, mid)[1] <= py) === (ya <= py)) lo = mid;
        else hi = mid;
      }
      if (at(c, (lo + hi) / 2)[0] > px) w += up ? 1 : -1;
    }
  }
  return w;
}

const insideOf = (segs: readonly Seg[], evenodd: boolean) => (x: number, y: number): boolean => {
  const w = winding(segs, x, y);
  return evenodd ? (w & 1) !== 0 : w !== 0;
};

// ---- Crossings -------------------------------------------------------------------------------------------------------------------

type Hit = [number, number]; // parameters on the first and the second curve

function crossLines(a: Cubic, b: Cubic, hits: Hit[]): void {
  const rx = a[6] - a[0];
  const ry = a[7] - a[1];
  const sx = b[6] - b[0];
  const sy = b[7] - b[1];
  const qx = b[0] - a[0];
  const qy = b[1] - a[1];
  const rs = rx * sy - ry * sx;
  const lr = Math.hypot(rx, ry);
  const ls = Math.hypot(sx, sy);
  if (lr === 0 || ls === 0) return;
  if (Math.abs(rs) > 1e-12 * lr * ls) {
    const t = (qx * sy - qy * sx) / rs;
    const u = (qx * ry - qy * rx) / rs;
    const e = 1e-9;
    if (t >= -e && t <= 1 + e && u >= -e && u <= 1 + e) hits.push([Math.min(1, Math.max(0, t)), Math.min(1, Math.max(0, u))]);
    return;
  }
  // Parallel. Along one line, the stretch they share ends where one of the four ends lies on the other segment.
  if (Math.abs(qx * ry - qy * rx) > 1e-9 * lr * Math.max(lr, ls, Math.hypot(qx, qy))) return;
  const t0 = (qx * rx + qy * ry) / (lr * lr);
  const t1 = t0 + (sx * rx + sy * ry) / (lr * lr);
  const lo = Math.max(0, Math.min(t0, t1));
  const hi = Math.min(1, Math.max(t0, t1));
  if (lo > hi) return;
  for (const t of lo === hi ? [lo] : [lo, hi]) {
    const px = a[0] + rx * t;
    const py = a[1] + ry * t;
    hits.push([t, Math.min(1, Math.max(0, ((px - b[0]) * sx + (py - b[1]) * sy) / (ls * ls)))]);
  }
}

/** Newton's method on A(ta) - B(tb) = 0 from a start; the parameters and how far apart the points still are. */
function newton(a: Cubic, b: Cubic, ta0: number, tb0: number): [number, number, number] {
  let ta = ta0;
  let tb = tb0;
  for (let i = 0; i < 8; i++) {
    const [px, py] = at(a, ta);
    const [qx, qy] = at(b, tb);
    const [dax, day] = derivative(a, ta);
    const [dbx, dby] = derivative(b, tb);
    const det = -dax * dby + day * dbx;
    if (Math.abs(det) < 1e-12 * Math.hypot(dax, day) * Math.hypot(dbx, dby)) break; // parallel here: a graze
    const ex = px - qx;
    const ey = py - qy;
    ta = Math.min(1, Math.max(0, ta - (-ex * dby + ey * dbx) / det));
    tb = Math.min(1, Math.max(0, tb - (dax * ey - day * ex) / det));
  }
  const [px, py] = at(a, ta);
  const [qx, qy] = at(b, tb);
  return [ta, tb, Math.hypot(px - qx, py - qy)];
}

/** The parameter of the point of a curve nearest a point (by sampling, then golden-section search). */
function nearestT(c: Cubic, x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= 32; i++) {
    const [px, py] = at(c, i / 32);
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i / 32;
    }
  }
  let lo = Math.max(0, best - 1 / 32);
  let hi = Math.min(1, best + 1 / 32);
  const phi = 0.6180339887498949;
  for (let i = 0; i < 60; i++) {
    const m1 = hi - (hi - lo) * phi;
    const m2 = lo + (hi - lo) * phi;
    const d1 = (at(c, m1)[0] - x) ** 2 + (at(c, m1)[1] - y) ** 2;
    const d2 = (at(c, m2)[0] - x) ** 2 + (at(c, m2)[1] - y) ** 2;
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

/**
 * Where two curves cross. Halving finds where they come near each other (to a tolerance coarse enough that a graze does not make a
 * thousand candidates); the candidates that follow each other are one meeting; each is made exact by Newton's method from a few starts
 * (so two crossings close together are both found), and a meeting where the curves only touch, where Newton has nothing to hold on to,
 * is the closest approach of the two, found by looking from one curve to the other.
 */
function crossCurves(a: Cubic, b: Cubic, tiny: number, hits: Hit[]): void {
  const coarse = tiny * 1e5; // a graze spans about sqrt(2 R tolerance), so a coarse tolerance keeps it a few hundred leaves
  const cand: Hit[] = [];
  let work = 0;
  const rec = (ca: Cubic, a0: number, a1: number, cb: Cubic, b0: number, b1: number, depth: number): void => {
    if (work > 20000) return;
    const [ax0, ay0, ax1, ay1] = box(ca);
    const [bx0, by0, bx1, by1] = box(cb);
    if (ax1 < bx0 - coarse || bx1 < ax0 - coarse || ay1 < by0 - coarse || by1 < ay0 - coarse) return;
    work++;
    const sa = Math.max(ax1 - ax0, ay1 - ay0);
    const sb = Math.max(bx1 - bx0, by1 - by0);
    if ((sa <= coarse && sb <= coarse) || depth > 50) {
      cand.push([(a0 + a1) / 2, (b0 + b1) / 2]);
      return;
    }
    if (sa >= sb) {
      const [l, r] = split(ca, 0.5);
      const m = (a0 + a1) / 2;
      rec(l, a0, m, cb, b0, b1, depth + 1);
      rec(r, m, a1, cb, b0, b1, depth + 1);
    } else {
      const [l, r] = split(cb, 0.5);
      const m = (b0 + b1) / 2;
      rec(ca, a0, a1, l, b0, m, depth + 1);
      rec(ca, a0, a1, r, m, b1, depth + 1);
    }
  };
  rec(a, 0, 1, b, 0, 1, 0);
  // Thousands of candidates: the curves lie along each other. Their ends, and the other pieces' sides, settle it.
  if (work > 20000 || cand.length > 4000) return;
  cand.sort((p, q) => p[0] - q[0]);
  const clusters: Hit[][] = [];
  for (const h of cand) {
    const c = clusters[clusters.length - 1];
    const prev = c?.[c.length - 1];
    if (c && prev && Math.abs(h[0] - prev[0]) < 0.03 && Math.abs(h[1] - prev[1]) < 0.03) c.push(h);
    else clusters.push([h]);
  }
  const close = tiny * 10;
  for (const c of clusters) {
    const found: Hit[] = [];
    for (const seed of [c[0]!, c[Math.floor(c.length / 2)]!, c[c.length - 1]!]) {
      const [ta, tb, d] = newton(a, b, seed[0], seed[1]);
      if (d <= close && !found.some((f) => Math.abs(f[0] - ta) < 1e-7 && Math.abs(f[1] - tb) < 1e-7)) found.push([ta, tb]);
    }
    if (!found.length) {
      // no crossing, only a touch: the closest approach
      const mid = c[Math.floor(c.length / 2)]!;
      let ta = mid[0];
      let tb = mid[1];
      for (let i = 0; i < 40; i++) {
        tb = nearestT(b, ...at(a, ta));
        ta = nearestT(a, ...at(b, tb));
      }
      const [px, py] = at(a, ta);
      const [qx, qy] = at(b, tb);
      if (Math.hypot(px - qx, py - qy) <= tiny * 1e3) found.push([ta, tb]);
    }
    hits.push(...found);
  }
}

// ---- Pieces ----------------------------------------------------------------------------------------------------------------------

interface Piece {
  c: Cubic;
  line: boolean;
}

function cutAt(seg: Seg, ts: readonly number[]): Piece[] {
  const t = [...new Set(ts.filter((v) => v > 1e-9 && v < 1 - 1e-9))].sort((a, b) => a - b);
  const out: Piece[] = [];
  let rest = seg.c;
  let from = 0;
  for (const v of t) {
    const [l, r] = split(rest, (v - from) / (1 - from));
    out.push({ c: l, line: seg.line });
    rest = r;
    from = v;
  }
  out.push({ c: rest, line: seg.line });
  return out;
}

const tooShort = (c: Cubic, tiny: number): boolean => {
  const [x0, y0, x1, y1] = box(c);
  return Math.max(x1 - x0, y1 - y0) <= tiny;
};

// ---- The operation ---------------------------------------------------------------------------------------------------------------

const member: Record<BoolOp, (a: boolean, b: boolean) => boolean> = {
  union: (a, b) => a || b,
  intersect: (a, b) => a && b,
  subtract: (a, b) => a && !b,
  exclude: (a, b) => a !== b,
};

/** The largest coordinate of a box: tolerances cannot be finer than a few dozen steps of the numbers, which grow with it. */
const magnitude = (b: readonly number[]): number => Math.max(Math.abs(b[0]!), Math.abs(b[1]!), Math.abs(b[2]!), Math.abs(b[3]!));

const boxOfSegs = (segs: readonly Seg[]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { c } of segs) {
    const [a, b, d, e] = box(c);
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, d); y1 = Math.max(y1, e);
  }
  return [x0, y0, x1, y1];
};

function binary(op: BoolOp, A: Region, B: Region): SubPath[] | null {
  const la = loopsOfRegion(A.subs);
  const lb = loopsOfRegion(B.subs);
  if (!la.length || !lb.length) {
    // An operand with no area: union and exclude leave the other, subtract the first, intersect nothing.
    const keep = !la.length ? (op === "union" || op === "exclude" ? B : null) : op === "intersect" ? null : A;
    return keep ? [...keep.subs] : [];
  }
  const sa = la.flat();
  const sb = lb.flat();
  const inA = insideOf(sa, A.evenodd);
  const inB = insideOf(sb, B.evenodd);
  const m = member[op];
  // Which loop each segment belongs to, and every loop's box.
  const loops = [...la, ...lb];
  const boxes = loops.map(boxOfSegs);
  const owner: number[] = loops.flatMap((l, i) => l.map(() => i));
  const segs = loops.flat();
  const nA = sa.length;
  const cut: number[][] = segs.map(() => []);
  // Loops that cross each other belong together: cut and joined with tolerances from their own size, not that of a far larger shape.
  const parent = loops.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < nA; i++) {
    const [ax0, ay0, ax1, ay1] = box(segs[i]!.c);
    for (let j = nA; j < segs.length; j++) {
      const [bx0, by0, bx1, by1] = box(segs[j]!.c);
      const pad = 1e-10 * Math.max(ax1 - ax0, ay1 - ay0, bx1 - bx0, by1 - by0, 1e-300);
      if (ax1 < bx0 - pad || bx1 < ax0 - pad || ay1 < by0 - pad || by1 < ay0 - pad) continue;
      const lbox = [boxes[owner[i]!]!, boxes[owner[j]!]!];
      const tiny = Math.max(1e-10 * Math.max(...lbox.map((b) => Math.max(b[2] - b[0], b[3] - b[1]))), 1e-14 * Math.max(...lbox.map(magnitude)));
      const hits: Hit[] = [];
      if (segs[i]!.line && segs[j]!.line) crossLines(segs[i]!.c, segs[j]!.c, hits);
      else crossCurves(segs[i]!.c, segs[j]!.c, tiny, hits);
      if (!hits.length) continue;
      for (const [t, u] of hits) {
        cut[i]!.push(t);
        cut[j]!.push(u);
      }
      parent[find(owner[i]!)] = find(owner[j]!);
    }
  }
  const out: SubPath[] = [];
  const comps = new Map<number, number[]>();
  loops.forEach((_, i) => (comps.get(find(i)) ?? comps.set(find(i), []).get(find(i))!).push(i));
  for (const members of comps.values()) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of members) {
      const b = boxes[i]!;
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    const extent = Math.max(x1 - x0, y1 - y0);
    if (!(extent > 0) || !Number.isFinite(extent)) return null;
    const reach = Math.max(...members.map((i) => magnitude(boxes[i]!)));
    const sliver = Math.max(extent * 1e-6, reach * 1e-13);
    const delta = Math.max(extent * 1e-9, reach * 1e-14);
    const kept: Piece[] = [];
    let offset = 0;
    const starts = loops.map((l) => (offset += l.length) - l.length);
    for (const i of members) {
      const fromA = i < la.length;
      loops[i]!.forEach((seg, k) => {
        for (const p of cutAt(seg, cut[starts[i]! + k]!)) {
          if (tooShort(p.c, sliver)) continue; // a graze makes a cluster of crossings and slivers between them: they are nothing
          const [mx, my] = at(p.c, 0.5);
          let [dx, dy] = derivative(p.c, 0.5);
          if (Math.hypot(dx, dy) < 1e-12 * extent) {
            dx = p.c[6] - p.c[0];
            dy = p.c[7] - p.c[1];
          }
          const len = Math.hypot(dx, dy);
          if (!(len > 0)) continue;
          const nx = (-dy / len) * delta;
          const ny = (dx / len) * delta;
          const lx = mx + nx, ly = my + ny, rx = mx - nx, ry = my - ny;
          const al = inA(lx, ly), ar = inA(rx, ry), bl = inB(lx, ly), br = inB(rx, ry);
          // a piece of B that also lies on A's outline is the same edge A already offers
          if (!fromA && al !== ar) continue;
          const left = m(al, bl);
          const right = m(ar, br);
          if (left === right) continue;
          kept.push(left ? p : { c: reverse(p.c), line: p.line });
        }
      });
    }
    const loopsOut = link(kept, Math.max(extent, reach * 1e-6));
    if (!loopsOut) return null;
    out.push(...loopsOut);
  }
  return out;
}

/** Join pieces end to end into closed loops (the result is always on the left of a piece, so the way round is fixed). */
function link(pieces: readonly Piece[], extent: number): SubPath[] | null {
  const tol = extent * 3e-6; // a little more than the slivers dropped
  const cell = tol * 4;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number): string => `${Math.round(x / cell)},${Math.round(y / cell)}`;
  pieces.forEach((p, i) => {
    const k = key(p.c[0], p.c[1]);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  // The way a piece leaves its start and arrives at its end (a handle on the point itself does not say: the next one does).
  const dirOut = (c: Cubic): [number, number] => (c[2] !== c[0] || c[3] !== c[1] ? [c[2] - c[0], c[3] - c[1]] : c[4] !== c[0] || c[5] !== c[1] ? [c[4] - c[0], c[5] - c[1]] : [c[6] - c[0], c[7] - c[1]]);
  const dirIn = (c: Cubic): [number, number] => (c[6] !== c[4] || c[7] !== c[5] ? [c[6] - c[4], c[7] - c[5]] : c[6] !== c[2] || c[7] !== c[3] ? [c[6] - c[2], c[7] - c[3]] : [c[6] - c[0], c[7] - c[1]]);
  /**
   * The piece to go on with from the end of `from`. Where several start at that point (outlines touching at a corner), the one turning
   * furthest to the right: the loop then goes round the outside of the touching shapes, and an empty place they close in is a loop of
   * its own (a hole), not shared out among the shapes' loops.
   */
  const near = (from: Cubic, skip: ReadonlySet<number>): number => {
    const [x, y] = [from[6], from[7]];
    const cx = Math.round(x / cell);
    const cy = Math.round(y / cell);
    const found: number[] = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const i of grid.get(`${cx + a},${cy + b}`) ?? []) if (!skip.has(i) && Math.hypot(pieces[i]!.c[0] - x, pieces[i]!.c[1] - y) <= tol) found.push(i);
    }
    if (found.length <= 1) return found[0] ?? -1;
    const [ix, iy] = dirIn(from);
    const turn = (i: number): number => {
      const [ox, oy] = dirOut(pieces[i]!.c);
      return Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy);
    };
    return found.reduce((best, i) => (turn(i) < turn(best) ? i : best));
  };
  const used = new Set<number>();
  const loops: SubPath[] = [];
  for (let s = 0; s < pieces.length; s++) {
    if (used.has(s)) continue;
    const chain: Piece[] = [];
    let i = s;
    for (;;) {
      used.add(i);
      chain.push(pieces[i]!);
      const e = pieces[i]!.c;
      // closed: the end meets the start of the chain
      if (chain.length > 1 && Math.hypot(e[6] - chain[0]!.c[0], e[7] - chain[0]!.c[1]) <= tol) break;
      const next = near(e, used);
      if (next < 0) {
        if (Math.hypot(e[6] - chain[0]!.c[0], e[7] - chain[0]!.c[1]) <= tol * 100) break;
        return null; // a loop that will not close
      }
      i = next;
    }
    // nodes: the point is where a piece starts; the handles are the piece's own (a line has none)
    const n: number[] = [];
    chain.forEach((p, k) => {
      const prev = chain[(k - 1 + chain.length) % chain.length]!;
      n.push(p.c[0], p.c[1], prev.line ? p.c[0] : prev.c[4], prev.line ? p.c[1] : prev.c[5], p.line ? p.c[0] : p.c[2], p.line ? p.c[1] : p.c[3]);
    });
    if (chain.length >= 2) loops.push({ n, closed: true });
  }
  return loops;
}

/**
 * The result of an operation on regions, in the order the operands were given: union, intersect and exclude are taken pair by pair;
 * subtract takes the first (the one at the back) minus every other. null: the outlines graze each other in a way that could not be
 * told apart (a loop that does not close); [] : nothing is left.
 */
export function booleanOp(op: BoolOp, regions: readonly Region[]): SubPath[] | null {
  if (regions.length < 2) return null;
  let acc: Region = regions[0]!;
  for (let i = 1; i < regions.length; i++) {
    const out = binary(op, acc, regions[i]!);
    if (!out) return null;
    acc = { subs: out, evenodd: false };
  }
  return [...acc.subs];
}

/**
 * Rounded corners (ADR 0105): every corner of a path, between lines or curves, replaced by a smooth arc of a given radius. A corner is a node
 * where the path turns (the direction it arrives in and the direction it leaves in differ), whatever the segments on either side are. The
 * radius is cut down where a segment is too short to hold it, each corner using at most half of each adjacent segment, so neighbouring
 * corners never overlap and a large radius on a rectangle makes a pill.
 */
import type { Radius, SubPath } from "./path";
import { NODE, cubicOf, nodeCount } from "./path";

type Cubic = [number, number, number, number, number, number, number, number];

const SAMPLES = 24;
/** A path turning by less than this (radians) at a node is going straight on: not a corner. */
const STRAIGHT = 0.01;

const unit = (dx: number, dy: number): [number, number] | null => {
  const l = Math.hypot(dx, dy);
  return l > 1e-12 ? [dx / l, dy / l] : null;
};

/** Where on the curve (parameter) the arc length from the start is `d`, and the whole length. */
function lengths(c: Cubic): { total: number; at(d: number): number } {
  const cum = [0];
  let px = c[0], py = c[1];
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i / SAMPLES, u = 1 - t;
    const x = u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6];
    const y = u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7];
    cum.push(cum[i - 1]! + Math.hypot(x - px, y - py));
    px = x;
    py = y;
  }
  const total = cum[SAMPLES]!;
  return {
    total,
    at(d: number): number {
      if (d <= 0) return 0;
      if (d >= total) return 1;
      let i = 1;
      while (cum[i]! < d) i++;
      const f = (d - cum[i - 1]!) / Math.max(1e-300, cum[i]! - cum[i - 1]!);
      return (i - 1 + f) / SAMPLES;
    },
  };
}

/** The part of a cubic between parameters `a` and `b` (de Casteljau twice). */
function slice(c: Cubic, a: number, b: number): Cubic {
  const split = (q: Cubic, t: number): [Cubic, Cubic] => {
    const l = (p: number, r: number): number => p + (r - p) * t;
    const ax = l(q[0], q[2]), ay = l(q[1], q[3]), bx = l(q[2], q[4]), by = l(q[3], q[5]), cx = l(q[4], q[6]), cy = l(q[5], q[7]);
    const dx = l(ax, bx), dy = l(ay, by), ex = l(bx, cx), ey = l(by, cy);
    const mx = l(dx, ex), my = l(dy, ey);
    return [[q[0], q[1], ax, ay, dx, dy, mx, my], [mx, my, ex, ey, cx, cy, q[6], q[7]]];
  };
  let q = c;
  if (b < 1) q = split(q, b)[0];
  if (a > 0) q = split(q, b > 0 ? a / b : 0)[1];
  return q;
}

/** The unit direction of a cubic at parameter t (the chord when the derivative vanishes). */
function tangentAt(c: Cubic, t: number): [number, number] {
  const u = 1 - t;
  const dx = 3 * (u * u * (c[2] - c[0]) + 2 * u * t * (c[4] - c[2]) + t * t * (c[6] - c[4]));
  const dy = 3 * (u * u * (c[3] - c[1]) + 2 * u * t * (c[5] - c[3]) + t * t * (c[7] - c[5]));
  return unit(dx, dy) ?? unit(c[6] - c[0], c[7] - c[1]) ?? [1, 0];
}

/** What a node of a sub-path is as a corner: where it is, the unit directions it leaves along on each side, the angle between them and the two segments' lengths; null when the path goes straight on. */
export interface Corner {
  x: number;
  y: number;
  /** Unit vectors from the corner along the segment before it and the segment after it. */
  e1: [number, number];
  e2: [number, number];
  /** The angle between them (a right angle: pi/2; a straight line: pi). */
  theta: number;
  lenIn: number;
  lenOut: number;
}

export function cornerAt(s: SubPath, k: number): Corner | null {
  const c = nodeCount(s);
  if (c < 3 || (!s.closed && (k <= 0 || k >= c - 1))) return null;
  const a = (k + c - 1) % c, b = (k + 1) % c;
  const A = cubicOf(s.n, a, k), B = cubicOf(s.n, k, b);
  const x = s.n[k * NODE]!, y = s.n[k * NODE + 1]!;
  const e1 = unit(A[4] - x, A[5] - y) ?? unit(A[2] - x, A[3] - y) ?? unit(A[0] - x, A[1] - y);
  const e2 = unit(B[2] - x, B[3] - y) ?? unit(B[4] - x, B[5] - y) ?? unit(B[6] - x, B[7] - y);
  if (!e1 || !e2) return null;
  const theta = Math.acos(Math.max(-1, Math.min(1, e1[0] * e2[0] + e1[1] * e2[1])));
  if (theta < 1e-3 || theta > Math.PI - STRAIGHT) return null;
  return { x, y, e1, e2, theta, lenIn: lengths(A).total, lenOut: lengths(B).total };
}

/** The arc of a corner: how far from the node along each segment it starts, and the radius it actually has. */
export function trimOf(corner: Corner, radius: number): { t: number; r: number } {
  const t = Math.min(radius / Math.tan(corner.theta / 2), corner.lenIn / 2, corner.lenOut / 2);
  return { t, r: t * Math.tan(corner.theta / 2) };
}

/** Whether any corner could be rounded. */
export const canRound = (subs: readonly SubPath[]): boolean => subs.some((s) => Array.from({ length: nodeCount(s) }, (_, k) => k).some((k) => cornerAt(s, k) !== null));

/** The radius that rounds corner `k` of the flat node list of `subs` (a number: all of them; an array: one per node, across the sub-paths in order). */
const radiusFor = (r: Radius, flat: number): number => (typeof r === "number" ? r : (r[flat] ?? 0));

/** The nodes of a sub-path, rounded. `flat0`: how many nodes the earlier sub-paths had (an array radius counts nodes across them all). */
function roundSub(s: SubPath, r: Radius, flat0: number): SubPath {
  const c = nodeCount(s);
  if (c < 3) return s;
  const segs = s.closed ? c : c - 1;
  const cubic: Cubic[] = Array.from({ length: segs }, (_, j) => cubicOf(s.n, j, (j + 1) % c));
  const len = cubic.map((q) => lengths(q));
  // What each corner asks of the segments next to it (the length along them its arc starts at), and how far a segment can give to both of its ends.
  const demand = new Array<number>(c).fill(0);
  const corners: Array<Corner | null> = new Array(c).fill(null);
  for (let k = 0; k < c; k++) {
    const rad = radiusFor(r, flat0 + k);
    if (!(rad > 0)) continue;
    const corner = cornerAt(s, k);
    if (!corner) continue;
    corners[k] = corner;
    demand[k] = rad / Math.tan(corner.theta / 2);
  }
  // A segment that cannot hold what both its ends ask shares itself out in proportion to what they asked, so the one that asks for little
  // is not held to half of it just because its neighbour asks for a lot (a star's tip next to a blunt inner corner).
  const share = (j: number): number => {
    const a = demand[j]!, b = demand[(j + 1) % c]!, total = len[j]!.total;
    return a + b > total ? total / (a + b) : 1;
  };
  const trimStart = new Array<number>(segs).fill(0);
  const trimEnd = new Array<number>(segs).fill(0);
  const rounded = new Array<boolean>(c).fill(false);
  for (let k = 0; k < c; k++) {
    if (!corners[k]) continue;
    const jin = (k + segs - 1) % segs;
    const t = demand[k]! * Math.min(share(jin), share(k));
    if (!(t > 0)) continue;
    rounded[k] = true;
    trimEnd[jin] = t; // the segment arriving at k ends early
    trimStart[k] = t; // the one leaving it starts late
  }
  // Each segment as it is left after trimming, and where on it the trimmed ends are.
  const from = cubic.map((_, j) => (trimStart[j]! > 0 ? len[j]!.at(trimStart[j]!) : 0));
  const to = cubic.map((_, j) => Math.max(from[j]!, trimEnd[j]! > 0 ? len[j]!.at(len[j]!.total - trimEnd[j]!) : 1));
  const piece = cubic.map((q, j) => slice(q, from[j]!, to[j]!));
  const out: number[] = [];
  const emit = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): void => void out.push(x, y, ix, iy, ox, oy);
  for (let k = 0; k < c; k++) {
    const into = !s.closed && k === 0 ? null : piece[(k + segs - 1) % segs]!; // the piece arriving at k
    const leave = !s.closed && k === c - 1 ? null : piece[k]!; // the piece leaving it
    if (!rounded[k]) {
      const x = s.n[k * NODE]!, y = s.n[k * NODE + 1]!;
      emit(x, y, into ? into[4] : x, into ? into[5] : y, leave ? leave[2] : x, leave ? leave[3] : y);
      continue;
    }
    const a = into!, b = leave!;
    const jin = (k + segs - 1) % segs;
    const u1 = tangentAt(cubic[jin]!, to[jin]!);
    const u2 = tangentAt(cubic[k]!, from[k]!);
    const chord = Math.hypot(b[0] - a[6], b[1] - a[7]);
    const phi = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    const hh = phi > 1e-3 ? (4 / 3) * Math.tan(phi / 4) * (chord / (2 * Math.sin(phi / 2))) : 0;
    emit(a[6], a[7], a[4], a[5], a[6] + u1[0] * hh, a[7] + u1[1] * hh);
    emit(b[0], b[1], b[0] - u2[0] * hh, b[1] - u2[1] * hh, b[2], b[3]);
  }
  return { n: out, closed: s.closed };
}

/** The sub-paths with their corners rounded by `r` (see the file's note); nodes that are not corners, and the ends of open sub-paths, are as they were. */
export function roundCorners(subs: readonly SubPath[], r: Radius): SubPath[] {
  let flat = 0;
  return subs.map((s) => {
    const done = roundSub(s, r, flat);
    flat += nodeCount(s);
    return done;
  });
}

/** How many nodes the sub-paths have in all: the length of an array radius. */
export const nodesIn = (subs: readonly SubPath[]): number => subs.reduce((a, s) => a + nodeCount(s), 0);

/** The corners of the sub-paths in one list (a node that is not one is null), with the segment lengths each sits between. */
function flatCorners(subs: readonly SubPath[]): Array<{ corner: Corner | null; sub: number; k: number }> {
  const out: Array<{ corner: Corner | null; sub: number; k: number }> = [];
  subs.forEach((s, si) => {
    for (let k = 0; k < nodeCount(s); k++) out.push({ corner: cornerAt(s, k), sub: si, k });
  });
  return out;
}

/**
 * The largest single radius that still changes how the corners look. Where a segment cannot hold what both its ends ask, they share it out,
 * so a corner stops changing as soon as one of its two segments is full, and once every corner has stopped more radius changes nothing; that radius is the limit (a control that could be pushed past it would have
 * nowhere to come back from). A segment is full when its two corners ask for all of it: radius * (1 / tan(half angle at one end) + 1 / tan(half angle at the other)) = its length.
 */
export function maxUniform(subs: readonly SubPath[]): number {
  let max = 0;
  subs.forEach((s) => {
    const c = nodeCount(s);
    const segs = s.closed ? c : c - 1;
    if (c < 3) return;
    const cot = (k: number): number => {
      const q = cornerAt(s, k);
      return q ? 1 / Math.tan(q.theta / 2) : 0;
    };
    // the radius at which segment j is full
    const full = Array.from({ length: segs }, (_, j) => {
      const k = cot(j) + cot((j + 1) % c);
      return k > 0 ? lengths(cubicOf(s.n, j, (j + 1) % c)).total / k : Infinity;
    });
    // a corner stops changing when the first of its two segments is full
    for (let k = 0; k < c; k++) {
      if (!cornerAt(s, k)) continue;
      const r = Math.min(full[(k + segs - 1) % segs]!, full[k % segs]!);
      if (Number.isFinite(r)) max = Math.max(max, r);
    }
  });
  return max;
}

/** The largest radius corner `i` (its place among all the nodes) can have with the others at `radii`: what is left of the two segments beside it. */
export function maxFor(subs: readonly SubPath[], radii: ArrayLike<number>, i: number): number {
  const flat = flatCorners(subs);
  const me = flat[i]?.corner;
  if (!me) return 0;
  const { sub, k } = flat[i]!;
  const s = subs[sub]!, c = nodeCount(s);
  const base = i - k;
  const demandOf = (n: number): number => {
    const q = flat[base + n]?.corner;
    return q ? (radii[base + n] ?? 0) / Math.tan(q.theta / 2) : 0;
  };
  const before = s.closed || k > 0 ? demandOf((k + c - 1) % c) : 0;
  const after = s.closed || k < c - 1 ? demandOf((k + 1) % c) : 0;
  return Math.max(0, Math.min(me.lenIn - before, me.lenOut - after)) * Math.tan(me.theta / 2);
}

/** A radius cut to what the corners of `sharp` can use: one number to the largest the corners can all have, an array corner by corner. */
export function clampRadius(sharp: readonly SubPath[], r: Radius): Radius {
  if (typeof r === "number") return Math.min(r, maxUniform(sharp));
  const out = [...r];
  for (let i = 0; i < out.length; i++) out[i] = Math.min(out[i]!, maxFor(sharp, out, i));
  return out;
}

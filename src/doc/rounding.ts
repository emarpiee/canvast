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
  const trimStart = new Array<number>(segs).fill(0);
  const trimEnd = new Array<number>(segs).fill(0);
  const rounded = new Array<boolean>(c).fill(false);
  for (let k = 0; k < c; k++) {
    const rad = radiusFor(r, flat0 + k);
    if (!(rad > 0)) continue;
    const corner = cornerAt(s, k);
    if (!corner) continue;
    const { t } = trimOf(corner, rad);
    if (!(t > 0)) continue;
    rounded[k] = true;
    trimEnd[(k + segs - 1) % segs] = t; // the segment arriving at k ends early
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

/**
 * The largest radius each node's corner can use (0 where there is no corner): half of the shorter adjacent segment, as an arc of that
 * tangent length. A radius above it looks the same as it, so it is not kept above it (a control that could be pushed past this would have
 * nowhere to come back from).
 */
export function maxRadii(subs: readonly SubPath[]): number[] {
  const out: number[] = [];
  for (const s of subs) {
    for (let k = 0; k < nodeCount(s); k++) {
      const c = cornerAt(s, k);
      out.push(c ? (Math.min(c.lenIn, c.lenOut) / 2) * Math.tan(c.theta / 2) : 0);
    }
  }
  return out;
}

/** A radius cut to what the corners of `sharp` can use: one number to the largest of them, an array node by node. */
export function clampRadius(sharp: readonly SubPath[], r: Radius): Radius {
  const max = maxRadii(sharp);
  return typeof r === "number" ? Math.min(r, Math.max(0, ...max)) : r.map((v, i) => Math.min(v, max[i] ?? 0));
}

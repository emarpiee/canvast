/**
 * Rounded corners (ADR 0105): every corner of a path, between lines or curves, replaced by a smooth arc of a given radius.
 *
 * A *corner* is a node where the path turns (the direction it arrives in and the direction it leaves in differ); a smooth node, or one
 * the path goes straight through, is not one. The stretch of path between two corners (or an end of an open path) is an *edge*, however many
 * segments and smooth nodes it is made of: a corner takes its arc from the edge's own length, not from the first segment next to it, so
 * the corners that a Boolean operation leaves at the ends of a string of tiny segments are rounded like any other. Where an edge cannot hold
 * what both its corners ask, they share it in proportion to what each asked, so neighbouring arcs never overlap and a large radius on a
 * rectangle makes a pill.
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

/** The arc length of a cubic, and the parameter at which the arc length from its start is `d`. */
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

const pointAt = (c: Cubic, t: number): [number, number] => {
  const u = 1 - t;
  return [u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6], u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7]];
};

/** The unit direction of a cubic at parameter t (the chord when the derivative vanishes). */
function tangentAt(c: Cubic, t: number): [number, number] {
  const u = 1 - t;
  const dx = 3 * (u * u * (c[2] - c[0]) + 2 * u * t * (c[4] - c[2]) + t * t * (c[6] - c[4]));
  const dy = 3 * (u * u * (c[3] - c[1]) + 2 * u * t * (c[5] - c[3]) + t * t * (c[7] - c[5]));
  return unit(dx, dy) ?? unit(c[6] - c[0], c[7] - c[1]) ?? [1, 0];
}

/** What a node of a sub-path is as a corner: where it is, the unit directions it leaves along on each side, the angle between them (a right angle: pi/2; a straight line: pi) and the lengths of the two edges that meet there. */
export interface Corner {
  x: number;
  y: number;
  e1: [number, number];
  e2: [number, number];
  theta: number;
  lenIn: number;
  lenOut: number;
  /** The edges arriving at and leaving this corner (indices into the sub-path's edges). */
  inEdge: number;
  outEdge: number;
}

/** A stretch of path from one corner (or the start of an open sub-path) to the next, as the segments it is made of. `from` / `to`: the node it starts and ends at. */
interface Edge {
  from: number;
  to: number;
  cubics: Cubic[];
  lg: Array<ReturnType<typeof lengths>>;
  len: number;
}

interface Analysis {
  corners: Array<Corner | null>;
  edges: Edge[];
}

/** Every corner of a sub-path and the edges between them. */
function analyse(s: SubPath): Analysis {
  const c = nodeCount(s);
  const none: Analysis = { corners: new Array<Corner | null>(c).fill(null), edges: [] };
  if (c < 3) return none;
  const turn: Array<{ x: number; y: number; e1: [number, number]; e2: [number, number]; theta: number } | null> = [];
  for (let k = 0; k < c; k++) {
    if (!s.closed && (k === 0 || k === c - 1)) {
      turn.push(null);
      continue;
    }
    const a = (k + c - 1) % c, b = (k + 1) % c;
    const A = cubicOf(s.n, a, k), B = cubicOf(s.n, k, b);
    const x = s.n[k * NODE]!, y = s.n[k * NODE + 1]!;
    const e1 = unit(A[4] - x, A[5] - y) ?? unit(A[2] - x, A[3] - y) ?? unit(A[0] - x, A[1] - y);
    const e2 = unit(B[2] - x, B[3] - y) ?? unit(B[4] - x, B[5] - y) ?? unit(B[6] - x, B[7] - y);
    const theta = e1 && e2 ? Math.acos(Math.max(-1, Math.min(1, e1[0] * e2[0] + e1[1] * e2[1]))) : Math.PI;
    turn.push(e1 && e2 && theta >= 1e-3 && theta <= Math.PI - STRAIGHT ? { x, y, e1, e2, theta } : null);
  }
  // The nodes the edges run between: the corners, and the two ends of an open sub-path.
  const breaks: number[] = [];
  for (let k = 0; k < c; k++) if (turn[k] || (!s.closed && (k === 0 || k === c - 1))) breaks.push(k);
  if (!turn.some((t) => t)) return none;
  const edges: Edge[] = [];
  const count = s.closed ? breaks.length : breaks.length - 1;
  for (let i = 0; i < count; i++) {
    const from = breaks[i]!, to = breaks[(i + 1) % breaks.length]!;
    const cubics: Cubic[] = [];
    let j = from;
    do {
      cubics.push(cubicOf(s.n, j, (j + 1) % c));
      j = (j + 1) % c;
    } while (j !== to);
    const lg = cubics.map(lengths);
    edges.push({ from, to, cubics, lg, len: lg.reduce((a, l) => a + l.total, 0) });
  }
  const corners: Array<Corner | null> = new Array<Corner | null>(c).fill(null);
  edges.forEach((e, i) => {
    const t = turn[e.to];
    if (t) {
      const o = corners[e.to] ?? { ...t, lenIn: 0, lenOut: 0, inEdge: -1, outEdge: -1 };
      o.lenIn = e.len;
      o.inEdge = i;
      corners[e.to] = o;
    }
    const f = turn[e.from];
    if (f) {
      const o = corners[e.from] ?? { ...f, lenIn: 0, lenOut: 0, inEdge: -1, outEdge: -1 };
      o.lenOut = e.len;
      o.outEdge = i;
      corners[e.from] = o;
    }
  });
  return { corners, edges };
}

/** The corners of a sub-path (null for a node that is not one). */
export const cornersOf = (s: SubPath): Array<Corner | null> => analyse(s).corners;

/** The corner at node `k`, or null. */
export const cornerAt = (s: SubPath, k: number): Corner | null => analyse(s).corners[k] ?? null;

/** The arc of a corner: how far from the node along each edge it starts, and the radius it actually has. */
export function trimOf(corner: Corner, radius: number): { t: number; r: number } {
  const t = Math.min(radius / Math.tan(corner.theta / 2), corner.lenIn / 2, corner.lenOut / 2);
  return { t, r: t * Math.tan(corner.theta / 2) };
}

/** Whether any corner could be rounded. */
export const canRound = (subs: readonly SubPath[]): boolean => subs.some((s) => analyse(s).corners.some((c) => c !== null));

/** The radius that rounds corner `k` of the flat node list of `subs` (a number: all of them; an array: one per node, across the sub-paths in order). */
const radiusFor = (r: Radius, flat: number): number => (typeof r === "number" ? r : (r[flat] ?? 0));

/** One piece of an edge after its ends are trimmed, and where it begins and ends and which way it goes there. */
interface Cut {
  pieces: Cubic[];
  start: [number, number];
  end: [number, number];
  startTan: [number, number];
  endTan: [number, number];
}

/** The edge from arc length `lo` to `hi` along it: the parts of its segments that lie there (the segments beyond are dropped). */
function cutEdge(e: Edge, lo: number, hi: number): Cut {
  const pieces: Cubic[] = [];
  let cum = 0;
  let startTan: [number, number] | null = null;
  let endTan: [number, number] = [1, 0];
  const where = (d: number): { seg: number; u: number } => {
    let at = 0;
    for (let i = 0; i < e.cubics.length; i++) {
      const L = e.lg[i]!.total;
      if (d <= at + L || i === e.cubics.length - 1) return { seg: i, u: e.lg[i]!.at(Math.max(0, d - at)) };
      at += L;
    }
    return { seg: 0, u: 0 };
  };
  for (let i = 0; i < e.cubics.length; i++) {
    const L = e.lg[i]!.total;
    const a = Math.max(lo, cum) - cum, b = Math.min(hi, cum + L) - cum;
    if (b - a > 1e-9 * Math.max(1, e.len)) pieces.push(slice(e.cubics[i]!, a <= 0 ? 0 : e.lg[i]!.at(a), b >= L ? 1 : e.lg[i]!.at(b)));
    cum += L;
  }
  const w0 = where(lo), w1 = where(hi);
  startTan = tangentAt(e.cubics[w0.seg]!, w0.u);
  endTan = tangentAt(e.cubics[w1.seg]!, w1.u);
  const s0 = pointAt(e.cubics[w0.seg]!, w0.u), s1 = pointAt(e.cubics[w1.seg]!, w1.u);
  if (!pieces.length) pieces.push([s0[0], s0[1], s0[0], s0[1], s0[0], s0[1], s0[0], s0[1]]); // the edge is used up: a point
  const first = pieces[0]!, last = pieces[pieces.length - 1]!;
  void s1;
  return { pieces, start: [first[0], first[1]], end: [last[6], last[7]], startTan, endTan };
}

/** The nodes of a sub-path, rounded. `flat0`: how many nodes the earlier sub-paths had (an array radius counts nodes across them all). */
function roundSub(s: SubPath, r: Radius, flat0: number): SubPath {
  const c = nodeCount(s);
  const { corners, edges } = analyse(s);
  if (!edges.length) return s;
  // What each corner asks of its two edges, and how far an edge can give to both of its ends.
  const demand = new Array<number>(c).fill(0);
  corners.forEach((q, k) => {
    const rad = q ? radiusFor(r, flat0 + k) : 0;
    if (q && rad > 0) demand[k] = rad / Math.tan(q.theta / 2);
  });
  const share = (e: Edge): number => {
    const ask = demand[e.from]! + demand[e.to]!;
    return ask > e.len ? e.len / ask : 1;
  };
  const trim = new Array<number>(c).fill(0);
  corners.forEach((q, k) => {
    if (q && demand[k]! > 0) trim[k] = demand[k]! * Math.min(share(edges[q.inEdge]!), share(edges[q.outEdge]!));
  });
  const rounded = (k: number): boolean => !!corners[k] && trim[k]! > 0;
  const cuts = edges.map((e) => cutEdge(e, rounded(e.from) ? trim[e.from]! : 0, e.len - (rounded(e.to) ? trim[e.to]! : 0)));
  // The bridge at a rounded corner: from the end of the edge coming in to the start of the one going out, leaving and arriving along their directions.
  const bridge = (k: number): { out: [number, number]; into: [number, number] } => {
    const q = corners[k]!;
    const a = cuts[q.inEdge]!, b = cuts[q.outEdge]!;
    const chord = Math.hypot(b.start[0] - a.end[0], b.start[1] - a.end[1]);
    const phi = Math.acos(Math.max(-1, Math.min(1, a.endTan[0] * b.startTan[0] + a.endTan[1] * b.startTan[1])));
    const hh = phi > 1e-3 ? (4 / 3) * Math.tan(phi / 4) * (chord / (2 * Math.sin(phi / 2))) : 0;
    return { out: [a.end[0] + a.endTan[0] * hh, a.end[1] + a.endTan[1] * hh], into: [b.start[0] - b.startTan[0] * hh, b.start[1] - b.startTan[1] * hh] };
  };
  const out: number[] = [];
  const emit = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): void => void out.push(x, y, ix, iy, ox, oy);
  edges.forEach((e, i) => {
    const cut = cuts[i]!;
    const first = cut.pieces[0]!, last = cut.pieces[cut.pieces.length - 1]!;
    // the node the edge starts at
    if (rounded(e.from)) {
      const b = bridge(e.from);
      emit(first[0], first[1], b.into[0], b.into[1], first[2], first[3]);
    } else if (corners[e.from]) {
      const prev = cuts[corners[e.from]!.inEdge]!;
      const into = prev.pieces[prev.pieces.length - 1]!;
      emit(first[0], first[1], into[4], into[5], first[2], first[3]);
    } else {
      emit(first[0], first[1], first[0], first[1], first[2], first[3]); // the start of an open sub-path
    }
    // the smooth nodes along it
    for (let p = 0; p + 1 < cut.pieces.length; p++) {
      const a = cut.pieces[p]!, b = cut.pieces[p + 1]!;
      emit(a[6], a[7], a[4], a[5], b[2], b[3]);
    }
    // the node it ends at: a rounded corner's first node, or the end of an open sub-path (an unrounded corner is the next edge's first)
    if (rounded(e.to)) {
      const b = bridge(e.to);
      emit(last[6], last[7], last[4], last[5], b.out[0], b.out[1]);
    } else if (!corners[e.to]) {
      emit(last[6], last[7], last[4], last[5], last[6], last[7]);
    }
  });
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
 * The largest single radius that still changes how the corners look. Where an edge cannot hold what both its ends ask, they share it out, so
 * a corner stops changing as soon as one of its two edges is full, and once every corner has stopped more radius changes nothing; that
 * radius is the limit (a control that could be pushed past it would have nowhere to come back from). An edge is full when its two corners
 * ask for all of it: radius * (1 / tan(half angle at one end) + 1 / tan(half angle at the other)) = its length.
 */
export function maxUniform(subs: readonly SubPath[]): number {
  let max = 0;
  for (const s of subs) {
    const { corners, edges } = analyse(s);
    const cot = (k: number): number => (corners[k] ? 1 / Math.tan(corners[k]!.theta / 2) : 0);
    const full = edges.map((e) => {
      const k = cot(e.from) + cot(e.to);
      return k > 0 ? e.len / k : Infinity;
    });
    corners.forEach((q) => {
      if (!q) return;
      const r = Math.min(full[q.inEdge]!, full[q.outEdge]!);
      if (Number.isFinite(r)) max = Math.max(max, r);
    });
  }
  return max;
}

/** The largest radius corner `i` (its place among all the nodes) can have with the others at `radii`: what is left of the two edges beside it. */
export function maxFor(subs: readonly SubPath[], radii: ArrayLike<number>, i: number): number {
  let base = 0;
  for (const s of subs) {
    const c = nodeCount(s);
    if (i < base + c) {
      const { corners, edges } = analyse(s);
      const me = corners[i - base];
      if (!me) return 0;
      const left = (e: Edge, other: number): number => {
        if (other === i - base) return e.len / 2; // an edge from a corner back to itself is shared between its two ends
        const q = corners[other];
        return e.len - (q ? (radii[base + other] ?? 0) / Math.tan(q.theta / 2) : 0);
      };
      const room = Math.min(left(edges[me.inEdge]!, edges[me.inEdge]!.from), left(edges[me.outEdge]!, edges[me.outEdge]!.to));
      return Math.max(0, room) * Math.tan(me.theta / 2);
    }
    base += c;
  }
  return 0;
}

/** A radius cut to what the corners of `sharp` can use: one number to the largest the corners can all have, an array corner by corner. */
export function clampRadius(sharp: readonly SubPath[], r: Radius): Radius {
  if (typeof r === "number") return Math.min(r, maxUniform(sharp));
  const out = [...r];
  for (let i = 0; i < out.length; i++) out[i] = Math.min(out[i]!, maxFor(sharp, out, i));
  return out;
}

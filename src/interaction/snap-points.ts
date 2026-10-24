/**
 * Snapping to the shapes themselves, not only their boxes (ADR 0171): a corner onto a corner or the middle of a side, a corner onto any
 * point of an edge, and a side flush along a side it is nearly parallel to. Everything here is in screen pixels; the caller turns the
 * chosen offset into an exact move. Targets go in a grid of cells, so a move looks at the few cells round each moving corner, not at
 * everything in view.
 */
import { SNAP_PX } from "./snap";

/** A line piece on the screen: x0, y0, x1, y1. */
export type Seg = readonly [number, number, number, number];

/** Most corners and sides kept for one gesture (a dense view would make the gesture start slow). */
export const MAX_SNAP_POINTS = 20_000;
export const MAX_SNAP_SEGS = 20_000;
/** Sides closer to parallel than this (in radians, about 3°) can lie flush. */
export const FLUSH_ANGLE = 0.052;

const CELL = 32;
const key = (cx: number, cy: number): number => cx * 100_003 + cy; // (screen cells: a few thousand per axis at most)

export interface SnapTargets {
  pts: Float64Array; // x, y pairs
  segs: Seg[];
  /** Straight sides only (the ones that can lie flush); indices into `segs`. */
  straight: Set<number>;
  ptCells: Map<number, number[]>;
  segCells: Map<number, number[]>;
}

const add = (m: Map<number, number[]>, k: number, i: number): void => {
  const l = m.get(k);
  if (!l) m.set(k, [i]);
  else if (l[l.length - 1] !== i) l.push(i);
};

/** Index the corners (x, y pairs) and sides of what can be snapped to. A side is entered in every cell along it. */
export function snapTargets(points: readonly number[], segs: readonly Seg[], straight: ReadonlySet<number> = new Set()): SnapTargets {
  const n = Math.min(points.length / 2, MAX_SNAP_POINTS);
  const pts = Float64Array.from(points.slice(0, n * 2));
  const ptCells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) add(ptCells, key(Math.floor(pts[2 * i]! / CELL), Math.floor(pts[2 * i + 1]! / CELL)), i);
  const kept = segs.slice(0, MAX_SNAP_SEGS);
  const segCells = new Map<number, number[]>();
  kept.forEach(([x0, y0, x1, y1], i) => {
    const steps = Math.min(4000, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / CELL)); // (a query looks at the cells round it, so a cell a step misses is covered)
    for (let t = 0; t <= steps; t++) {
      const f = steps ? t / steps : 0;
      add(segCells, key(Math.floor((x0 + (x1 - x0) * f) / CELL), Math.floor((y0 + (y1 - y0) * f) / CELL)), i);
    }
  });
  return { pts, segs: kept, straight: new Set([...straight].filter((i) => i < kept.length)), ptCells, segCells };
}

const near = (cells: Map<number, number[]>, x: number, y: number): Set<number> => {
  const out = new Set<number>();
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const v of cells.get(key(cx + i, cy + j)) ?? []) out.add(v);
  return out;
};

/** The closest point of a side to (x, y), and how far it is. */
export function closestOnSeg([x0, y0, x1, y1]: Seg, x: number, y: number): { x: number; y: number; dist: number } {
  const vx = x1 - x0, vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / len2)) : 0;
  const px = x0 + vx * t, py = y0 + vy * t;
  return { x: px, y: py, dist: Math.hypot(x - px, y - py) };
}

export interface PointSnap {
  /** Which moving corner (index of the source list) and which target corner. */
  source: number;
  target: number;
  dist: number;
}

/** The closest corner-to-corner pair within `threshold`; `sources` are x, y pairs already moved by the pointer. */
export function bestPointSnap(sources: ArrayLike<number>, t: SnapTargets, threshold = SNAP_PX): PointSnap | null {
  let best: PointSnap | null = null;
  for (let s = 0; s < sources.length / 2; s++) {
    const x = sources[2 * s]!, y = sources[2 * s + 1]!;
    for (const i of near(t.ptCells, x, y)) {
      const dist = Math.hypot(t.pts[2 * i]! - x, t.pts[2 * i + 1]! - y);
      if (dist <= threshold && (!best || dist < best.dist)) best = { source: s, target: i, dist };
    }
  }
  return best;
}

/** A snap that is an offset on the screen: what to add to the pointer, the side it went to, and which moving corner (or side) went. */
export interface OffsetSnap {
  source: number;
  dx: number;
  dy: number;
  dist: number;
  seg: Seg;
}

/** The closest moving corner to any point of a side, within `threshold`. */
export function bestEdgeSnap(sources: ArrayLike<number>, t: SnapTargets, threshold = SNAP_PX): OffsetSnap | null {
  let best: OffsetSnap | null = null;
  for (let s = 0; s < sources.length / 2; s++) {
    const x = sources[2 * s]!, y = sources[2 * s + 1]!;
    for (const i of near(t.segCells, x, y)) {
      const c = closestOnSeg(t.segs[i]!, x, y);
      if (c.dist <= threshold && (!best || c.dist < best.dist)) best = { source: s, dx: c.x - x, dy: c.y - y, dist: c.dist, seg: t.segs[i]! };
    }
  }
  return best;
}

/**
 * A moving straight side brought onto the line of a straight side it is nearly parallel to (within FLUSH_ANGLE), when its middle is within
 * `threshold` of that side: the move is along the side's normal only, so the shapes still slide along each other.
 */
export function bestFlushSnap(sources: readonly Seg[], t: SnapTargets, threshold = SNAP_PX): OffsetSnap | null {
  let best: OffsetSnap | null = null;
  for (const [src, [a0, b0, a1, b1]] of sources.entries()) {
    const mx = (a0 + a1) / 2, my = (b0 + b1) / 2;
    const sa = Math.atan2(b1 - b0, a1 - a0);
    for (const i of near(t.segCells, mx, my)) {
      if (!t.straight.has(i)) continue;
      const seg = t.segs[i]!;
      const [x0, y0, x1, y1] = seg;
      let da = Math.abs(sa - Math.atan2(y1 - y0, x1 - x0)) % Math.PI;
      if (da > Math.PI / 2) da = Math.PI - da;
      if (da > FLUSH_ANGLE) continue;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (!(len > 0)) continue;
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      const along = ((mx - x0) * (x1 - x0) + (my - y0) * (y1 - y0)) / len;
      if (along < 0 || along > len) continue; // (the sides must face each other)
      const d = (mx - x0) * nx + (my - y0) * ny;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < best.dist)) best = { source: src, dx: -d * nx, dy: -d * ny, dist: Math.abs(d), seg };
    }
  }
  return best;
}

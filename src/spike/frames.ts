import * as D from "../core/dyadic";
import type { Camera, ScreenPoint, Viewport, WorldPoint } from "../core/camera";
import { panBy, zoomAt } from "../core/camera";

/**
 * SPIKE (docs/plans/nested-frames.md, step 1). Nested frames: every number
 * on the per-frame path stays small, whatever the depth.
 *
 * A frame's coordinates relate to its parent's by
 *
 *   parentPoint = o + childPoint · 2^(−K·n)
 *
 * with a small exact offset `o` and n ≥ 1 steps of K levels (n > 1 is a
 * compressed dive into empty space). The camera is a small exact position in
 * its frame plus a zoom level relative to that frame; it rebases to a child,
 * parent or another cell before any of its numbers grow.
 */

export const K = 32;
/** Rebase hysteresis (levels). */
const H = 8;
/** Sub-unit bits kept when rebasing up (as PRECISION_BUDGET in camera.ts). */
const BUDGET = 4096;
/** Beyond this many frame units from the view, a point is "far" for good at this depth. */
const FAR_LOG2 = 80;

export interface Frame {
  readonly id: number;
  parent: Frame | null;
  n: bigint;
  ox: D.Dyadic;
  oy: D.Dyadic;
  /** Depth in K-level steps from the original root (negative above it). */
  level: bigint;
  readonly kids: Map<string, Frame>;
}

let nextId = 0;
function frame(parent: Frame | null, n: bigint, ox: D.Dyadic, oy: D.Dyadic, level: bigint): Frame {
  return { id: nextId++, parent, n, ox, oy, level, kids: new Map() };
}

export const ROOT_LEVEL = 0n;

export class FrameSpace {
  root: Frame = frame(null, 1n, D.ZERO, D.ZERO, ROOT_LEVEL);
  /** The frame the world (level-0 dyadic coordinates) was defined in. */
  readonly world = this.root;
  count = 1;

  child(p: Frame, n: bigint, ox: D.Dyadic, oy: D.Dyadic): Frame {
    const key = `${n}|${D.toString(ox)}|${D.toString(oy)}`;
    let c = p.kids.get(key);
    if (!c) {
      c = frame(p, n, ox, oy, p.level + n);
      p.kids.set(key, c);
      this.count++;
    }
    return c;
  }

  /** The parent of `f`, creating one above the root, and splitting a compressed dive so the step is one K. */
  parentOf(f: Frame): Frame {
    if (!f.parent) {
      const r = frame(null, 1n, D.ZERO, D.ZERO, f.level - 1n);
      f.parent = r;
      r.kids.set(`1|0p0|0p0`, f);
      this.root = r;
      this.count++;
      return r;
    }
    if (f.n > 1n) {
      const p = f.parent;
      const mid = this.child(p, f.n - 1n, f.ox, f.oy);
      p.kids.delete(`${f.n}|${D.toString(f.ox)}|${D.toString(f.oy)}`);
      f.parent = mid;
      f.n = 1n;
      f.ox = D.ZERO;
      f.oy = D.ZERO;
      mid.kids.set(`1|0p0|0p0`, f);
    }
    return f.parent;
  }

  /** Frames from the root down to `f`. */
  path(f: Frame): Frame[] {
    const out: Frame[] = [];
    for (let g: Frame | null = f; g; g = g.parent) out.push(g);
    return out.reverse();
  }
}

/** Small exact rounding; never builds a huge constant (a term far below 2^q is just dropped). */
function roundSmall(a: D.Dyadic, q: number): D.Dyadic {
  if (a.m === 0n || a.e >= q) return a;
  if (D.log2Abs(a) < q - 2) return D.ZERO;
  return D.roundTo(a, q);
}

export interface FrameCamera {
  readonly f: Frame;
  readonly x: D.Dyadic;
  readonly y: D.Dyadic;
  /** log2 of CSS px per frame unit; kept within [−H, K + H] by rebasing. */
  readonly z: number;
}

/** The ordinary camera in the frame's own coordinates (all small), for the existing renderer and maths. */
export function localCamera(c: FrameCamera): Camera {
  const zi = Math.floor(c.z);
  return { center: { x: c.x, y: c.y }, zi, zf: c.z - zi, pz: zi };
}

function fromLocal(f: Frame, cam: Camera): FrameCamera {
  return { f, x: cam.center.x, y: cam.center.y, z: cam.zi + cam.zf };
}

/** Rebase until the numbers are in range. Exact: screen positions do not change. */
export function normalize(space: FrameSpace, c: FrameCamera): FrameCamera {
  let { f, x, y, z } = c;
  for (;;) {
    const big = D.log2Abs(x) > K + 1 || D.log2Abs(y) > K + 1;
    if (z < -H || big) {
      const p = space.parentOf(f);
      x = roundSmall(D.add(f.ox, D.shift(x, -K)), -BUDGET);
      y = roundSmall(D.add(f.oy, D.shift(y, -K)), -BUDGET);
      z += K;
      f = p;
    } else if (z > K + H) {
      const i = D.fromBigInt(D.floorDivPow2(x, 0));
      const j = D.fromBigInt(D.floorDivPow2(y, 0));
      x = D.sub(x, i);
      y = D.sub(y, j);
      // Nothing left below the cell corner: dive the remaining whole steps at once.
      const steps = x.m === 0n && y.m === 0n ? Math.max(1, Math.floor((z - K - H) / K) + 1) : 1;
      f = space.child(f, BigInt(steps), i, j);
      x = D.shift(x, K * steps);
      y = D.shift(y, K * steps);
      z -= K * steps;
    } else {
      return { f, x, y, z };
    }
  }
}

export function fpanBy(space: FrameSpace, c: FrameCamera, dx: number, dy: number): FrameCamera {
  return normalize(space, fromLocal(c.f, panBy(localCamera(c), dx, dy)));
}

export function fzoomAt(space: FrameSpace, c: FrameCamera, vp: Viewport, at: ScreenPoint, dz: number): FrameCamera {
  return normalize(space, fromLocal(c.f, zoomAt(localCamera(c), vp, at, dz)));
}

/** Zoom by any number of levels about the screen centre (the zoom read-out jump). */
export function fjump(space: FrameSpace, c: FrameCamera, levels: number): FrameCamera {
  return normalize(space, { ...c, z: c.z + levels });
}

/** Absolute zoom level (levels below the world frame), as a BigInt plus fraction. */
export function depthOf(c: FrameCamera): { levels: bigint; frac: number } {
  const zi = Math.floor(c.z);
  return { levels: c.f.level * BigInt(K) + BigInt(zi), frac: c.z - zi };
}

/**
 * Express a point of frame `g` in frame `f`'s units, or null when it is
 * farther than 2^FAR_LOG2 units from `f`'s origin region (then it is off
 * screen for good at this depth). Walks up from `g` to the common ancestor,
 * then down to `f`, stopping as soon as the point is far: the numbers stay
 * small, so the cost is the path length, not the depth in bits.
 */
export function expressIn(space: FrameSpace, g: Frame, p: WorldPoint, f: Frame): WorldPoint | null {
  const pathF = space.path(f);
  const onF = new Set(pathF);
  let x = p.x;
  let y = p.y;
  let a = g;
  while (!onF.has(a)) {
    const up = space.parentOf(a);
    x = D.add(a.ox, D.shift(x, -K * Number(a.n)));
    y = D.add(a.oy, D.shift(y, -K * Number(a.n)));
    a = up;
  }
  for (let i = pathF.indexOf(a) + 1; i < pathF.length; i++) {
    const d = pathF[i]!;
    x = D.shift(D.sub(x, d.ox), K * Number(d.n));
    y = D.shift(D.sub(y, d.oy), K * Number(d.n));
    if (D.log2Abs(x) > FAR_LOG2 || D.log2Abs(y) > FAR_LOG2) return null;
  }
  return { x, y };
}

/** Levels by which frame `f` is finer than frame `g` (positive when f is deeper). */
export function levelsBetween(g: Frame, f: Frame): number {
  return Number((f.level - g.level) * BigInt(K));
}

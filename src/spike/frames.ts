import * as D from "../core/dyadic";
import type { Camera, ScreenPoint, Viewport, WorldPoint } from "../core/camera";
import { CENTER_GUARD_BITS, PRECISION_BUDGET, ZOOM_QUANTUM, panBy, zoomAt } from "../core/camera";

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
/** Beyond this many frame units from the view, a point is "far" for good at this depth. */
const FAR_LOG2 = 80;
/** expressIn's precision, in bits below the target frame's unit: covers zoom up to K + H and objects 2K levels finer. */
const DRAW_BITS = 2 * K + 128;

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

  /** The parent of `f`, creating one above the root, and splitting a compressed dive so the step is `k` K-steps. */
  parentOf(f: Frame, k = 1n): Frame {
    if (!f.parent) {
      const r = frame(null, 1n, D.ZERO, D.ZERO, f.level - 1n);
      f.parent = r;
      r.kids.set(`1|0p0|0p0`, f);
      this.root = r;
      this.count++;
      return r;
    }
    if (f.n > k) {
      const p = f.parent;
      const mid = this.child(p, f.n - k, f.ox, f.oy);
      p.kids.delete(`${f.n}|${D.toString(f.ox)}|${D.toString(f.oy)}`);
      f.parent = mid;
      f.n = k;
      f.ox = D.ZERO;
      f.oy = D.ZERO;
      mid.kids.set(`${k}|0p0|0p0`, f);
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
  /** Precision depth in the frame's levels (as Camera.pz, see core/camera.ts). */
  readonly pz: number;
}

/** The ordinary camera in the frame's own coordinates (all small), for the existing renderer and maths. */
export function localCamera(c: FrameCamera): Camera {
  const zi = Math.floor(c.z);
  return { center: { x: c.x, y: c.y }, zi, zf: c.z - zi, pz: c.pz };
}

function fromLocal(f: Frame, cam: Camera): FrameCamera {
  return { f, x: cam.center.x, y: cam.center.y, z: cam.zi + cam.zf, pz: cam.pz };
}

/** x·2^-shift added to an integer offset, dropping a term that rounding at 2^q would remove anyway (|term| < 2^(q-2)). */
function up1(o: D.Dyadic, x: D.Dyadic, shift: number, q: number): D.Dyadic {
  const t = D.log2Abs(x) - shift < q - 2 ? D.ZERO : D.shift(x, -shift);
  return D.add(o, t);
}

/**
 * Rebase until the numbers are in range. Exact: the camera's world position,
 * zoom and precision depth are unchanged (only their frame changes), so
 * screen positions do not move.
 */
export function normalize(space: FrameSpace, c: FrameCamera): FrameCamera {
  let { f, x, y, z, pz } = c;
  for (;;) {
    const big = D.log2Abs(x) > K + 1 || D.log2Abs(y) > K + 1;
    if (z < -H || big) {
      // Up as many steps as needed at once (a compressed dive is left in one step; above the root, one new parent).
      const want = big ? 1 : Math.max(1, Math.ceil((-H - z) / K));
      let p: Frame;
      let n: number;
      if (!f.parent) {
        p = space.parentOf(f);
        if (want > 1) {
          // A new root a whole run above: one record, however far out.
          p.kids.delete("1|0p0|0p0");
          f.n = BigInt(want);
          p.level = f.level - f.n;
          p.kids.set(`${f.n}|0p0|0p0`, f);
        }
        n = Number(f.n);
      } else if (f.n > 1n && want < Number(f.n)) {
        p = space.parentOf(f, BigInt(want)); // splits the dive once: `want` steps up
        n = want;
      } else {
        p = f.parent;
        n = Number(f.n);
      }
      const q = -(pz + K * n + 96);
      x = up1(f.ox, x, K * n, q);
      y = up1(f.oy, y, K * n, q);
      z += K * n;
      pz += K * n;
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
      pz -= K * steps;
    } else {
      return { f, x, y, z, pz };
    }
  }
}

/** Ordinary pan (CSS px). */
export function fpanBy(space: FrameSpace, c: FrameCamera, dx: number, dy: number): FrameCamera {
  return normalize(space, fromLocal(c.f, panBy(localCamera(c), dx, dy)));
}

/** Ordinary zoom about a screen point (|dz| within a frame step; larger changes go through fjump). */
export function fzoomAt(space: FrameSpace, c: FrameCamera, vp: Viewport, at: ScreenPoint, dz: number): FrameCamera {
  if (Math.abs(dz) > K) throw new RangeError("use fjump for large zoom changes");
  return normalize(space, fromLocal(c.f, zoomAt(localCamera(c), vp, at, dz)));
}

/**
 * Zoom by any number of levels about the screen centre (the zoom read-out
 * jump). Same result as core/camera.ts zoomAt about the centre: the centre
 * stays, the precision depth follows nextDepth, and the centre is rounded to
 * it, computed after rebasing so no number grows with the jump.
 */
export function fjump(space: FrameSpace, c: FrameCamera, levels: number): FrameCamera {
  // Zoom counts are doubles: beyond this a jump is no longer exact. Depth itself is unbounded (frame levels are BigInt).
  if (!(Math.abs(levels) <= MAX_FRAME_JUMP)) throw new RangeError(`jumps are limited to 2^50 levels at a time`);
  const dzq = Math.round(levels / ZOOM_QUANTUM) * ZOOM_QUANTUM;
  if (dzq === 0) return c;
  const z = c.z + dzq;
  const zi = Math.floor(z);
  const pz = Math.min(Math.max(c.pz, zi), zi + PRECISION_BUDGET);
  const n = normalize(space, { ...c, z, pz });
  const q = -(n.pz + CENTER_GUARD_BITS);
  return { ...n, x: roundSmall(n.x, q), y: roundSmall(n.y, q) };
}

export const MAX_FRAME_JUMP = 2 ** 50;

/** Absolute zoom level (levels below the world frame), as a BigInt plus fraction. */
export function depthOf(c: FrameCamera): { levels: bigint; frac: number } {
  const zi = Math.floor(c.z);
  return { levels: c.f.level * BigInt(K) + BigInt(zi), frac: c.z - zi };
}

/**
 * A number kept as a sum of small terms, coarse to fine, each at least
 * GAP bits below the previous one (so the sum is the first term to within
 * 2^(1-GAP)). Walking between frames adds and drops terms at the coarse end
 * only, so a point 2^-10^12 from a corner never becomes a 10^12-bit number.
 */
type Terms = D.Dyadic[];
const GAP = 64;

/** Add `c` at the coarse end, merging terms that overlap and removing zeros. */
function addTerm(c: D.Dyadic, ts: Terms): Terms {
  const out = c.m === 0n ? ts.slice() : [c, ...ts];
  while (out.length > 1 && (out[0]!.m === 0n || D.log2Abs(out[1]!) >= out[0]!.e - GAP)) {
    out.splice(0, 2, D.add(out[0]!, out[1]!));
  }
  if (out.length === 1 && out[0]!.m === 0n) out.pop();
  return out;
}

/** Shift every term, then drop the fine end below 2^q (it cannot reach a pixel). */
function shiftTerms(ts: Terms, by: number, q: number): Terms {
  const out = ts.map((t) => D.shift(t, by));
  while (out.length && D.log2Abs(out[out.length - 1]!) < q - 2) out.pop();
  return out;
}

const leadLog2 = (ts: Terms): number => (ts.length ? D.log2Abs(ts[0]!) : -Infinity);

function sumTerms(ts: Terms): D.Dyadic {
  return ts.reduce((a, t) => D.add(a, t), D.ZERO);
}

/**
 * Express a point of frame `g` in frame `f`'s units, or null when it is
 * farther than 2^FAR_LOG2 units from `f`'s origin region (then it is off
 * screen for good at this depth). Walks up from `g` to the common ancestor,
 * then down to `f`, stopping as soon as the point is far. Every number stays
 * small (see Terms), so the cost is the path length, not the depth in bits.
 *
 * For drawing only: terms below 2^-DRAW_BITS of `f`'s unit are dropped (far
 * below 10^-6 px at any zoom the frame allows). Exact work uses expressExactIn.
 */
export function expressIn(space: FrameSpace, g: Frame, p: WorldPoint, f: Frame): WorldPoint | null {
  const pathF = space.path(f);
  const onF = new Set(pathF);
  let x: Terms = addTerm(p.x, []);
  let y: Terms = addTerm(p.y, []);
  let a = g;
  while (!onF.has(a)) {
    const up = a.parent!; // read only: a split here would cost one loop per step of a compressed dive
    const q = -(DRAW_BITS + levelsBetween(up, f));
    x = addTerm(a.ox, shiftTerms(x, -K * Number(a.n), q));
    y = addTerm(a.oy, shiftTerms(y, -K * Number(a.n), q));
    a = up;
  }
  for (let i = pathF.indexOf(a) + 1; i < pathF.length; i++) {
    const d = pathF[i]!;
    const q = -(DRAW_BITS + levelsBetween(d, f));
    x = shiftTerms(addTerm(D.neg(d.ox), x), K * Number(d.n), q);
    y = shiftTerms(addTerm(D.neg(d.oy), y), K * Number(d.n), q);
    if (leadLog2(x) > FAR_LOG2 + 1 || leadLog2(y) > FAR_LOG2 + 1) return null;
  }
  return { x: sumTerms(x), y: sumTerms(y) };
}

/** Levels by which frame `f` is finer than frame `g` (positive when f is deeper). */
export function levelsBetween(g: Frame, f: Frame): number {
  return Number((f.level - g.level) * BigInt(K));
}

/**
 * Exact expression of a point of frame `g` in frame `f`, with no far
 * cut-off (bits grow with the level gap). For debugging, tests, migration
 * and coarse objects; never on the per-frame path for ordinary content.
 */
export function expressExactIn(space: FrameSpace, g: Frame, p: WorldPoint, f: Frame): WorldPoint {
  const onF = new Set(space.path(f));
  let x = p.x;
  let y = p.y;
  let a = g;
  while (!onF.has(a)) {
    const up = a.parent!; // read only: a split here would cost one loop per step of a compressed dive
    x = D.add(a.ox, D.shift(x, -K * Number(a.n)));
    y = D.add(a.oy, D.shift(y, -K * Number(a.n)));
    a = up;
  }
  const pathF = space.path(f);
  for (let i = pathF.indexOf(a) + 1; i < pathF.length; i++) {
    const d = pathF[i]!;
    x = D.shift(D.sub(x, d.ox), K * Number(d.n));
    y = D.shift(D.sub(y, d.oy), K * Number(d.n));
  }
  return { x, y };
}

/** The camera as the old absolute system sees it (world centre, zoom level). Exact. */
export function toAbsoluteCamera(space: FrameSpace, c: FrameCamera): Camera {
  const d = levelsBetween(space.world, c.f);
  const zi = Math.floor(c.z);
  return { center: expressExactIn(space, c.f, { x: c.x, y: c.y }, space.world), zi: zi + d, zf: c.z - zi, pz: c.pz + d };
}

/** The frame camera for an absolute camera (as when loading a v0.8 saved view). Exact. */
export function fromAbsoluteCamera(space: FrameSpace, center: WorldPoint, z: number, pz = Math.floor(z)): FrameCamera {
  return normalize(space, { f: space.world, x: center.x, y: center.y, z, pz });
}

export interface Placement {
  readonly f: Frame;
  readonly anchor: WorldPoint;
  /** Local-unit exponent relative to the frame's unit. */
  readonly unit: number;
}

/**
 * Re-home an object to the frame that suits its position and scale, exactly
 * (its world geometry does not change by a single bit). An object lives in a
 * frame where its extent is between 2^-H and 2^(K+H) frame units and its
 * anchor within 2^(K+1) units of the frame origin: the same bounds as the
 * camera, so an object drawn at the camera's scale lands in or next to the
 * camera's frame. Frames are coordinate systems, not containers: geometry
 * may extend past the frame's cell (nothing is clipped or parented).
 */
export function rehome(space: FrameSpace, pl: Placement, extentLog2: number): Placement {
  let { f, anchor, unit } = pl;
  let { x, y } = anchor;
  for (;;) {
    const s = unit + extentLog2;
    if (s > K + H || D.log2Abs(x) > K + 1 || D.log2Abs(y) > K + 1) {
      const p = space.parentOf(f);
      x = D.add(f.ox, D.shift(x, -K));
      y = D.add(f.oy, D.shift(y, -K));
      unit -= K;
      f = p;
    } else if (s < -H) {
      const i = D.fromBigInt(D.floorDivPow2(x, 0));
      const j = D.fromBigInt(D.floorDivPow2(y, 0));
      f = space.child(f, 1n, i, j);
      x = D.shift(D.sub(x, i), K);
      y = D.shift(D.sub(y, j), K);
      unit += K;
    } else {
      return { f, anchor: { x, y }, unit };
    }
  }
}

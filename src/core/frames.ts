import * as D from "./dyadic";
import type { Camera, ScreenPoint, Viewport, WorldPoint } from "./camera";
import { CENTER_GUARD_BITS, PRECISION_BUDGET, ZOOM_QUANTUM, panBy, zoomAt } from "./camera";

/**
 * Nested frames (ADR 0014; reference: docs/reference/nested-frames.md): every number
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
export const H = 8;
/** Beyond this many frame units from the view, a point is "far" for good at this depth. */
const FAR_LOG2 = 80;
/** expressIn's precision, in bits below the target frame's unit: covers zoom up to K + H and objects 2K levels finer. */
export const DRAW_BITS = 2 * K + 128;

export interface Frame {
  readonly id: number;
  parent: Frame | null;
  n: bigint;
  ox: D.Dyadic;
  oy: D.Dyadic;
  /** Depth in K-level steps from the original root (negative above it). */
  level: bigint;
  readonly kids: Map<string, Frame>;
  /** The tree this frame belongs to (for exact conversion to the world frame). */
  readonly space: FrameSpace;
  /** Stable identity in storage (ADR 0014, step 4); assigned when first saved. The world frame is "world". */
  uid: string | null;
}

let nextId = 0;
function frame(space: FrameSpace, parent: Frame | null, n: bigint, ox: D.Dyadic, oy: D.Dyadic, level: bigint): Frame {
  return { id: nextId++, parent, n, ox, oy, level, kids: new Map(), space, uid: null };
}

export const ROOT_LEVEL = 0n;
export const WORLD_UID = "world";

/** A frame as stored (core/frames.ts FrameSpace.records): ids are stable, numbers are strings. */
export interface FrameRecord {
  id: string;
  parent: string | null;
  n: string;
  ox: string;
  oy: string;
  level: string;
}

interface ParsedRecord {
  parent: string | null;
  n: bigint;
  ox: D.Dyadic;
  oy: D.Dyadic;
  level: bigint;
}

export class FrameRecordError extends Error {}

function randomUid(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export class FrameSpace {
  root: Frame = frame(this, null, 1n, D.ZERO, D.ZERO, ROOT_LEVEL);
  /** The frame the world (level-0 dyadic coordinates) was defined in. */
  readonly world = this.root;
  count = 1;
  private readonly byUid = new Map<string, Frame>();

  constructor() {
    this.world.uid = WORLD_UID;
    this.byUid.set(WORLD_UID, this.world);
  }

  /** The frame's stable id for storage, assigned on first use. */
  uidOf(f: Frame): string {
    if (!f.uid) {
      do f.uid = randomUid();
      while (this.byUid.has(f.uid));
      this.byUid.set(f.uid, f);
    }
    return f.uid;
  }

  frameByUid(uid: string): Frame | undefined {
    return this.byUid.get(uid);
  }

  /**
   * Frame records for storage: every given frame, all its ancestors and the
   * world frame's chain (so the stored tree always reaches the root), parents
   * first. Cost: the path lengths, not the depth in bits.
   */
  records(frames: Iterable<Frame>): FrameRecord[] {
    const seen = new Set<Frame>();
    const out: Frame[] = [];
    for (const start of [...frames, this.world]) {
      for (let f: Frame | null = start; f && !seen.has(f); f = f.parent) {
        seen.add(f);
        out.push(f);
      }
    }
    out.sort((a, b) => (a.level < b.level ? -1 : a.level > b.level ? 1 : 0));
    return out.filter((f) => f.parent || f !== this.world).map((f) => this.record(f));
  }

  record(f: Frame): FrameRecord {
    return { id: this.uidOf(f), parent: f.parent ? this.uidOf(f.parent) : null, n: `${f.n}`, ox: D.toString(f.ox), oy: D.toString(f.oy), level: `${f.level}` };
  }

  /**
   * Build the frames of stored records into this (fresh) tree. Records are
   * untrusted: ids, links, levels and the single root are checked. Throws
   * FrameRecordError; nothing is half-built (the tree is changed only after
   * every check passed).
   */
  restore(records: readonly FrameRecord[]): void {
    if (this.count !== 1 || this.world.parent) throw new FrameRecordError("frames can only be restored into a fresh tree");
    const made = new Map<string, Frame>([[WORLD_UID, this.world]]);
    const fresh: Array<{ f: Frame; rec: ParsedRecord }> = [];
    const parsed = new Map<string, ParsedRecord>();
    for (const r of records) {
      if (!r || typeof r.id !== "string" || !r.id || r.id.length > 64) throw new FrameRecordError("bad frame id");
      if (parsed.has(r.id)) throw new FrameRecordError(`frame ${r.id} is stored twice`);
      let n: bigint;
      let level: bigint;
      let ox: D.Dyadic;
      let oy: D.Dyadic;
      try {
        if (!/^-?\d{1,40}$/.test(r.n) || !/^-?\d{1,40}$/.test(r.level)) throw new Error("bad integer");
        n = BigInt(r.n);
        level = BigInt(r.level);
        ox = D.parse(r.ox);
        oy = D.parse(r.oy);
      } catch {
        throw new FrameRecordError(`frame ${r.id} is damaged`);
      }
      if (n < 1n) throw new FrameRecordError(`frame ${r.id} has a bad step count`);
      if (r.parent !== null && typeof r.parent !== "string") throw new FrameRecordError(`frame ${r.id} has a bad parent`);
      parsed.set(r.id, { parent: r.parent, n, ox, oy, level });
    }
    for (const [id, rec] of parsed) {
      if (id === WORLD_UID) continue;
      const f = frame(this, null, rec.n, rec.ox, rec.oy, rec.level);
      f.uid = id;
      made.set(id, f);
      fresh.push({ f, rec });
    }
    const w = parsed.get(WORLD_UID);
    const links: Array<{ f: Frame; rec: ParsedRecord }> = [...fresh, ...(w ? [{ f: this.world, rec: w }] : [])];
    for (const { f, rec } of links) {
      if (rec.parent === null) continue;
      const p = made.get(rec.parent);
      if (!p) throw new FrameRecordError(`frame ${f.uid} has a missing parent ${rec.parent}`);
      const plevel = p === this.world ? 0n : parsed.get(rec.parent)!.level;
      if (f === this.world && rec.level !== 0n) throw new FrameRecordError("the world frame must be at level 0");
      if (plevel + rec.n !== (f === this.world ? 0n : rec.level)) throw new FrameRecordError(`frame ${f.uid} has an inconsistent level`);
    }
    // Links: acyclic, one root (an ancestor of the world frame).
    const parentOf = (f: Frame): string | null => (f === this.world ? (w ? w.parent : null) : parsed.get(f.uid!)!.parent);
    for (const { f } of links) {
      let g: Frame | undefined = f;
      for (let i = 0; g && parentOf(g) !== null; i++) {
        if (i > made.size) throw new FrameRecordError("frames form a cycle");
        g = made.get(parentOf(g)!);
      }
    }
    let top = this.world;
    for (let i = 0; parentOf(top) !== null; i++) top = made.get(parentOf(top)!)!;
    for (const f of made.values()) if (parentOf(f) === null && f !== top) throw new FrameRecordError("frames have more than one root");
    // All checks passed: link.
    for (const { f, rec } of links) {
      if (rec.parent === null) continue;
      const p = made.get(rec.parent)!;
      f.parent = p;
      f.n = rec.n;
      f.ox = rec.ox;
      f.oy = rec.oy;
      p.kids.set(`${rec.n}|${D.toString(rec.ox)}|${D.toString(rec.oy)}`, f);
    }
    for (const [id, f] of made) {
      if (f !== this.world) this.byUid.set(id, f);
    }
    if (w) this.world.level = 0n;
    this.root = top;
    this.count = made.size;
  }

  child(p: Frame, n: bigint, ox: D.Dyadic, oy: D.Dyadic): Frame {
    const key = `${n}|${D.toString(ox)}|${D.toString(oy)}`;
    let c = p.kids.get(key);
    if (!c) {
      c = frame(this, p, n, ox, oy, p.level + n);
      p.kids.set(key, c);
      this.count++;
    }
    return c;
  }

  /** The parent of `f`, creating one above the root, and splitting a compressed dive so the step is `k` K-steps. */
  parentOf(f: Frame, k = 1n): Frame {
    if (!f.parent) {
      const r = frame(this, null, 1n, D.ZERO, D.ZERO, f.level - 1n);
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

/** A saved view in frame form (storage schema 4): the camera's frame by id, and its small local numbers. */
export interface StoredFrameView {
  v: 2;
  frame: string;
  x: string;
  y: string;
  z: number;
  pz: number;
}

export function serializeFrameCamera(c: FrameCamera): StoredFrameView {
  return { v: 2, frame: c.f.space.uidOf(c.f), x: D.toString(c.x), y: D.toString(c.y), z: c.z, pz: c.pz };
}

/** The camera of a stored view in `space`'s frames; throws RangeError for anything invalid. */
export function deserializeFrameCamera(space: FrameSpace, s: StoredFrameView): FrameCamera {
  const f = typeof s.frame === "string" ? space.frameByUid(s.frame) : undefined;
  if (!f) throw new RangeError("the saved view names an unknown frame");
  if (!Number.isFinite(s.z) || !Number.isSafeInteger(s.pz)) throw new RangeError("invalid saved zoom");
  return normalize(space, { f, x: D.parse(s.x), y: D.parse(s.y), z: s.z, pz: s.pz });
}

/** The ordinary camera in the frame's own coordinates (all small), for the existing renderer and maths. */
export function localCamera(c: FrameCamera): Camera {
  const zi = Math.floor(c.z);
  return { center: { x: c.x, y: c.y }, zi, zf: c.z - zi, pz: c.pz };
}

export function fromLocal(f: Frame, cam: Camera): FrameCamera {
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
      // Every step needed at once (linear in the point's bits; empty trailing steps become a dive).
      const steps = Math.floor((z - K - H) / K) + 1;
      ({ f, x, y } = descend(space, f, x, y, steps));
      z -= K * steps;
      pz -= K * steps;
    } else {
      return { f, x, y, z, pz };
    }
  }
}

/**
 * Descend `steps` K-steps from frame `f` at point (x, y), exactly, in time
 * linear in the point's size (stepping one level at a time redoes
 * arithmetic on the whole number each step: quadratic, hours for a point
 * with 10^7 significant bits).
 *
 * Cells use balanced digits: each level's offset is the nearest integer, so
 * the remainder lies in [−1/2, 1/2) of a cell and offsets in [−2^(K−1),
 * 2^(K−1)). With floor digits a point just below a corner would read
 * 0.FFFF… at every level and never compress; balanced, it reads 0, 0, …,
 * then its few significant digits. Every non-zero cell takes the empty
 * cells after it as one compressed dive, so a point 2^-10^7 from a corner
 * needs a few frames, not 312,500.
 */
function descend(space: FrameSpace, f: Frame, x: D.Dyadic, y: D.Dyadic, steps: number): { f: Frame; x: D.Dyadic; y: D.Dyadic } {
  // Nearest integer, ties toward +∞ (as roundTo), without adding 1/2 (see D.roundShift).
  const nearest = (v: D.Dyadic): bigint => (v.e >= 0 ? D.floorDivPow2(v, 0) : D.roundShift(v.m, -v.e));
  const ix = nearest(x);
  const iy = nearest(y);
  const fx = ix === 0n ? x : D.sub(x, D.fromBigInt(ix)); // in [−1/2, 1/2)
  const fy = iy === 0n ? y : D.sub(y, D.fromBigInt(iy));
  // Digit chunks after the first cell; beyond the point's lowest bit they are all zero.
  const bitsBelow = (v: D.Dyadic): number => (v.m === 0n ? 0 : Math.ceil(-v.e / K));
  const rest = Math.min(steps - 1, Math.max(bitsBelow(fx), bitsBelow(fy)));
  // F = round(f·2^(K·rest)): the digits as one integer (exact when the digits cover every bit).
  const F = (v: D.Dyadic): bigint => nearest(D.shift(v, K * rest));
  const FX = F(fx);
  const FY = F(fy);
  // Balanced base-2^K digits of F, low digit first, from one hex string: add the bias
  // 2^(K−1) to every digit, read unsigned digits, subtract the bias.
  const hexDigits = K / 4;
  const digits = (v: bigint): bigint[] => {
    if (v === 0n) return [];
    const a = v < 0n ? -v : v;
    const count = Math.min(rest, Math.ceil((D.bitLength(a) + 1) / K) + 1);
    const bias = BigInt("0x" + "8".padEnd(hexDigits, "0").repeat(count));
    const hex = (v + bias).toString(16).padStart(count * hexDigits, "0");
    const out: bigint[] = [];
    for (let j = 0; j < count; j++) out.push(BigInt("0x" + hex.slice(hex.length - (j + 1) * hexDigits, hex.length - j * hexDigits)) - (1n << BigInt(K - 1)));
    return out;
  };
  const dx = digits(FX);
  const dy = digits(FY);
  // Chunk k (1..rest, coarse to fine) is digit rest − k.
  const at = (d: bigint[], k: number): bigint => d[rest - k] ?? 0n;
  const cell = (k: number): [bigint, bigint] => (k === 0 ? [ix, iy] : [at(dx, k), at(dy, k)]);
  // Remainder below the last cell, in the final frame's units: [−2^(K−1), 2^(K−1)). Zero when the digits ran out first.
  const full = rest === steps - 1;
  const rx = full ? D.sub(D.shift(fx, K * steps), D.fromBigInt(FX << BigInt(K))) : D.ZERO;
  const ry = full ? D.sub(D.shift(fy, K * steps), D.fromBigInt(FY << BigInt(K))) : D.ZERO;
  const starts = new Set<number>([0]);
  for (const d of [dx, dy]) d.forEach((v, j) => v !== 0n && rest - j >= 1 && starts.add(rest - j));
  const ks = [...starts].sort((a, b) => a - b);
  let g = f;
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]!;
    const [a, b] = cell(k);
    g = space.child(g, BigInt((ks[i + 1] ?? steps) - k), D.fromBigInt(a), D.fromBigInt(b));
  }
  return { f: g, x: rx, y: ry };
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
 * For drawing only: terms below 2^-bits of `f`'s unit are dropped (by
 * default DRAW_BITS: far below 10^-6 px at any zoom the frame allows).
 * Exact work uses expressExactIn.
 */
export function expressIn(space: FrameSpace, g: Frame, p: WorldPoint, f: Frame, bits = DRAW_BITS): WorldPoint | null {
  const w = walk(space, g, p, f, FAR_LOG2, bits);
  return w && { x: sumTerms(w.x), y: sumTerms(w.y) };
}

/** A point of frame `g` in frame `f`'s units at any distance, to a relative error below 2^(1−GAP): for read-outs. */
export function approxIn(space: FrameSpace, g: Frame, p: WorldPoint, f: Frame): WorldPoint {
  // Nothing is dropped: the read-out needs relative, not absolute, precision (a point 2^-10^7 from the origin is not 0).
  const w = walk(space, g, p, f, Infinity, Infinity)!;
  return { x: w.x[0] ?? D.ZERO, y: w.y[0] ?? D.ZERO };
}

function walk(_space: FrameSpace, g: Frame, p: WorldPoint, f: Frame, far: number, bits: number): { x: Terms; y: Terms } | null {
  const { up, down } = route(g, f);
  let x: Terms = addTerm(p.x, []);
  let y: Terms = addTerm(p.y, []);
  for (const a of up) {
    const q = -(bits + levelsBetween(a.parent!, f));
    x = addTerm(a.ox, shiftTerms(x, -K * Number(a.n), q));
    y = addTerm(a.oy, shiftTerms(y, -K * Number(a.n), q));
  }
  for (const d of down) {
    const q = -(bits + levelsBetween(d, f));
    x = shiftTerms(addTerm(D.neg(d.ox), x), K * Number(d.n), q);
    y = shiftTerms(addTerm(D.neg(d.oy), y), K * Number(d.n), q);
    if (leadLog2(x) > far + 1 || leadLog2(y) > far + 1) return null;
  }
  return { x, y };
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
  // In the common ancestor A's units the point is a sum of offsets at falling scales (2):
  // up from g, + o·2^(−K·levels above), and down to f, − o·2^(−K·levels above). Summed
  // one by one this is quadratic in the depth (every addition copies the growing number);
  // a balanced sum is O(bits · log steps).
  const { up, down: path } = route(g, f);
  const xs: D.Dyadic[] = [];
  const ys: D.Dyadic[] = [];
  let depth = 0; // K-steps below A so far
  for (let i = up.length - 1; i >= 0; i--) {
    const u = up[i]!;
    xs.push(D.shift(u.ox, -K * depth));
    ys.push(D.shift(u.oy, -K * depth));
    depth += Number(u.n);
  }
  xs.push(D.shift(p.x, -K * depth));
  ys.push(D.shift(p.y, -K * depth));
  let down = 0;
  for (const d of path) {
    xs.push(D.neg(D.shift(d.ox, -K * down)));
    ys.push(D.neg(D.shift(d.oy, -K * down)));
    down += Number(d.n);
  }
  return { x: D.shift(balancedSum(xs), K * down), y: D.shift(balancedSum(ys), K * down) };
}

/**
 * The frames between `g` and `f` through their nearest common ancestor A:
 * `up` from g to below A (bottom-up), `down` from below A to f (top-down).
 * Read only; the cost is the distance between them, not their depth.
 */
function route(g: Frame, f: Frame): { up: Frame[]; down: Frame[] } {
  const up: Frame[] = [];
  const down: Frame[] = [];
  let a = g;
  let b = f;
  while (a !== b) {
    if (a.level >= b.level) {
      up.push(a);
      a = a.parent!;
    } else {
      down.push(b);
      b = b.parent!;
    }
  }
  return { up, down: down.reverse() };
}

/**
 * Exact sum, adding neighbours pairwise: O(total bits · log n) instead of
 * quadratic, as long as neighbours have similar scales (callers pass runs
 * ordered coarse to fine).
 */
function balancedSum(ts: D.Dyadic[]): D.Dyadic {
  let a = ts;
  if (!a.length) return D.ZERO;
  while (a.length > 1) {
    const b: D.Dyadic[] = [];
    for (let i = 0; i < a.length; i += 2) b.push(i + 1 < a.length ? D.add(a[i]!, a[i + 1]!) : a[i]!);
    a = b;
  }
  return a[0]!;
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
      const steps = Math.ceil((-H - s) / K);
      ({ f, x, y } = descend(space, f, x, y, steps));
      unit += K * steps;
    } else {
      return { f, anchor: { x, y }, unit };
    }
  }
}

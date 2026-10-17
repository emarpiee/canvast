import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import { cosSin, normAngle } from "../core/angle";
import type { CanvasObject } from "./model";
import { localBounds, pivotOf } from "./model";
import { scaleSubs } from "./path";

/**
 * Pure geometric edits. Each returns a new object; the document applies them
 * through transactions. Translation is exact. Scaling is exact for the anchor
 * and rounds local geometry once (to double precision) per edit; undo restores
 * the stored previous object, so no rounding ever accumulates through undo.
 */

export function translate(o: CanvasObject, dx: D.Dyadic, dy: D.Dyadic): CanvasObject {
  return { ...o, anchor: { x: D.add(o.anchor.x, dx), y: D.add(o.anchor.y, dy) } };
}

/** Bits kept below the local unit when an anchor is scaled. */
const ANCHOR_GUARD_BITS = 96;

function scaleCoord(a: D.Dyadic, f: D.Dyadic, k: D.Dyadic, unit: number): D.Dyadic {
  // a' = f + (a - f) * k, rounded far below one local unit.
  return D.roundTo(D.add(f, D.mul(D.sub(a, f), k)), unit - ANCHOR_GUARD_BITS);
}

/**
 * Scale about a fixed world point by (kx, ky). Strokes and text require
 * kx === ky (they scale uniformly, including stroke width and font size); a path
 * may be stretched (its outline width follows the geometric mean of the two).
 * `keepWidth` (thickness lock): a stroke's shape scales but its line width does not.
 */
export function scaleAbout(o: CanvasObject, fixed: WorldPoint, kx: number, ky: number, keepWidth = false): CanvasObject {
  if (!(kx > 0 && ky > 0 && Number.isFinite(kx) && Number.isFinite(ky))) throw new RangeError(`bad scale ${kx},${ky}`);
  const anchor = {
    x: scaleCoord(o.anchor.x, fixed.x, D.fromNumber(kx), o.unit),
    y: scaleCoord(o.anchor.y, fixed.y, D.fromNumber(ky), o.unit),
  };
  if (o.kind === "stroke") {
    if (kx !== ky) throw new RangeError("strokes scale uniformly");
    return normalizeUnit({ ...o, anchor, points: o.points.map((v) => v * kx), width: keepWidth ? o.width : o.width * kx });
  }
  if (o.kind === "text") {
    if (kx !== ky) throw new RangeError("text scales uniformly");
    return normalizeUnit({ ...o, anchor, w: o.w * kx, size: o.size * kx });
  }
  if (o.kind === "path") {
    if (o.rot && kx !== ky) throw new RangeError("a turned path scales uniformly");
    return normalizeUnit({ ...o, anchor, sub: scaleSubs(o.sub, kx, ky), width: keepWidth ? o.width : o.width * Math.sqrt(kx * ky) });
  }
  return normalizeUnit({ ...o, anchor, w: o.w * kx, h: o.h * ky });
}

/**
 * Rotate an object by `delta` (whole 2^-32 turns) about a world point (ADR 0018).
 * The object keeps its own geometry and gains `rot`, so rotating by an angle
 * and then by its opposite returns exactly the same object. The object turns
 * about the centre of its bounds; when `about` is elsewhere it also
 * moves around it (that move is rounded once, like a scale).
 */
export function rotateAbout(o: CanvasObject, about: WorldPoint, delta: number): CanvasObject {
  delta = Math.round(delta); // an angle is a whole number of 2^-32 turns
  const rot = normAngle((o.rot ?? 0) + delta);
  const { c, s } = cosSin(delta);
  const pv = pivotOf(o);
  // The pivot relative to `about`, in local units.
  const vx = D.toNumber(D.shift(D.sub(D.add(o.anchor.x, D.shift(D.fromNumber(pv.x), o.unit)), about.x), -o.unit));
  const vy = D.toNumber(D.shift(D.sub(D.add(o.anchor.y, D.shift(D.fromNumber(pv.y), o.unit)), about.y), -o.unit));
  const dx = c * vx - s * vy - vx;
  const dy = s * vx + c * vy - vy;
  const { rot: _old, ...rest } = o;
  const moved = dx === 0 && dy === 0 ? o.anchor : { x: D.add(o.anchor.x, D.shift(D.fromNumber(dx), o.unit)), y: D.add(o.anchor.y, D.shift(D.fromNumber(dy), o.unit)) };
  return { ...rest, anchor: moved, ...(rot ? { rot } : {}) };
}

/**
 * Move `objects` to the front or back of the paint order, keeping their order
 * among themselves. `others` is the rest of the document in paint order.
 */
export function restack(objects: readonly CanvasObject[], others: readonly CanvasObject[], to: "front" | "back"): CanvasObject[] {
  const own = [...objects].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
  const rest = others.filter((o) => !objects.includes(o));
  if (to === "front") {
    const top = rest.length ? rest[rest.length - 1]!.z : 0;
    return own.map((o, i) => ({ ...o, z: top + 1 + i }));
  }
  const bottom = rest.length ? rest[0]!.z : 0;
  return own.map((o, i) => ({ ...o, z: bottom - own.length + i }));
}

/**
 * Put `moving` (any order) just in front of the object `above` in the paint
 * order, keeping their order among themselves. `all` is the whole document in
 * paint order. Their new z values sit in the gap between `above` and the next
 * object in front of it, so no other object changes; if the gap is too small
 * for the numbers to stay distinct, the whole document is renumbered.
 */
export function placeAbove(all: readonly CanvasObject[], moving: readonly CanvasObject[], above: CanvasObject): CanvasObject[] {
  const ids = new Set(moving.map((o) => o.id));
  const rest = all.filter((o) => !ids.has(o.id));
  const own = [...moving].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
  const at = rest.findIndex((o) => o.id === above.id);
  if (at < 0) return [];
  const lo = rest[at]!.z;
  const hi = at + 1 < rest.length ? rest[at + 1]!.z : lo + own.length + 1;
  const step = (hi - lo) / (own.length + 1);
  const placed = own.map((o, i) => ({ ...o, z: lo + step * (i + 1) }));
  const distinct = step > Math.abs(lo) * 2 ** -40 && placed.every((o, i) => i === 0 || o.z > placed[i - 1]!.z) && placed[0]!.z > lo;
  if (distinct) return placed;
  // Renumber everything in the new order.
  const order = [...rest.slice(0, at + 1), ...own, ...rest.slice(at + 1)];
  return order.map((o, i) => ({ ...o, z: i })).filter((o, i) => o.z !== order[i]!.z || ids.has(o.id));
}

const MIN_EXTENT_LOG2 = 0;
const MAX_EXTENT_LOG2 = 16;
const TARGET_EXTENT_LOG2 = 8;

/**
 * Re-express local geometry in a different power-of-two unit so its magnitude
 * stays in [2^0, 2^16]. Exact: multiplying doubles by a power of two is exact
 * away from overflow/underflow, which this range keeps clear of.
 */
export function normalizeUnit(o: CanvasObject): CanvasObject {
  const b = localBounds(o);
  const extent = Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minY), Math.abs(b.maxY), b.maxX - b.minX, b.maxY - b.minY);
  if (!(extent > 0)) return o;
  const e = Math.log2(extent);
  if (e >= MIN_EXTENT_LOG2 && e <= MAX_EXTENT_LOG2) return o;
  const n = Math.round(e) - TARGET_EXTENT_LOG2;
  const s = 2 ** -n;
  const unit = o.unit + n;
  if (o.kind === "stroke") return { ...o, unit, points: o.points.map((v) => v * s), width: o.width * s };
  if (o.kind === "text") return { ...o, unit, w: o.w * s, size: o.size * s };
  if (o.kind === "path") return { ...o, unit, sub: scaleSubs(o.sub, s, s), width: o.width * s };
  return { ...o, unit, w: o.w * s, h: o.h * s };
}

/** World position of a local point (exact). */
export function localToWorld(o: CanvasObject, lx: number, ly: number): WorldPoint {
  return {
    x: D.add(o.anchor.x, D.shift(D.fromNumber(lx), o.unit)),
    y: D.add(o.anchor.y, D.shift(D.fromNumber(ly), o.unit)),
  };
}

/** Exact world-space bounding box of an object. */
export function worldBounds(o: CanvasObject): { min: WorldPoint; max: WorldPoint } {
  const b = localBounds(o);
  return { min: localToWorld(o, b.minX, b.minY), max: localToWorld(o, b.maxX, b.maxY) };
}

/** Exact union of the world bounding boxes of `objects` (null when empty). */
export function unionBounds(objects: Iterable<CanvasObject>): { min: WorldPoint; max: WorldPoint } | null {
  let r: { min: { x: D.Dyadic; y: D.Dyadic }; max: { x: D.Dyadic; y: D.Dyadic } } | null = null;
  for (const o of objects) {
    const b = worldBounds(o);
    if (!r) {
      r = { min: { ...b.min }, max: { ...b.max } };
      continue;
    }
    if (D.cmp(b.min.x, r.min.x) < 0) r.min.x = b.min.x;
    if (D.cmp(b.min.y, r.min.y) < 0) r.min.y = b.min.y;
    if (D.cmp(b.max.x, r.max.x) > 0) r.max.x = b.max.x;
    if (D.cmp(b.max.y, r.max.y) > 0) r.max.y = b.max.y;
  }
  return r;
}

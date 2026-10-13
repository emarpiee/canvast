import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { CanvasObject } from "./model";
import { localBounds } from "./model";

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
 * Scale about a fixed world point by (kx, ky). Strokes require kx === ky
 * (vector strokes scale uniformly, including width).
 */
export function scaleAbout(o: CanvasObject, fixed: WorldPoint, kx: number, ky: number): CanvasObject {
  if (!(kx > 0 && ky > 0 && Number.isFinite(kx) && Number.isFinite(ky))) throw new RangeError(`bad scale ${kx},${ky}`);
  const anchor = {
    x: scaleCoord(o.anchor.x, fixed.x, D.fromNumber(kx), o.unit),
    y: scaleCoord(o.anchor.y, fixed.y, D.fromNumber(ky), o.unit),
  };
  if (o.kind === "stroke") {
    if (kx !== ky) throw new RangeError("strokes scale uniformly");
    return normalizeUnit({ ...o, anchor, points: o.points.map((v) => v * kx), width: o.width * kx });
  }
  return normalizeUnit({ ...o, anchor, w: o.w * kx, h: o.h * ky });
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
  return { ...o, unit, w: o.w * s, h: o.h * s };
}

/** World position of a local point (exact). */
export function localToWorld(o: CanvasObject, lx: number, ly: number): WorldPoint {
  return {
    x: D.add(o.anchor.x, D.shift(D.fromNumber(lx), o.unit)),
    y: D.add(o.anchor.y, D.shift(D.fromNumber(ly), o.unit)),
  };
}

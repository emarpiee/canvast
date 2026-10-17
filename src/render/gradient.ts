import * as D from "../core/dyadic";
import { cosSin } from "../core/angle";
import type { Viewport } from "../core/camera";
import type { PathObject } from "../doc/model";
import { pathStyle } from "../doc/model";
import type { Gradient, Paint } from "../doc/paint";
import { hexOf, isGradient, sliceStops, stopsAt } from "../doc/paint";
import { geometryBounds, paintBounds } from "../doc/path";
import { paintColor } from "./ink";
import type { Projection } from "./projection";

/**
 * Gradients on paths (ADR 0100). A gradient is placed on the geometry box of the shape in box units (doc/paint.ts); here it becomes
 * numbers in the path's local units (turned with the path, as `pathSubs` turns its nodes), and from those a canvas gradient.
 *
 * The canvas gets only the part the view can show. A gradient may be a million times bigger than the view, or astronomically far
 * from it, and a rasterizer keeps gradient coordinates in single precision; so the gradient is re-expressed over the view: a
 * linear one runs along its axis across the view's own span, a radial one is rings round its centre while that centre is near the
 * view, and a linear gradient along the direction to it when it is far (the rings are straight to within a fraction of the colour
 * change they carry). Its stops are cut to the part of 0..1 that is visible, so the colours at the ends are exact. Deeper than the
 * view can resolve, the span of offsets is nothing and the gradient is the colour at the centre of the view.
 */
export type LocalGradient =
  | { readonly type: "linear"; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
  | { readonly type: "radial"; readonly cx: number; readonly cy: number; readonly R: number };

/** The turn of a path (about the centre of its unturned paint bounds, as `pathSubs`) and its inverse, in local units. */
export function turner(o: PathObject): { turn(x: number, y: number): [number, number]; unturn(x: number, y: number): [number, number] } {
  if (!o.rot) return { turn: (x, y) => [x, y], unturn: (x, y) => [x, y] };
  const b = paintBounds(o.sub, pathStyle(o));
  const px = (b.minX + b.maxX) / 2;
  const py = (b.minY + b.maxY) / 2;
  const { c, s } = cosSin(o.rot);
  return {
    turn: (x, y) => [px + c * (x - px) - s * (y - py), py + s * (x - px) + c * (y - py)],
    unturn: (x, y) => [px + c * (x - px) + s * (y - py), py - s * (x - px) + c * (y - py)],
  };
}

/** A point in box units of the shape's geometry box, as a local point (turned with the path). */
export function boxToLocal(o: PathObject, u: number, v: number): [number, number] {
  const b = geometryBounds(o.sub);
  return turner(o).turn(b.minX + u * (b.maxX - b.minX), b.minY + v * (b.maxY - b.minY));
}

/** A local point (turned) as box units: the inverse of `boxToLocal` (a box with no width or no height maps to 0 on that axis). */
export function localToBox(o: PathObject, x: number, y: number): [number, number] {
  const b = geometryBounds(o.sub);
  const [ux, uy] = turner(o).unturn(x, y);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  return [w > 0 ? (ux - b.minX) / w : 0, h > 0 ? (uy - b.minY) / h : 0];
}

export function localGradient(o: PathObject, g: Gradient): LocalGradient {
  if (g.type === "linear") {
    const [x0, y0] = boxToLocal(o, g.x0, g.y0);
    const [x1, y1] = boxToLocal(o, g.x1, g.y1);
    return { type: "linear", x0, y0, x1, y1 };
  }
  const b = geometryBounds(o.sub);
  const [cx, cy] = boxToLocal(o, g.cx, g.cy);
  return { type: "radial", cx, cy, R: g.r * Math.max(b.maxX - b.minX, b.maxY - b.minY) };
}

/** The offset along the gradient of a local point. */
export function offsetAt(l: LocalGradient, x: number, y: number): number {
  if (l.type === "radial") return l.R > 0 ? Math.hypot(x - l.cx, y - l.cy) / l.R : 0;
  const ax = l.x1 - l.x0;
  const ay = l.y1 - l.y0;
  const len2 = ax * ax + ay * ay;
  return len2 > 0 ? ((x - l.x0) * ax + (y - l.y0) * ay) / len2 : 0;
}

/** The colour a paint has at a local point (a solid colour is itself). */
export function paintAt(o: PathObject, paint: Paint, x: number, y: number): string {
  return isGradient(paint) ? hexOf(stopsAt(paint.stops, offsetAt(localGradient(o, paint), x, y))) : paint;
}

/** What to set as `fillStyle` or `strokeStyle` for a paint, in the view described by `p` and `vp` (see the head of this file). */
export function canvasPaint(ctx: CanvasRenderingContext2D, o: PathObject, paint: Paint, p: Projection, vp: Viewport): string | CanvasGradient {
  if (!isGradient(paint)) return paintColor(paint); // (the default ink follows the theme)
  const l = localGradient(o, paint);
  const cx = D.toNumber(p.lx);
  const cy = D.toNumber(p.ly);
  const hvPx = Math.hypot(vp.width, vp.height) / 2 + 8; // the view's half diagonal
  const ppu = Number.isFinite(p.ppu) && p.ppu > 0 ? p.ppu : Infinity;
  const hv = Number.isFinite(ppu) ? hvPx / ppu : 0; // in local units; nothing deeper than doubles can tell
  const sx = vp.width / 2;
  const sy = vp.height / 2;
  const make = (g: CanvasGradient, stops: ReturnType<typeof sliceStops>): CanvasGradient => {
    for (const s of stops) g.addColorStop(s.o, s.c);
    return g;
  };
  // Linear along a direction (ux, uy), where the view centre is at offset `t` and the view spans ±dt.
  const along = (ux: number, uy: number, t: number, dt: number): CanvasGradient =>
    make(ctx.createLinearGradient(sx - hvPx * ux, sy - hvPx * uy, sx + hvPx * ux, sy + hvPx * uy), sliceStops(paint.stops, t - dt, t + dt));
  if (l.type === "linear") {
    const ax = l.x1 - l.x0;
    const ay = l.y1 - l.y0;
    const len = Math.hypot(ax, ay);
    if (!(len > 0)) return hexOf(stopsAt(paint.stops, 0));
    return along(ax / len, ay / len, offsetAt(l, cx, cy), hv / len);
  }
  const d = Math.hypot(cx - l.cx, cy - l.cy);
  if (Number.isFinite(ppu) && d <= 20 * hv) {
    // The centre is near the view: true rings, their radii in px of the distance (bounded by the view, whatever the gradient's size).
    const t0 = Math.max(0, (d - hv) / l.R);
    const t1 = (d + hv) / l.R;
    const gx = sx + (l.cx - cx) * ppu;
    const gy = sy + (l.cy - cy) * ppu;
    return make(ctx.createRadialGradient(gx, gy, Math.max(0, d - hv) * ppu, gx, gy, (d + hv) * ppu), sliceStops(paint.stops, t0, t1));
  }
  // Far from the view: the rings are straight across it.
  const ux = d > 0 ? (cx - l.cx) / d : 1;
  const uy = d > 0 ? (cy - l.cy) / d : 0;
  return along(ux, uy, l.R > 0 ? d / l.R : 0, l.R > 0 ? hv / l.R : 0);
}

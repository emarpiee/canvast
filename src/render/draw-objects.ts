import type { Viewport } from "../core/camera";
import type { CanvasObject, ImageObject, StrokeObject } from "../doc/model";
import type { ProjectedObject } from "./projection";
import { fromPx, toPx } from "./projection";
import * as D from "../core/dyadic";
import type { Rect } from "./geometry2d";
import { clipSegment } from "./geometry2d";
import { exactStrokeCoverage } from "./stroke-coverage";

/**
 * Canvas 2D drawing of projected objects.
 *
 * Two invariants keep deep zoom, opacity and (future) blend modes correct:
 *
 * 1. **Bounded canvas coordinates.** Canvas rasterizers commonly use single
 *    precision internally, so nothing is handed to the canvas more than a few
 *    thousand px outside the viewport. Geometry is clipped in double precision
 *    first, or computed exactly (stroke-coverage.ts) when doubles are not
 *    enough.
 * 2. **One paint per object.** Each object's coverage is built as a single
 *    path (or a single image draw / a set of non-overlapping device-aligned
 *    rectangles) and painted once with the object's opacity. Overlapping
 *    pieces of the same object never composite twice (no double-darkening),
 *    and pieces never cancel each other (no holes showing what is behind).
 */

/** Thinnest line drawn for strokes that have shrunk below a pixel. */
const MIN_VISIBLE_WIDTH = 0.6;

export interface RasterSource {
  readonly source: CanvasImageSource;
  readonly pixelW: number;
  readonly pixelH: number;
  /** Colours of an integer pixel window, for magnified drawing. */
  readPixels(x: number, y: number, w: number, h: number): Uint8ClampedArray;
}

function viewRect(vp: Viewport, margin: number): Rect {
  return { minX: -margin, minY: -margin, maxX: vp.width + margin, maxY: vp.height + margin };
}

/** Apply per-object paint state (opacity today; blend mode is the next field here). */
function paint(ctx: CanvasRenderingContext2D, o: CanvasObject, body: () => void): void {
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * o.opacity;
  try {
    body();
  } finally {
    ctx.globalAlpha = prevAlpha;
  }
}

export function drawStroke(ctx: CanvasRenderingContext2D, po: ProjectedObject, vp: Viewport, color?: string): void {
  const o = po.obj as StrokeObject;
  paint(ctx, o, () => {
    ctx.strokeStyle = ctx.fillStyle = color ?? o.color;
    if (po.exact) fillPolygons(ctx, exactStrokeCoverage(po, vp));
    else strokeClipped(ctx, po, vp);
  });
}

/**
 * Double-precision path: one `stroke()` of the polyline with round caps and
 * joins (the canvas strokes the union once). Segments are pre-clipped to the
 * viewport grown by the radius, so canvas coordinates stay within
 * ±(viewport + 2^14) px; breaks only happen outside the visible area.
 */
function strokeClipped(ctx: CanvasRenderingContext2D, po: ProjectedObject, vp: Viewport): void {
  const q = po.q;
  const r = po.radius;
  ctx.lineWidth = Math.max(2 * r, MIN_VISIBLE_WIDTH);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (q.length === 2) {
    ctx.moveTo(q[0]!, q[1]!);
    ctx.lineTo(q[0]! + 1e-3, q[1]!);
    ctx.stroke();
    return;
  }
  const view = viewRect(vp, r + 2);
  let penX = NaN;
  let penY = NaN;
  for (let i = 0; i + 3 < q.length; i += 2) {
    const c = clipSegment(q[i]!, q[i + 1]!, q[i + 2]!, q[i + 3]!, view);
    if (!c) continue;
    if (c[0] !== penX || c[1] !== penY) ctx.moveTo(c[0], c[1]);
    ctx.lineTo(c[2], c[3]);
    penX = c[2];
    penY = c[3];
  }
  ctx.stroke();
}

function fillPolygons(ctx: CanvasRenderingContext2D, polys: number[][]): void {
  if (!polys.length) return;
  ctx.beginPath();
  for (const p of polys) {
    ctx.moveTo(p[0]!, p[1]!);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
    ctx.closePath();
  }
  ctx.fill("nonzero");
}

/** Above this many CSS px per source pixel, pixels are drawn as exact rectangles. */
const PIXEL_RECT_THRESHOLD = 64;

export function drawImageObject(
  ctx: CanvasRenderingContext2D,
  po: ProjectedObject,
  vp: Viewport,
  dpr: number,
  src: RasterSource | null,
  placeholder: string,
): void {
  const o = po.obj as ImageObject;
  const [l, t, r, b] = po.q as unknown as [number, number, number, number];
  const view = viewRect(vp, 1);
  const cl = Math.max(l, view.minX);
  const ct = Math.max(t, view.minY);
  const cr = Math.min(r, view.maxX);
  const cb = Math.min(b, view.maxY);
  if (cr <= cl || cb <= ct) return;
  paint(ctx, o, () => {
    if (!src) {
      ctx.fillStyle = placeholder;
      ctx.fillRect(cl, ct, cr - cl, cb - ct);
      return;
    }
    // Visible source window from the local coordinates of the clipped screen
    // rectangle (unprojecting avoids cancellation against a far-away corner).
    const p = po.proj;
    const localX = (sx: number): number => p.lxHi + ((sx - p.cx) / p.ppu + p.lxLo);
    const localY = (sy: number): number => p.lyHi + ((sy - p.cy) / p.ppu + p.lyLo);
    const pxPerSrc = (p.ppu * o.w) / o.pixelW;
    if (pxPerSrc <= PIXEL_RECT_THRESHOLD) {
      // Magnified pixels stay crisp (no invented detail); minified images smooth.
      ctx.imageSmoothingEnabled = pxPerSrc < 2;
      ctx.imageSmoothingQuality = "high";
      const sx0 = (localX(cl) * o.pixelW) / o.w;
      const sy0 = (localY(ct) * o.pixelH) / o.h;
      const sx1 = (localX(cr) * o.pixelW) / o.w;
      const sy1 = (localY(cb) * o.pixelH) / o.h;
      ctx.drawImage(src.source, sx0, sy0, sx1 - sx0, sy1 - sy0, cl, ct, cr - cl, cb - ct);
      return;
    }
    // Each source pixel covers many screen pixels: draw the few visible ones as
    // rectangles whose edges are projected exactly (any magnification) and
    // snapped to device pixels, so neighbours share edges exactly (no seams
    // showing what is behind, no double coverage under opacity).
    const exactLocalX = (sx: number): number => D.toNumber(D.add(p.lx, fromPx(p, sx - p.cx)));
    const exactLocalY = (sy: number): number => D.toNumber(D.add(p.ly, fromPx(p, sy - p.cy)));
    // ±1 pixel of slack: the window only bounds the loop; edges are clamped below.
    const x0 = Math.max(0, Math.floor((exactLocalX(cl) * o.pixelW) / o.w) - 1);
    const y0 = Math.max(0, Math.floor((exactLocalY(ct) * o.pixelH) / o.h) - 1);
    const x1 = Math.min(o.pixelW, Math.ceil((exactLocalX(cr) * o.pixelW) / o.w) + 1);
    const y1 = Math.min(o.pixelH, Math.ceil((exactLocalY(cb) * o.pixelH) / o.h) + 1);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const data = src.readPixels(x0, y0, w, h);
    const snap = (v: number): number => Math.round(v * dpr) / dpr;
    // Pixel edge i lies at the rational local x = i·w/pixelW. Project it as
    // (i·w − L·pixelW)·2^e·f / pixelW: the numerator is exact, so interior
    // edges stay exact at any magnification.
    const W = D.fromNumber(o.w);
    const H = D.fromNumber(o.h);
    const PW = D.fromNumber(o.pixelW);
    const PH = D.fromNumber(o.pixelH);
    const edgeX = (i: number): number =>
      snap(Math.min(cr, Math.max(cl, p.cx + toPx(p, D.sub(D.mul(D.fromNumber(i), W), D.mul(p.lx, PW))) / o.pixelW)));
    const edgeY = (j: number): number =>
      snap(Math.min(cb, Math.max(ct, p.cy + toPx(p, D.sub(D.mul(D.fromNumber(j), H), D.mul(p.ly, PH))) / o.pixelH)));
    for (let j = 0; j < h; j++) {
      const top = edgeY(y0 + j);
      const bottom = edgeY(y0 + j + 1);
      if (bottom <= top) continue;
      for (let i = 0; i < w; i++) {
        const left = edgeX(x0 + i);
        const right = edgeX(x0 + i + 1);
        if (right <= left) continue;
        const k = (j * w + i) * 4;
        const a = data[k + 3]!;
        if (a === 0) continue;
        ctx.fillStyle = `rgba(${data[k]},${data[k + 1]},${data[k + 2]},${a / 255})`;
        ctx.fillRect(left, top, right - left, bottom - top);
      }
    }
  });
}

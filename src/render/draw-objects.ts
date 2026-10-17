import type { Viewport } from "../core/camera";
import type { CanvasObject, ImageObject, PathObject, StrokeObject } from "../doc/model";
import { alignOf } from "../doc/model";
import type { ProjectedObject } from "./projection";
import { fromPx, toPx } from "./projection";
import * as D from "../core/dyadic";
import type { Rect } from "./geometry2d";
import { clipPolygon, clipSegment } from "./geometry2d";
import { MITER_LIMIT } from "../doc/path";
import { canvasPaint } from "./gradient";
import { exactStrokeCoverage } from "./stroke-coverage";
import { paintColor } from "./ink";
import { adjustPixel, cropOf, isNeutral } from "../doc/adjust";
import { playingFilter } from "./adjust-filter";
import { adjustedSource } from "./adjust-image";

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
  /** Source pixels per full-size pixel: 1 for the original, less for a reduced copy used while the image is drawn small. */
  readonly scale?: number;
  /** Colours of an integer pixel window, for magnified drawing. */
  readPixels(x: number, y: number, w: number, h: number): Uint8ClampedArray;
}

function viewRect(vp: Viewport, margin: number): Rect {
  return { minX: -margin, minY: -margin, maxX: vp.width + margin, maxY: vp.height + margin };
}

/** Apply per-object paint state: opacity and blend mode (ADR 0047). */
export function paint(ctx: CanvasRenderingContext2D, o: CanvasObject, body: () => void): void {
  const prevAlpha = ctx.globalAlpha;
  const prevOp = ctx.globalCompositeOperation;
  ctx.globalAlpha = prevAlpha * o.opacity;
  if (o.blend) ctx.globalCompositeOperation = o.blend;
  try {
    body();
  } finally {
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevOp;
  }
}

export function drawStroke(ctx: CanvasRenderingContext2D, po: ProjectedObject, vp: Viewport, color?: string): void {
  const o = po.obj as StrokeObject;
  paint(ctx, o, () => {
    ctx.strokeStyle = ctx.fillStyle = paintColor(color ?? o.color);
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
  ctx.lineWidth = strokeLineWidth(po);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  addStrokePath(ctx, po, vp);
  ctx.stroke();
}

export function strokeLineWidth(po: ProjectedObject): number {
  return Math.max(2 * po.radius, MIN_VISIBLE_WIDTH);
}

/** True when a stroke can share one `stroke()` call with neighbours of the same paint. */
export function batchable(po: ProjectedObject): boolean {
  return po.obj.kind === "stroke" && !po.exact && !po.cover && po.obj.opacity === 1 && !po.obj.blend && !po.clip;
}

/**
 * Stroke consecutive (in paint order) opaque, same-colour, same-width
 * fast-path strokes with one `stroke()` call. For opaque paint of a single
 * colour, painting the union once gives the same pixels as painting each
 * object in turn, so this is a pure optimization; translucent or exact-path
 * objects are never batched (they keep one paint per object).
 */
export function strokeBatch(ctx: CanvasRenderingContext2D, items: readonly ProjectedObject[], lineWidth: number, vp: Viewport): void {
  const o = items[0]!.obj as StrokeObject;
  ctx.strokeStyle = paintColor(o.color);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const po of items) addStrokePath(ctx, po, vp);
  ctx.stroke();
}

/** Append a fast-path stroke's (pre-clipped) polyline to the current path. */
function addStrokePath(ctx: CanvasRenderingContext2D, po: ProjectedObject, vp: Viewport): void {
  const q = po.q;
  const r = po.radius;
  if (q.length === 2) {
    ctx.moveTo(q[0]!, q[1]!);
    ctx.lineTo(q[0]! + 1e-3, q[1]!);
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
}

/** Farthest a path's vertex may lie outside the viewport (px) before its outline is clipped: canvas rasterizers lose precision far out. */
const PATH_REACH = 2 ** 13;

const inReach = (pts: Float64Array, vp: Viewport, margin: number): boolean => {
  for (let i = 0; i < pts.length; i += 2) {
    if (!(pts[i]! > -margin && pts[i]! < vp.width + margin && pts[i + 1]! > -margin && pts[i + 1]! < vp.height + margin)) return false;
  }
  return true;
};

/** Add every outline to the current path as a filled polygon (clipped to the view when it reaches far outside it). */
export function addFillPath(ctx: CanvasRenderingContext2D, po: ProjectedObject, vp: Viewport): void {
  for (const f of po.fillPath ?? po.path!) {
    let p: ArrayLike<number> = f.pts;
    if (p.length < 6) continue;
    if (!inReach(f.pts, vp, PATH_REACH)) {
      p = clipPolygon(Array.from(f.pts), viewRect(vp, 64));
      if (p.length < 6) continue;
    }
    ctx.moveTo(p[0]!, p[1]!);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
    ctx.closePath();
  }
}

/** Add every outline to the current path as a line: whole when it stays in reach, else segment by segment, clipped (breaks fall outside the view). */
function addOutlinePath(ctx: CanvasRenderingContext2D, po: ProjectedObject, vp: Viewport): void {
  const view = viewRect(vp, po.radius + 2);
  for (const f of po.path!) {
    const p = f.pts;
    const n = p.length / 2;
    if (n === 1) {
      ctx.moveTo(p[0]!, p[1]!);
      ctx.lineTo(p[0]! + 1e-3, p[1]!);
      continue;
    }
    if (inReach(p, vp, PATH_REACH)) {
      ctx.moveTo(p[0]!, p[1]!);
      for (let i = 1; i < n; i++) ctx.lineTo(p[i * 2]!, p[i * 2 + 1]!);
      if (f.closed) ctx.closePath();
      continue;
    }
    let penX = NaN;
    let penY = NaN;
    for (let i = 0; i < (f.closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      const c = clipSegment(p[i * 2]!, p[i * 2 + 1]!, p[j * 2]!, p[j * 2 + 1]!, view);
      if (!c) continue;
      if (c[0] !== penX || c[1] !== penY) ctx.moveTo(c[0], c[1]);
      ctx.lineTo(c[2], c[3]);
      penX = c[2];
      penY = c[3];
    }
  }
}

/** The dash pattern in screen px for an outline `w` px wide (the pattern is in widths, so it looks the same at any zoom). */
const dashPattern = (d: readonly [number, number], w: number): number[] => [d[0] * w, d[1] * w];

let layer: HTMLCanvasElement | null = null;

/**
 * A vector path: its fill, then its outline, painted once with the object's opacity and blend mode. A path that has both and is
 * see-through (or blended) is drawn on a scratch layer first, so the outline does not show the fill through itself or blend twice.
 */
export function drawPath(ctx: CanvasRenderingContext2D, po: ProjectedObject, vp: Viewport): void {
  const o = po.obj as PathObject;
  const body = (c: CanvasRenderingContext2D): void => {
    if (o.fill !== null) {
      c.fillStyle = canvasPaint(c, o, o.fill, po.proj, vp);
      c.beginPath();
      addFillPath(c, po, vp);
      c.fill(o.evenodd ? "evenodd" : "nonzero");
    }
    if (o.stroke !== null && po.strokePolys) {
      // Too wide for the canvas to stroke: its exact coverage, as polygons.
      c.fillStyle = canvasPaint(c, o, o.stroke, po.proj, vp);
      fillPolygons(c, po.strokePolys as number[][]);
    } else if (o.stroke !== null && alignOf(o)) {
      drawAlignedOutline(c, po, vp, alignOf(o)!);
    } else if (o.stroke !== null) {
      c.strokeStyle = canvasPaint(c, o, o.stroke, po.proj, vp);
      c.lineWidth = Math.max(2 * po.radius, MIN_VISIBLE_WIDTH);
      c.lineJoin = o.join ?? "round";
      c.lineCap = o.dash && o.dash[0] === 0 ? "round" : (o.cap ?? "round"); // (a dot is a dash of no length: only round ends show it)
      c.miterLimit = MITER_LIMIT;
      if (o.dash) c.setLineDash(dashPattern(o.dash, c.lineWidth));
      c.beginPath();
      addOutlinePath(c, po, vp);
      c.stroke();
      if (o.dash) c.setLineDash([]);
    }
  };
  if (!(o.fill !== null && o.stroke !== null && (o.opacity < 1 || o.blend))) return paint(ctx, o, () => body(ctx));
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  layer ??= document.createElement("canvas");
  if (layer.width !== w || layer.height !== h) {
    layer.width = w;
    layer.height = h;
  }
  const lc = layer.getContext("2d")!;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, w, h);
  lc.setTransform(ctx.getTransform());
  body(lc);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paint(ctx, o, () => ctx.drawImage(layer!, 0, 0));
  ctx.restore();
}

let aligned: HTMLCanvasElement | null = null;

/**
 * An outline wholly inside or wholly outside the edge (PathObject.align): a centred line twice as wide, kept where the shape is (inside) or
 * where it is not (outside), so exactly the width asked for is left on that side. It is made apart and put on, so the shape's own fill (and
 * whatever is under it) is not touched by the cut.
 */
function drawAlignedOutline(c: CanvasRenderingContext2D, po: ProjectedObject, vp: Viewport, side: "inside" | "outside"): void {
  const o = po.obj as PathObject;
  const w = c.canvas.width;
  const h = c.canvas.height;
  aligned ??= document.createElement("canvas");
  if (aligned.width !== w || aligned.height !== h) {
    aligned.width = w;
    aligned.height = h;
  }
  const a = aligned.getContext("2d")!;
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, w, h);
  a.setTransform(c.getTransform());
  a.strokeStyle = canvasPaint(a, o, o.stroke!, po.proj, vp);
  a.lineWidth = 2 * Math.max(2 * po.radius, MIN_VISIBLE_WIDTH);
  a.lineJoin = o.join ?? "round";
  a.miterLimit = MITER_LIMIT;
  if (o.dash) a.setLineDash(dashPattern(o.dash, a.lineWidth / 2));
  a.beginPath();
  addOutlinePath(a, po, vp);
  a.stroke();
  a.setLineDash([]);
  a.globalCompositeOperation = side === "inside" ? "destination-in" : "destination-out";
  a.beginPath();
  addFillPath(a, po, vp);
  a.fill(o.evenodd ? "evenodd" : "nonzero");
  a.globalCompositeOperation = "source-over";
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(aligned, 0, 0);
  c.restore();
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

/** Strength of an approximate (dimmed) cover relative to the exact one. */
const DIM_ALPHA = 0.5;

/**
 * A coarse object that covers the view (render/coarse.ts): one colour over
 * all of it, or rectangles each showing one source pixel of an image.
 */

export function drawCover(ctx: CanvasRenderingContext2D, po: ProjectedObject, vp: Viewport, src: RasterSource | null, placeholder: string): void {
  const cover = po.cover!;
  paint(ctx, po.obj, () => {
    if (cover.dim) ctx.globalAlpha *= DIM_ALPHA;
    if (cover.rects) {
      const margin = 1;
      for (const r of cover.rects) {
        const x0 = Math.max(r.x0, -margin);
        const y0 = Math.max(r.y0, -margin);
        const x1 = Math.min(r.x1, vp.width + margin);
        const y1 = Math.min(r.y1, vp.height + margin);
        if (x1 <= x0 || y1 <= y0) continue;
        if (!src) ctx.fillStyle = placeholder;
        else {
          const [cr0, cg0, cb0, ca] = src.readPixels(r.i, r.j, 1, 1) as unknown as [number, number, number, number];
          if (ca === 0) continue;
          const im = po.obj as ImageObject;
          const [cr, cg, cb] = isNeutral(im.adjust) || im.media ? [cr0, cg0, cb0] : adjustPixel(cr0, cg0, cb0, im.adjust!);
          ctx.fillStyle = `rgba(${Math.round(cr)},${Math.round(cg)},${Math.round(cb)},${ca / 255})`;
        }
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      return;
    }
    ctx.fillStyle = cover.color ? paintColor(cover.color) : placeholder;
    ctx.fillRect(-1, -1, vp.width + 2, vp.height + 2);
  });
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
  /** Grow each magnified source pixel by this many px (turned images: edges are not on pixel boundaries, so neighbours would show seams). */
  bleed = 0,
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
    // What the picture shows of its source (a crop is a window of whole source pixels): `cw` x `ch` source pixels over `w` x `h` local units.
    const crop = cropOf(o);
    const pxPerSrc = (p.ppu * o.w) / crop.w;
    if (pxPerSrc <= PIXEL_RECT_THRESHOLD) {
      // Magnified pixels stay crisp (no invented detail); minified images smooth.
      const k = src.scale ?? 1; // a reduced copy has fewer pixels: scale the source window to it
      ctx.imageSmoothingEnabled = pxPerSrc < 2;
      ctx.imageSmoothingQuality = "high";
      const sx0 = k * (crop.x + (localX(cl) * crop.w) / o.w);
      const sy0 = k * (crop.y + (localY(ct) * crop.h) / o.h);
      const sx1 = k * (crop.x + (localX(cr) * crop.w) / o.w);
      const sy1 = k * (crop.y + (localY(cb) * crop.h) / o.h);
      // A video or a GIF is adjusted as its player on the canvas is (an SVG filter, every adjustment); a still, pixel by pixel.
      const filter = o.media ? playingFilter(o.adjust) : "";
      if (filter) ctx.filter = filter;
      ctx.drawImage(isNeutral(o.adjust) || o.media ? src.source : adjustedSource(src, o.adjust!), sx0, sy0, sx1 - sx0, sy1 - sy0, cl, ct, cr - cl, cb - ct);
      if (filter) ctx.filter = "none";
      return;
    }
    // Each source pixel covers many screen pixels: draw the few visible ones as
    // rectangles whose edges are projected exactly (any magnification) and
    // snapped to device pixels, so neighbours share edges exactly (no seams
    // showing what is behind, no double coverage under opacity).
    const exactLocalX = (sx: number): number => D.toNumber(D.add(p.lx, fromPx(p, sx - p.cx)));
    const exactLocalY = (sy: number): number => D.toNumber(D.add(p.ly, fromPx(p, sy - p.cy)));
    // ±1 pixel of slack: the window only bounds the loop; edges are clamped below.
    const x0 = Math.max(0, Math.floor((exactLocalX(cl) * crop.w) / o.w) - 1);
    const y0 = Math.max(0, Math.floor((exactLocalY(ct) * crop.h) / o.h) - 1);
    const x1 = Math.min(crop.w, Math.ceil((exactLocalX(cr) * crop.w) / o.w) + 1);
    const y1 = Math.min(crop.h, Math.ceil((exactLocalY(cb) * crop.h) / o.h) + 1);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const data = src.readPixels(crop.x + x0, crop.y + y0, w, h);
    const adj = isNeutral(o.adjust) || o.media ? null : o.adjust!;
    const snap = (v: number): number => Math.round(v * dpr) / dpr;
    // Pixel edge i lies at the rational local x = i·w/pixelW. Project it as
    // (i·w − L·pixelW)·2^e·f / pixelW: the numerator is exact, so interior
    // edges stay exact at any magnification.
    const W = D.fromNumber(o.w);
    const H = D.fromNumber(o.h);
    const PW = D.fromNumber(crop.w);
    const PH = D.fromNumber(crop.h);
    const edgeX = (i: number): number =>
      snap(Math.min(cr, Math.max(cl, p.cx + toPx(p, D.sub(D.mul(D.fromNumber(i), W), D.mul(p.lx, PW))) / crop.w)));
    const edgeY = (j: number): number =>
      snap(Math.min(cb, Math.max(ct, p.cy + toPx(p, D.sub(D.mul(D.fromNumber(j), H), D.mul(p.ly, PH))) / crop.h)));
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
        if (adj) {
          const [ar, ag, ab] = adjustPixel(data[k]!, data[k + 1]!, data[k + 2]!, adj);
          ctx.fillStyle = `rgba(${Math.round(ar)},${Math.round(ag)},${Math.round(ab)},${a / 255})`;
        } else ctx.fillStyle = `rgba(${data[k]},${data[k + 1]},${data[k + 2]},${a / 255})`;
        ctx.fillRect(left, top, right - left + bleed, bottom - top + bleed);
      }
    }
  });
}

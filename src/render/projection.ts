import * as D from "../core/dyadic";
import type { Camera, Viewport } from "../core/camera";
import type { CanvasObject, LocalBounds } from "../doc/model";
import { localBounds, strokePoints } from "../doc/model";
import type { IndexCell, IndexEntry } from "../scene/spatial-index";
import { MIN_CELL_PX, objectLevel } from "../scene/spatial-index";
import type { Cover } from "./coarse";

/**
 * Projection of an object's local geometry to screen space, shared by the
 * renderer, hit testing, lasso/box selection and selection handles so that
 * what is drawn is exactly what is picked.
 *
 * For a local point x (relative to the object's anchor):
 *
 *   screen = viewportCenter + (x − L) · 2^e · f
 *
 * where L = (camera.center − anchor) · 2^-unit is the viewport centre in the
 * object's local units (exact), e = unit + zi is an integer, and f = 2^zf.
 * The scale is never formed as one double: (x − L) is exact, the 2^e factor is
 * an exponent shift on that exact value, and only the final result is turned
 * into a double. There is therefore no magnification at which an object is
 * dropped or its screen geometry overflows.
 *
 * A double-double fast path, ((x − L.hi) − L.lo) · ppu, is used for stroke
 * vertices only when its error bound is below 2^-40 px (see `exact`).
 */
export interface Projection {
  /** Exact viewport centre in local units. */
  readonly lx: D.Dyadic;
  readonly ly: D.Dyadic;
  /** log2 of pixels per local unit, integer part, and the fractional factor 2^zf. */
  readonly e: number;
  readonly f: number;
  /** 2^e · f as a double. May be 0 or Infinity at extreme scales; only valid on the fast path. */
  readonly ppu: number;
  readonly lxHi: number;
  readonly lxLo: number;
  readonly lyHi: number;
  readonly lyLo: number;
  readonly cx: number;
  readonly cy: number;
}

export function projectionFor(cam: Camera, vp: Viewport, anchor: CanvasObject["anchor"], unit: number): Projection {
  const lxe = D.shift(D.sub(cam.center.x, anchor.x), -unit);
  const lye = D.shift(D.sub(cam.center.y, anchor.y), -unit);
  const lx = D.toDD(lxe);
  const ly = D.toDD(lye);
  const e = unit + cam.zi;
  const f = 2 ** cam.zf;
  return {
    lx: lxe,
    ly: lye,
    e,
    f,
    ppu: e > 1100 ? Infinity : e < -1100 ? 0 : 2 ** e * f,
    lxHi: lx.hi,
    lxLo: lx.lo,
    lyHi: ly.hi,
    lyLo: ly.lo,
    cx: vp.width / 2,
    cy: vp.height / 2,
  };
}

/** Scale an exact local-unit quantity to CSS px: v · 2^e · f, without overflow in between. */
export function toPx(p: Projection, v: D.Dyadic): number {
  return D.toNumber(D.shift(v, p.e)) * p.f;
}

/** Local-unit offset corresponding to a screen offset of `px` CSS px (exact apart from one division by f). */
export function fromPx(p: Projection, px: number): D.Dyadic {
  return D.shift(D.fromNumber(px / p.f), -p.e);
}

/** Exact projection of a local x coordinate. */
export function exactX(p: Projection, x: number | D.Dyadic): number {
  return p.cx + toPx(p, D.sub(typeof x === "number" ? D.fromNumber(x) : x, p.lx));
}

export function exactY(p: Projection, y: number | D.Dyadic): number {
  return p.cy + toPx(p, D.sub(typeof y === "number" ? D.fromNumber(y) : y, p.ly));
}

/** Fast double-double projection; accurate only on the fast path (see ProjectedObject.exact). */
export function projX(p: Projection, x: number): number {
  return p.cx + (x - p.lxHi - p.lxLo) * p.ppu;
}

export function projY(p: Projection, y: number): number {
  return p.cy + (y - p.lyHi - p.lyLo) * p.ppu;
}

export interface ScreenBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ProjectedObject {
  readonly obj: CanvasObject;
  /** Full projection; computed lazily on the cell-relative fast path. */
  readonly proj: Projection;
  /** Exact screen bounding box (may be far beyond the viewport, or ±Infinity). */
  readonly box: ScreenBox;
  /** Stroke: projected polyline [x0, y0, ...]; image and text: [left, top, right, bottom]. */
  readonly q: Float64Array;
  /** Stroke radius in px (0 for images and text; may be Infinity at extreme magnification). */
  readonly radius: number;
  /**
   * True when the double-precision fast path is not accurate enough for this
   * object (huge radius, geometry far off-screen, or a scale where the
   * double-double viewport centre is too coarse), so drawing and hit testing
   * use exact arithmetic (stroke-coverage.ts, exact image pixel edges).
   */
  readonly exact: boolean;
  /** A coarse object covering the whole view (render/coarse.ts): drawn as one fill, with no projection. */
  readonly cover?: Cover;
}

class Projected implements ProjectedObject {
  private p: Projection | null;
  constructor(
    readonly obj: CanvasObject,
    readonly box: ScreenBox,
    readonly q: Float64Array,
    readonly radius: number,
    readonly exact: boolean,
    private readonly cam: Camera,
    private readonly vp: Viewport,
    proj: Projection | null,
  ) {
    this.p = proj;
  }

  get proj(): Projection {
    return (this.p ??= projectionFor(this.cam, this.vp, this.obj.anchor, this.obj.unit));
  }
}

/** Fast path limits: |screen coords| ≤ 2^40 px and stroke radius ≤ 2^14 px. */
export const EXACT_COORD_THRESHOLD = 2 ** 40;
export const EXACT_RADIUS_THRESHOLD = 2 ** 14;

/** Screen-space margin for culling (covers selection outlines). */
const CULL_MARGIN = 8;

/**
 * Error bound (px) of the double-double fast path: L is represented to about
 * 2^-104 of its magnitude, and local coordinates to 2^-53 of theirs.
 */
function fastPathError(p: Projection, localMagnitude: number): number {
  const lMag = Math.max(Math.abs(p.lxHi), Math.abs(p.lyHi));
  return (lMag * 2 ** -104 + localMagnitude * 2 ** -106) * p.ppu;
}

/**
 * Project an object if any of it can be visible; returns null when it is
 * entirely offscreen or (unless keepTiny) too small to draw individually.
 */
/**
 * Whether an object is too small to draw individually at this zoom: decided
 * by its index level, exactly as the index skips levels (MIN_CELL_PX), so
 * every object is either drawn or in the density preview (render/density.ts),
 * never both and never neither. (A box-size cutoff cannot do this: objects
 * are between half and all of their cell's size, which leaves a band where
 * the two rules disagree.)
 */
export function tooSmallToDraw(o: CanvasObject, cam: Camera): boolean {
  return 2 ** (objectLevel(o) + cam.zi + cam.zf) < MIN_CELL_PX;
}

export function projectObject(o: CanvasObject, cam: Camera, vp: Viewport, opts: { keepTiny?: boolean } = {}): ProjectedObject | null {
  const p = projectionFor(cam, vp, o.anchor, o.unit);
  const b: LocalBounds = localBounds(o);
  // The bounding box is always computed exactly: it drives culling.
  const box = { minX: exactX(p, b.minX), minY: exactY(p, b.minY), maxX: exactX(p, b.maxX), maxY: exactY(p, b.maxY) };
  if (box.maxX < -CULL_MARGIN || box.maxY < -CULL_MARGIN || box.minX > vp.width + CULL_MARGIN || box.minY > vp.height + CULL_MARGIN) {
    return null;
  }
  if (!opts.keepTiny && tooSmallToDraw(o, cam)) return null;
  const extent = Math.max(Math.abs(box.minX), Math.abs(box.maxX), Math.abs(box.minY), Math.abs(box.maxY));
  const localMag = Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minY), Math.abs(b.maxY));
  if (o.kind !== "stroke") {
    // Text draws its glyphs exactly (draw-text.ts) when doubles are not accurate enough.
    const exact = o.kind === "text" && (!(extent <= EXACT_COORD_THRESHOLD) || !(fastPathError(p, localMag) <= 2 ** -40));
    return new Projected(o, box, Float64Array.of(box.minX, box.minY, box.maxX, box.maxY), 0, exact, cam, vp, p);
  }
  const radius = toPx(p, D.fromNumber(o.width / 2));
  const exact =
    !(radius <= EXACT_RADIUS_THRESHOLD) || !(extent <= EXACT_COORD_THRESHOLD) || !(fastPathError(p, localMag) <= 2 ** -40);
  const pts = strokePoints(o);
  const q = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    q[i] = exact ? exactX(p, pts[i]!) : projX(p, pts[i]!);
    q[i + 1] = exact ? exactY(p, pts[i + 1]!) : projY(p, pts[i + 1]!);
  }
  return new Projected(o, box, q, radius, exact, cam, vp, p);
}

/**
 * Screen placement of an index cell, computed exactly once per cell per
 * frame: the screen position of its origin and its size in px.
 */
export interface CellFrame {
  readonly x: number;
  readonly y: number;
  readonly pxPerCell: number;
}

export function cellFrame(cell: IndexCell, cam: Camera, vp: Viewport): CellFrame {
  const L = cell.level;
  const f = 2 ** cam.zf;
  return {
    x: vp.width / 2 + D.diffToNumber(D.fromBigInt(cell.ix, L), cam.center.x, cam.zi) * f,
    y: vp.height / 2 + D.diffToNumber(D.fromBigInt(cell.iy, L), cam.center.y, cam.zi) * f,
    pxPerCell: 2 ** (L + cam.zi) * f,
  };
}

/**
 * Cell-relative fast projection: screen = cellOrigin + (ax + x·scale)·pxPerCell,
 * doubles only. The anchor offset `ax` is within ~2 cell units and stored to
 * 2^-53 relative precision, so the error is below 2^-52·pxPerCell px; this path
 * is used only while pxPerCell ≤ 2^30 (error < 2^-22 px), the radius is ≤ 2^14 px
 * and the screen extent is ≤ 2^40 px. Anything else falls back to the exact
 * projection (projectObject).
 */
const FAST_MAX_PX_PER_CELL = 2 ** 30;

export function projectEntry(e: IndexEntry, cf: CellFrame, cam: Camera, vp: Viewport): ProjectedObject | null {
  const o = e.obj;
  if (cf.pxPerCell > FAST_MAX_PX_PER_CELL) return projectObject(o, cam, vp);
  const s = e.scale * cf.pxPerCell; // px per local unit
  const ox = cf.x + e.ax * cf.pxPerCell;
  const oy = cf.y + e.ay * cf.pxPerCell;
  const b = localBounds(o);
  const box = { minX: ox + b.minX * s, minY: oy + b.minY * s, maxX: ox + b.maxX * s, maxY: oy + b.maxY * s };
  if (box.maxX < -CULL_MARGIN || box.maxY < -CULL_MARGIN || box.minX > vp.width + CULL_MARGIN || box.minY > vp.height + CULL_MARGIN) {
    return null;
  }
  // No size cull here: the index only returns cells of levels drawn individually.
  const extent = Math.max(Math.abs(box.minX), Math.abs(box.maxX), Math.abs(box.minY), Math.abs(box.maxY));
  if (o.kind !== "stroke") {
    if (o.kind === "text" && !(extent <= EXACT_COORD_THRESHOLD)) return projectObject(o, cam, vp);
    return new Projected(o, box, Float64Array.of(box.minX, box.minY, box.maxX, box.maxY), 0, false, cam, vp, null);
  }
  const radius = (o.width / 2) * s;
  if (!(radius <= EXACT_RADIUS_THRESHOLD) || !(extent <= EXACT_COORD_THRESHOLD)) return projectObject(o, cam, vp);
  const pts = strokePoints(o);
  const q = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    q[i] = ox + pts[i]! * s;
    q[i + 1] = oy + pts[i + 1]! * s;
  }
  return new Projected(o, box, q, radius, false, cam, vp, null);
}

/**
 * A coarse object that covers the view (render/coarse.ts): its box is the
 * viewport, so tiles, hit testing and selection see it like any object.
 */
export function coverObject(o: CanvasObject, vp: Viewport, cover: Cover): ProjectedObject {
  const box = { minX: 0, minY: 0, maxX: vp.width, maxY: vp.height };
  return {
    obj: o,
    box,
    q: Float64Array.of(0, 0, vp.width, vp.height),
    radius: 0,
    exact: false,
    cover,
    get proj(): Projection {
      throw new Error("a covering object has no projection");
    },
  };
}

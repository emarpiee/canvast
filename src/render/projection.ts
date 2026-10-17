import * as D from "../core/dyadic";
import type { Camera, Viewport } from "../core/camera";
import type { CanvasObject, LocalBounds } from "../doc/model";
import { localBounds, pathSubs, pivotOf, strokePoints, unrotatedBounds } from "../doc/model";
import type { FlatPath } from "../doc/path";
import { FLAT_TOLERANCE_PX, flatten } from "../doc/path";
import { cosSin } from "../core/angle";
import { approxPath, classifyPath } from "./coarse";
import { exactPath, isStraight, outlineStrokes } from "./path-exact";
import { exactStrokeCoverage } from "./stroke-coverage";
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
  /** A path: its outlines flattened in screen space (`q` holds all their vertices, for the selection box and lasso). */
  readonly path?: readonly FlatPath[] | undefined;
  /** A path seen at a depth doubles cannot place (render/path-exact.ts): the polygons to fill (the outline round the view included). Absent: fill `path`. */
  readonly fillPath?: readonly FlatPath[] | undefined;
  /** The same, for the outline when it is too wide for the canvas (its capsules as polygons to fill), and the strokes they came from (for picking). */
  readonly strokePolys?: readonly (readonly number[])[] | undefined;
  readonly synth?: readonly ProjectedObject[] | undefined;
  /** The four corners of the object's own (turned) bounds on screen, when that is not the bounding box (turned paths). */
  readonly corners?: readonly (readonly [number, number])[] | undefined;
  /**
   * A turned image or text (ADR 0018): `inner` is the object as if not turned,
   * seen by a camera that is moved and widened so the turned view fits in it.
   * Drawing turns the canvas by the object's angle; picking turns the point back.
   */
  readonly rotated?: RotatedView;
  /** The frames this object is cut by, outermost first (ADR 0108): each frame's own projection; what lies outside any of them is neither drawn nor picked. */
  // (set in place after projecting: a projected object keeps lazy parts that a copy would lose)
  clip?: readonly ProjectedObject[] | undefined;
}

export interface RotatedView {
  readonly inner: ProjectedObject;
  /** Size of the widened viewport `inner` was projected for. */
  readonly vvp: Viewport;
  /** cos and sin of the object's angle. */
  readonly c: number;
  readonly s: number;
  /** Centre of the real viewport. */
  readonly cx: number;
  readonly cy: number;
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
    readonly path?: readonly FlatPath[] | undefined,
    readonly corners?: readonly (readonly [number, number])[] | undefined,
    readonly fillPath?: readonly FlatPath[] | undefined,
    readonly strokePolys?: readonly (readonly number[])[] | undefined,
    readonly synth?: readonly ProjectedObject[] | undefined,
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

/**
 * A turned image or text: project the unturned object for a camera whose centre is
 * where the viewport centre lands once the turn is undone (computed exactly: the
 * matrix entries are doubles, which are exact dyadic numbers), with a viewport
 * large enough to contain the turned one.
 */
function projectRotated(o: CanvasObject, cam: Camera, vp: Viewport, p: Projection, box: ScreenBox, opts: { keepTiny?: boolean }): ProjectedObject | null {
  const { c, s } = cosSin(o.rot!);
  const pv = pivotOf(o);
  const dx = D.sub(p.lx, D.fromNumber(pv.x));
  const dy = D.sub(p.ly, D.fromNumber(pv.y));
  // u = pivot + R(-angle) (L - pivot)
  const ux = D.add(D.fromNumber(pv.x), D.add(D.mul(D.fromNumber(c), dx), D.mul(D.fromNumber(s), dy)));
  const uy = D.add(D.fromNumber(pv.y), D.sub(D.mul(D.fromNumber(c), dy), D.mul(D.fromNumber(s), dx)));
  const { rot: _turn, ...flat } = o;
  const unturned = flat as CanvasObject;
  const vcam: Camera = { ...cam, center: { x: D.add(o.anchor.x, D.shift(ux, o.unit)), y: D.add(o.anchor.y, D.shift(uy, o.unit)) } };
  const vvp: Viewport = { width: Math.abs(c) * vp.width + Math.abs(s) * vp.height, height: Math.abs(s) * vp.width + Math.abs(c) * vp.height };
  const inner = projectObject(unturned, vcam, vvp, opts);
  if (!inner) return null;
  return {
    obj: o,
    box,
    q: Float64Array.of(box.minX, box.minY, box.maxX, box.maxY),
    radius: 0,
    exact: inner.exact,
    rotated: { inner, vvp, c, s, cx: vp.width / 2, cy: vp.height / 2 },
    get proj(): Projection {
      return inner.proj;
    },
  };
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
  if (o.kind === "path") return projectPath(o, cam, vp, p, box, b);
  if (o.kind !== "stroke" && o.rot) return projectRotated(o, cam, vp, p, box, opts);
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

/** Farthest outside the viewport (px) a path is flattened precisely: a curve entirely beyond this becomes its chord. */
const PATH_CULL_MARGIN = 4096;
/** A path is drawn only while its bounds stay within this many px and its outline half-width within EXACT_RADIUS_THRESHOLD; beyond that it is approximated (render/coarse.ts). */
const PATH_MAX_EXTENT = 2 ** 44;

/**
 * A path's screen geometry from a projection of its local x and y: every node (and handle) is projected, then the curves are
 * flattened in screen space until within FLAT_TOLERANCE_PX of the true curve. `proj` is the full projection when there is one.
 */
function pathFromScreen(
  o: Extract<CanvasObject, { kind: "path" }>,
  cam: Camera,
  vp: Viewport,
  box: ScreenBox,
  px: (x: number) => number,
  py: (y: number) => number,
  proj: Projection | null,
): ProjectedObject {
  const subs = pathSubs(o);
  const q = subs.map((s) => {
    const a = new Float64Array(s.n.length);
    for (let i = 0; i < a.length; i += 2) {
      a[i] = px(s.n[i]!);
      a[i + 1] = py(s.n[i + 1]!);
    }
    return a;
  });
  const flats = flatten(subs, q, FLAT_TOLERANCE_PX, { minX: 0, minY: 0, maxX: vp.width, maxY: vp.height }, PATH_CULL_MARGIN);
  let total = 0;
  for (const f of flats) total += f.pts.length;
  const all = new Float64Array(total);
  let at = 0;
  for (const f of flats) {
    all.set(f.pts, at);
    at += f.pts.length;
  }
  // The object's own bounds, turned with it: what the selection box is built on.
  const ub = localBoundsUnturned(o);
  const c = o.rot ? cosSin(o.rot) : { c: 1, s: 0 };
  const cx0 = (ub.minX + ub.maxX) / 2;
  const cy0 = (ub.minY + ub.maxY) / 2;
  const corner = (x: number, y: number): [number, number] => [px(cx0 + c.c * (x - cx0) - c.s * (y - cy0)), py(cy0 + c.s * (x - cx0) + c.c * (y - cy0))];
  const corners = o.rot ? [corner(ub.minX, ub.minY), corner(ub.maxX, ub.minY), corner(ub.maxX, ub.maxY), corner(ub.minX, ub.maxY)] : undefined;
  const radius = o.stroke === null ? 0 : (proj ? toPx(proj, D.fromNumber(o.width / 2)) : (px(o.width / 2) - px(0)));
  return new Projected(o, box, all, radius, false, cam, vp, proj, flats, corners);
}

const localBoundsUnturned = (o: Extract<CanvasObject, { kind: "path" }>): LocalBounds => unrotatedBounds(o);

function projectPath(o: Extract<CanvasObject, { kind: "path" }>, cam: Camera, vp: Viewport, p: Projection, box: ScreenBox, b: LocalBounds): ProjectedObject | null {
  const extent = Math.max(Math.abs(box.minX), Math.abs(box.maxX), Math.abs(box.minY), Math.abs(box.maxY));
  const localMag = Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minY), Math.abs(b.maxY));
  const radius = o.stroke === null ? 0 : toPx(p, D.fromNumber(o.width / 2));
  if (!(extent <= PATH_MAX_EXTENT) || !(radius <= EXACT_RADIUS_THRESHOLD)) {
    // Zoomed so far into a large path (or its outline) that doubles cannot place its edges. Where the whole view is inside the fill or the
    // outline it is that colour, exactly; where it misses, nothing; only with an edge in view is it the colour at the centre, dimmed.
    const lx = D.toNumber(p.lx);
    const ly = D.toNumber(p.ly);
    const view = Math.hypot(vp.width, vp.height) / 2 + 8;
    const m = (Number.isFinite(p.ppu) && p.ppu > 0 ? view / p.ppu : 0) + Math.max(Math.abs(lx), Math.abs(ly), localMag) * 2 ** -46;
    const r = classifyPath(o, lx, ly, m);
    if (r === "miss") return null;
    if (r !== "exact") return coverObject(o, vp, r);
    // An edge is in view. Exact when the outline can be drawn: thin enough for the canvas, or straight-edged (its capsules are polygons).
    const thin = radius <= EXACT_RADIUS_THRESHOLD;
    if (thin || (isStraight(o) && o.stroke !== null)) {
      const ex = exactPath(o, p, vp, thin ? radius : 0);
      const q = new Float64Array(ex.lines.reduce((n, l) => n + l.pts.length, 0));
      let at = 0;
      for (const l of ex.lines) {
        q.set(l.pts, at);
        at += l.pts.length;
      }
      if (thin) return new Projected(o, box, q, radius, true, cam, vp, p, ex.lines, undefined, ex.fill);
      const synth = outlineStrokes(o).map((s): ProjectedObject => ({ obj: s, proj: p, box, q: new Float64Array(0), radius, exact: true }));
      const polys = synth.flatMap((s) => exactStrokeCoverage(s, vp));
      return new Projected(o, box, q, radius, true, cam, vp, p, ex.lines, undefined, ex.fill, polys, synth);
    }
    const cover = approxPath(o, lx, ly);
    return cover ? coverObject(o, vp, { ...cover, dim: true }) : null;
  }
  // Whole-object accuracy: the double-double projection while its error is far below a pixel, the exact one otherwise.
  const precise = fastPathError(p, localMag) <= 2 ** -40 && extent <= EXACT_COORD_THRESHOLD;
  return pathFromScreen(o, cam, vp, box, precise ? (x) => projX(p, x) : (x) => exactX(p, x), precise ? (y) => projY(p, y) : (y) => exactY(p, y), p);
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
  if (cf.pxPerCell > FAST_MAX_PX_PER_CELL || (o.kind !== "stroke" && o.kind !== "path" && o.rot)) return projectObject(o, cam, vp);
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
  if (o.kind === "path") {
    if (!(extent <= EXACT_COORD_THRESHOLD) || !((o.stroke === null ? 0 : (o.width / 2) * s) <= EXACT_RADIUS_THRESHOLD)) return projectObject(o, cam, vp);
    return pathFromScreen(o, cam, vp, box, (x) => ox + x * s, (y) => oy + y * s, null);
  }
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

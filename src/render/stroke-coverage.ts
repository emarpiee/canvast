import * as D from "../core/dyadic";
import type { Viewport } from "../core/camera";
import type { StrokeObject } from "../doc/model";
import { strokePoints } from "../doc/model";
import type { ProjectedObject, Projection } from "./projection";
import { fromPx, toPx } from "./projection";
import { distToSegment } from "./geometry2d";

/**
 * Exact stroke geometry for deep magnification.
 *
 * A stroke is the union of capsules (one per segment) of radius r. When it
 * is magnified so far that its vertices lie astronomically far off-screen (or
 * its radius is astronomically many pixels), screen coordinates as doubles no
 * longer carry the sub-pixel part, and geometry built from them shows holes
 * and jitter. Even "radius − distance" in pixels cancels catastrophically
 * once the radius is ~2^60 px.
 *
 * Everything that involves cancellation is therefore computed exactly in the
 * object's local units, relative to the exact viewport centre C:
 *
 *   segment AB:  U = B − A, W = C − A                  (exact dyadics)
 *     perp = cross(U, W)   (|U| × signed distance of C to line AB)
 *     dot  = U · W         (|U| × position of C along AB)
 *     side offsets r ∓ d from the exact numerator r²|U|² − perp²
 *   disc at A:   |W| − r = (|W|² − r²) / (|W| + r)
 *
 * These are small whenever the boundary is visible, so converting them to
 * doubles is accurate. The visible coverage is then the viewport rectangle
 * clipped by a few half-planes with small coefficients.
 */

/** Polygons extend this far beyond the viewport (CSS px) to hide edge seams. */
const VIEW_MARGIN = 2;
/** Beyond this distance from a disc centre (px), its boundary is treated as a line (error < 0.001 px). */
const FLAT_DISC_DISTANCE = 1e9;
/** Maximum chord error when polygonizing visible disc arcs (CSS px). */
const ARC_TOLERANCE = 0.01;

type Plane = (x: number, y: number) => number; // >= 0 is inside

/** Clip a polygon by one half-plane (Sutherland–Hodgman step). */
export function clipHalfPlane(poly: number[], inside: Plane): number[] {
  const out: number[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i += 2) {
    const ax = poly[(i - 2 + n) % n]!;
    const ay = poly[(i - 1 + n) % n]!;
    const bx = poly[i]!;
    const by = poly[i + 1]!;
    const da = inside(ax, ay);
    const db = inside(bx, by);
    if (db >= 0) {
      if (da < 0) {
        const t = da / (da - db);
        out.push(ax + t * (bx - ax), ay + t * (by - ay));
      }
      out.push(bx, by);
    } else if (da >= 0) {
      const t = da / (da - db);
      out.push(ax + t * (bx - ax), ay + t * (by - ay));
    }
  }
  return out;
}

/** Make a polygon's signed area positive so every piece winds the same way. */
export function orientPositive(poly: number[]): number[] {
  let area = 0;
  const n = poly.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    area += poly[i]! * poly[j + 1]! - poly[j]! * poly[i + 1]!;
  }
  if (area >= 0) return poly;
  const out: number[] = [];
  for (let i = n - 2; i >= 0; i -= 2) out.push(poly[i]!, poly[i + 1]!);
  return out;
}

function vertex(o: StrokeObject, i: number): { x: D.Dyadic; y: D.Dyadic } {
  return { x: D.fromNumber(strokePoints(o)[2 * i]!), y: D.fromNumber(strokePoints(o)[2 * i + 1]!) };
}

/**
 * Conservative culling in local units (never in screen px, which may be
 * ±Infinity at extreme magnification): can geometry within `reachPx` CSS px of
 * the viewport centre involve the given local point/segment? Doubles of local
 * coordinates are accurate to ~2^-52 of their magnitude; the slack covers that.
 */
interface LocalCull {
  readonly cx: number;
  readonly cy: number;
  readonly reach: number;
}

function localCull(p: Projection, o: StrokeObject, reachPx: number): LocalCull {
  const cx = D.toNumber(p.lx);
  const cy = D.toNumber(p.ly);
  let mag = Math.max(Math.abs(cx), Math.abs(cy));
  for (const v of strokePoints(o)) mag = Math.max(mag, Math.abs(v));
  // reachPx · 2^-e / f, computed without overflow; tiny or zero at deep zoom.
  const reachLocal = D.toNumber(fromPx(p, reachPx));
  return { cx, cy, reach: o.width / 2 + Math.abs(reachLocal) + mag * 2 ** -40 + 2 ** -1000 };
}

/**
 * Distances (CSS px) from a point to the two side lines of a capsule,
 * positive inside: toLeft = r − d, toRight = r + d, where d = perp/|U| is the
 * signed distance to the centre line. The near side comes from the exact
 * numerator (r² − d²)|U|² = r²|U|² − perp², the far side is a sum of
 * same-signed terms, so neither cancels.
 */
function sideOffsets(pr: Projection, perp: D.Dyadic, uu: D.Dyadic, len: number, r: number): { toLeft: number; toRight: number } {
  const rd = D.fromNumber(r);
  // (r² − d²)|U|² scaled to px before conversion, so it neither underflows nor overflows.
  const num = toPx(pr, D.sub(D.mul(D.mul(rd, rd), uu), D.mul(perp, perp)));
  const p = D.toNumber(perp);
  const rl = r * len;
  const far = (x: D.Dyadic): number => toPx(pr, x) / len; // same-signed sum: no cancellation
  if (p >= 0) return { toLeft: num / (len * (rl + p)), toRight: far(D.add(D.mul(rd, D.fromNumber(len)), perp)) };
  return { toLeft: far(D.sub(D.mul(rd, D.fromNumber(len)), perp)), toRight: num / (len * (rl - p)) };
}

/**
 * Visible coverage of a stroke as positively-oriented polygons in absolute
 * screen coordinates, clipped to the viewport (+margin). Filling them all in
 * one nonzero path paints the union exactly once.
 */
export function exactStrokeCoverage(po: ProjectedObject, vp: Viewport): number[][] {
  const o = po.obj as StrokeObject;
  const p = po.proj;
  const r = o.width / 2;
  const hw = vp.width / 2 + VIEW_MARGIN;
  const hh = vp.height / 2 + VIEW_MARGIN;
  const view = [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
  const cull = localCull(p, o, Math.hypot(hw, hh) + 4);
  const pts = strokePoints(o);
  const polys: number[][] = [];
  const nVerts = pts.length / 2;

  for (let i = 0; i + 1 < nVerts; i++) {
    // Conservative local-unit cull; the exact computation follows.
    if (!(distToSegment(cull.cx, cull.cy, pts[2 * i]!, pts[2 * i + 1]!, pts[2 * i + 2]!, pts[2 * i + 3]!) <= cull.reach)) continue;
    const a = vertex(o, i);
    const b = vertex(o, i + 1);
    const ux = D.sub(b.x, a.x);
    const uy = D.sub(b.y, a.y);
    const uu = D.add(D.mul(ux, ux), D.mul(uy, uy));
    const len = Math.sqrt(D.toNumber(uu));
    if (!(len > 0)) continue; // zero-length segment: covered by its disc
    const wx = D.sub(p.lx, a.x);
    const wy = D.sub(p.ly, a.y);
    const perp = D.sub(D.mul(ux, wy), D.mul(uy, wx));
    const dot = D.add(D.mul(ux, wx), D.mul(uy, wy));
    const sides = sideOffsets(p, perp, uu, len, r);
    // Signed px distances of the viewport centre inside each boundary.
    const inLeft = sides.toLeft;
    const inRight = sides.toRight;
    const inStart = toPx(p, dot) / len;
    const inEnd = toPx(p, D.sub(uu, dot)) / len;
    const dx = D.toNumber(ux) / len;
    const dy = D.toNumber(uy) / len;
    // A screen offset P (from the centre) changes the signed perpendicular
    // distance by (dx·Py − dy·Px) and the along-coordinate by (dx·Px + dy·Py).
    let poly = clipHalfPlane(view, (x, y) => inLeft - (dx * y - dy * x));
    if (poly.length >= 6) poly = clipHalfPlane(poly, (x, y) => inRight + (dx * y - dy * x));
    if (poly.length >= 6) poly = clipHalfPlane(poly, (x, y) => inStart + dx * x + dy * y);
    if (poly.length >= 6) poly = clipHalfPlane(poly, (x, y) => inEnd - (dx * x + dy * y));
    if (poly.length >= 6) polys.push(poly);
  }

  for (let i = 0; i < nVerts; i++) {
    if (!(Math.hypot(pts[2 * i]! - cull.cx, pts[2 * i + 1]! - cull.cy) <= cull.reach)) continue;
    const disc = discCoverage(po, vertex(o, i), r, hw, hh, view);
    if (disc) polys.push(disc);
  }

  return polys.map((poly) => {
    const abs = new Array<number>(poly.length);
    for (let i = 0; i < poly.length; i += 2) {
      abs[i] = poly[i]! + p.cx;
      abs[i + 1] = poly[i + 1]! + p.cy;
    }
    return orientPositive(abs);
  });
}

function discCoverage(
  po: ProjectedObject,
  a: { x: D.Dyadic; y: D.Dyadic },
  r: number,
  hw: number,
  hh: number,
  view: number[],
): number[] | null {
  const p = po.proj;
  const rPx = po.radius;
  const diag = Math.hypot(hw, hh);
  const wx = D.sub(p.lx, a.x);
  const wy = D.sub(p.ly, a.y);
  const w2 = D.add(D.mul(wx, wx), D.mul(wy, wy));
  const wLen = Math.sqrt(D.toNumber(w2)); // |C − A| in local units
  const rd = D.fromNumber(r);
  // |W| − r, exactly from the numerator: px distance of the centre outside the disc.
  const outside = toPx(p, D.sub(w2, D.mul(rd, rd))) / (wLen + r);
  if (outside > diag + 1) return null; // the disc does not reach the viewport
  if (outside < -(diag + 1)) return view.slice(); // the viewport is inside the disc
  const centreDistPx = toPx(p, D.fromNumber(wLen));
  if (centreDistPx >= FLAT_DISC_DISTANCE) {
    // Far-away centre: within the viewport the boundary is a line at distance
    // `outside` along the direction from the centre (curvature error < 0.001 px).
    const ex = D.toNumber(wx) / wLen;
    const ey = D.toNumber(wy) / wLen;
    const poly = clipHalfPlane(view, (x, y) => -(outside + ex * x + ey * y));
    return poly.length >= 6 ? poly : null;
  }
  // Centre within 1e9 px: double-precision circle geometry is accurate here.
  const ccx = -toPx(p, wx);
  const ccy = -toPx(p, wy);
  let poly = arcPolygon(ccx, ccy, rPx, diag, centreDistPx);
  poly = clipHalfPlane(poly, (x) => x + hw);
  poly = clipHalfPlane(poly, (x) => hw - x);
  poly = clipHalfPlane(poly, (_x, y) => y + hh);
  poly = clipHalfPlane(poly, (_x, y) => hh - y);
  return poly.length >= 6 ? poly : null;
}

/** Polygon covering the part of a disc that can be visible: a pie slice over the visible arc. */
function arcPolygon(ccx: number, ccy: number, r: number, diag: number, dist: number): number[] {
  let start = 0;
  let span = 2 * Math.PI;
  if (dist > 0 && r > diag) {
    // Only the arc within `diag` of the viewport centre can be visible.
    const cosA = (r * r + dist * dist - diag * diag) / (2 * r * dist);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
    start = Math.atan2(-ccy, -ccx) - alpha;
    span = 2 * alpha;
  }
  const step = 2 * Math.acos(Math.max(0, 1 - ARC_TOLERANCE / Math.max(r, ARC_TOLERANCE)));
  const n = Math.min(4096, Math.max(8, Math.ceil(span / step)));
  const poly: number[] = [];
  for (let k = 0; k <= n; k++) {
    const t = start + (span * k) / n;
    poly.push(ccx + r * Math.cos(t), ccy + r * Math.sin(t));
  }
  if (span < 2 * Math.PI) poly.push(ccx, ccy); // close the slice through the centre
  return poly;
}

/**
 * Signed distance (CSS px) from screen point (sx, sy) to the stroke's outline:
 * negative inside, positive outside. Accurate near the outline at any
 * magnification (exact numerators, as above), so hit testing with a few px
 * of tolerance agrees with exactStrokeCoverage even for a 2^60 px radius.
 */
export function exactStrokeEdgeDistancePx(po: ProjectedObject, sx: number, sy: number): number {
  const o = po.obj as StrokeObject;
  const p = po.proj;
  // Local position of the screen point (the offset is small; one rounding).
  const px = D.add(p.lx, fromPx(p, sx - p.cx));
  const py = D.add(p.ly, fromPx(p, sy - p.cy));
  const r = o.width / 2;
  const rd = D.fromNumber(r);
  const r2 = D.mul(rd, rd);
  const pts = strokePoints(o);
  const n = pts.length / 2;
  // Cull around the query point (not the viewport centre).
  const base = localCull(p, o, 64);
  const cull = { cx: D.toNumber(px), cy: D.toNumber(py), reach: base.reach };
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    if (!(Math.hypot(pts[2 * i]! - cull.cx, pts[2 * i + 1]! - cull.cy) <= cull.reach)) continue;
    const a = vertex(o, i);
    const wx = D.sub(px, a.x);
    const wy = D.sub(py, a.y);
    const w2 = D.add(D.mul(wx, wx), D.mul(wy, wy));
    const e = toPx(p, D.sub(w2, r2)) / (Math.sqrt(D.toNumber(w2)) + r);
    if (e < best) best = e;
  }
  for (let i = 0; i + 1 < n; i++) {
    if (!(distToSegment(cull.cx, cull.cy, pts[2 * i]!, pts[2 * i + 1]!, pts[2 * i + 2]!, pts[2 * i + 3]!) <= cull.reach)) continue;
    const a = vertex(o, i);
    const b = vertex(o, i + 1);
    const ux = D.sub(b.x, a.x);
    const uy = D.sub(b.y, a.y);
    const uu = D.add(D.mul(ux, ux), D.mul(uy, uy));
    const len = Math.sqrt(D.toNumber(uu));
    if (!(len > 0)) continue;
    const wx = D.sub(px, a.x);
    const wy = D.sub(py, a.y);
    const dot = D.add(D.mul(ux, wx), D.mul(uy, wy));
    if (D.sign(dot) <= 0 || D.cmp(dot, uu) >= 0) continue; // nearest point is an endpoint (disc above)
    const perp = D.sub(D.mul(ux, wy), D.mul(uy, wx));
    const { toLeft, toRight } = sideOffsets(p, perp, uu, len, r);
    const e = -Math.min(toLeft, toRight);
    if (e < best) best = e;
  }
  return best;
}

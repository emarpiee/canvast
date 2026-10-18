import type { ProjectedObject } from "./projection";
import type { Rect } from "./geometry2d";
import { distToSegment, pointInPolygon, polygonsOverlap, polylineTouchesPolygon } from "./geometry2d";
import { itemCorners } from "./selection-frame";
import type { ObjectId, PathObject } from "../doc/model";
import { alignOf } from "../doc/model";
import type { ImageObject } from "../doc/model";
import { cornerRadiiPx } from "./draw-objects";
import { exactStrokeEdgeDistancePx } from "./stroke-coverage";
import { distanceToOutline, insideFill } from "../doc/path";

/**
 * Object-specific hit tests over projected geometry. Callers pass candidates
 * (all visible objects today; spatial-index results in Phase 0C), and these
 * functions decide membership authoritatively.
 */

/** Pointer tolerance in CSS px around strokes. */
export const HIT_TOLERANCE_PX = 4;

/** Whether the point is inside a sheet's shape, whatever its paint (a sheet with no fill still holds what is on it). */
export function insideBody(po: ProjectedObject, x: number, y: number): boolean {
  if (po.cover) return true;
  const b = po.box;
  if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return false;
  return insideFill(po.fillPath ?? po.path!, x, y, !!(po.obj as PathObject).evenodd);
}

export function hitsObject(po: ProjectedObject, x: number, y: number, tol = HIT_TOLERANCE_PX): boolean {
  if (po.clip && !po.clip.every((c) => insideBody(c, x, y))) return false; // cut away by a sheet: not there to be picked
  // Cut away by a mask (ADR 0144): picked only where a mask shape is (or is not, when inverted). Shape only: a mask's own brightness or softness is not read.
  if (po.obj.mask && po.maskPos?.length && po.maskPos.some((m) => hitsObject(m, x, y, 0)) === (po.obj.mask.invert === true)) return false;
  const b = po.box;
  const t = po.rotated;
  if (t) {
    // Turn the point back into the unturned view (the box above is the turned object's bounding box).
    if (x < b.minX - tol || x > b.maxX + tol || y < b.minY - tol || y > b.maxY + tol) return false;
    const ox = x - t.cx;
    const oy = y - t.cy;
    return hitsObject(t.inner, t.vvp.width / 2 + t.c * ox + t.s * oy, t.vvp.height / 2 - t.s * ox + t.c * oy, tol);
  }
  if (x < b.minX - tol || x > b.maxX + tol || y < b.minY - tol || y > b.maxY + tol) return false;
  if (po.cover) return true; // the view is inside the object
  if (po.obj.kind === "path") {
    // Its outline within the pen's reach, or its inside when it is filled (an unfilled shape is picked by its line only).
    const flats = po.path!;
    if (po.obj.stroke !== null) {
      // An outline too wide for the canvas is measured exactly, as the stroke code does; otherwise on the flattened line.
      if (po.synth) {
        if (po.synth.some((s) => exactStrokeEdgeDistancePx(s, x, y) <= tol)) return true;
      } else {
        const side = alignOf(po.obj as PathObject);
        // centred: the line's own width; inside or outside: its whole width on that side of the edge
        if (!side && distanceToOutline(flats, x, y) <= po.radius + tol) return true;
        if (side && insideFill(po.fillPath ?? flats, x, y, !!po.obj.evenodd) === (side === "inside") && distanceToOutline(flats, x, y) <= 2 * po.radius + tol) return true;
      }
    }
    return (po.obj.fill !== null || (!!po.regionFills && !po.regionFills.stroked)) && insideFill(po.fillPath ?? flats, x, y, !!po.obj.evenodd);
  }
  if (po.obj.kind !== "stroke") {
    // Bounds-based picking (images and text boxes). Alpha-aware picking is not implemented yet.
    if (po.obj.kind === "image" && po.obj.radius !== undefined) return insideRoundedBox(po, x, y, tol);
    return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  }
  const reach = po.radius + tol;
  // Deeply magnified strokes: measure exactly, matching exactStrokeCoverage.
  if (po.exact) return exactStrokeEdgeDistancePx(po, x, y) <= tol;
  const q = po.q;
  if (q.length === 2) return Math.hypot(x - q[0]!, y - q[1]!) <= reach;
  for (let i = 0; i + 3 < q.length; i += 2) {
    if (distToSegment(x, y, q[i]!, q[i + 1]!, q[i + 2]!, q[i + 3]!) <= reach) return true;
  }
  return false;
}

/** Whether a point is on a picture with rounded corners (ADR 0153): in its box, but not in a corner the radius cuts away (within `tol` px of the curve counts). */
function insideRoundedBox(po: ProjectedObject, x: number, y: number, tol: number): boolean {
  const [l, t, r, bt] = po.q as unknown as [number, number, number, number];
  if (x < l - tol || x > r + tol || y < t - tol || y > bt + tol) return false;
  const radii = cornerRadiiPx((po.obj as ImageObject).radius!, po.proj.ppu, (r - l) / 2, (bt - t) / 2);
  if (!radii) return true;
  // top left, top right, bottom right, bottom left: the centre of each corner's arc, and whether the point lies in that corner's square
  const arcs: Array<[number, number, number, boolean]> = [
    [l + radii[0]!, t + radii[0]!, radii[0]!, x < l + radii[0]! && y < t + radii[0]!],
    [r - radii[1]!, t + radii[1]!, radii[1]!, x > r - radii[1]! && y < t + radii[1]!],
    [r - radii[2]!, bt - radii[2]!, radii[2]!, x > r - radii[2]! && y > bt - radii[2]!],
    [l + radii[3]!, bt - radii[3]!, radii[3]!, x < l + radii[3]! && y > bt - radii[3]!],
  ];
  for (const [cx, cy, rad, inSquare] of arcs) if (inSquare && Math.hypot(x - cx, y - cy) > rad + tol) return false;
  return true;
}

/** A closed outline as a polyline that returns to its first vertex. */
function closedLine(p: Float64Array): Float64Array {
  const out = new Float64Array(p.length + 2);
  out.set(p);
  out[p.length] = p[0]!;
  out[p.length + 1] = p[1]!;
  return out;
}

/** Whether a disc of radius `r` px at (x, y) touches the object's geometry (not just its bounding box, for strokes). */
function discHits(po: ProjectedObject, x: number, y: number, r: number): boolean {
  const t = po.rotated;
  if (t) {
    const ox = x - t.cx;
    const oy = y - t.cy;
    return discHits(t.inner, t.vvp.width / 2 + t.c * ox + t.s * oy, t.vvp.height / 2 - t.s * ox + t.c * oy, r);
  }
  if (po.cover) return true;
  if (po.obj.kind === "stroke" || po.obj.kind === "path") return hitsObject(po, x, y, r);
  const b = po.box;
  return Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minY - y, 0, y - b.maxY)) <= r;
}

/**
 * Whether a brush of diameter 2r swept from (x0, y0) to (x1, y1) touches the
 * object. The path is covered by discs at most half a radius apart, so a fast
 * swipe between two pointer samples cannot jump over a thin object.
 */
export function sweepHits(po: ProjectedObject, x0: number, y0: number, x1: number, y1: number, r: number): boolean {
  const b = po.box;
  if (Math.max(x0, x1) + r < b.minX || Math.min(x0, x1) - r > b.maxX || Math.max(y0, y1) + r < b.minY || Math.min(y0, y1) - r > b.maxY) return false;
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, r / 2)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (discHits(po, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) return true;
  }
  return false;
}

/**
 * Every object whose shape lies under the point, topmost first, whatever its paint: a path counts by its inside (even with no fill) or by
 * its edge (even with no outline), so a sheet or a shape with nothing painted is found too. Used to reveal what is under the pointer.
 */
export function pickAllByShape(ordered: readonly ProjectedObject[], x: number, y: number, tol = HIT_TOLERANCE_PX): ProjectedObject[] {
  const hits: ProjectedObject[] = [];
  for (let i = ordered.length - 1; i >= 0; i--) {
    const po = ordered[i]!;
    if (po.obj.kind === "path" && !po.cover && !po.rotated && po.path) {
      const b = po.box;
      if (x < b.minX - tol || x > b.maxX + tol || y < b.minY - tol || y > b.maxY + tol) continue;
      if (po.clip && !po.clip.every((c) => insideBody(c, x, y))) continue;
      if (insideFill(po.fillPath ?? po.path, x, y, !!po.obj.evenodd) || distanceToOutline(po.path, x, y) <= (po.obj.stroke !== null ? po.radius : 0) + tol) hits.push(po);
    } else if (hitsObject(po, x, y)) hits.push(po);
  }
  return hits;
}

/** All objects under the point, topmost first. `ordered` is in paint order. */
export function pickAll(ordered: readonly ProjectedObject[], x: number, y: number): ProjectedObject[] {
  const hits: ProjectedObject[] = [];
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (hitsObject(ordered[i]!, x, y)) hits.push(ordered[i]!);
  }
  return hits;
}

export type LassoFilter = "strokes" | "all";

/**
 * Lasso and box selection take what the shape touches (ADR 0031), like a design tool's marquee, not only what it
 * encloses: a stroke when any part of it is inside or crosses the edge, a turned or plain image or text when its
 * rectangle overlaps the shape. One exception keeps a drawing over a picture safe: a shape drawn entirely inside an
 * image or text does not select it (that is how you lasso strokes lying on media; click the media to take it).
 */
function touches(po: ProjectedObject, poly: ArrayLike<number>, filter: LassoFilter): boolean {
  if (po.cover) return false;
  if (po.obj.kind === "stroke") return polylineTouchesPolygon(po.q, poly);
  // A path is drawing, like a stroke: the lasso takes it when it touches its outline (the closing line of a closed one included).
  if (po.obj.kind === "path") return po.path!.some((f) => polylineTouchesPolygon(f.closed && f.pts.length >= 4 ? closedLine(f.pts) : f.pts, poly));
  if (filter !== "all") return false;
  const quad = itemCorners(po).flatMap((p) => [p[0], p[1]]);
  if (!polygonsOverlap(quad, poly)) return false;
  for (let i = 0; i < poly.length; i += 2) if (!pointInPolygon(poly[i]!, poly[i + 1]!, quad)) return true; // some of the shape lies outside it
  return false;
}

export function lassoSelect(objects: readonly ProjectedObject[], poly: ArrayLike<number>, filter: LassoFilter): ObjectId[] {
  if (poly.length < 6) return [];
  return objects.filter((po) => touches(po, poly, filter)).map((po) => po.obj.id);
}

/** Box selection: the same rule with a rectangle, for every kind of object. */
export function boxSelect(objects: readonly ProjectedObject[], box: Rect): ObjectId[] {
  const poly = [box.minX, box.minY, box.maxX, box.minY, box.maxX, box.maxY, box.minX, box.maxY];
  return objects.filter((po) => touches(po, poly, "all")).map((po) => po.obj.id);
}

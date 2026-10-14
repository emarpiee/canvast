import type { ProjectedObject } from "./projection";
import type { Rect } from "./geometry2d";
import { distToSegment, pointInPolygon, rectContains } from "./geometry2d";
import type { ObjectId } from "../doc/model";
import { exactStrokeEdgeDistancePx } from "./stroke-coverage";

/**
 * Object-specific hit tests over projected geometry. Callers pass candidates
 * (all visible objects today; spatial-index results in Phase 0C), and these
 * functions decide membership authoritatively.
 */

/** Pointer tolerance in CSS px around strokes. */
export const HIT_TOLERANCE_PX = 4;

export function hitsObject(po: ProjectedObject, x: number, y: number, tol = HIT_TOLERANCE_PX): boolean {
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
  if (po.obj.kind !== "stroke") {
    // Bounds-based picking (images and text boxes). Alpha-aware picking is not implemented yet.
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

/** All objects under the point, topmost first. `ordered` is in paint order. */
export function pickAll(ordered: readonly ProjectedObject[], x: number, y: number): ProjectedObject[] {
  const hits: ProjectedObject[] = [];
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (hitsObject(ordered[i]!, x, y)) hits.push(ordered[i]!);
  }
  return hits;
}

export type LassoFilter = "strokes" | "all";

/** Minimum fraction of a stroke's vertices that must lie inside a lasso. */
export const LASSO_STROKE_FRACTION = 0.5;

/**
 * Lasso membership:
 * - strokes: at least half of the stroke's vertices lie inside the lasso;
 * - images (only with the "all" filter): all four corners lie inside the
 *   lasso (full containment), so a small lasso drawn over a large image never
 *   grabs the image.
 */
export function lassoSelect(objects: readonly ProjectedObject[], poly: ArrayLike<number>, filter: LassoFilter): ObjectId[] {
  if (poly.length < 6) return [];
  const out: ObjectId[] = [];
  for (const po of objects) {
    if (po.obj.kind === "stroke") {
      const q = po.q;
      let inside = 0;
      for (let i = 0; i < q.length; i += 2) if (pointInPolygon(q[i]!, q[i + 1]!, poly)) inside++;
      if (inside / (q.length / 2) >= LASSO_STROKE_FRACTION) out.push(po.obj.id);
    } else if (filter === "all") {
      const [l, t, r, b] = po.q;
      if (
        pointInPolygon(l!, t!, poly) &&
        pointInPolygon(r!, t!, poly) &&
        pointInPolygon(r!, b!, poly) &&
        pointInPolygon(l!, b!, poly)
      ) {
        out.push(po.obj.id);
      }
    }
  }
  return out;
}

/** Box selection: objects whose screen bounds are fully inside the box. */
export function boxSelect(objects: readonly ProjectedObject[], box: Rect): ObjectId[] {
  return objects.filter((po) => rectContains(box, po.box)).map((po) => po.obj.id);
}

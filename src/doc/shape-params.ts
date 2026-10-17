/**
 * Shapes you can still change after drawing (ADR 0105): a rectangle, polygon or star keeps the numbers it was made from (`params`), so its
 * sides, points, ratio and corner radius can be edited later, and the nodes are made again from them. Editing the nodes by hand ends this
 * (the nodes are then the person's own): the object loses `params` and stays an ordinary path.
 */
import type { PathObject } from "./model";
import { CORNERED, DEFAULT_INNER, fittedShape, geometryBounds, nodeCount, shapeFromParams, type ShapeParams } from "./path";

/** The parameters of a shape that has them, or can be worked out: a shape drawn before they were kept, whose nodes are still exactly its kind's own. */
export function paramsOf(o: PathObject): ShapeParams | null {
  if (!o.shape || !CORNERED.includes(o.shape) && o.shape !== "ellipse") return null;
  if (o.params) return o.params;
  if (o.shape === "ellipse" || o.sub.length !== 1 || !o.sub[0]!.closed) return null;
  const b = geometryBounds(o.sub);
  const c = nodeCount(o.sub[0]!);
  const p: ShapeParams = { box: [b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY], ...(o.shape === "polygon" ? { sides: c } : o.shape === "star" ? { tips: c / 2, inner: DEFAULT_INNER } : {}) };
  const made = fittedShape(o.shape, p)[0]!;
  const size = Math.max(p.box[2], p.box[3]);
  const same = made.n.length === o.sub[0]!.n.length && made.n.every((v, i) => Math.abs(v - o.sub[0]!.n[i]!) <= 1e-6 * size);
  return same ? p : null;
}

export type ShapePatch = { sides?: number; tips?: number; inner?: number; radius?: number };

/** The shape made again with some of its numbers changed (null: it cannot be, its nodes are no longer the shape's own). */
export function withShapeParams(o: PathObject, patch: ShapePatch): PathObject | null {
  const p = paramsOf(o);
  if (!p || !o.shape) return null;
  const next: ShapeParams = { ...p, ...patch };
  const params: ShapeParams = next.radius ? next : (({ radius: _r, ...rest }) => rest)(next);
  return { ...o, sub: shapeFromParams(o.shape, params), params };
}

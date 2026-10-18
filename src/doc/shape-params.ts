/**
 * Shapes you can still change after drawing (ADR 0105): a rectangle, polygon or star keeps the numbers it was made from (`params`), so its
 * sides, points, ratio and corner radius can be edited later, and the nodes are made again from them. Editing the nodes by hand ends this
 * (the nodes are then the person's own): the object loses `params` and stays an ordinary path.
 */
import { canRound, clampRadius, nodesIn, roundCorners } from "./rounding";
import type { PathObject } from "./model";
import { CORNERED, DEFAULT_INNER, fittedShape, geometryBounds, nodeCount, type Radius, type ShapeParams, type SubPath } from "./path";

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

export type ShapePatch = { sides?: number; tips?: number; inner?: number };

/** The sharp geometry of a path: what its rounded corners are made from. */
const sharpOf = (o: PathObject): readonly SubPath[] => o.base ?? (o.params && o.shape ? fittedShape(o.shape, o.params) : o.sub);

/** The shape made again with some of its numbers changed, keeping its rounded corners (null: it cannot be, its nodes are no longer the shape's own). */
export function withShapeParams(o: PathObject, patch: ShapePatch): PathObject | null {
  const p = paramsOf(o);
  if (!p || !o.shape) return null;
  const params: ShapeParams = { ...p, ...patch };
  const base = fittedShape(o.shape, params);
  if (o.radius === undefined) return { ...o, params, sub: base };
  // (a radius for each corner no longer fits when the corners are not the same in number: it becomes the one that was largest)
  const radius = typeof o.radius === "number" || o.radius.length === nodesIn(base) ? o.radius : Math.max(...o.radius);
  return { ...o, params, radius, base, sub: roundCorners(base, radius, o.smoothing) };
}

/**
 * The path with its corners rounded by `radius` (0: sharp again). The sharp geometry is kept in `base`, so the radius can be changed and the
 * nodes edited later. The result of a boolean group keeps only the number: it is rounded as it is derived from its shapes.
 */
export function withRadius(o: PathObject, radius: Radius): PathObject {
  const zero = typeof radius === "number" ? !(radius > 0) : radius.every((v) => !(v > 0));
  const { radius: _r, base: _b, ...rest } = o;
  if (o.result !== undefined) return zero ? (rest as PathObject) : { ...rest, radius: typeof radius === "number" ? clampRadius(sharpOf(o), radius) : Math.max(...radius) };
  const base = sharpOf(o);
  const r = clampRadius(base, radius);
  return zero ? { ...rest, sub: base } : { ...rest, radius: r, base, sub: roundCorners(base, r, o.smoothing) };
}

/** Whether the path has corners that a radius would round (or is rounded now); a boolean group's result is judged by its own outline. */
const cornered = new WeakMap<PathObject, boolean>();
export function hasCorners(o: PathObject): boolean {
  let r = cornered.get(o);
  if (r === undefined) cornered.set(o, (r = o.radius !== undefined || canRound(sharpOf(o))));
  return r;
}

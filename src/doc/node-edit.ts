/**
 * A path's nodes as they are edited (shared by the canvas's Edit nodes tool and the Painting view's, ADR 0166): the nodes a path is edited
 * at (a turned path as it looks, a rounded one at its sharp corners), and the path again with nodes replaced (a rounded path keeps its
 * radius, the rounding made again; nodes edited by hand are no longer the shape's own parameters).
 */
import type { FrameSpace } from "../core/frames";
import type { PathObject } from "./model";
import { editSubs, homeObject } from "./model";
import { normalizeUnit } from "./edit-ops";
import type { SubPath } from "./path";
import { nodesIn, roundCorners } from "./rounding";

/** The nodes the path is edited at, and the path without its turn on those nodes. */
export function bakedPath(o: PathObject): { sub: readonly SubPath[]; flat: PathObject } {
  const { rot: _turn, ...flat } = o;
  const sub = editSubs(o);
  return { sub, flat: { ...flat, sub } };
}

/** The path with its nodes replaced by `sub` (as `bakedPath` gives them). */
export function rebuiltPath(o: PathObject, sub: readonly SubPath[], space: FrameSpace): PathObject {
  const { params: _own, ...flat } = bakedPath(o).flat;
  // (a radius for each corner no longer fits when nodes were added or taken away: it becomes the largest of them)
  const radius = o.radius !== undefined && typeof o.radius !== "number" && o.radius.length !== nodesIn(sub) ? Math.max(...o.radius) : o.radius;
  return homeObject(normalizeUnit((o.base && radius !== undefined ? { ...flat, radius, base: sub, sub: roundCorners(sub, radius, o.smoothing) } : { ...flat, sub }) as PathObject), space) as PathObject;
}

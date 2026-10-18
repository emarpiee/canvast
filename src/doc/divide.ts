/**
 * Dividing shapes into the regions they overlap in (Divide and the Shape builder, ADR 0145). The regions come from `faces.ts`; this turns
 * them into path objects that look like the shape on top of each (its fill and outline), all placed in the units of the back shape.
 */
import type { FrameSpace } from "../core/frames";
import type { Region } from "./boolean";
import { booleanOp } from "./boolean";
import { regionIn } from "./boolean-group";
import { facesOf, MAX_DIVIDE } from "./faces";
import type { PathObject } from "./model";
import { newObjectId } from "./model";

export interface RegionShape {
  /** Which of the shapes this region is inside (indices into the shapes given). */
  readonly inside: readonly number[];
  /** The region as a path, in the units of the back shape. */
  readonly obj: PathObject;
}

/** The look a region takes: the shape on top of the shapes it is inside, without its place or its links. */
export function pathLookOf(top: PathObject): Omit<PathObject, "sub" | "id" | "anchor" | "unit" | "z" | "frame"> {
  const { sub: _s, id: _i, anchor: _a, unit: _u, z: _z, frame: _f, rot: _r, shape: _sh, evenodd: _e, groups: _g, groupNames: _gn, boolOps: _b, radius: _rad, smoothing: _sm, base: _bs, params: _pm, initial: _in, name: _n, parent: _p, container: _c, result: _res, attachmentTargetId: _at, constraint: _co, ...look } = top;
  return { ...look, attachmentTargetId: null };
}

/** The regions of `shapes` (two to MAX_DIVIDE closed shapes), or a sentence saying why not. */
export function divideShapes(shapes: readonly PathObject[], space: FrameSpace): RegionShape[] | string {
  if (shapes.length < 2) return "Pick two or more shapes to divide.";
  if (shapes.length > MAX_DIVIDE) return `Divide takes up to ${MAX_DIVIDE} shapes at a time.`;
  const back = [...shapes].sort((a, b) => a.z - b.z)[0]!;
  const regions: Region[] = [];
  for (const o of shapes) {
    const r = regionIn(o, back, space);
    if (!r) return "Those shapes cannot be placed together.";
    regions.push(r);
  }
  const faces = facesOf(regions);
  if (!faces) return "Those outlines graze each other in a way that cannot be told apart: move one a little and try again.";
  return faces.map((f): RegionShape => {
    const top = f.inside.map((i) => shapes[i]!).sort((a, b) => b.z - a.z)[0]!;
    return {
      inside: f.inside,
      obj: { ...pathLookOf(top), id: newObjectId(), kind: "path", anchor: back.anchor, unit: back.unit, ...(back.frame ? { frame: back.frame } : {}), z: back.z, sub: f.subs } as PathObject,
    };
  });
}

/** Regions united into one path (the look of the one on top), or null when their outlines could not be united. */
export function uniteRegions(parts: readonly PathObject[]): PathObject | null {
  if (!parts.length) return null;
  const top = [...parts].sort((a, b) => b.z - a.z)[0]!;
  if (parts.length === 1) return top;
  const sub = booleanOp("union", parts.map((p) => ({ subs: p.sub, evenodd: false })));
  return sub && sub.length ? { ...top, id: newObjectId(), sub } : null;
}

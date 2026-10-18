/**
 * Masks (ADR 0144). An object is cut by a mask group: `mask: { by, mode }` names a group, and the objects of that group that are marked
 * `isMask` are the mask. They are not drawn or picked on their own (they are not in the spatial index); the renderer draws the object,
 * draws the mask, and keeps of the object what the mask lets through, by the mask's opacity (`alpha`) or brightness (`luminance`), or the
 * opposite when `invert`. The mask group and the object sit in a group of their own, so they move, stretch, turn, copy and delete together.
 */
import type { CanvasObject } from "./model";

export const isMaskObject = (o: CanvasObject | undefined | null): boolean => !!o && o.isMask === true;

/** The objects that make up the mask `by` (in paint order). */
export function maskMembers(all: Iterable<CanvasObject>, by: string): CanvasObject[] {
  const out: CanvasObject[] = [];
  for (const o of all) if (o.isMask === true && o.groups?.includes(by)) out.push(o);
  return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

/** The masks (group ids) that cut `objs`. */
export const masksOf = (objs: Iterable<CanvasObject>): string[] => [...new Set([...objs].flatMap((o) => (o.mask ? [o.mask.by] : [])))];

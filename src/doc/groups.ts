import type { CanvasObject, ObjectId } from "./model";
import { newObjectId } from "./model";

/**
 * Groups (ADR 0020). A group is membership, not a transform: every object
 * carries `groups`, the ids of the groups that contain it from the outermost
 * to the innermost. Moving, turning or scaling a group is the same exact
 * operation as on a multi-selection, applied to its members, so groups add
 * no second coordinate authority and no nested transforms to resolve at
 * draw or pick time.
 *
 * A level is the position in that path. At level 0 the "unit" an object
 * belongs to is its outermost group (or itself); when a group has been
 * entered, the level is one deeper.
 */
export const MAX_GROUP_DEPTH = 16;

/** The unit of `o` at `level`: its group at that depth, or the object itself. */
export const unitKey = (o: CanvasObject, level: number): string => o.groups?.[level] ?? o.id;

/** Whether `o` lies inside the entered groups (a path from the outermost). */
export const isInside = (o: CanvasObject, entered: readonly string[]): boolean => entered.every((id, i) => o.groups?.[i] === id);

/** Every object whose unit (at the level it is selected at) is that of one of `ids`. */
export function expandToUnits(all: readonly CanvasObject[], picked: readonly CanvasObject[], entered: readonly string[]): ObjectId[] {
  const level = (o: CanvasObject): number => (isInside(o, entered) ? entered.length : 0);
  const keys = new Set(picked.map((o) => `${level(o)}|${unitKey(o, level(o))}`));
  if (picked.every((o) => !o.groups?.length)) return picked.map((o) => o.id); // nothing grouped: no scan
  return all.filter((o) => keys.has(`${level(o)}|${unitKey(o, level(o))}`)).map((o) => o.id);
}

/** Put the objects in a new group at `level`. They must be whole units at that level. */
export function groupObjects(objects: readonly CanvasObject[], level: number, id: string = newObjectId()): CanvasObject[] {
  if (objects.some((o) => (o.groups?.length ?? 0) >= MAX_GROUP_DEPTH)) throw new RangeError("groups nest too deeply");
  return objects.map((o) => {
    const path = [...(o.groups ?? [])];
    path.splice(level, 0, id);
    return { ...o, groups: path };
  });
}

/** Dissolve the groups at `level` that contain these objects: their members move up one level. */
export function ungroupObjects(objects: readonly CanvasObject[], level: number): CanvasObject[] {
  const out: CanvasObject[] = [];
  for (const o of objects) {
    if (!o.groups || o.groups.length <= level) continue;
    const path = o.groups.filter((_, i) => i !== level);
    const { groups: _old, groupNames, ...rest } = o;
    const gone = o.groups[level]!;
    const { [gone]: _name, ...names } = groupNames ?? {};
    const kept = Object.keys(names).length ? { groupNames: names } : {};
    out.push((path.length ? { ...rest, ...kept, groups: path } : { ...rest, ...kept }) as CanvasObject);
  }
  return out;
}

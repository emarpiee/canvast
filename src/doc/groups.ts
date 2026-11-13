import type { CanvasObject, ObjectId } from "./model";
import { newObjectId } from "./model";
import { withDescendants } from "./containers";

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

/** Every object whose unit (at the level it is selected at) is that of one of `ids`, and what is on a sheet among them (ADR 0108). */
export function expandToUnits(all: readonly CanvasObject[], picked: readonly CanvasObject[], entered: readonly string[]): ObjectId[] {
  return withDescendants(all, expandGroups(all, picked, entered));
}

/**
 * What a marquee or a lasso takes (ADR 0031, revised): a touched object's group comes whole only when all of it lies inside the shape
 * (`within`), the outermost such group from the level reached; otherwise the touched object alone (or the group it is one thing with: a
 * boolean group, a pen's mark, a pattern). A click takes whole groups (`expandToUnits`).
 * Hidden members do not count. A sheet takes what is on it either way.
 */
export function unitsWithin(all: readonly CanvasObject[], picked: readonly CanvasObject[], entered: readonly string[], within: (o: CanvasObject) => boolean): ObjectId[] {
  if (picked.every((o) => !o.groups?.length)) return withDescendants(all, picked.map((o) => o.id)); // nothing grouped: no scan
  let members: Map<string, CanvasObject[]> | null = null;
  const membersOf = (gid: string): CanvasObject[] => {
    if (!members) {
      members = new Map();
      for (const o of all) for (const g of o.groups ?? []) {
        let list = members.get(g);
        if (!list) members.set(g, (list = []));
        list.push(o);
      }
    }
    return members.get(gid) ?? [];
  };
  const whole = new Map<string, boolean>();
  const isWhole = (gid: string): boolean => {
    let w = whole.get(gid);
    if (w === undefined) whole.set(gid, (w = membersOf(gid).every((m) => m.hidden || within(m))));
    return w;
  };
  // A group that is one thing is never split, as a single object is not: a boolean group (its result is made from its shapes), a pen's
  // mark (a pencil or ink line is a group of strokes), a pattern (made as one).
  const oneThing = (gid: string): boolean => membersOf(gid).some((m) => m.boolOps?.[gid] !== undefined || m.gen?.gid === gid) || membersOf(gid).every((m) => m.kind === "stroke");
  const ids = new Set<ObjectId>();
  for (const o of picked) {
    const path = o.groups ?? [];
    const gid = path.slice(isInside(o, entered) ? entered.length : 0).find((g) => isWhole(g) || oneThing(g));
    if (gid) for (const m of membersOf(gid)) ids.add(m.id);
    else ids.add(o.id);
  }
  return withDescendants(all, [...ids]);
}

function expandGroups(all: readonly CanvasObject[], picked: readonly CanvasObject[], entered: readonly string[]): ObjectId[] {
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

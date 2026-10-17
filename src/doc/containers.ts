/**
 * Sheets (ADR 0108): a sheet is a rectangle path with `container`, and the objects on it name it as their `parent`. Membership is
 * stored on the child (like a group's), so moving a sheet is moving it and everything on it, and no second coordinate system exists.
 */
import type { CanvasObject, ObjectId, PathObject } from "./model";

export const MAX_SHEET_DEPTH = 32;

export const isContainer = (o: CanvasObject | undefined | null): o is PathObject & { container: { clip: boolean } } => !!o && o.kind === "path" && !!o.container;

/** The sheets around `o`, innermost first. A sheet that is gone, or a loop in a hand-edited file, ends the chain. */
export function ancestorsOf(get: (id: ObjectId) => CanvasObject | undefined, o: CanvasObject): Array<PathObject & { container: { clip: boolean } }> {
  const out: Array<PathObject & { container: { clip: boolean } }> = [];
  let p = o.parent;
  while (p !== undefined && out.length < MAX_SHEET_DEPTH) {
    const f = get(p);
    if (!isContainer(f) || f.id === o.id || out.includes(f)) break;
    out.push(f);
    p = f.parent;
  }
  return out;
}

/** Every object on the sheets among `ids` (at any depth), not counting `ids` themselves. */
export function descendantsOf(all: Iterable<CanvasObject>, ids: ReadonlySet<ObjectId>): ObjectId[] {
  const kids = new Map<ObjectId, ObjectId[]>();
  for (const o of all) if (o.parent !== undefined) (kids.get(o.parent) ?? kids.set(o.parent, []).get(o.parent)!).push(o.id);
  const seen = new Set<ObjectId>(ids);
  const out: ObjectId[] = [];
  const stack = [...ids];
  while (stack.length) {
    for (const k of kids.get(stack.pop()!) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
      stack.push(k);
    }
  }
  return out;
}

/** `ids` plus everything on the sheets among them. */
export function withDescendants(all: Iterable<CanvasObject>, ids: readonly ObjectId[]): ObjectId[] {
  const list = [...all];
  if (!list.some((o) => isContainer(o) && ids.includes(o.id))) return [...ids];
  return [...ids, ...descendantsOf(list, new Set(ids))];
}

/** The objects of `objs` that are not inside another of them: the ones a move puts onto a (maybe different) sheet. */
export function rootsOf(objs: readonly CanvasObject[]): CanvasObject[] {
  const ids = new Set(objs.map((o) => o.id));
  return objs.filter((o) => o.parent === undefined || !ids.has(o.parent));
}

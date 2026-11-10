import type { CanvasObject, ObjectId } from "./model";
import { ancestorsOf } from "./containers";

/**
 * What belongs to shapes and goes where they go (one rule for the document and the Layers panel): the words in a shape or along a path, a
 * connector between two speech balloons, and the piece that covers its neck. They share their shapes' groups and sheet, never are shapes
 * of a boolean group, and are no layer of their own: a shape's row stands for them.
 */

/** The shape (or the first balloon) something belongs to, or undefined when it belongs to none. */
export function ownerOf(o: CanvasObject): ObjectId | undefined {
  if (o.kind === "text") return o.inShape?.shape ?? o.onPath?.path;
  const l = o.kind === "path" ? o.params?.link : undefined;
  return l ? l.a : undefined;
}

/** What belongs to these objects (words, connectors and their cover pieces), found in `all`. */
export function belongingTo(all: readonly CanvasObject[], ids: ReadonlySet<ObjectId>): CanvasObject[] {
  const links = new Set<ObjectId>();
  const out: CanvasObject[] = [];
  for (const o of all) {
    if (ids.has(o.id)) continue;
    const owner = ownerOf(o);
    if (owner !== undefined && ids.has(owner)) {
      out.push(o);
      if (o.kind === "path" && o.params?.link && o.params.link.cover === undefined) links.add(o.id);
    }
  }
  // (a cover piece names its connector, not a balloon)
  for (const o of all) if (o.kind === "path" && o.params?.link?.cover !== undefined && links.has(o.params.link.cover)) out.push(o);
  return out;
}

/** The place shapes share: the groups both are in (up to a boolean group, which only shapes go in) and the sheet both are on. */
export function sharedPlace(shapes: readonly CanvasObject[], get: (id: ObjectId) => CanvasObject | undefined): Pick<CanvasObject, "groups" | "groupNames" | "parent"> {
  const first = shapes[0]!;
  const chain = first.groups ?? [];
  let n = 0;
  while (n < chain.length && !first.boolOps?.[chain[n]!] && shapes.every((s) => s.groups?.[n] === chain[n])) n++;
  const groups = chain.slice(0, n);
  const names = Object.fromEntries(groups.flatMap((g) => (first.groupNames?.[g] !== undefined ? [[g, first.groupNames[g]!]] : [])));
  // the nearest sheet every one of them is on (the canvas when there is none)
  const lines = shapes.map((s) => [s.parent, ...ancestorsOf(get, s).slice(1).map((a) => a.id)].filter((x): x is ObjectId => x !== undefined));
  const parent = lines[0]!.find((p) => lines.every((l) => l.includes(p)));
  return { ...(groups.length ? { groups } : {}), ...(Object.keys(names).length ? { groupNames: names } : {}), ...(parent !== undefined ? { parent } : {}) };
}

/** `o` put in `place` (its own groups, names and sheet replaced). */
export function placedIn<T extends CanvasObject>(o: T, place: Pick<CanvasObject, "groups" | "groupNames" | "parent">): T {
  const { groups: _g, groupNames: _n, parent: _p, ...rest } = o;
  return { ...rest, ...place } as T;
}

/** Whether `o` already is in `place`. */
export const isIn = (o: CanvasObject, place: Pick<CanvasObject, "groups" | "groupNames" | "parent">): boolean =>
  (o.groups ?? []).join() === (place.groups ?? []).join() && o.parent === place.parent && JSON.stringify(o.groupNames ?? {}) === JSON.stringify(place.groupNames ?? {});

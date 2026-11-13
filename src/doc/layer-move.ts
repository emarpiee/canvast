import type { CanvasObject, ObjectId } from "./model";
import { MAX_GROUP_DEPTH } from "./groups";
import { MAX_SHEET_DEPTH, ancestorsOf, descendantsOf, isContainer } from "./containers";
import { belongingTo, ownerOf } from "./belongs";

/**
 * Moving rows of the Layers panel (a row is an object, a sheet with what is on it, or a group by its id) before, after or inside another row.
 * One rule for groups, boolean groups and sheets, as deep as their limits allow: what moves takes the place it is dropped at (the groups of
 * that place, then its own inner groups; the sheet of that place) and its stacking order, and stays where it is on the canvas. A boolean
 * group's result follows its members by itself (the document makes it again). Pure: the objects that change, or why nothing can.
 */
export type LayerPlace = "before" | "after" | "inside";

/** The members of a row: an object (a sheet: it and what is on it), or every member of a group. */
export function rowMembers(all: readonly CanvasObject[], key: string): CanvasObject[] {
  const o = all.find((x) => x.id === key);
  let found: CanvasObject[];
  if (o) {
    const ids = new Set(isContainer(o) ? [o.id, ...descendantsOf(all, new Set([o.id]))] : [o.id]);
    found = all.filter((x) => ids.has(x.id));
  } else found = all.filter((x) => x.groups?.includes(key));
  // (and what belongs to them: a shape's words, a balloon's connectors: doc/belongs.ts)
  const ids = new Set(found.map((x) => x.id));
  return [...found, ...belongingTo(all, ids).filter((x) => !ids.has(x.id))];
}

/**
 * `rowMembers` for many rows of one list at once (the Layers panel draws hundreds): the same members, found through maps made in one pass,
 * not a walk of every object for each row. In no set order.
 */
export function rowMembersIndex(all: readonly CanvasObject[]): (key: string) => CanvasObject[] {
  const byId = new Map<ObjectId, CanvasObject>();
  const kids = new Map<ObjectId, CanvasObject[]>();
  const inGroup = new Map<string, CanvasObject[]>();
  const owned = new Map<ObjectId, CanvasObject[]>();
  const covers = new Map<ObjectId, CanvasObject[]>();
  const add = <K>(m: Map<K, CanvasObject[]>, k: K, o: CanvasObject): void => void (m.get(k) ?? m.set(k, []).get(k)!).push(o);
  for (const o of all) {
    byId.set(o.id, o);
    if (o.parent !== undefined) add(kids, o.parent, o);
    if (o.attachmentTargetId !== null) add(kids, o.attachmentTargetId, o);
    for (const g of o.groups ?? []) add(inGroup, g, o);
    const owner = ownerOf(o);
    if (owner !== undefined) add(owned, owner, o);
    const cover = o.kind === "path" ? o.params?.link?.cover : undefined;
    if (cover !== undefined) add(covers, cover, o);
  }
  return (key) => {
    const o = byId.get(key);
    const found = new Map<ObjectId, CanvasObject>();
    if (o) {
      found.set(o.id, o);
      if (isContainer(o)) for (let i: CanvasObject[] = [o]; i.length; ) i = i.flatMap((x) => (kids.get(x.id) ?? []).filter((k) => !found.has(k.id) && found.set(k.id, k)));
    } else for (const m of inGroup.get(key) ?? []) found.set(m.id, m);
    // (and what belongs to them, as belongingTo: a shape's words, a balloon's connectors and their cover pieces)
    const extra = new Map<ObjectId, CanvasObject>();
    for (const id of found.keys()) for (const x of owned.get(id) ?? []) if (!found.has(x.id)) extra.set(x.id, x);
    for (const x of [...extra.values()]) if (x.kind === "path" && x.params?.link && x.params.link.cover === undefined) for (const c of covers.get(x.id) ?? []) if (!found.has(c.id)) extra.set(c.id, c);
    return [...found.values(), ...extra.values()];
  };
}

/** Whether a row can hold others: a group (a boolean one too) or a sheet. */
export const rowHolds = (all: readonly CanvasObject[], key: string): boolean => {
  const o = all.find((x) => x.id === key);
  return o ? isContainer(o) : all.some((x) => x.groups?.includes(key));
};

export function planLayerMove(all: readonly CanvasObject[], keys: readonly string[], target: string, place: LayerPlace): { next: CanvasObject[] } | { problem: string } {
  const get = new Map(all.map((o) => [o.id, o] as const));
  const tMembers = rowMembers(all, target);
  const tObj = get.get(target);
  const tAny = tObj ?? tMembers[0];
  if (!tAny || keys.includes(target)) return { problem: "Drop it on another layer." };
  if (place === "inside" && !rowHolds(all, target)) return { problem: "Only a group or a sheet can hold layers." };
  // Where it goes: the chain of groups and the sheet of that place.
  let path: readonly string[];
  let parent: ObjectId | undefined;
  if (tObj) {
    path = place === "inside" ? [] : (tObj.groups ?? []);
    parent = place === "inside" ? tObj.id : tObj.parent;
  } else {
    const at = tAny.groups!.indexOf(target);
    path = tAny.groups!.slice(0, place === "inside" ? at + 1 : at);
    parent = tAny.parent;
  }
  // What moves: each row's members with the inner groups they keep (a group keeps itself and what is inside it; an object leaves its groups).
  // (what is on a sheet that moves goes with it as it is: only its stacking order follows)
  const moving = new Map<ObjectId, { o: CanvasObject; keep: readonly string[]; inner: boolean }>();
  for (const key of keys) {
    const own = get.get(key);
    for (const m of rowMembers(all, key)) {
      if (moving.has(m.id)) continue;
      const inner = !!own && m.id !== own.id;
      const keep = own ? (inner ? (m.groups ?? []) : []) : (m.groups ?? []).slice(m.groups!.indexOf(key));
      moving.set(m.id, { o: m, keep, inner });
    }
  }
  if (!moving.size) return { problem: "Nothing to move." };
  if ([...moving.values()].some(({ o }) => o.locked)) return { problem: "A locked layer cannot be moved: unlock it first." };
  // Never into itself: a group into a group inside it, a sheet onto itself or onto what is on it.
  if (path.some((g) => keys.includes(g))) return { problem: "A group cannot go inside itself." };
  if (parent !== undefined && (moving.has(parent) || ancestorsOf((id) => get.get(id), get.get(parent)!).some((s) => moving.has(s.id)))) return { problem: "A sheet cannot go onto itself or onto what is on it." };
  // What the place's groups are called, and which of them are boolean groups (with their operation), as one of its members says.
  const names = Object.fromEntries(path.flatMap((g) => (tAny.groupNames?.[g] !== undefined ? [[g, tAny.groupNames[g]!]] : [])));
  const ops = Object.fromEntries(path.flatMap((g) => (tAny.boolOps?.[g] !== undefined ? [[g, tAny.boolOps[g]!]] : [])));
  if (Object.keys(ops).length && [...moving.values()].some(({ o, keep, inner }) => !inner && o.kind !== "path" && !keep.some((g) => o.boolOps?.[g])))
    return { problem: "Only shapes can go in a boolean group." };
  const sheetDepth = parent === undefined ? 0 : ancestorsOf((id) => get.get(id), get.get(parent)!).length + 1;
  const next: CanvasObject[] = [];
  for (const { o, keep, inner } of moving.values()) {
    if (inner) {
      next.push(o);
      continue;
    }
    const groups = [...path, ...keep];
    if (groups.length > MAX_GROUP_DEPTH) return { problem: `Groups go ${MAX_GROUP_DEPTH} deep at most.` };
    const ownNames = Object.fromEntries(keep.flatMap((g) => (o.groupNames?.[g] !== undefined ? [[g, o.groupNames[g]!]] : [])));
    const ownOps = Object.fromEntries(keep.flatMap((g) => (o.boolOps?.[g] !== undefined ? [[g, o.boolOps[g]!]] : [])));
    const allNames = { ...names, ...ownNames }, allOps = { ...ops, ...ownOps };
    // (on a sheet that moves too, it stays on it; else it takes the sheet of the place)
    const onMoving = o.parent !== undefined && moving.has(o.parent);
    const p = onMoving ? o.parent : parent;
    if (!onMoving && p !== undefined && sheetDepth > MAX_SHEET_DEPTH) return { problem: `Sheets go ${MAX_SHEET_DEPTH} deep at most.` };
    const { groups: _g, groupNames: _n, boolOps: _b, parent: _p, ...rest } = o;
    next.push({ ...rest, ...(groups.length ? { groups } : {}), ...(Object.keys(allNames).length ? { groupNames: allNames } : {}), ...(Object.keys(allOps).length ? { boolOps: allOps } : {}), ...(p !== undefined ? { parent: p } : {}) } as CanvasObject);
  }
  // The stacking order: just in front of the place's frontmost member (before, inside), or just behind its backmost (after).
  const ids = new Set(moving.keys());
  const rest = [...all].filter((o) => !ids.has(o.id)).sort((a, b) => a.z - b.z);
  const own = next.sort((a, b) => a.z - b.z);
  const tz = tMembers.filter((m) => !ids.has(m.id)).map((m) => m.z);
  const pivot = place === "after" ? Math.min(...tz) : Math.max(...tz);
  const at = rest.findIndex((o) => o.z === pivot) + (place === "after" ? 0 : 1);
  const order = [...rest.slice(0, at), ...own, ...rest.slice(at)];
  const out = new Map<ObjectId, CanvasObject>(own.map((o) => [o.id, o]));
  order.forEach((o, z) => {
    const now = out.get(o.id) ?? o;
    if (now.z !== z || out.has(o.id)) out.set(o.id, { ...now, z } as CanvasObject);
  });
  return { next: [...out.values()] };
}

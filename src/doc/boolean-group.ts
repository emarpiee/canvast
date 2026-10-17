/**
 * Boolean groups (ADR 0103): a non-destructive Boolean operation. A boolean group is an ordinary group (doc/groups.ts) with an
 * operation: its members are the shapes you combined, which stay in the document as real paths that can be moved, stretched, turned, edited
 * node by node, hidden and deleted; and one more object, its *result* (a path with `result` set to the group's id), that is what the group
 * looks like on the canvas, with its own fill and outline. The result is never edited directly: it is derived from the members, inside the
 * transaction that changes them (`withDerived`, called by DocumentStore.transaction), so that undo and redo, which replay whole
 * transactions, can never find a result that does not match its members.
 *
 * Every object in a boolean group carries `boolOps` (its group id to the operation, for each boolean group it is in), so the operation is
 * stored once per object and no group record is needed. Groups nest: the result of an inner group is an operand of the outer one.
 *
 * `groups` of a member is [outer groups…, gid]; of a result, the same ([outer groups…, gid]), so selecting any of them selects the whole
 * unit. What an object is *to* a group: a member or the group's own result. Members are hidden (not drawn, not in the spatial index, not
 * picked) unless their group has been entered; the result is what is drawn and picked.
 */
import { booleanOp, type BoolOp, type Region } from "./boolean";
import { normalizeUnit } from "./edit-ops";
import type { FrameSpace } from "../core/frames";
import * as D from "../core/dyadic";
import type { CanvasObject, ObjectId, PathObject } from "./model";
import { expressObjectIn, homeObject, newObjectId, pathSubs } from "./model";
import { mapSubs, roundCorners } from "./path";

/** The boolean groups an object is in, outermost first, each with whether the object is that group's own result. */
export function boolGroupsOf(o: CanvasObject): Array<{ gid: string; op: BoolOp; own: boolean }> {
  if (!o.boolOps) return [];
  const out: Array<{ gid: string; op: BoolOp; own: boolean }> = [];
  for (const gid of o.groups ?? []) {
    const op = o.boolOps[gid];
    if (op) out.push({ gid, op, own: o.kind === "path" && o.result === gid });
  }
  return out;
}

/** Whether `o` is the derived result of a boolean group. */
export const isResult = (o: CanvasObject): o is PathObject => o.kind === "path" && o.result !== undefined;

/** Whether `o` is hidden inside some boolean group (it is a member of one, or the result of an inner one, and is not that group's own result). */
export const isBoolMember = (o: CanvasObject): boolean => boolGroupsOf(o).some((g) => !g.own);

/** The id of the group `o` is a direct operand of, or null: a path whose innermost group is boolean (a member), or the result of a boolean group inside one. */
export function operandOf(o: CanvasObject): string | null {
  const g = o.groups;
  if (!g?.length || o.kind !== "path") return null;
  const own = o.result;
  const parent = own !== undefined ? g[g.indexOf(own) - 1] : g[g.length - 1];
  return parent !== undefined && o.boolOps?.[parent] ? parent : null;
}

/** The direct operands of a group, back to front. */
export const operandsOf = (all: Iterable<CanvasObject>, gid: string): CanvasObject[] =>
  [...all].filter((o) => operandOf(o) === gid).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));

/** The result object of a group in `all`, if there is one. */
export const resultOf = (all: Iterable<CanvasObject>, gid: string): PathObject | undefined => {
  for (const o of all) if (isResult(o) && o.result === gid) return o;
  return undefined;
};

/** The operation of a group, from any of its objects. */
export function opOf(all: Iterable<CanvasObject>, gid: string): BoolOp | undefined {
  for (const o of all) {
    const op = o.boolOps?.[gid];
    if (op) return op;
  }
  return undefined;
}

/** A path as a Boolean operand: its sub-paths turned and placed in the units of `base`, exactly (the anchors differ by an exact amount, the rest is one rounding). */
function regionIn(o: PathObject, base: PathObject, space: FrameSpace): Region | null {
  const e = expressObjectIn(o, base.frame ?? space.world) as PathObject;
  const k = 2 ** (e.unit - base.unit);
  const dx = D.toNumber(D.shift(D.sub(e.anchor.x, base.anchor.x), -base.unit));
  const dy = D.toNumber(D.shift(D.sub(e.anchor.y, base.anchor.y), -base.unit));
  if (!(k > 0 && Number.isFinite(k + dx + dy))) return null;
  return { subs: mapSubs(pathSubs(e), (x, y) => [x * k + dx, y * k + dy]), evenodd: !!o.evenodd };
}

export type Derivation = { upsert: PathObject[]; remove: ObjectId[] } | null;

/**
 * What a group's result should be, from its operands (hidden ones are left out): the result object to store, or the id of the one to
 * remove when nothing is left. null: the operation could not be done (outlines that graze undecidably, shapes too different in size), the
 * result is left as it is.
 */
export function deriveResult(all: readonly CanvasObject[], gid: string, space: FrameSpace): Derivation {
  const existing = resultOf(all, gid);
  const ops = operandsOf(all, gid).filter((o): o is PathObject => o.kind === "path" && !o.hidden);
  if (!ops.length) return { upsert: [], remove: existing ? [existing.id] : [] };
  const op = opOf(all, gid)!;
  const base = ops[0]!;
  const regions: Region[] = [];
  for (const o of ops) {
    const r = regionIn(o, base, space);
    if (!r) return null;
    regions.push(r);
  }
  const raw = ops.length === 1 ? regions[0]!.subs : booleanOp(op, regions);
  if (!raw) return null;
  // The group's own corner radius rounds the corners of the result (the shapes keep their own); it is in the result's units, which may differ from the back shape's.
  const radius = typeof existing?.radius === "number" ? existing.radius * 2 ** ((existing.unit ?? 0) - base.unit) : 0;
  const loops = radius > 0 ? roundCorners(raw, radius) : raw;
  if (!loops.length) return { upsert: [], remove: existing ? [existing.id] : [] };
  const chain = (base.groups ?? []).slice(0, (base.groups ?? []).indexOf(gid) + 1);
  const bools = Object.fromEntries(Object.entries(base.boolOps ?? {}).filter(([k]) => chain.includes(k)));
  // The result's own look is kept (it is the group's fill and outline); a new one starts as the back shape's.
  const look = existing ?? { fill: base.fill, stroke: base.stroke, width: base.width, ...(base.join ? { join: base.join } : {}), ...(base.cap ? { cap: base.cap } : {}), ...(base.align ? { align: base.align } : {}), opacity: base.opacity, ...(base.blend ? { blend: base.blend } : {}) };
  const { sub: _s, rot: _r, shape: _sh, evenodd: _e, anchor: _a, unit: _u, frame: _f, groups: _g, boolOps: _b, radius: _rad, base: _bs, params: _pm, ...keep } = look as PathObject;
  const result: PathObject = {
    ...keep,
    id: existing?.id ?? newObjectId(),
    kind: "path",
    ...(base.frame ? { frame: base.frame } : {}),
    anchor: base.anchor,
    unit: base.unit,
    z: existing?.z ?? base.z,
    attachmentTargetId: null,
    sub: loops,
    ...(radius > 0 ? { radius } : {}),
    groups: chain,
    boolOps: bools,
    result: gid,
  } as PathObject;
  return { upsert: [homeObject(normalizeUnit(result), space) as PathObject], remove: [] };
}

/** What changing objects does to the boolean groups they are in: the results to store and to remove, innermost group first (an inner result is an operand of the outer). */
export interface DerivationSource {
  get(id: ObjectId): CanvasObject | undefined;
  all(): Iterable<CanvasObject>;
  readonly space: FrameSpace;
}

function derive(src: DerivationSource, overlay: Map<ObjectId, CanvasObject | null>, affected: Set<string>): Map<ObjectId, CanvasObject | null> {
  const view = (): CanvasObject[] => {
    const out: CanvasObject[] = [];
    for (const o of src.all()) {
      const v = overlay.has(o.id) ? overlay.get(o.id) : o;
      if (v) out.push(v);
    }
    for (const [id, o] of overlay) if (o && !src.get(id)) out.push(o);
    return out;
  };
  const done = new Set<string>();
  const changed = new Map<ObjectId, CanvasObject | null>();
  for (;;) {
    const all = view();
    const pending = [...affected].filter((g) => !done.has(g));
    if (!pending.length) break;
    // the innermost first: its result is an operand of the group outside it
    const depth = (gid: string): number => {
      let d = 0;
      for (const o of all) {
        const i = o.groups?.indexOf(gid) ?? -1;
        if (i > d) d = i;
      }
      return d;
    };
    pending.sort((a, b) => depth(b) - depth(a));
    const gid = pending[0]!;
    done.add(gid);
    const r = deriveResult(all, gid, src.space);
    if (!r) continue;
    for (const o of r.upsert) {
      overlay.set(o.id, o);
      changed.set(o.id, o);
      for (const outer of Object.keys(o.boolOps ?? {})) if (outer !== gid) affected.add(outer); // the group this result is an operand of
    }
    for (const id of r.remove) {
      overlay.set(id, null);
      changed.set(id, null);
    }
  }
  return changed;
}

/**
 * The transaction's objects with the boolean results that depend on them brought up to date. Called with the objects a transaction replaces
 * (`next`) and deletes (`removed`); returns the same with the results added, replaced or removed. Nothing to do when none of the objects,
 * before or after, is in a boolean group.
 */
export function withDerived(src: DerivationSource, next: readonly CanvasObject[], removed: readonly ObjectId[]): { next: CanvasObject[]; removed: ObjectId[] } {
  const affected = new Set<string>();
  const note = (o: CanvasObject | undefined): void => {
    for (const g of Object.keys(o?.boolOps ?? {})) affected.add(g);
  };
  for (const o of next) {
    note(o);
    note(src.get(o.id));
  }
  for (const id of removed) note(src.get(id));
  if (!affected.size) return { next: [...next], removed: [...removed] };
  const overlay = new Map<ObjectId, CanvasObject | null>();
  for (const o of next) overlay.set(o.id, o);
  for (const id of removed) overlay.set(id, null);
  const changed = derive(src, overlay, affected);
  const outNext = new Map(next.map((o) => [o.id, o] as const));
  const outRemoved = new Set(removed);
  for (const [id, o] of changed) {
    if (o) {
      outNext.set(id, o);
      outRemoved.delete(id);
    } else if (src.get(id) || outNext.has(id)) {
      outNext.delete(id);
      outRemoved.add(id);
    }
  }
  return { next: [...outNext.values()], removed: [...outRemoved] };
}

/**
 * The results as they would be with some objects shown changed (a move or an edit being dragged), for drawing while it goes on. The results of
 * groups whose own result is among the changed objects are left to it (a whole group being moved moves its result as it is).
 */
export function previewResults(src: DerivationSource, changed: ReadonlyMap<ObjectId, CanvasObject | null>): CanvasObject[] {
  const affected = new Set<string>();
  for (const [id, o] of changed) {
    const base = src.get(id);
    if (!(o ?? base) || !isBoolMember(o ?? base!)) continue;
    for (const g of boolGroupsOf(o ?? base!)) if (!g.own) affected.add(g.gid);
  }
  for (const [id] of changed) {
    const o = src.get(id);
    if (o && isResult(o)) affected.delete(o.result!);
  }
  if (!affected.size) return [];
  const overlay = new Map(changed);
  return [...derive(src, overlay, affected).values()].filter((o): o is CanvasObject => o !== null);
}

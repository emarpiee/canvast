import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { Frame, FrameSpace } from "../core/frames";
import type { CanvasObject, SerializedObject } from "./model";
import { deserializeObject, homeObject, newObjectId, serializeObject } from "./model";
import { unionBounds } from "./edit-ops";

/**
 * Copy and paste of canvas objects (ADR 0038). The clipboard holds the objects' stored form, the frame and depth
 * (log2 pixels per unit) of the view they were copied from, and the centre of their box. Pasting puts them centred
 * on a chosen point of the current view at the size they had on screen when copied: positions and sizes move by an
 * exact power of two (`unit` and the anchor offset shift together), so the geometry is never recomputed and
 * nothing is rounded, at any depth.
 */
export interface ClipboardPayload {
  v: 1;
  objects: SerializedObject[];
  /** Uid of the frame of the view the copy was made in, and that view's depth (levels). */
  viewFrame: string;
  depth: number;
  /** Centre of the objects' box in that frame (dyadic strings), or null when they are in other frames. */
  centre: [string, string] | null;
}

export class ClipboardError extends Error {}

export function buildPayload(objs: readonly CanvasObject[], viewFrame: Frame, depth: number): ClipboardPayload {
  const space = viewFrame.space;
  const inView = objs.every((o) => (o.frame ?? space.world) === viewFrame);
  const b = inView ? unionBounds(objs) : null;
  return {
    v: 1,
    // Hidden and locked are states of the copy's origin, not of the objects as pasted.
    objects: objs.map((o) => {
      const s = serializeObject(o);
      delete s["hidden"];
      delete s["locked"];
      return s;
    }),
    viewFrame: space.uidOf(viewFrame),
    depth,
    centre: b ? [D.toString(D.shift(D.add(b.min.x, b.max.x), -1)), D.toString(D.shift(D.add(b.min.y, b.max.y), -1))] : null,
  };
}

/** Parse a payload read from storage or the clipboard; null if it is not one. */
export function parsePayload(text: string): ClipboardPayload | null {
  try {
    const p = JSON.parse(text) as Partial<ClipboardPayload>;
    return p && p.v === 1 && Array.isArray(p.objects) && p.objects.length && typeof p.viewFrame === "string" && typeof p.depth === "number" ? (p as ClipboardPayload) : null;
  } catch {
    return null;
  }
}

/**
 * New objects (new ids, groups renamed together) from a payload, for `space`. With a `target` (the view's frame, the
 * point to centre them on and the view's depth) they are moved there at their on-screen size when the copy was made in the
 * same frame; otherwise they come back where they were. Stacking order is kept: `z` starts above `zTop`.
 */
export function instantiate(p: ClipboardPayload, space: FrameSpace, zTop: number, target?: { frame: Frame; at: WorldPoint; depth: number }): { objects: CanvasObject[]; moved: boolean } {
  let objs: CanvasObject[];
  try {
    objs = p.objects.map((s) => deserializeObject(s, space));
  } catch (e) {
    throw new ClipboardError(`These objects belong to a space that this canvas does not have (${(e as Error).message}).`);
  }
  const groupIds = new Map<string, string>();
  const regroup = (g: string): string => groupIds.get(g) ?? (groupIds.set(g, newObjectId()), groupIds.get(g)!);
  const sameFrame = !!target && !!p.centre && space.uidOf(target.frame) === p.viewFrame && objs.every((o) => (o.frame ?? space.world) === target.frame);
  const k = sameFrame ? Math.round(p.depth - target!.depth) : 0;
  const centre = sameFrame ? { x: D.parse(p.centre![0]), y: D.parse(p.centre![1]) } : null;
  const ordered = [...objs].sort((a, b) => a.z - b.z);
  // (a frame copied with what is inside it: the copies name the copied frame; one copied alone keeps its frame)
  const copyId = new Map(ordered.map((o) => [o.id, newObjectId()]));
  // A mask copied without anything it cuts is just objects again (they would be invisible otherwise).
  const cuts = new Set(ordered.flatMap((o) => (o.mask ? [o.mask.by] : [])));
  const out = ordered.map((o0, i): CanvasObject => {
    const o: CanvasObject = o0.isMask && !(o0.groups ?? []).some((g) => cuts.has(g)) ? (({ isMask: _m, ...rest }) => rest as CanvasObject)(o0) : o0;
    const moved: CanvasObject = centre
      ? {
          ...o,
          unit: o.unit + k,
          ...(o.kind === "path" && o.initial ? { initial: { ...o.initial, unit: o.initial.unit + k } } : {}),
          anchor: { x: D.add(target!.at.x, D.shift(D.sub(o.anchor.x, centre.x), k)), y: D.add(target!.at.y, D.shift(D.sub(o.anchor.y, centre.y), k)) },
        }
      : o;
    return homeObject({ ...moved, id: copyId.get(o.id)!, z: zTop + 1 + i, ...(o.parent !== undefined ? { parent: copyId.get(o.parent) ?? o.parent } : {}), ...(o.attachmentTargetId !== null ? { attachmentTargetId: copyId.get(o.attachmentTargetId) ?? null } : {}), ...(o.groups ? { groups: o.groups.map(regroup) } : {}), ...(o.groupNames ? { groupNames: Object.fromEntries(Object.entries(o.groupNames).map(([k, v]) => [regroup(k), v])) } : {}), ...(o.boolOps ? { boolOps: Object.fromEntries(Object.entries(o.boolOps).map(([k, v]) => [regroup(k), v])) } : {}), ...(o.mask ? { mask: { ...o.mask, by: regroup(o.mask.by) } } : {}), ...(o.kind === "path" && o.result !== undefined ? { result: regroup(o.result) } : {}) } as CanvasObject, space);
  });
  return { objects: out, moved: sameFrame };
}

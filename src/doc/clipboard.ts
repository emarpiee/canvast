import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { Frame, FrameSpace } from "../core/frames";
import type { CanvasObject, SerializedObject } from "./model";
import { deserializeObject, expressObjectIn, homeObject, inFrame, newObjectId, serializeObject } from "./model";
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
  /** Centre of the objects' box in that frame (dyadic strings); null only in a payload of an older version, when they were in other frames. */
  centre: [string, string] | null;
}

export class ClipboardError extends Error {}

export function buildPayload(objs: readonly CanvasObject[], viewFrame: Frame, depth: number): ClipboardPayload {
  const space = viewFrame.space;
  // (all in the view's frame, whichever frames they live in: what is pasted is placed from the view, never from where it came)
  const here = objs.map((o) => expressObjectIn(o, viewFrame));
  const b = unionBounds(here);
  return {
    v: 1,
    // Hidden and locked are states of the copy's origin, not of the objects as pasted.
    objects: here.map((o) => {
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
 * point to centre them on and the view's depth) they are moved there at their on-screen size, from any frame or canvas: the
 * payload holds them in the frame of the view they were copied from. Without one they come back where they were. Stacking order is kept: `z` starts above `zTop`.
 */
/** What a copy holds that names other objects, pointed at their copies: words stay with a shape that is copied too, and a connector with its balloons. */
function linksCopied(o: CanvasObject, copyId: ReadonlyMap<string, string>): Partial<CanvasObject> {
  if (o.kind === "text" && o.inShape?.shape !== undefined) {
    const { shape, ...rest } = o.inShape;
    const to = copyId.get(shape);
    return { inShape: to ? { ...rest, shape: to } : rest } as Partial<CanvasObject>;
  }
  const l = o.kind === "path" ? o.params?.link : undefined;
  if (o.kind === "path" && l) return { params: { ...o.params!, link: { ...l, a: copyId.get(l.a) ?? l.a, b: copyId.get(l.b) ?? l.b, ...(l.cover ? { cover: copyId.get(l.cover) ?? l.cover } : {}) } } } as Partial<CanvasObject>;
  return {};
}

export function instantiate(p: ClipboardPayload, space: FrameSpace, zTop: number, target?: { frame: Frame; at: WorldPoint; depth: number }): { objects: CanvasObject[]; moved: boolean } {
  let objs: CanvasObject[];
  try {
    // (placed from the view: the frame they came from need not exist here, on another canvas)
    const placed = !!target && !!p.centre;
    objs = p.objects.map((s) => {
      if (!placed) return deserializeObject(s, space);
      const { frame: _from, ...rest } = s;
      return deserializeObject(rest as typeof s, space);
    });
  } catch (e) {
    throw new ClipboardError(`These objects belong to a space that this canvas does not have (${(e as Error).message}).`);
  }
  const groupIds = new Map<string, string>();
  const regroup = (g: string): string => groupIds.get(g) ?? (groupIds.set(g, newObjectId()), groupIds.get(g)!);
  const sameFrame = !!target && !!p.centre;
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
      ? inFrame(
          o,
          target!.frame,
          { x: D.add(target!.at.x, D.shift(D.sub(o.anchor.x, centre.x), k)), y: D.add(target!.at.y, D.shift(D.sub(o.anchor.y, centre.y), k)) },
          o.unit + k,
        )
      : o;
    const links = linksCopied(moved, copyId);
    return homeObject({ ...moved, ...links, id: copyId.get(o.id)!, z: zTop + 1 + i, ...(o.parent !== undefined ? { parent: copyId.get(o.parent) ?? o.parent } : {}), ...(o.attachmentTargetId !== null ? { attachmentTargetId: copyId.get(o.attachmentTargetId) ?? null } : {}), ...(o.groups ? { groups: o.groups.map(regroup) } : {}), ...(o.groupNames ? { groupNames: Object.fromEntries(Object.entries(o.groupNames).map(([k, v]) => [regroup(k), v])) } : {}), ...(o.boolOps ? { boolOps: Object.fromEntries(Object.entries(o.boolOps).map(([k, v]) => [regroup(k), v])) } : {}), ...(o.mask ? { mask: { ...o.mask, by: regroup(o.mask.by) } } : {}), ...(o.gen ? { gen: { ...o.gen, gid: regroup(o.gen.gid) } } : {}), ...(o.kind === "path" && o.result !== undefined ? { result: regroup(o.result) } : {}) } as CanvasObject, space);
  });
  return { objects: out, moved: sameFrame };
}

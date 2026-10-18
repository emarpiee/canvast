import type { Viewport } from "../core/camera";
import type { FrameCamera } from "../core/frames";
import type { DocumentStore } from "../doc/document-store";
import type { EditorState } from "../app/editor-state";
import type { CanvasObject, ObjectId } from "../doc/model";
import { isBoolMember, isResult, operandOf, operandsOf, previewResults } from "../doc/boolean-group";
import type { FrameIndex } from "../scene/frame-index";
import { cameraIn } from "../scene/frame-index";
import type { ProjectedObject } from "./projection";
import { cellFrame, coverObject, projectEntry, projectObject } from "./projection";
import { approxCoarse, classifyCoarse } from "./coarse";
import { ancestorsOf } from "../doc/containers";
import { maskMembers } from "../doc/masks";
import type { FrameCamera as FC } from "../core/frames";

/** How see-through a moving selection looks, and the largest selection that gets it (above that, drawing it one by one would slow the drag). */
export const GHOST_OPACITY = 0.6;
export const GHOST_MAX = 200;
/** How see-through a picked mask is drawn. */
export const MASK_GHOST = 0.45;

const maskCache = new WeakMap<DocumentStore, { revision: number; byGroup: Map<string, CanvasObject[]> }>();
/** The objects of a mask group, in paint order (cached until the document changes). */
function membersOfMask(doc: DocumentStore, by: string): CanvasObject[] {
  let c = maskCache.get(doc);
  if (!c || c.revision !== doc.revision) maskCache.set(doc, (c = { revision: doc.revision, byGroup: new Map() }));
  let list = c.byGroup.get(by);
  if (!list) c.byGroup.set(by, (list = maskMembers(doc.all(), by)));
  return list;
}

const hiddenCache = new WeakMap<DocumentStore, { revision: number; list: CanvasObject[] }>();
/**
 * The objects that are hidden (and not mask parts), projected for this view, to show where they are while Reveal is on (ADR 0153): they are in no
 * index, so the list is made once for each state of the document and only the first `limit` of it is looked at.
 */
export function hiddenInView(doc: DocumentStore, fc: FC, vp: Viewport, limit = 400): ProjectedObject[] {
  let c = hiddenCache.get(doc);
  if (!c || c.revision !== doc.revision) hiddenCache.set(doc, (c = { revision: doc.revision, list: [...doc.all()].filter((o) => o.hidden && !o.isMask) }));
  const out: ProjectedObject[] = [];
  for (const o of c.list.slice(0, limit)) {
    const cam = cameraIn(fc, o.frame ?? doc.space.world);
    const po = cam && projectObject(o, cam, vp, { keepTiny: true });
    if (po && !po.cover) out.push(po);
  }
  return out;
}

/** Give each object that has a mask (ADR 0144) the mask's objects, projected on their own, to be drawn through. A mask with nothing in it cuts nothing. */
function withMasks(doc: DocumentStore, fc: FC, vp: Viewport, list: ProjectedObject[], now: (o: CanvasObject) => CanvasObject | null): ProjectedObject[] {
  if (!list.some((po) => po.obj.mask)) return list;
  for (const po of list) {
    const m = po.obj.mask;
    if (!m) continue;
    const mine: ProjectedObject[] = [];
    for (const o0 of membersOfMask(doc, m.by)) {
      const o = o0.hidden ? null : now(o0); // (a mask being moved cuts as it is moved)
      if (!o) continue;
      const cam = cameraIn(fc, o.frame ?? doc.space.world);
      const p = cam ? projectObject(o, cam, vp, { keepTiny: true }) : null;
      if (p) mine.push(p);
    }
    if (mine.length) po.maskPos = mine;
  }
  return list;
}

export interface VisibleStats {
  levelsVisited: number;
  cellsProbed: number;
  candidates: number;
}

/**
 * Visible objects in paint order, projected for the current camera, with
 * any interaction preview applied. Rendering and hit testing both consume this
 * list, so they always agree.
 *
 * Candidates come from each frame's spatial index, queried with the camera
 * expressed in that frame (ADR 0014), so every number stays small (cells
 * overlapping the viewport at every level whose objects can be at least a
 * quarter pixel); each candidate
 * is then projected and culled exactly. Objects with an active preview (being
 * moved or resized) are projected from their preview state instead, since the
 * index holds their committed position.
 */
/** What of a boolean group (ADR 0103) the caller wants besides the plain objects: `pick`: the members of the innermost entered group, and not its result (so a click reaches the shape under it); `members`: only those members (to draw their outlines). */
export interface BoolView {
  readonly entered: readonly string[];
  readonly mode: "pick" | "members";
  /** Also these objects when they are masks (ADR 0144): a picked mask is shown and reachable, though it is in no index. */
  readonly also?: ReadonlySet<ObjectId>;
}

const operandCache = new WeakMap<DocumentStore, { revision: number; byGroup: Map<string, CanvasObject[]> }>();
/** The direct operands of a boolean group, back to front (cached until the document changes). */
function operandsIn(doc: DocumentStore, gid: string): CanvasObject[] {
  let c = operandCache.get(doc);
  if (!c || c.revision !== doc.revision) operandCache.set(doc, (c = { revision: doc.revision, byGroup: new Map() }));
  let list = c.byGroup.get(gid);
  if (!list) c.byGroup.set(gid, (list = operandsOf(doc.all(), gid)));
  return list;
}

export function visibleObjects(
  doc: DocumentStore,
  index: FrameIndex,
  editor: EditorState | null,
  fc: FrameCamera,
  vp: Viewport,
  stats?: VisibleStats,
  bool?: BoolView,
): ProjectedObject[] {
  const previewIds0: ReadonlySet<ObjectId> = editor ? editor.previewIds() : new Set();
  // A member being moved or edited changes its group's result: the result as it would be, shown while the gesture goes on (ADR 0103).
  const derived = new Map<ObjectId, CanvasObject>();
  if (editor && previewIds0.size) {
    const shown = new Map<ObjectId, CanvasObject | null>();
    for (const id of previewIds0) {
      const o = doc.get(id);
      if (o) shown.set(id, editor.previewed(o));
    }
    for (const o of previewResults(doc, shown)) derived.set(o.id, o);
  }
  const previewIds: ReadonlySet<ObjectId> = derived.size ? new Set([...previewIds0, ...derived.keys()]) : previewIds0;
  const out: ProjectedObject[] = [];
  const entered = bool?.entered ?? [];
  const inner = entered[entered.length - 1];
  const project = (o: CanvasObject): void => {
    const cam = cameraIn(fc, o.frame ?? doc.space.world);
    const po = cam && projectObject(o, cam, vp);
    if (po) out.push(po);
  };
  if (bool?.mode === "members") {
    // Only the members of the entered group, as they are now (or as being moved).
    if (inner) for (const o of operandsIn(doc, inner)) if (!o.hidden) { const v = editor && previewIds.has(o.id) ? editor.previewed(o) : o; if (v) project(v); }
    out.sort((a, b) => a.obj.z - b.obj.z || (a.obj.id < b.obj.id ? -1 : 1));
    return out;
  }
  let levelsVisited = 0;
  let cellsProbed = 0;
  let candidates = 0;
  for (const { cam, index: ix, coarse } of index.views(fc)) {
    const q = ix.query(cam, vp);
    levelsVisited += q.levelsVisited;
    cellsProbed += q.cellsProbed;
    candidates += q.candidates;
    for (const cell of q.cells) {
      const cf = coarse ? null : cellFrame(cell, cam, vp);
      for (const e of cell.entries) {
        if (previewIds.has(e.obj.id)) continue;
        // Inside a boolean group the shapes under the pointer are its members; its result is not what a click is after.
        if (bool && inner && isResult(e.obj) && entered.includes(e.obj.result!)) continue;
        if (coarse) {
          // Far coarser than the camera: covers the view, misses it, or an edge is near (render/coarse.ts).
          const r = classifyCoarse(e.obj, coarse.center, coarse.info, vp, coarse.terms);
          if (r === "miss") continue;
          const exact = r === "exact" ? coarse.exactCam() : null;
          // Out of exact range (> COARSE_EXACT_MAX levels): a dimmed approximate fill instead of nothing (ADR 0016).
          const po = r !== "exact" ? coverObject(e.obj, vp, r) : exact ? projectObject(e.obj, exact, vp) : coverObject(e.obj, vp, approxCoarse(e.obj, coarse.center, coarse.info, vp));
          if (po) out.push(po);
          continue;
        }
        const po = projectEntry(e, cf!, cam, vp);
        if (po) out.push(po);
      }
    }
  }
  for (const id of previewIds) {
    const base = derived.get(id) ?? doc.get(id);
    const moved = base && (derived.has(id) ? base : editor!.previewed(base));
    if (!moved || (isBoolMember(moved) && !(inner && operandOf(moved) === inner && bool?.mode === "pick"))) continue;
    // While an object is moved, turned or stretched it is shown a little see-through, so what is behind it stays readable (ADR 0073).
    // Only the picture on screen: the committed object keeps its own opacity. A see-through stroke is drawn on its own, so a very large
    // selection stays opaque: it would lose the batching that keeps a drag at full frame rate.
    // (Editing nodes is not a move: the path keeps its look while its shape changes. A derived result is not either.)
    const pk = editor!.preview.kind;
    const shown = !derived.has(id) && previewIds.size <= GHOST_MAX && (pk === "move" || pk === "rotate" || pk === "scale") ? ({ ...moved, opacity: moved.opacity * GHOST_OPACITY } as CanvasObject) : moved;
    project(shown);
  }
  if (bool?.mode === "pick" && inner && !editor) for (const o of operandsIn(doc, inner)) if (!o.hidden) project(o);
  // A picked mask is shown a little see-through, over what it cuts, so it can be seen and moved; unpicked it is not in the index at all.
  const maskIds = bool?.also ?? (editor ? editor.selection : null);
  if (maskIds) for (const id of maskIds) {
    const o = doc.get(id);
    if (o?.isMask && !o.hidden) project({ ...o, opacity: o.opacity * MASK_GHOST } as CanvasObject);
  }
  out.sort((a, b) => a.obj.z - b.obj.z || (a.obj.id < b.obj.id ? -1 : a.obj.id > b.obj.id ? 1 : 0));
  if (stats) {
    stats.levelsVisited = levelsVisited;
    stats.cellsProbed = cellsProbed;
    stats.candidates = candidates;
  }
  return withMasks(doc, fc, vp, withClips(doc, fc, vp, out), (o) => (editor && previewIds.has(o.id) ? editor.previewed(o) : o));
}

/**
 * Give what sits on a clipping sheet (ADR 0108) the sheet's projected shape to be cut by. The sheet is taken from the list when it is
 * there, else projected on its own (a sheet too small or off screen is not in it); what is on a hidden sheet, or a sheet that is
 * off screen altogether, is dropped, and a sheet that covers the view cuts nothing.
 */
function withClips(doc: DocumentStore, fc: FC, vp: Viewport, list: ProjectedObject[]): ProjectedObject[] {
  if (!list.some((po) => po.obj.parent !== undefined)) return list;
  const byId = new Map(list.map((po) => [po.obj.id, po]));
  const own = new Map<ObjectId, ProjectedObject | null>();
  const body = (f: CanvasObject): ProjectedObject | null => {
    const listed = byId.get(f.id);
    if (listed) return listed;
    if (!own.has(f.id)) {
      const cam = cameraIn(fc, f.frame ?? doc.space.world);
      own.set(f.id, cam ? projectObject(f, cam, vp, { keepTiny: true }) : null);
    }
    return own.get(f.id)!;
  };
  const out: ProjectedObject[] = [];
  for (const po of list) {
    if (po.obj.parent === undefined) {
      out.push(po);
      continue;
    }
    const chain = ancestorsOf((id) => doc.get(id), po.obj);
    if (chain.some((a) => a.hidden)) continue;
    const clip: ProjectedObject[] = [];
    let gone = false;
    for (const a of chain.filter((c) => c.container.clip).reverse()) {
      const b = body(a);
      if (!b) { gone = true; break; }
      if (!b.cover) clip.push(b);
    }
    if (gone) continue;
    if (clip.length) po.clip = clip;
    out.push(po);
  }
  return out;
}

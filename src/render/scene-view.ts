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

/** How see-through a moving selection looks, and the largest selection that gets it (above that, drawing it one by one would slow the drag). */
export const GHOST_OPACITY = 0.6;
export const GHOST_MAX = 200;

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
  out.sort((a, b) => a.obj.z - b.obj.z || (a.obj.id < b.obj.id ? -1 : a.obj.id > b.obj.id ? 1 : 0));
  if (stats) {
    stats.levelsVisited = levelsVisited;
    stats.cellsProbed = cellsProbed;
    stats.candidates = candidates;
  }
  return out;
}

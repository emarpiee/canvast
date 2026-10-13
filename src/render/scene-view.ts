import type { Viewport } from "../core/camera";
import type { FrameCamera } from "../core/frames";
import type { DocumentStore } from "../doc/document-store";
import type { EditorState } from "../app/editor-state";
import type { ObjectId } from "../doc/model";
import type { FrameIndex } from "../scene/frame-index";
import { cameraIn } from "../scene/frame-index";
import type { ProjectedObject } from "./projection";
import { cellFrame, projectEntry, projectObject } from "./projection";

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
export function visibleObjects(
  doc: DocumentStore,
  index: FrameIndex,
  editor: EditorState | null,
  fc: FrameCamera,
  vp: Viewport,
  stats?: VisibleStats,
): ProjectedObject[] {
  const previewIds: ReadonlySet<ObjectId> = editor ? editor.previewIds() : new Set();
  const out: ProjectedObject[] = [];
  let levelsVisited = 0;
  let cellsProbed = 0;
  let candidates = 0;
  for (const { cam, index: ix } of index.views(fc)) {
    const q = ix.query(cam, vp);
    levelsVisited += q.levelsVisited;
    cellsProbed += q.cellsProbed;
    candidates += q.candidates;
    for (const cell of q.cells) {
      const cf = cellFrame(cell, cam, vp);
      for (const e of cell.entries) {
        if (previewIds.has(e.obj.id)) continue;
        const po = projectEntry(e, cf, cam, vp);
        if (po) out.push(po);
      }
    }
  }
  for (const id of previewIds) {
    const o = doc.get(id);
    const shown = o && editor!.previewed(o);
    if (!shown) continue;
    const cam = cameraIn(fc, shown.frame ?? doc.space.world);
    const po = cam && projectObject(shown, cam, vp);
    if (po) out.push(po);
  }
  out.sort((a, b) => a.obj.z - b.obj.z || (a.obj.id < b.obj.id ? -1 : a.obj.id > b.obj.id ? 1 : 0));
  if (stats) {
    stats.levelsVisited = levelsVisited;
    stats.cellsProbed = cellsProbed;
    stats.candidates = candidates;
  }
  return out;
}

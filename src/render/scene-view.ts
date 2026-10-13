import type { Camera, Viewport } from "../core/camera";
import type { DocumentStore } from "../doc/document-store";
import type { EditorState } from "../app/editor-state";
import type { ObjectId } from "../doc/model";
import type { SpatialIndex } from "../scene/spatial-index";
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
 * Candidates come from the spatial index (cells overlapping the viewport at
 * every level whose objects can be at least a quarter pixel); each candidate
 * is then projected and culled exactly. Objects with an active preview (being
 * moved or resized) are projected from their preview state instead, since the
 * index holds their committed position.
 */
export function visibleObjects(
  doc: DocumentStore,
  index: SpatialIndex,
  editor: EditorState | null,
  cam: Camera,
  vp: Viewport,
  stats?: VisibleStats,
): ProjectedObject[] {
  const previewIds: ReadonlySet<ObjectId> = editor ? editor.previewIds() : new Set();
  const out: ProjectedObject[] = [];
  const q = index.query(cam, vp);
  for (const cell of q.cells) {
    const cf = cellFrame(cell, cam, vp);
    for (const e of cell.entries) {
      if (previewIds.has(e.obj.id)) continue;
      const po = projectEntry(e, cf, cam, vp);
      if (po) out.push(po);
    }
  }
  for (const id of previewIds) {
    const o = doc.get(id);
    const shown = o && editor!.previewed(o);
    if (!shown) continue;
    const po = projectObject(shown, cam, vp);
    if (po) out.push(po);
  }
  out.sort((a, b) => a.obj.z - b.obj.z || (a.obj.id < b.obj.id ? -1 : a.obj.id > b.obj.id ? 1 : 0));
  if (stats) {
    stats.levelsVisited = q.levelsVisited;
    stats.cellsProbed = q.cellsProbed;
    stats.candidates = q.candidates;
  }
  return out;
}

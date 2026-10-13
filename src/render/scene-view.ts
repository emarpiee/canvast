import type { Camera, Viewport } from "../core/camera";
import type { DocumentStore } from "../doc/document-store";
import type { EditorState } from "../app/editor-state";
import type { ProjectedObject } from "./projection";
import { projectObject } from "./projection";

/**
 * Visible objects in paint order, projected for the current camera, with
 * any interaction preview applied. Rendering and hit testing both consume this
 * list, so they always agree.
 *
 * Phase 0B scans every object; Phase 0C replaces the scan with a spatial index
 * query that returns candidates for the same projection step.
 */
export function visibleObjects(doc: DocumentStore, editor: EditorState | null, cam: Camera, vp: Viewport): ProjectedObject[] {
  const out: ProjectedObject[] = [];
  for (const o of doc.ordered()) {
    const shown = editor ? editor.previewed(o) : o;
    const po = projectObject(shown, cam, vp);
    if (po) out.push(po);
  }
  return out;
}

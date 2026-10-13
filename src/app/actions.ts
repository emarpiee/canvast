import * as D from "../core/dyadic";
import { screenToWorld } from "../core/camera";
import type { DocumentStore } from "../doc/document-store";
import type { ImageObject } from "../doc/model";
import { newObjectId } from "../doc/model";
import { normalizeUnit } from "../doc/edit-ops";
import type { AssetLibrary } from "../assets/asset-library";
import type { EditorState } from "./editor-state";
import type { ViewState } from "./view-state";

/** User-level commands shared by keyboard shortcuts, toolbar and tests. */

export function undo(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  doc.undo();
  pruneSelection(doc, editor);
}

export function redo(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  doc.redo();
  pruneSelection(doc, editor);
}

export function pruneSelection(doc: DocumentStore, editor: EditorState): void {
  for (const id of [...editor.selection]) if (!doc.get(id)) editor.selection.delete(id);
  editor.changed();
}

export function deleteSelection(doc: DocumentStore, editor: EditorState): void {
  if (editor.selection.size && editor.blockEdit()) return;
  const ids = [...editor.selection].filter((id) => doc.get(id));
  if (!ids.length) return;
  doc.commit(doc.transaction(ids.length === 1 ? "Delete object" : `Delete ${ids.length} objects`, [], ids));
  editor.select([]);
}

/** Largest fraction of the viewport a newly placed image may cover. */
const PLACE_MAX_VIEWPORT_FRACTION = 0.6;

/**
 * Import image files and place one instance of each at the viewport centre,
 * at the current scale (1 source pixel = 1 CSS px, shrunk to fit). Placing an
 * image does not select it or touch any existing object.
 */
export async function importImages(
  files: Iterable<File>,
  assets: AssetLibrary,
  doc: DocumentStore,
  view: ViewState,
  editor: EditorState,
): Promise<ImageObject[]> {
  const placed: ImageObject[] = [];
  if (editor.blockEdit()) return placed;
  for (const file of files) {
    try {
      const rec = await assets.importFile(file);
      const cam = view.camera;
      const vp = view.viewport;
      const f = 2 ** cam.zf;
      const fit = Math.min(1, (PLACE_MAX_VIEWPORT_FRACTION * vp.width) / rec.pixelW, (PLACE_MAX_VIEWPORT_FRACTION * vp.height) / rec.pixelH);
      // Local unit = 2^-zi world = f CSS px.
      const w = (rec.pixelW * fit) / f;
      const h = (rec.pixelH * fit) / f;
      const offset = placed.length * 24;
      const c = screenToWorld(cam, vp, { x: vp.width / 2 + offset, y: vp.height / 2 + offset });
      const unit = -cam.zi;
      const img: ImageObject = {
        id: newObjectId(),
        kind: "image",
        anchor: { x: D.sub(c.x, D.shift(D.fromNumber(w / 2), unit)), y: D.sub(c.y, D.shift(D.fromNumber(h / 2), unit)) },
        unit,
        z: doc.topZ() + 1,
        opacity: 1,
        attachmentTargetId: null,
        assetId: rec.hash,
        w,
        h,
        pixelW: rec.pixelW,
        pixelH: rec.pixelH,
      };
      const obj = normalizeUnit(img) as ImageObject;
      doc.commit(doc.transaction("Import image", [obj]));
      placed.push(obj);
    } catch (e) {
      editor.message = `Could not import ${file.name || "file"}: ${(e as Error).message}`;
      editor.changed();
    }
  }
  return placed;
}

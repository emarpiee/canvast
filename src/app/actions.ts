import * as D from "../core/dyadic";
import { screenToWorld } from "../core/camera";
import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject, ImageObject } from "../doc/model";
import { homeObject, newObjectId } from "../doc/model";
import { normalizeUnit, placeAbove, restack } from "../doc/edit-ops";
import { groupObjects, ungroupObjects } from "../doc/groups";
import type { AssetLibrary, AssetRecord } from "../assets/asset-library";
import { duplicateNotice } from "../assets/asset-library";
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

/** The selected objects that exist (in paint order). */
const selected = (doc: DocumentStore, editor: EditorState): CanvasObject[] => doc.ordered().filter((o) => editor.selection.has(o.id));

/** Group the selection (at least two units) into one group at the level the user is working at. */
export function groupSelection(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const objs = selected(doc, editor);
  const level = editor.entered.length;
  if (new Set(objs.map((o) => o.groups?.[level] ?? o.id)).size < 2) return;
  doc.commit(doc.transaction(`Group ${objs.length} objects`, groupObjects(objs, level)));
  editor.changed();
}

/** Dissolve the selected groups (one level): the members stay selected. */
export function ungroupSelection(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const changed = ungroupObjects(selected(doc, editor), editor.entered.length);
  if (!changed.length) return;
  doc.commit(doc.transaction("Ungroup", changed));
  editor.changed();
}

/** Bring the selection to the front, or send it to the back, of the paint order. */
export function arrangeSelection(doc: DocumentStore, editor: EditorState, to: "front" | "back"): void {
  if (editor.blockEdit()) return;
  const objs = selected(doc, editor);
  if (!objs.length) return;
  doc.commit(doc.transaction(to === "front" ? "Bring to front" : "Send to back", restack(objs, doc.ordered(), to)));
  editor.changed();
}

/** Hide or lock the selected objects (they leave the selection: hidden ones cannot be seen, locked ones cannot be picked). */
export function setFlag(doc: DocumentStore, editor: EditorState, flag: "hidden" | "locked"): void {
  if (editor.blockEdit()) return;
  const objs = selected(doc, editor);
  if (!objs.length) return;
  doc.commit(doc.transaction(flag === "hidden" ? "Hide" : "Lock", objs.map((o) => ({ ...o, [flag]: true }) as CanvasObject)));
  editor.select([]);
}

/** Set or clear a flag on specific objects (the Layers panel's eye and lock). */
export function setFlagOn(doc: DocumentStore, editor: EditorState, ids: readonly string[], flag: "hidden" | "locked", on: boolean): void {
  if (editor.blockEdit()) return;
  const objs = ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o && !!o[flag] !== on);
  if (!objs.length) return;
  const label = flag === "hidden" ? (on ? "Hide" : "Show") : on ? "Lock" : "Unlock";
  doc.commit(
    doc.transaction(
      label,
      objs.map((o) => {
        const { [flag]: _old, ...rest } = o;
        return (on ? { ...rest, [flag]: true } : rest) as CanvasObject;
      }),
    ),
  );
  if (on && flag === "hidden") for (const o of objs) editor.selection.delete(o.id);
  editor.changed();
}

/** Move objects in front of `above` in the paint order (the Layers panel's drag). */
export function moveAbove(doc: DocumentStore, editor: EditorState, ids: readonly string[], aboveId: string): void {
  if (editor.blockEdit()) return;
  const moving = ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o);
  const above = doc.get(aboveId);
  if (!moving.length || !above || moving.some((o) => o.id === aboveId)) return;
  const changed = placeAbove(doc.ordered(), moving, above);
  if (changed.length) doc.commit(doc.transaction("Reorder", changed));
  editor.changed();
}

/** Show every hidden object, or unlock every locked one. */
export function clearFlag(doc: DocumentStore, editor: EditorState, flag: "hidden" | "locked"): void {
  if (editor.blockEdit()) return;
  const flagged = doc.ordered().filter((o) => o[flag]);
  if (!flagged.length) return;
  doc.commit(
    doc.transaction(
      flag === "hidden" ? "Show all" : "Unlock all",
      flagged.map((o) => {
        const { [flag]: _gone, ...rest } = o;
        return rest as CanvasObject;
      }),
    ),
  );
  editor.message = `${flag === "hidden" ? "Showed" : "Unlocked"} ${flagged.length} object${flagged.length === 1 ? "" : "s"}`;
  editor.changed();
}

/** Largest fraction of the viewport a newly placed image may cover. */
const PLACE_MAX_VIEWPORT_FRACTION = 0.6;

/**
 * Place one new instance of a stored asset at the viewport centre (shifted by
 * `offsetPx`), at the current scale: 1 source pixel = 1 CSS px, shrunk to fit.
 * Placing does not select it or touch any existing object.
 */
export function placeImage(
  rec: Pick<AssetRecord, "hash" | "pixelW" | "pixelH">,
  doc: DocumentStore,
  view: ViewState,
  offsetPx: number,
  label: string,
): ImageObject {
  const cam = view.camera;
  const vp = view.viewport;
  const f = 2 ** cam.zf;
  const fit = Math.min(1, (PLACE_MAX_VIEWPORT_FRACTION * vp.width) / rec.pixelW, (PLACE_MAX_VIEWPORT_FRACTION * vp.height) / rec.pixelH);
  // Local unit = 2^-zi world = f CSS px.
  const w = (rec.pixelW * fit) / f;
  const h = (rec.pixelH * fit) / f;
  const c = screenToWorld(cam, vp, { x: vp.width / 2 + offsetPx, y: vp.height / 2 + offsetPx });
  const unit = -cam.zi;
  const img: ImageObject = {
    id: newObjectId(),
    kind: "image",
    // `c` is in the camera frame's coordinates (ADR 0014).
    ...(view.frame === doc.space.world ? {} : { frame: view.frame }),
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
  const obj = homeObject(normalizeUnit(img), doc.space) as ImageObject;
  doc.commit(doc.transaction(label, [obj]));
  return obj;
}

/** Import image files and place one instance of each (see placeImage). */
export async function importImages(
  files: Iterable<File>,
  assets: AssetLibrary,
  doc: DocumentStore,
  view: ViewState,
  editor: EditorState,
): Promise<ImageObject[]> {
  const placed: ImageObject[] = [];
  if (editor.blockEdit()) return placed;
  const seen: Array<{ name: string; duplicate: "present" | "restored" }> = [];
  let total = 0;
  for (const file of files) {
    total++;
    try {
      const { record, duplicate } = await assets.importFileDetailed(file);
      if (duplicate) seen.push({ name: record.name || file.name, duplicate });
      placed.push(placeImage(record, doc, view, placed.length * 24, "Import image"));
    } catch (e) {
      editor.message = `Could not import ${file.name || "file"}: ${(e as Error).message}`;
      editor.changed();
    }
  }
  const notice = duplicateNotice(seen, total);
  if (notice) {
    editor.message = notice;
    editor.changed();
  }
  return placed;
}

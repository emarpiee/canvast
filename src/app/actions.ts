import * as D from "../core/dyadic";
import { screenToWorld } from "../core/camera";
import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject, ImageObject } from "../doc/model";
import { homeObject, newObjectId } from "../doc/model";
import { normalizeUnit, placeAbove, restack } from "../doc/edit-ops";
import { groupObjects, ungroupObjects, unitKey } from "../doc/groups";
import type { AlignKey, SortKey, Unit } from "../doc/arrange";
import { alignUnits, arrangeGrid, distributeUnits, gridCells } from "../doc/arrange";
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

export type LayoutCommand = { grid: SortKey } | { align: AlignKey } | { distribute: "x" | "y" };

const LABELS: Record<SortKey, string> = { "name-asc": "A to Z", "name-desc": "Z to A", date: "by date added", size: "by size", type: "by type", stack: "in stacking order" };

/** The selection as units (a group at the level being worked at, else one object) in one frame, without locked ones. */
function layoutUnits(doc: DocumentStore, editor: EditorState, names: ReadonlyMap<string, { name: string; date: number }>): Unit[] | string {
  const objs = selected(doc, editor).filter((o) => !o.locked);
  if (new Set(objs.map((o) => o.frame?.id ?? 0)).size > 1) return "These items are in different spaces; arrange them one space at a time.";
  const level = editor.entered.length;
  const byUnit = new Map<string, CanvasObject[]>();
  for (const o of objs) {
    const k = unitKey(o, level);
    (byUnit.get(k) ?? byUnit.set(k, []).get(k)!).push(o);
  }
  const nameOf = (o: CanvasObject): string => (o.kind === "image" ? (names.get(o.assetId)?.name ?? "") : o.kind === "text" ? o.md.replace(/[#*_`>\\-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) : "");
  return [...byUnit.values()].map((objects) => {
    const first = objects[0]!;
    const date = first.kind === "image" ? names.get(first.assetId)?.date : undefined;
    return { objects, name: nameOf(first), ...(date !== undefined ? { date } : {}) };
  });
}

/**
 * Arrange the selection in a grid, or align or distribute it, as one undoable step of exact translations. `names`
 * maps an image's content hash to its file name and when it was added (for sorting by name or date).
 */
export function layoutSelection(doc: DocumentStore, editor: EditorState, cmd: LayoutCommand, names: ReadonlyMap<string, { name: string; date: number }> = new Map()): void {
  if (editor.blockEdit()) return;
  const units = layoutUnits(doc, editor, names);
  if (typeof units === "string") {
    editor.message = units;
    editor.changed();
    return;
  }
  const need = "distribute" in cmd ? 3 : 2;
  if (units.length < need) {
    editor.message = `Select at least ${need} items to ${"distribute" in cmd ? "distribute" : "grid" in cmd ? "arrange" : "align"}.`;
    editor.changed();
    return;
  }
  const moved = "grid" in cmd ? arrangeGrid(units, cmd.grid) : "align" in cmd ? alignUnits(units, cmd.align) : distributeUnits(units, cmd.distribute);
  if (!moved.length) return; // already in place
  const label = "grid" in cmd ? `Arrange ${units.length} items in a grid ${LABELS[cmd.grid]}` : "align" in cmd ? `Align ${cmd.align}` : `Distribute ${cmd.distribute === "x" ? "horizontally" : "vertically"}`;
  doc.commit(doc.transaction(label, moved));
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
/** Largest fraction of the viewport a batch of imported images may cover together. */
const GRID_VIEWPORT_FRACTION = 0.9;
/** Gap between grid cells, as a fraction of the larger cell side. */
const GRID_GAP = 0.08;

/** The image object for `rec` with its top-left corner at screen (x, y) and a size of wPx by hPx CSS px. */
function imageAt(rec: Pick<AssetRecord, "hash" | "pixelW" | "pixelH">, doc: DocumentStore, view: ViewState, x: number, y: number, wPx: number, hPx: number, z: number): ImageObject {
  const cam = view.camera;
  const f = 2 ** cam.zf; // local unit = 2^-zi world = f CSS px
  const c = screenToWorld(cam, view.viewport, { x, y });
  const unit = -cam.zi;
  const img: ImageObject = {
    id: newObjectId(),
    kind: "image",
    // `c` is in the camera frame's coordinates (ADR 0014).
    ...(view.frame === doc.space.world ? {} : { frame: view.frame }),
    anchor: c,
    unit,
    z,
    opacity: 1,
    attachmentTargetId: null,
    assetId: rec.hash,
    w: wPx / f,
    h: hPx / f,
    pixelW: rec.pixelW,
    pixelH: rec.pixelH,
  };
  return homeObject(normalizeUnit(img), doc.space) as ImageObject;
}

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
  const vp = view.viewport;
  const fit = Math.min(1, (PLACE_MAX_VIEWPORT_FRACTION * vp.width) / rec.pixelW, (PLACE_MAX_VIEWPORT_FRACTION * vp.height) / rec.pixelH);
  const w = rec.pixelW * fit;
  const h = rec.pixelH * fit;
  const obj = imageAt(rec, doc, view, vp.width / 2 + offsetPx - w / 2, vp.height / 2 + offsetPx - h / 2, w, h, doc.topZ() + 1);
  doc.commit(doc.transaction(label, [obj]));
  return obj;
}

/**
 * Lay a batch of images out in a roughly square grid, centred on the viewport (ADR 0030). Cells are as large as the
 * largest image, each image is centred in its cell, rows fill left to right in the given order, and the columns are
 * chosen so the whole grid is about as wide as it is tall (cols = round(sqrt(n x cellH / cellW))). The grid is then
 * scaled down, never up, to fit 90% of the viewport; every image keeps its own aspect ratio. Sizes and the result are
 * in CSS px, results from the viewport's top-left.
 */
export function gridLayout(sizes: ReadonlyArray<{ w: number; h: number }>, vp: { width: number; height: number }): Array<{ x: number; y: number; w: number; h: number }> {
  const n = sizes.length;
  if (!n) return [];
  const g = gridCells(sizes, GRID_GAP);
  const gridW = g.w;
  const gridH = g.h;
  const k = Math.min(1, (GRID_VIEWPORT_FRACTION * vp.width) / gridW, (GRID_VIEWPORT_FRACTION * vp.height) / gridH);
  const x0 = vp.width / 2 - (gridW * k) / 2;
  const y0 = vp.height / 2 - (gridH * k) / 2;
  return sizes.map((s, i) => ({ x: x0 + g.cells[i]!.x * k, y: y0 + g.cells[i]!.y * k, w: s.w * k, h: s.h * k }));
}

/** Place a batch of images in a grid as one undoable step (see gridLayout). */
export function placeImages(recs: ReadonlyArray<Pick<AssetRecord, "hash" | "pixelW" | "pixelH">>, doc: DocumentStore, view: ViewState, label: string): ImageObject[] {
  const cells = gridLayout(recs.map((r) => ({ w: r.pixelW, h: r.pixelH })), view.viewport);
  const z = doc.topZ();
  const objs = recs.map((r, i) => imageAt(r, doc, view, cells[i]!.x, cells[i]!.y, cells[i]!.w, cells[i]!.h, z + 1 + i));
  doc.commit(doc.transaction(label, objs));
  return objs;
}

/** Import image files and place one instance of each (see placeImage). */
export async function importImages(
  files: Iterable<File>,
  assets: AssetLibrary,
  doc: DocumentStore,
  view: ViewState,
  editor: EditorState,
): Promise<ImageObject[]> {
  if (editor.blockEdit()) return [];
  const list = [...files];
  const records: AssetRecord[] = [];
  const seen: Array<{ name: string; duplicate: "present" | "restored" }> = [];
  let done = 0;
  for (const file of list) {
    done++;
    try {
      const { record, duplicate } = await assets.importFileDetailed(file, list.length <= 3);
      if (duplicate) seen.push({ name: record.name || file.name, duplicate });
      records.push(record);
    } catch (e) {
      editor.message = `Could not import ${file.name || "file"}: ${(e as Error).message}`;
      editor.changed();
    }
    if (list.length > 3) {
      editor.message = `Importing ${done} of ${list.length}…`;
      editor.changed();
    }
  }
  // One image goes in the middle as before; several go in a grid. Either way, one undo step.
  const placed = records.length === 1 ? [placeImage(records[0]!, doc, view, 0, "Import image")] : records.length ? placeImages(records, doc, view, `Import ${records.length} images`) : [];
  const notice = duplicateNotice(seen, list.length);
  editor.message = notice ?? (list.length > 3 ? `Imported ${records.length} images.` : "");
  editor.changed();
  return placed;
}

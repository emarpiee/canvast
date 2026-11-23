import { divideShapes, uniteRegions } from "../../doc/divide";
import { normalizeUnit, placeAbove } from "../../doc/edit-ops";
import { gapsOf } from "../../doc/gaps";
import { homeObject, newObjectId } from "../../doc/model";
import { projectionFor } from "../../render/projection";
import { cameraIn } from "../../scene/frame-index";
import { dividable } from "./shared";
import type { DocumentStore } from "../../doc/document-store";
import type { CanvasObject, PathObject } from "../../doc/model";
import type { EditorState } from "../editor-state";
import type { ViewState } from "../view-state";

// ---- Gaps (ADR 0172) ---------------------------------------------------------------------------------------------------------

/** The gaps the picked shapes close in, as shapes with the Shape tool's fill and no outline, placed in the units of the back one; or why none. */
function gapShapes(doc: DocumentStore, editor: EditorState, view: ViewState, closePx: number): { back: PathObject; gaps: PathObject[] } | string {
  const shapes = dividable(doc, editor);
  // the closing distance on the screen, in the units of the back shape (the one the gaps are found in)
  const back0 = [...shapes].sort((a, b) => a.z - b.z)[0];
  const cam = back0 && cameraIn(view.frameCamera, back0.frame ?? doc.space.world);
  const ppu = cam && back0 ? projectionFor(cam, view.viewport, back0.anchor, back0.unit).ppu : 0;
  const found = gapsOf(shapes, doc.space, ppu > 0 && ppu < Infinity ? closePx / ppu : 0);
  if (typeof found === "string") return found;
  const { back } = found;
  if (!found.gaps.length) return "The selected shapes close in no gap: an empty place must be closed in on every side to be filled.";
  const gaps = found.gaps.map((g): PathObject => homeObject(normalizeUnit({
    id: newObjectId(), kind: "path", ...(back.frame ? { frame: back.frame } : {}), anchor: back.anchor, unit: back.unit, z: back.z, opacity: 1,
    attachmentTargetId: null, ...(back.parent ? { parent: back.parent } : {}), sub: g.subs, evenodd: true,
    fill: editor.shapeFill ?? "#2563eb", stroke: null, width: back.width, name: "Gap",
  }), doc.space) as PathObject);
  return { back, gaps };
}

/** Put new fills just under `back` (they fill what lies between it and its neighbours, which stay on top). */
function placeUnder(doc: DocumentStore, objs: PathObject[], back: PathObject): CanvasObject[] {
  const all = doc.ordered();
  const at = all.findIndex((o) => o.id === back.id);
  return at > 0 ? placeAbove(all, objs, all[at - 1]!) : objs.map((o, i) => ({ ...o, z: back.z - objs.length + i }));
}

export const canFillGaps = (doc: DocumentStore, editor: EditorState): boolean => dividable(doc, editor).length >= 1;

/** Fill every gap the picked shapes close in: one undo step; the fills are picked. */
export function fillAllGaps(doc: DocumentStore, editor: EditorState, view: ViewState, closePx: number): void {
  if (editor.blockEdit()) return;
  const found = gapShapes(doc, editor, view, closePx);
  if (typeof found === "string") {
    editor.message = found;
    return editor.changed();
  }
  const placed = placeUnder(doc, found.gaps, found.back);
  doc.commit(doc.transaction(`Fill ${found.gaps.length} ${found.gaps.length === 1 ? "gap" : "gaps"}`, placed));
  editor.select(placed.map((o) => o.id));
  editor.changed();
}

/** Turn on Fill a gap: the gaps of the picked shapes show, a click fills the one under it (one undo step each), Enter or Esc ends it. */
export function startGapFill(doc: DocumentStore, editor: EditorState, view: ViewState, closePx: number): void {
  if (editor.blockEdit() || editor.builder || editor.gapFill) return;
  const found = gapShapes(doc, editor, view, closePx);
  if (typeof found === "string") {
    editor.message = found;
    return editor.changed();
  }
  editor.gapFill = { gaps: found.gaps, world: doc.space.world, hover: null };
  editor.message = `Fill a gap: click a gap to fill it (${found.gaps.length} found); Enter or Esc when done.`;
  editor.changed();
}

/** Fill gap `i` of Fill a gap, under the shape at the back of the ones around it. */
export function fillGapAt(doc: DocumentStore, editor: EditorState, i: number): void {
  const f = editor.gapFill;
  const gap = f?.gaps[i];
  if (!f || !gap || editor.blockEdit()) return;
  const backs = dividable(doc, editor);
  const back = [...backs].sort((a, b) => a.z - b.z)[0];
  const placed = back ? placeUnder(doc, [gap], back) : [gap];
  doc.commit(doc.transaction("Fill a gap", placed));
  f.gaps = f.gaps.filter((_, k) => k !== i);
  f.hover = null;
  if (!f.gaps.length) editor.gapFill = null;
  editor.changed();
}

export function finishGapFill(editor: EditorState): void {
  editor.gapFill = null;
  editor.changed();
}

/** Open the Shape builder on the picked shapes: their regions are drawn instead of them; drag across regions to merge them, Alt-drag to delete them, Enter to finish. */
export function startShapeBuilder(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit() || editor.builder) return;
  const shapes = dividable(doc, editor);
  const made = divideShapes(shapes, doc.space);
  if (typeof made === "string") {
    editor.message = made;
    editor.changed();
    return;
  }
  editor.builder = { faces: made, srcIds: shapes.map((o) => o.id), world: doc.space.world, merged: [], deleted: new Set(), hover: null, touched: [], removing: false };
  editor.preview = { kind: "edit", ids: shapes.map((o) => o.id) };
  editor.message = "Shape builder: drag across regions to merge them, Alt-drag to delete them, Enter to finish, Esc to cancel.";
  editor.changed();
}

/** Close the Shape builder: with `apply`, the shapes are replaced by the regions as they were left (merged ones united, deleted ones gone). */
export function finishShapeBuilder(doc: DocumentStore, editor: EditorState, apply: boolean): void {
  const b = editor.builder;
  if (!b) return;
  editor.builder = null;
  editor.preview = { kind: "none" };
  if (!apply) return editor.changed();
  const grouped = new Set(b.merged.flat());
  const parts: PathObject[] = [];
  for (const group of b.merged) {
    const united = uniteRegions(group.filter((i) => !b.deleted.has(i)).map((i) => b.faces[i]!.obj));
    if (!united) {
      editor.message = "Those regions could not be merged: their outlines graze each other.";
      editor.changed();
      return;
    }
    parts.push(united);
  }
  b.faces.forEach((f, i) => {
    if (!grouped.has(i) && !b.deleted.has(i)) parts.push(f.obj);
  });
  const sources = b.srcIds.map((id) => doc.get(id)).filter((o): o is PathObject => o?.kind === "path");
  if (!sources.length) return editor.changed();
  const top = [...sources].sort((a, c) => c.z - a.z)[0]!;
  const placed = parts.length ? placeAbove(doc.ordered(), parts.map((o) => homeObject(normalizeUnit(o), doc.space)), top) : [];
  doc.commit(doc.transaction("Shape builder", placed, sources.map((o) => o.id)));
  editor.select(placed.map((o) => o.id));
  editor.changed();
}


import type { DocumentStore } from "../../doc/document-store";
import type { CanvasObject, ObjectId, PathObject } from "../../doc/model";
import type { EditorState } from "../editor-state";

// What several groups of the canvas actions share (moved out of actions.ts with them, B34): the selection as objects, and the paths that can be divided.
/** The selected objects that exist (in paint order). */
/** The selected objects, back to front. Asked many times for one change (every bar and check), so kept until the document or the selection
 * changes: a large selection in a large canvas was a filter of every object each time. (A copy each time: a caller may sort it.) */
let selectedMemo: { ordered: readonly CanvasObject[]; ids: Set<ObjectId>; out: CanvasObject[] } | null = null;
export const selected = (doc: DocumentStore, editor: EditorState): CanvasObject[] => {
  const ordered = doc.ordered();
  const sel = editor.selection;
  const m = selectedMemo;
  if (m && m.ordered === ordered && m.ids.size === sel.size && [...sel].every((id) => m.ids.has(id))) return [...m.out];
  const out = ordered.filter((o) => sel.has(o.id));
  selectedMemo = { ordered, ids: new Set(sel), out };
  return [...out];
};

export const dividable = (doc: DocumentStore, editor: EditorState): PathObject[] => selected(doc, editor).filter((o): o is PathObject => o.kind === "path" && !o.container && !o.result && !o.locked && o.sub.some((s) => s.closed));

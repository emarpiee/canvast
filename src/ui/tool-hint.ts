/**
 * The one line under the tool options that says what the vector tools do right now and what to press next (ADR 0104). It reads the state
 * the editor is in (tool, a shape or path being drawn, what is selected, a boolean group entered) and returns null when there is nothing
 * worth saying, so it never repeats what is obvious.
 */
import type { DocumentStore } from "../doc/document-store";
import { boolGroupsOf } from "../doc/boolean-group";
import type { EditorState } from "../app/editor-state";
import type { PathObject } from "../doc/model";
import type { ShapeKind } from "../doc/path";
import { isGradient } from "../doc/paint";
import { hasCorners } from "../doc/shape-params";

const SHAPE_HINT: Record<ShapeKind, string> = {
  rect: "Drag to draw a rectangle · Shift: square · Alt: from the centre",
  ellipse: "Drag to draw an ellipse · Shift: circle · Alt: from the centre",
  line: "Drag to draw a line · Shift: steps of 45° · Alt: from the middle",
  polygon: "Drag to draw a polygon (the sides are set beside it) · Shift: even · Alt: from the centre",
  star: "Drag to draw a star (the points are set beside it) · Shift: even · Alt: from the centre",
};

export function toolHint(editor: EditorState, doc: DocumentStore): string | null {
  const sel = [...editor.selection].map((id) => doc.get(id)).filter((o) => !!o);
  const paths = sel.filter((o) => o!.kind === "path");
  switch (editor.tool) {
    case "shape":
      return editor.shapeDraft ? null : SHAPE_HINT[editor.shapeKind];
    case "path":
      return editor.pathDraft
        ? "Click the first node to close the shape · Enter or double-click to finish · Backspace takes back a node · Esc ends it open"
        : "Click to place a corner · drag to pull out a curve · click the first node to close the shape";
    case "node":
      return paths.length === 1 ? "Drag a node or a handle · click a line to add a node · Alt-click a node: smooth or corner · Delete removes it · Enter or Esc to finish" : "Click a shape to edit its nodes";
    case "select": {
      const inside = editor.entered.length ? editor.entered[editor.entered.length - 1]! : null;
      // (a group entered with nothing picked is found among all the objects: a rare moment, so the scan is fine)
      const boolEntered = inside !== null && (sel.length ? sel.some((o) => o!.boolOps?.[inside]) : [...doc.all()].some((o) => o.boolOps?.[inside]));
      if (boolEntered) return "Inside a boolean group: edit its shapes and the result follows · Esc goes back out";
      // (a gradient's handles are on the shape: the group's own paint is what a picked boolean group shows)
      const gradient = paths.some((o) => !boolGroupsOf(o!).some((g) => !g.own && !editor.entered.includes(g.gid)) && (isGradient((o as PathObject).fill) || isGradient((o as PathObject).stroke)));
      const handles = gradient ? " · Drag the round handles on the shape to move its gradient (Fill or Outline picks which one)" : "";
      if (sel.length && sel.every((o) => boolGroupsOf(o!).length > 0 && boolGroupsOf(o!).some((g) => !editor.entered.includes(g.gid)))) return "Boolean group · double-click to edit the shapes inside · Combine in the bar above changes the operation, flattens or releases" + handles;
      if (paths.length === 1 && sel.length === 1) {
        const shape = (paths[0] as PathObject).shape;
        const dots = !hasCorners(paths[0] as PathObject) ? "" : shape === "star" ? " · Drag the big dot to round every corner (double-click it for one dot per corner) or the small one for the ratio" : " · Drag the big dot to round every corner (double-click it for one dot per corner)";
        return "Enter or double-click edits its nodes · Fill and Outline are in the bar above" + dots + handles;
      }
      return null;
    }
    default:
      return null;
  }
}

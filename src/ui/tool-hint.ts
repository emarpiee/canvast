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
import { gradientName, gradientSides, paintName } from "../interaction/path-edit";

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
    case "sheet":
      return "Drag to draw a sheet · what you draw or move into it is held and cut by it · Ctrl+Alt+G puts the selected objects on a sheet";
    case "path":
      return editor.pathDraft
        ? "Click the first node to close the shape · Enter or double-click to finish · Backspace takes back a node · Esc ends it open"
        : "Click to place a corner · drag to pull out a curve · click the first node to close the shape";
    case "node":
      return paths.length === 1 ? "Drag a node or a handle · click a line to add a node · Alt-click a node: smooth or corner · Delete removes it · Enter or Esc to finish" : "Click a shape to edit its nodes";
    case "select": {
      if (editor.cropId) return "Crop: drag a side or a corner of the picture; drag outward to bring back what was cut · Enter or Esc finishes";
      if (editor.attachMode) return "Click the object to attach the selected ones to · they will follow it when it moves · Esc cancels";
      const inside = editor.entered.length ? editor.entered[editor.entered.length - 1]! : null;
      // (a group entered with nothing picked is found among all the objects: a rare moment, so the scan is fine)
      const boolEntered = inside !== null && (sel.length ? sel.some((o) => o!.boolOps?.[inside]) : [...doc.all()].some((o) => o.boolOps?.[inside]));
      if (boolEntered) return "Inside a boolean group: edit its shapes and the result follows · Esc goes back out";
      // (a gradient's handles are on the shape: the group's own paint is what a picked boolean group shows)
      const gradient = paths.some((o) => !boolGroupsOf(o!).some((g) => !g.own && !editor.entered.includes(g.gid)) && (isGradient((o as PathObject).fill) || isGradient((o as PathObject).stroke)));
      // one shape: say whose gradient the handles on it are (the fill's or the outline's) and how to get the other one's; several: the general words
      const sides = paths.length === 1 && sel.length === 1 ? gradientSides(paths[0] as PathObject, editor.gradientFocus) : null;
      const handles = sides
        ? ` · Drag the round handles on the shape to move its ${paintName(sides.active).toLowerCase()}'s ${gradientName(sides.g)} gradient${sides.other ? ` · Press ${paintName(sides.other.which)} in the bar above to edit its ${gradientName(sides.other.g)} gradient instead` : ""}`
        : gradient ? " · Drag the round handles on the shape to move its gradient (Fill or Outline selects which one)" : "";
      if (sel.length && sel.every((o) => boolGroupsOf(o!).length > 0 && boolGroupsOf(o!).some((g) => !editor.entered.includes(g.gid)))) return "Boolean group · double-click to edit the shapes inside · Combine in the bar above changes the operation, flattens or releases · The pin saves its initial state" + handles;
      if (paths.length === 1 && sel.length === 1) {
        const shape = (paths[0] as PathObject).shape;
        const radius = " · Big dot: the radius of every corner (double-click: one dot for each)";
        const dots = !hasCorners(paths[0] as PathObject) ? (shape === "polygon" || shape === "star" ? " · Triangle: how many" : "") : radius + (shape === "star" ? " · Diamond: the ratio · Triangle: how many" : shape === "polygon" ? " · Triangle: how many" : "");
        return "Enter or double-click edits its nodes · Fill and Outline are in the bar above · The pin saves its initial state" + dots + handles;
      }
      return null;
    }
    default:
      return null;
  }
}

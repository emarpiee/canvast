import type { Tool } from "../app/editor-state";
import type { NavDir } from "../interaction/item-navigation";
import { commandById, inView, type KeyView } from "./keymap";

/**
 * Keyboard shortcuts (ADR 0049, 0158). Every key that does something is a command of the keymap (settings/keymap.ts) and can be changed in Settings >
 * Shortcuts; what is listed here is what cannot be: the browser's clipboard keys, Escape and Enter, and the gestures that use a modifier key with the pointer.
 */
export const TOOL_ORDER: readonly Tool[] = ["hand", "select", "node", "pen", "brush", "pencil", "smudge", "clone", "shape", "path", "sheet", "marquee", "marqueeEllipse", "lasso", "lassoPoly", "wand", "fill", "gradient", "text", "note", "eyedropper", "eraser"];

export const TOOL_NAME: Record<Tool, string> = { hand: "Hand (pan)", select: "Select", node: "Edit nodes", pen: "Pen", shape: "Shape", path: "Path (curves)", sheet: "Sheet", lasso: "Lasso", text: "Text", note: "Note", eraser: "Object eraser", brush: "Brush", pencil: "Pencil", eyedropper: "Eyedropper", marquee: "Rectangle marquee", marqueeEllipse: "Ellipse marquee", lassoPoly: "Polygonal lasso", wand: "Magic wand", fill: "Fill bucket", gradient: "Gradient", smudge: "Smudge", clone: "Clone stamp" };

/** The command of each tool in the keymap (settings/keymap.ts). */
export const TOOL_COMMAND: Record<Tool, string> = {
  hand: "tool.hand", select: "tool.select", node: "tool.node", pen: "tool.pen", shape: "tool.shape", path: "tool.path", sheet: "tool.sheet", lasso: "tool.lasso", text: "tool.text", note: "tool.note", eraser: "tool.eraser", brush: "tool.brush", pencil: "tool.pencil", eyedropper: "tool.eyedropper", marquee: "tool.marquee", marqueeEllipse: "tool.marqueeEllipse", lassoPoly: "tool.lassoPoly", wand: "tool.wand", fill: "tool.fill", gradient: "tool.gradient", smudge: "tool.smudge", clone: "tool.clone",
};

/** The tool a key picks in a view, as the tool handler hears it: the keymap has already turned the person's binding into the tool's own key. */
export function toolForKey(key: string, view: KeyView = "canvas"): Tool | undefined {
  const k = key.toUpperCase();
  return TOOL_ORDER.find((t) => {
    const c = commandById(TOOL_COMMAND[t]);
    return !!c && inView(c.scope, view) && c.internal[0] === k;
  });
}

/** The keys that step the selection to the next item (ADR 0058, 0072). */
export const NAV_ORDER: readonly NavDir[] = ["up", "left", "down", "right"];
export const NAV_COMMAND: Record<NavDir, string> = { up: "nav.up", left: "nav.left", down: "nav.down", right: "nav.right" };

/** The direction a key steps in, if any (as the handler hears it). */
export function navForKey(key: string): NavDir | undefined {
  const k = key.toUpperCase();
  return NAV_ORDER.find((d) => commandById(NAV_COMMAND[d])?.internal[0] === k);
}

export interface FixedShortcut {
  readonly keys: string;
  readonly does: string;
}

/** Shortcuts that cannot be changed, by group (shown read-only in Settings, under the ones that can). */
export const FIXED_SHORTCUTS: ReadonlyArray<{ group: string; items: readonly FixedShortcut[] }> = [
  {
    group: "The browser's own",
    items: [
      { keys: "Ctrl+C, Ctrl+X, Ctrl+V", does: "Copy, cut and paste (the browser's clipboard: a page cannot give these other keys)" },
      { keys: "Escape", does: "Cancel the gesture, then back to Select, then leave a group, then clear the selection" },
      { keys: "Enter", does: "Finish what is being edited (a path, nodes, a crop, a text)" },
      { keys: "Tab", does: "Move between the buttons and fields" },
      { keys: "?", does: "Open this list (also the question mark button in the dock)" },
    ],
  },
  {
    group: "With the pointer",
    items: [
      { keys: "Mouse wheel", does: "Zoom at the pointer (Shift: pan)" },
      { keys: "Alt+drag the selection", does: "Drag a copy; the original stays" },
      { keys: "Hold Ctrl and move over the canvas", does: "Show the outline of everything under the pointer (the top one strong, the ones below dashed), with their names" },
      { keys: "Ctrl+click", does: "Pick the very thing under the pointer, deep in a group, a mask or a sheet" },
      { keys: "Ctrl+Shift+click", does: "Add that very thing to what is picked, or take it away" },
      { keys: "Ctrl+Alt+click", does: "Go on to the thing below the one picked" },
      { keys: "Point at a Layers row", does: "Show the outline of what it stands for on the canvas" },
      { keys: "Drag a handle", does: "Resize (a corner or a side of a picture is free; strokes and text keep their proportions)" },
      { keys: "Shift+drag a handle", does: "Resize keeping the proportions" },
      { keys: "Alt+drag a handle", does: "Resize about the middle" },
      { keys: "Ctrl+drag a handle", does: "Resize without snapping" },
      { keys: "Shift or Alt while drawing a shape", does: "Shift: a square, a circle or a 45 degree line; Alt: from the centre" },
      { keys: "Alt+click a node", does: "Edit nodes: turn the node between a corner and smooth (in a network: join two ends, or cut an edge)" },
    ],
  },
];

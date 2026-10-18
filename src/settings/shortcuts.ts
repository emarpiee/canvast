import type { Tool } from "../app/editor-state";
import type { NavDir } from "../interaction/item-navigation";
import type { SettingKey, SettingsStore } from "./settings";

/**
 * Keyboard shortcuts (ADR 0049). The tool keys are device settings and can be changed in Settings > Shortcuts; everything else is
 * fixed and listed there so the list is the one place to look. A tool key is one plain letter (no modifier), so it never clashes
 * with the Ctrl and Shift combinations below.
 */
export const TOOL_ORDER: readonly Tool[] = ["hand", "select", "node", "pen", "shape", "path", "sheet", "lasso", "text", "note", "eraser"];

export const TOOL_NAME: Record<Tool, string> = { hand: "Hand (pan)", select: "Select", node: "Edit nodes", pen: "Pen", shape: "Shape", path: "Path (curves)", sheet: "Sheet", lasso: "Lasso", text: "Text", note: "Note", eraser: "Object eraser" };

export const TOOL_KEY_SETTING: Record<Tool, SettingKey> = {
  hand: "key.hand",
  select: "key.select",
  node: "key.node",
  pen: "key.pen",
  shape: "key.shape",
  path: "key.path",
  sheet: "key.sheet",
  lasso: "key.lasso",
  text: "key.text",
  note: "key.note",
  eraser: "key.eraser",
};

/** The letter for each tool as set now. */
export function toolKeys(settings: SettingsStore): Record<Tool, string> {
  const out = {} as Record<Tool, string>;
  for (const t of TOOL_ORDER) out[t] = settings.get(TOOL_KEY_SETTING[t]) as string;
  return out;
}

/** The tool a plain key picks, if any. */
export function toolForKey(settings: SettingsStore, key: string): Tool | undefined {
  const k = key.toLowerCase();
  return TOOL_ORDER.find((t) => settings.get(TOOL_KEY_SETTING[t]) === k);
}

/** Which tool uses `letter` now (other than `except`), for the conflict message. */
export function toolUsing(settings: SettingsStore, letter: string, except?: Tool): Tool | undefined {
  return TOOL_ORDER.find((t) => t !== except && settings.get(TOOL_KEY_SETTING[t]) === letter);
}

/** The keys that step the selection to the next item (ADR 0058, 0072): plain letters, W A S D at first, changeable like the tool keys. */
export const NAV_ORDER: readonly NavDir[] = ["up", "left", "down", "right"];
export const NAV_NAME: Record<NavDir, string> = { up: "Step up", left: "Step left", down: "Step down", right: "Step right" };
export const NAV_KEY_SETTING: Record<NavDir, SettingKey> = { up: "key.navUp", left: "key.navLeft", down: "key.navDown", right: "key.navRight" };

/** The direction a plain key steps in, if any. */
export function navForKey(settings: SettingsStore, key: string): NavDir | undefined {
  const k = key.toLowerCase();
  return NAV_ORDER.find((d) => settings.get(NAV_KEY_SETTING[d]) === k);
}

/** Every rebindable key, in the order Settings lists them. */
export const KEY_ROWS: ReadonlyArray<{ setting: SettingKey; name: string; group: string }> = [
  ...TOOL_ORDER.map((t) => ({ setting: TOOL_KEY_SETTING[t], name: TOOL_NAME[t], group: "Tools" })),
  ...NAV_ORDER.map((d) => ({ setting: NAV_KEY_SETTING[d], name: NAV_NAME[d], group: "Step to the next item" })),
  { setting: "key.zen" as SettingKey, name: "Zen mode", group: "View" },
];

/**
 * A tool key an earlier version let the person set to one of the step keys (W A S D) is taken back: the step key is the one that works
 * (ADR 0072), so the tool goes back to its own default letter and the two never share a key. Returns the tools that were reset.
 */
export function releaseStepKeys(settings: SettingsStore): Tool[] {
  const steps = new Set<unknown>([...NAV_ORDER.map((d) => settings.get(NAV_KEY_SETTING[d])), settings.get("key.zen")]);
  const freed: Tool[] = [];
  for (const t of TOOL_ORDER) {
    if (steps.has(settings.get(TOOL_KEY_SETTING[t]) as string)) {
      settings.reset(TOOL_KEY_SETTING[t]);
      freed.push(t);
    }
  }
  return freed;
}

/** What already uses `letter` (a tool or a step), apart from the key `except`: its name, for the conflict message. */
export function keyOwner(settings: SettingsStore, letter: string, except: SettingKey): string | undefined {
  return KEY_ROWS.find((r) => r.setting !== except && settings.get(r.setting) === letter)?.name;
}

export interface FixedShortcut {
  readonly keys: string;
  readonly does: string;
}

/** Shortcuts that cannot be changed, by group (shown read-only in Settings). */
export const FIXED_SHORTCUTS: ReadonlyArray<{ group: string; items: readonly FixedShortcut[] }> = [
  {
    group: "Navigation",
    items: [
      { keys: "Arrow keys", does: "Pan (Shift: further)" },
      { keys: "W A S D (changeable above)", does: "Step the selection to the next item up, left, down or right (the way is set in Settings > Navigation)" },
      { keys: "Ctrl+K, Ctrl+Shift+P", does: "The command palette: find any command or setting by its words" },
      { keys: "Alt+Shift+Left, Alt+Shift+Right", does: "Previous view, next view (the buttons beside Fit)" },
      { keys: "Alt (press and release)", does: "Bring the selection into view; again: fit everything visible at this zoom" },
      { keys: "Ctrl+F", does: "Search the canvas by file or layer name (in the Assets view: the library)" },
      { keys: "Ctrl+Shift+F", does: "Go to the Assets view and search the library" },
      { keys: "/", does: "The command palette (same as Ctrl+K)" },
      { keys: "#", does: "Search the canvas by tag" },
      { keys: "@", does: "Search the canvas for a bookmark" },
      { keys: "+ and -", does: "Zoom in and out (Shift: bigger steps)" },
      { keys: "0 or Home", does: "Return to the origin" },
      { keys: "Space (hold) and drag", does: "Pan with any tool" },
      { keys: "Mouse wheel", does: "Zoom at the pointer (Shift: pan)" },
    ],
  },
  {
    group: "Editing",
    items: [
      { keys: "Ctrl+Z", does: "Undo" },
      { keys: "Ctrl+Shift+Z or Ctrl+Y", does: "Redo" },
      { keys: "Ctrl+A", does: "Select everything" },
      { keys: "Ctrl+C, Ctrl+X, Ctrl+V", does: "Copy, cut and paste" },
      { keys: "Ctrl+D", does: "Duplicate" },
      { keys: "Ctrl+G, Ctrl+Shift+G", does: "Group, ungroup" },
      { keys: "Ctrl+] and Ctrl+[", does: "Bring to front, send to back" },
      { keys: "Ctrl+E", does: "Flatten: the selected text becomes paths (its letters' own outlines), a boolean group becomes one path" },
      { keys: "Alt+drag the selection", does: "Drag a copy; the original stays" },
      { keys: "Hold Ctrl and move over the canvas", does: "Show the outline of everything under the pointer (the top one strong, the ones below dashed), with their names" },
      { keys: "Ctrl+click", does: "Pick the very thing under the pointer, deep in a group, a mask or a sheet" },
      { keys: "Drag a handle", does: "Resize (a corner or a side of a picture is free; strokes and text keep their proportions)" },
      { keys: "Shift+drag a handle", does: "Resize keeping the proportions" },
      { keys: "Alt+drag a handle", does: "Resize about the middle" },
      { keys: "Ctrl+drag a handle", does: "Resize without snapping" },
      { keys: "Delete or Backspace", does: "Delete the selection" },
      { keys: "Escape", does: "Cancel the gesture, then back to Select, then leave a group, then clear the selection" },
    ],
  },
  {
    group: "Shapes and paths",
    items: [
      { keys: "U, then drag", does: "Draw the shape chosen in the options (Shift: a square, a circle or a 45 degree line; Alt: from the centre)" },
      { keys: "B, then click or drag", does: "Draw a path: a click is a corner, a drag pulls out a smooth node's handles; click the first node to close it" },
      { keys: "Enter, Escape or a double-click", does: "End the path being drawn, open (Backspace takes back its last node)" },
      { keys: "N, Enter, or a double-click on a path", does: "Edit its nodes: drag a node or a handle, click a line to add a node, Alt-click a node for smooth or corner, Delete removes it; Enter or Escape finishes" },
    ],
  },
  {
    group: "Help",
    items: [{ keys: "?", does: "Open this list" }],
  },
];

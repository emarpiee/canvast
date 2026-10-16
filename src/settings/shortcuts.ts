import type { Tool } from "../app/editor-state";
import type { SettingKey, SettingsStore } from "./settings";

/**
 * Keyboard shortcuts (ADR 0049). The tool keys are device settings and can be changed in Settings > Shortcuts; everything else is
 * fixed and listed there so the list is the one place to look. A tool key is one plain letter (no modifier), so it never clashes
 * with the Ctrl and Shift combinations below.
 */
export const TOOL_ORDER: readonly Tool[] = ["hand", "select", "pen", "lasso", "text", "eraser"];

export const TOOL_NAME: Record<Tool, string> = { hand: "Hand (pan)", select: "Select", pen: "Pen", lasso: "Lasso", text: "Text", eraser: "Object eraser" };

export const TOOL_KEY_SETTING: Record<Tool, SettingKey> = {
  hand: "key.hand",
  select: "key.select",
  pen: "key.pen",
  lasso: "key.lasso",
  text: "key.text",
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
      { keys: "Ctrl+Arrow keys", does: "Step the selection to the next item (the way is set in Settings > Navigation)" },
      { keys: "Alt (press and release)", does: "Bring the selection into view" },
      { keys: "/", does: "Search the canvas by file or layer name" },
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
      { keys: "Delete or Backspace", does: "Delete the selection" },
      { keys: "Escape", does: "Cancel the gesture, then back to Select, then leave a group, then clear the selection" },
    ],
  },
  {
    group: "Help",
    items: [{ keys: "?", does: "Open this list" }],
  },
];

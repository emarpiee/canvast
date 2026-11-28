import type { CommandRegistry } from "../commands/registry";
import { installMenuKeys, openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { ICONS } from "./icons";

/** What a right click on the canvas offers, by command title: on something picked, and on empty canvas. Each is a command of the registry, so it is the same action as everywhere else. */
const ON_ITEMS: ReadonlyArray<readonly string[]> = [
  ["Copy", "Copy file", "Cut", "Paste", "Duplicate", "Rename"],
  ["Group", "Ungroup", "Put the selection on a sheet", "Detach from what it follows"],
  ["Bring to front", "Send to back"],
  ["Export… (choose a size)", "Copy the selection as SVG", "Save the selection to the library as SVG"],
  ["Delete the selection", "Delete everywhere"],
];
const ON_EMPTY: ReadonlyArray<readonly string[]> = [["Paste", "Select everything"], ["Show all hidden", "Unlock all"], ["Fit everything in view", "Return to the origin"]];
/** The icon and the short line of each row: the same icon as the button that does the same thing elsewhere (one icon for one function). */
export const ROWS: Readonly<Record<string, { icon: string; hint: string }>> = {
  Copy: { icon: ICONS.clipboardCopy, hint: "To paste elsewhere" },
  "Copy file": { icon: ICONS.files, hint: "The real file, for a file manager" },
  Cut: { icon: ICONS.scissors, hint: "Copy, then remove" },
  Paste: { icon: ICONS.paste, hint: "From the clipboard" },
  Duplicate: { icon: ICONS.copy, hint: "A copy beside it" },
  Rename: { icon: ICONS.textCursorInput, hint: "Give it a new name" },
  Group: { icon: ICONS.group, hint: "Move them as one" },
  Ungroup: { icon: ICONS.ungroup, hint: "Separate them again" },
  "Put the selection on a sheet": { icon: ICONS.sheetSelection, hint: "A frame around them" },
  "Detach from what it follows": { icon: ICONS.unlink, hint: "It stays where it is" },
  "Bring to front": { icon: ICONS.bringToFront, hint: "Above everything" },
  "Send to back": { icon: ICONS.sendToBack, hint: "Behind everything" },
  "Export… (choose a size)": { icon: ICONS.exportMenu, hint: "Save as a picture file" },
  "Copy the selection as SVG": { icon: ICONS.fileCode, hint: "Vector text to paste" },
  "Save the selection to the library as SVG": { icon: ICONS.save, hint: "A new library item" },
  "Delete the selection": { icon: ICONS.trash, hint: "From this canvas" },
  "Delete everywhere": { icon: ICONS.trash, hint: "From every canvas" },
  "Select everything": { icon: ICONS.selectAll, hint: "All on this canvas" },
  "Show all hidden": { icon: ICONS.eye, hint: "Items hidden on this canvas" },
  "Unlock all": { icon: ICONS.lockKeyholeOpen, hint: "So they can be moved" },
  "Fit everything in view": { icon: ICONS.frame, hint: "Zoom to see it all" },
  "Return to the origin": { icon: ICONS.house, hint: "Back to the start" },
};
/** Every title a canvas menu lists (a test holds `ROWS` to it). */
export const MENU_TITLES: readonly string[] = [...ON_ITEMS, ...ON_EMPTY].flat();
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

/** Items in groups become one list: the first item of each group after the first has a line above it. Empty groups are left out. */
export function grouped(groups: ReadonlyArray<readonly MenuItem[]>): MenuItem[] {
  return groups.filter((g) => g.length).flatMap((g, gi) => g.map((it, i) => (gi > 0 && i === 0 ? { ...it, sep: true } : it)));
}

/** The items of the registry's commands with these titles that apply now (a command that is not there or not enabled is left out), each with its icon. */
export function commandItems(registry: CommandRegistry, titles: readonly string[]): MenuItem[] {
  const all = registry.all();
  return titles.flatMap((title): MenuItem[] => {
    const c = all.find((x) => x.title === title && x.group !== "Tool" && x.source === "app"); // (the canvas's own command: other parts may have one of the same name)
    const row = ROWS[title];
    if (!c || !row || registry.reasonOf(c) !== null) return [];
    return [{ label: title, ...row, danger: title.startsWith("Delete"), command: c.id, run: () => void registry.press(c.id) }];
  });
}

/** What the canvas offers on a thing or on empty ground, in groups: the same list for a right click and for a long touch. */
export function canvasItems(registry: CommandRegistry, onThing: boolean, only?: ReadonlySet<string>): MenuItem[] {
  return grouped((onThing ? ON_ITEMS : ON_EMPTY).map((g) => commandItems(registry, only ? g.filter((t) => only.has(t)) : g)));
}

let anchorEl: HTMLElement | null = null;
/** Open `items` as a menu at a point of the window (an invisible anchor there: the menu opens to the right and down, or where there is room). */
export function showContextMenu(clientX: number, clientY: number, items: readonly MenuItem[], label: string): void {
  if (!items.length) return;
  const anchor = document.createElement("div");
  anchor.style.cssText = `position:fixed;left:${clientX}px;top:${clientY}px;width:0;height:0;pointer-events:none`;
  anchor.dataset["atPoint"] = ""; // (the menu opens from the point, its corner there)
  anchor.setAttribute("aria-hidden", "true");
  anchorEl?.remove(); // (one anchor at a time: the one of the last menu is replaced)
  document.body.appendChild(anchor);
  anchorEl = anchor;
  openMoreMenu(anchor, items, label);
}

export interface ContextPoint {
  readonly clientX: number;
  readonly clientY: number;
  /** The element under the point. */
  readonly target: HTMLElement;
}
export interface ContextBinding {
  readonly label: string;
  /** Whether the menu may open now (a view that is shown, no text being edited). */
  active?(): boolean;
  /** What to offer at the point: null or nothing to leave the browser's own menu alone. May prepare things first (pick what is under the point). */
  build(at: ContextPoint): MenuItem[] | null | Promise<MenuItem[] | null>;
  /** A long touch also opens it (default). A view that already gives a long touch a meaning of its own says false and offers `canvasItems` in it. */
  longTouch?: boolean;
}

/**
 * The one way a view gets a context menu: a right click, the menu key (Shift+F10) and, on a touch screen, a long press all call `build` and
 * show what it returns with `showContextMenu`. A view brings only its items (a view that has none, like Settings, binds nothing).
 */
export function bindContextMenu(el: HTMLElement, b: ContextBinding): void {
  installMenuKeys();
  let touchOpenedAt = -Infinity;
  const open = (at: ContextPoint): void => {
    if (b.active && !b.active()) return;
    void Promise.resolve(b.build(at)).then((items) => {
      if (items?.length) showContextMenu(at.clientX, at.clientY, items, b.label);
    });
  };
  // view-state: (opens the menu; its rows are commands)
  el.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest?.("input, textarea, [contenteditable='true']")) return; // (a field keeps the browser's own: copy, paste, spelling)
    e.preventDefault();
    if (performance.now() - touchOpenedAt < 800) return; // (the browser's own contextmenu that follows a long press we already answered)
    open({ clientX: e.clientX, clientY: e.clientY, target: t });
  });
  if (b.longTouch === false) return;
  let timer: number | null = null;
  let start: { x: number; y: number; id: number } | null = null;
  const cancel = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    start = null;
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || !e.isPrimary) return cancel();
    const t = e.target as HTMLElement;
    if (t.closest?.("input, textarea, [contenteditable='true']")) return;
    cancel();
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    timer = window.setTimeout(() => {
      const s = start;
      cancel();
      if (s) {
        navigator.vibrate?.(10);
        touchOpenedAt = performance.now();
        open({ clientX: s.x, clientY: s.y, target: t });
      }
    }, LONG_PRESS_MS);
  });
  el.addEventListener("pointermove", (e) => {
    if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP_PX) cancel();
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"] as const) el.addEventListener(ev, cancel);
}

export interface ContextMenuHooks {
  /** Whether the menu may open now (the canvas is the view, no text is being edited). */
  active(): boolean;
  /** Pick what is at the point (canvas px) if it is not picked already; whether there is something there. */
  pickAt(x: number, y: number): boolean;
  /** Only the rows with these titles (a Pins window's short menu). */
  only?: ReadonlySet<string>;
}

/**
 * The context menu of the canvas: the registry's commands that apply now, in groups. A long touch on the canvas lists what is under the finger
 * (the tools do that); that list carries the same `canvasItems`, so a touch screen has the same menu.
 */
export function mountContextMenu(canvas: HTMLElement, registry: CommandRegistry, hooks: ContextMenuHooks): void {
  bindContextMenu(canvas, {
    label: "Canvas actions",
    longTouch: false,
    active: hooks.active,
    build: ({ clientX, clientY }) => {
      const r = canvas.getBoundingClientRect();
      return canvasItems(registry, hooks.pickAt(clientX - r.left, clientY - r.top), hooks.only);
    },
  });
}

// ---- No browser menu anywhere (the app's own, or none) ----

/** The text field a right click or a menu acts on: the one under the pointer, else the one with the focus. */
let fieldAt: HTMLElement | null = null;
const fieldOf = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]), textarea, [contenteditable='true']") : null);
const editable = (f: HTMLElement): boolean => !(f as HTMLInputElement).readOnly && !(f as HTMLInputElement).disabled;
/** What is selected in the field (a text box's own selection, or the page's in an editable element). */
const selectedIn = (f: HTMLElement): string =>
  f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement ? f.value.slice(f.selectionStart ?? 0, f.selectionEnd ?? 0) : (getSelection()?.toString() ?? "");
const inField = (run: (f: HTMLElement) => void) => (): void => {
  const f = fieldAt ?? fieldOf(document.activeElement);
  if (!f) return;
  f.focus({ preventScroll: true });
  run(f);
};

/** The field's commands: Cut, Copy, Paste, Select all, Undo, Redo, on the field under the menu (or the focused one). */
export function installFieldCommands(registry: CommandRegistry): void {
  const field = (id: string, title: string, hint: string, icon: string, keys: string, run: (f: HTMLElement) => void, risk: "read" | "edit" = "edit") => ({ id, title, group: "Text", hint, icon, keys, risk, exec: inField(run) });
  registry.setProvider("text-fields", () => [
    field("text.cut", "Cut", "Take the selected words out", ICONS.scissors, "Ctrl+X", () => void document.execCommand("cut")),
    field("text.copy", "Copy", "Copy the selected words", ICONS.copy, "Ctrl+C", (f) => void navigator.clipboard?.writeText(selectedIn(f)).catch(() => document.execCommand("copy")), "read"),
    field("text.paste", "Paste", "Put in what was copied", ICONS.clipboardPaste, "Ctrl+V", () => void navigator.clipboard?.readText().then((t) => t && document.execCommand("insertText", false, t), () => undefined)),
    field("text.selectAll", "Select all", "Every word of this field", ICONS.selectAll, "Ctrl+A", (f) => (f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement ? f.select() : document.execCommand("selectAll")), "read"),
    field("text.undo", "Undo", "Take back the last change here", ICONS.undo, "Ctrl+Z", () => void document.execCommand("undo")),
    field("text.redo", "Redo", "Put back what was taken back", ICONS.redo, "Ctrl+Shift+Z", () => void document.execCommand("redo")),
  ]);
}

/** A text field's menu rows (off what cannot be done now). */
function fieldItems(f: HTMLElement): MenuItem[] {
  const has = selectedIn(f).length > 0, can = editable(f);
  const row = (command: string, label: string, hint: string, icon: string, disabled = false, sep = false): MenuItem => ({ command, label, hint, icon, disabled, sep, id: command, run: () => void commandsRef?.press(command) });
  return [
    row("text.cut", "Cut", "Take the selected words out", ICONS.scissors, !has || !can),
    row("text.copy", "Copy", "Copy the selected words", ICONS.copy, !has),
    row("text.paste", "Paste", "Put in what was copied", ICONS.clipboardPaste, !can),
    row("text.selectAll", "Select all", "Every word of this field", ICONS.selectAll, false, true),
    row("text.undo", "Undo", "Take back the last change here", ICONS.undo, !can, true),
    row("text.redo", "Redo", "Put back what was taken back", ICONS.redo, !can),
  ];
}

let commandsRef: CommandRegistry | null = null;
/**
 * The browser's own menu never opens: a right click that no view answered (the canvas, the Library, the Note editor bind their own) is
 * the app's text menu on a text field, and nothing elsewhere. Heard last, on the document.
 */
export function installNoBrowserMenu(registry: CommandRegistry): void {
  commandsRef = registry;
  installFieldCommands(registry);
  installMenuKeys();
  // view-state: (opens the text menu, whose rows are commands; elsewhere only keeps the browser's menu shut)
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const f = fieldOf(e.target);
    fieldAt = f;
    if (f) showContextMenu(e.clientX, e.clientY, fieldItems(f), "Text");
  });
}

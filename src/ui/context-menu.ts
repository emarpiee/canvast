import type { CommandRegistry } from "../commands/registry";
import { installMenuKeys, openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { ICONS } from "./icons";

/** What a right click on the canvas offers, by command title: on something picked, and on empty canvas. Each is a command of the registry, so it is the same action as everywhere else. */
const ON_ITEMS: ReadonlyArray<readonly string[]> = [
  ["Copy", "Cut", "Paste", "Duplicate"],
  ["Group", "Ungroup", "Put the selection on a sheet", "Detach from what it follows"],
  ["Bring to front", "Send to back"],
  ["Export… (choose a size)", "Copy the selection as SVG", "Save the selection to the library as SVG"],
  ["Delete the selection"],
];
const ON_EMPTY: ReadonlyArray<readonly string[]> = [["Paste", "Select everything"], ["Show all hidden", "Unlock all"], ["Fit everything in view", "Return to the origin"]];
/** The icon of each row: the same icon as the button that does the same thing elsewhere (one icon for one function). */
const ICON: Record<string, string> = {
  Copy: ICONS.clipboardCopy, Cut: ICONS.scissors, Paste: ICONS.paste, Duplicate: ICONS.copy, Group: ICONS.group, Ungroup: ICONS.ungroup,
  "Bring to front": ICONS.bringToFront, "Send to back": ICONS.sendToBack, "Put the selection on a sheet": ICONS.sheetSelection, "Detach from what it follows": ICONS.unlink,
  "Save the selection to the library as SVG": ICONS.save, "Delete the selection": ICONS.trash, "Select everything": ICONS.selectAll, "Show all hidden": ICONS.eye, "Unlock all": ICONS.lockKeyholeOpen,
  "Fit everything in view": ICONS.frame, "Return to the origin": ICONS.house, "Export… (choose a size)": ICONS.exportMenu, "Copy the selection as SVG": ICONS.fileCode,
};
const MENU_W = 240;
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
    const c = all.find((x) => x.title === title && x.group !== "Tool");
    if (!c || (c.enabled && !c.enabled())) return [];
    return [{ label: title, ...(ICON[title] ? { icon: ICON[title] } : {}), danger: title.startsWith("Delete"), run: () => void registry.run(c.id) }];
  });
}

/** What the canvas offers on a thing or on empty ground, in groups: the same list for a right click and for a long touch. */
export function canvasItems(registry: CommandRegistry, onThing: boolean): MenuItem[] {
  return grouped((onThing ? ON_ITEMS : ON_EMPTY).map((g) => commandItems(registry, g)));
}

let anchorEl: HTMLElement | null = null;
/** Open `items` as a menu at a point of the window (an invisible anchor there: the menu opens to the right and down, or where there is room). */
export function showContextMenu(clientX: number, clientY: number, items: readonly MenuItem[], label: string): void {
  if (!items.length) return;
  const anchor = document.createElement("div");
  anchor.style.cssText = `position:fixed;left:${clientX}px;top:${clientY}px;width:${MENU_W}px;height:0;pointer-events:none`;
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
      return canvasItems(registry, hooks.pickAt(clientX - r.left, clientY - r.top));
    },
  });
}

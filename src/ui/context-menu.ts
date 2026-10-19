import type { CommandRegistry } from "../commands/registry";
import { installMenuKeys, openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { ICONS } from "./icons";

/** What a right click on the canvas offers, by command title: on something picked, and on empty canvas. Each is a command of the registry, so it is the same action as everywhere else. */
const ON_ITEMS = ["Copy", "Cut", "Paste", "Duplicate", "Group", "Ungroup", "Bring to front", "Send to back", "Put the selection on a sheet", "Detach from what it follows", "Save the selection to the library as SVG", "Delete the selection"];
const ON_EMPTY = ["Paste", "Select everything", "Show all hidden", "Unlock all", "Fit everything in view", "Return to the origin"];
/** The icon of each row: the same icon as the button that does the same thing elsewhere (one icon for one function). */
const ICON: Record<string, string> = {
  Copy: ICONS.clipboardCopy, Cut: ICONS.scissors, Paste: ICONS.paste, Duplicate: ICONS.copy, Group: ICONS.group, Ungroup: ICONS.ungroup,
  "Bring to front": ICONS.bringToFront, "Send to back": ICONS.sendToBack, "Put the selection on a sheet": ICONS.sheetSelection, "Detach from what it follows": ICONS.unlink,
  "Save the selection to the library as SVG": ICONS.bookDown, "Delete the selection": ICONS.trash, "Select everything": ICONS.selectAll, "Show all hidden": ICONS.eye, "Unlock all": ICONS.lockKeyholeOpen,
  "Fit everything in view": ICONS.frame, "Return to the origin": ICONS.house,
};
const MENU_W = 240;

export interface ContextMenuHooks {
  /** Whether the menu may open now (the canvas is the view, no text is being edited). */
  active(): boolean;
  /** Pick what is at the point (canvas px) if it is not picked already; whether there is something there. */
  pickAt(x: number, y: number): boolean;
}

/** The context menu of the canvas (right click, or the menu key / Shift+F10 at the middle of the picked item's place): the registry's commands that apply now. */
export function mountContextMenu(canvas: HTMLElement, registry: CommandRegistry, hooks: ContextMenuHooks): void {
  installMenuKeys();
  let last: HTMLElement | null = null;
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!hooks.active()) return;
    const r = canvas.getBoundingClientRect();
    const picked = hooks.pickAt(e.clientX - r.left, e.clientY - r.top);
    const all = registry.all();
    const items: MenuItem[] = (picked ? ON_ITEMS : ON_EMPTY).flatMap((title): MenuItem[] => {
      const c = all.find((x) => x.title === title && x.group !== "Tool");
      if (!c || (c.enabled && !c.enabled())) return [];
      return [{ label: title, ...(ICON[title] ? { icon: ICON[title] } : {}), danger: title.startsWith("Delete"), run: () => void registry.run(c.id) }];
    });
    if (!items.length) return;
    // An invisible anchor where the pointer is: the menu opens from it, to the right and down (or where there is room).
    const anchor = document.createElement("div");
    anchor.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;width:${MENU_W}px;height:0;pointer-events:none`;
    anchor.setAttribute("aria-hidden", "true");
    last?.remove(); // (one anchor at a time: the one of the last menu is replaced)
    document.body.appendChild(anchor);
    last = anchor;
    openMoreMenu(anchor, items, "Canvas actions");
  });
}

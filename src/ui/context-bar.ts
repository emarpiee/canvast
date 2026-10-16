import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { LayoutCommand } from "../app/actions";
import type { AlignKey, SortKey } from "../doc/arrange";
import { ICONS } from "./icons";
import { GAP_LABEL, GAP_ORDER } from "../doc/arrange";
import type { GapKey } from "../doc/arrange";
import { LAYOUT_MENU } from "./toolbar";

/**
 * The selection action bar (ADR 0051): a small bar next to the selected objects with what is most often wanted next: duplicate,
 * group or ungroup, bring to front, send to back, lock, hide and delete. The same actions as the toolbar (it stays as it is), put
 * where the pointer already is. It follows the selection box through pan and zoom, sits below it (the rotate handle is above) or
 * above it when the screen edge is in the way, and is hidden while the selection is being moved, scaled or turned, while text is
 * being edited, and with the Hand, Pen, Text and eraser tools (which do not select).
 */
export interface ContextActions {
  duplicate(): void;
  /** Take the turn off the selection; give stretched pictures their own proportions back. */
  resetRotation(): void;
  resetProportions(): void;
  /** What the selection can be reset from. */
  resettable(): { turned: boolean; stretched: boolean };
  /** Open the Layers panel on the tag box for the selection. */
  tag(): void;
  group(): void;
  ungroup(): void;
  arrange(to: "front" | "back"): void;
  /** Arrange in a grid, align or distribute the selection. */
  layout(cmd: LayoutCommand): void;
  /** The space between items in a grid (ADR 0074), and choosing another one (a grid just made is laid out again with it). */
  gap(): GapKey;
  setGap(gap: GapKey): void;
  setFlag(flag: "hidden" | "locked"): void;
  deleteSelection(): void;
}

const GAP = 12;
const MARGIN = 8;

export function mountContextBar(host: HTMLElement, editor: EditorState, doc: DocumentStore, actions: ContextActions, hidden: () => boolean): { update(): void } {
  const bar = document.createElement("div");
  bar.className = "ctx-bar";
  bar.dataset["testid"] = "context-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Selection actions");
  bar.hidden = true;
  const btn = (act: string, icon: string, label: string): string => `<button type="button" data-ctx="${act}" aria-label="${label}" title="${label}">${icon}</button>`;
  bar.innerHTML =
    btn("duplicate", ICONS.copy, "Duplicate") +
    btn("group", ICONS.group, "Group") +
    btn("ungroup", ICONS.ungroup, "Ungroup") +
    btn("tag", ICONS.tag, "Tag the selection") +
    btn("unrotate", ICONS.rotateCcw, "Reset rotation") +
    btn("unstretch", ICONS.ratio, "Reset proportions (the picture's own shape)") +
    btn("layout", ICONS.layoutGrid, "Arrange and align") +
    btn("front", ICONS.bringToFront, "Bring to front") +
    btn("back", ICONS.sendToBack, "Send to back") +
    btn("lock", ICONS.lockKeyhole, "Lock selection") +
    btn("hide", ICONS.eyeOff, "Hide selection") +
    btn("delete", ICONS.trash, "Delete selection");
  host.appendChild(bar);
  // The Arrange menu (grid, align, distribute) opens from the bar and floats beside it.
  const menu = document.createElement("div");
  menu.className = "layout-menu ctx-layout-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Arrange and align");
  menu.dataset["testid"] = "layout-menu";
  menu.hidden = true;
  // After the grid choices: the space between the items of a grid, as a row of choices (one is chosen; the menu stays open).
  const gapRow = `<div class="layout-head" id="layout-gap-head">Space between items</div><div class="layout-gaps" role="group" aria-labelledby="layout-gap-head">${GAP_ORDER.map((g) => `<button type="button" role="menuitemradio" aria-checked="false" data-gap="${g}">${GAP_LABEL[g]}</button>`).join("")}</div>`;
  menu.innerHTML = LAYOUT_MENU.map((g, n) => `<div class="layout-head">${g.head}</div>${g.items.map((i) => `<button type="button" role="menuitem" data-layout="${i.id}">${i.icon}<span>${i.label}</span></button>`).join("")}${n === 0 ? gapRow : ""}`).join("");
  const showGap = (): void => {
    for (const b of menu.querySelectorAll<HTMLElement>("[data-gap]")) b.setAttribute("aria-checked", String(b.dataset["gap"] === actions.gap()));
  };
  host.appendChild(menu);
  const closeMenu = (): void => {
    menu.hidden = true;
    bar.querySelector('[data-ctx="layout"]')?.setAttribute("aria-expanded", "false");
  };
  const placeMenu = (): void => {
    const r = bar.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let top = r.bottom - h.top + 6;
    if (top + mh > h.height - MARGIN) top = Math.max(MARGIN, r.top - h.top - 6 - mh);
    const left = Math.max(MARGIN, Math.min(r.left - h.left + r.width / 2 - mw / 2, h.width - mw - MARGIN));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };
  menu.addEventListener("click", (e) => {
    const gap = (e.target as HTMLElement).closest<HTMLElement>("[data-gap]");
    if (gap) {
      actions.setGap(gap.dataset["gap"] as GapKey);
      showGap();
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-layout]");
    if (!b) return;
    const [kind, arg] = b.dataset["layout"]!.split(":") as [string, string];
    closeMenu();
    actions.layout(kind === "grid" ? { grid: arg as SortKey } : kind === "align" ? { align: arg as AlignKey } : { distribute: arg as "x" | "y" });
  });
  menu.addEventListener("pointerdown", (e) => e.stopPropagation());
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      bar.querySelector<HTMLElement>('[data-ctx="layout"]')?.focus();
      e.stopPropagation();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !(e.target as HTMLElement).closest(".ctx-bar, .ctx-layout-menu")) closeMenu();
  });
  const q = (act: string): HTMLButtonElement => bar.querySelector<HTMLButtonElement>(`[data-ctx="${act}"]`)!;

  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ctx]");
    if (!b) return;
    switch (b.dataset["ctx"]) {
      case "layout":
        menu.hidden = !menu.hidden;
        b.setAttribute("aria-expanded", String(!menu.hidden));
        if (!menu.hidden) {
          showGap();
          placeMenu();
          menu.querySelector<HTMLElement>("button")?.focus();
        }
        break;
      case "tag": actions.tag(); break;
      case "unrotate": actions.resetRotation(); break;
      case "unstretch": actions.resetProportions(); break;
      case "duplicate": actions.duplicate(); break;
      case "group": actions.group(); break;
      case "ungroup": actions.ungroup(); break;
      case "front": actions.arrange("front"); break;
      case "back": actions.arrange("back"); break;
      case "lock": actions.setFlag("locked"); break;
      case "hide": actions.setFlag("hidden"); break;
      case "delete": actions.deleteSelection(); break;
    }
  });
  // The bar must not start a drag or a selection change on the canvas below it.
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());

  let lastKey = "";
  const update = (): void => {
    const box = editor.selectionBoxOnScreen;
    const show = !hidden() && editor.selection.size > 0 && (editor.tool === "select" || editor.tool === "lasso") && editor.preview.kind === "none" && !!box;
    if (!show || !box) {
      if (!bar.hidden) bar.hidden = true;
      closeMenu();
      lastKey = "";
      return;
    }
    const sel = [...editor.selection].map((id) => doc.get(id)).filter((o) => !!o);
    q("group").hidden = sel.length < 2 || sel.every((o) => (o!.groups?.length ?? 0) > 0 && new Set(sel.map((x) => x!.groups![0])).size === 1);
    q("layout").hidden = sel.length < 2;
    const reset = actions.resettable();
    q("unrotate").hidden = !reset.turned;
    q("unstretch").hidden = !reset.stretched;
    if (sel.length < 2) closeMenu();
    q("ungroup").hidden = !sel.some((o) => o!.groups?.length);
    bar.hidden = false;
    const xs = box.frame.corners.map((c) => c[0]);
    const ys = box.frame.corners.map((c) => c[1]);
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const vw = host.clientWidth;
    const vh = host.clientHeight;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    let top = Math.max(...ys) + GAP;
    if (top + h > vh - MARGIN) top = Math.min(...ys) - GAP - h - 24; // no room below: above the rotate handle
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    const left = Math.max(MARGIN, Math.min(cx - w / 2, vw - w - MARGIN));
    const key = `${Math.round(left)},${Math.round(top)}`;
    if (key !== lastKey) {
      bar.style.left = `${Math.round(left)}px`;
      bar.style.top = `${Math.round(top)}px`;
      lastKey = key;
      if (!menu.hidden) placeMenu();
    }
  };
  editor.subscribe(update);
  return { update };
}

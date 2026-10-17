import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { LayoutCommand } from "../app/actions";
import type { AlignKey, SortKey } from "../doc/arrange";
import { ICONS } from "./icons";
import { GAP_LABEL, GAP_ORDER } from "../doc/arrange";
import type { GapKey } from "../doc/arrange";
import { LAYOUT_MENU } from "./toolbar";
import { openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import type { BoolOp } from "../doc/boolean";

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
  /** The selection holds pictures, videos or audio that are in the library, and showing them there. */
  /** The one selected item is a file the app cannot show (kept as a card): its asset, and whether a tab can open it (ADR 0078). */
  fileSelection(): { hash: string; open: boolean } | null;
  downloadFile(): void;
  openFile(): void;
  hasLibraryItems(): boolean;
  showInLibrary(): void;
  /** Open the Tags panel on the box for the selection. */
  tag(): void;
  group(): void;
  ungroup(): void;
  arrange(to: "front" | "back"): void;
  /** Combine the selected shapes into one (ADR 0101); whether two or more can be. */
  combine(op: BoolOp): void;
  canCombine(): boolean;
  /** The operation of the boolean group that is the selection, if it is one (ADR 0103), and taking it apart or making it one path. */
  booleanState(): BoolOp | null;
  releaseBoolean(): void;
  flattenBoolean(): void;
  /** Turn the selected text into paths (ADR 0102), and whether any is selected. */
  outline(): void;
  canOutline(): boolean;
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
    btn("library", ICONS.library, "View in the library") +
    btn("download", ICONS.download, "Download the original file") +
    btn("open", ICONS.externalLink, "Open in a new tab") +
    btn("unrotate", ICONS.rotateCcw, "Reset rotation") +
    btn("unstretch", ICONS.ratio, "Reset proportions (the picture's own shape)") +
    btn("outline", ICONS.replace, "Convert text to path (Ctrl+E)") +
    btn("flatten", ICONS.merge, "Flatten the boolean group into one path (Ctrl+E)") +
    btn("combine", ICONS.combineIcon, "Combine shapes (union, intersect, subtract, exclude); on a boolean group: its operation, flatten, release") +
    btn("layout", ICONS.blocks, "Arrange and align") +
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
      case "combine": {
        // On a selection of shapes: the four operations make a boolean group. On a boolean group: the same four change its operation (the
        // current one ticked), and it can be flattened into one path or released into its shapes again.
        const cur = actions.booleanState();
        const pick = (op: BoolOp, label: string, icon: string, aria: string): MenuItem => ({ label, icon, aria, ...(cur ? { checked: cur === op } : {}), run: () => actions.combine(op) });
        openMoreMenu(b, [
          pick("union", "Union", ICONS.squaresUnite, "Union: join the shapes into one"),
          pick("intersect", "Intersect", ICONS.squaresIntersect, "Intersect: keep only where the shapes overlap"),
          pick("subtract", "Subtract", ICONS.squaresSubtract, "Subtract: take the shapes in front away from the one at the back"),
          pick("exclude", "Exclude overlap", ICONS.squaresExclude, "Exclude overlap: keep everything but where the shapes overlap"),
          ...(cur ? [
            { label: "Flatten", icon: ICONS.merge, aria: "Flatten: make it one path, without the shapes inside (Ctrl+E)", run: () => actions.flattenBoolean() },
            { label: "Release shapes", icon: ICONS.ungroup, aria: "Release the shapes: take the group apart, the shapes stay as they are", run: () => actions.releaseBoolean() },
          ] : []),
        ], cur ? "Boolean group" : "Combine shapes");
        break;
      }
      case "flatten": actions.flattenBoolean(); break;
      case "outline": actions.outline(); break;
      case "tag": actions.tag(); break;
      case "library": actions.showInLibrary(); break;
      case "download": actions.downloadFile(); break;
      case "open": actions.openFile(); break;
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
  let settling = false;
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
    q("group").hidden = sel.length < 2 || sel.every((o) => (o!.groups?.length ?? 0) > 0 && new Set(sel.map((x) => x!.groups?.[0])).size === 1);
    q("layout").hidden = sel.length < 2;
    q("combine").hidden = !actions.canCombine();
    q("flatten").hidden = actions.booleanState() === null;
    q("outline").hidden = !actions.canOutline();
    const reset = actions.resettable();
    q("library").hidden = !actions.hasLibraryItems();
    const file = actions.fileSelection();
    q("download").hidden = !file;
    q("open").hidden = !file?.open;
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
    // The bar goes below the selection when there is room, else above its turn handle. A picture with a player (video, audio, GIF) has the
    // player's bar on one side of it (below, or above when the view's edge leaves no room below): this bar then takes the first place that
    // is inside the view and clear of the player's bar: below the selection, above it, below the player, above the player.
    const hostBox = host.getBoundingClientRect();
    const playerEl = sel.length === 1 && "media" in sel[0]! && sel[0].media ? host.querySelector<HTMLElement>(".media-bar:not([hidden])") : null;
    const pr = playerEl && playerEl.style.display !== "none" ? playerEl.getBoundingClientRect() : null;
    const player = pr ? { top: pr.top - hostBox.top, bottom: pr.bottom - hostBox.top } : null;
    const clear = (t: number): boolean => !player || t + h + 2 <= player.top || t >= player.bottom + 2;
    const fits = (t: number): boolean => t >= MARGIN && t + h <= vh - MARGIN && clear(t);
    const candidates = [Math.max(...ys) + GAP, Math.min(...ys) - GAP - h - 24, ...(player ? [player.bottom + GAP, player.top - GAP - h] : [])];
    let top = candidates.find(fits) ?? candidates[0]!;
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    const left = Math.max(MARGIN, Math.min(cx - w / 2, vw - w - MARGIN));
    // The player's bar places itself in its own update; look again once it has, so the two agree.
    if (playerEl && !settling) {
      settling = true;
      requestAnimationFrame(() => {
        update(); // (settling is still on: this look does not ask for another)
        settling = false;
      });
    }
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

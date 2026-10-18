import { esc } from "./format";
import { ICONS } from "./icons";

/**
 * The one "more actions" pattern of the app (ADR 0068): a small ⋯ button at the end of a row or card, shown when the row is pointed at or
 * focused (always on a touch screen), that opens one labelled menu (icon and words), floating over the page and kept inside the window.
 * The same look (`.more-btn`, `.pop-menu`) and the same keys everywhere: Up and Down move, Home and End jump, Enter or Space chooses,
 * Escape closes and gives the focus back to the button, a press elsewhere closes. The sidebar, the workspace menu, the bookmarks and the
 * layers all use it.
 */
export interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  /** A choice among several (the current operation): shown ticked, announced as a radio. */
  checked?: boolean;
  /** The accessible name when the visible label is not enough (default: the label). */
  aria?: string;
  /** A short line of what it does, under the label (the menu is then a list to read, not only to pick from). */
  hint?: string;
  /** Names the item for tests and scripts (`data-id`). */
  id?: string;
  run(): void;
}

/** The markup of the ⋯ button. `label` names it ("More actions for bookmark Home"). */
export function moreButton(label: string, attrs = ""): string {
  return `<button type="button" class="more-btn" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}" title="More" ${attrs}>${ICONS.ellipsis}</button>`;
}

let open: { menu: HTMLElement; anchor: HTMLElement; onClose?: (() => void) | undefined } | null = null;

export function closeMoreMenu(refocus = false): void {
  if (!open) return;
  const { menu, anchor, onClose } = open;
  open = null;
  menu.remove();
  onClose?.();
  anchor.setAttribute("aria-expanded", "false");
  if (refocus && anchor.isConnected) anchor.focus();
}

/** What a menu or popover should not cover: the box of the selected items on screen (set by the app), or null. */
let avoidBox: () => { left: number; top: number; right: number; bottom: number } | null = () => null;
export const setMenuAvoid = (f: typeof avoidBox): void => {
  avoidBox = f;
};

/**
 * Keep a menu inside the window, under its button (above it when there is no room), right edges aligned; and not over the selected items:
 * if that is where it would land it goes beside them instead (right, then left), or as far from them as the window allows.
 */
export function placeMenu(menu: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const gap = 8;
  const left0 = Math.max(gap, Math.min(window.innerWidth - w - gap, r.right - w));
  let top = r.bottom + 4;
  if (top + h > window.innerHeight - gap) top = Math.max(gap, r.top - 4 - h);
  let left = left0;
  const avoid = avoidBox();
  if (avoid) {
    const overlap = (l: number, t: number): number => Math.max(0, Math.min(l + w, avoid.right + gap) - Math.max(l, avoid.left - gap)) * Math.max(0, Math.min(t + h, avoid.bottom + gap) - Math.max(t, avoid.top - gap));
    const fit = (l: number, t: number): { l: number; t: number } => ({ l: Math.max(gap, Math.min(window.innerWidth - w - gap, l)), t: Math.max(gap, Math.min(window.innerHeight - h - gap, t)) });
    const options = [
      { l: left0, t: top },
      fit(left0, r.top - 4 - h),
      fit(left0, r.bottom + 4),
      fit(avoid.right + gap * 2, top),
      fit(avoid.left - gap * 2 - w, top),
      fit(avoid.right + gap * 2, avoid.top),
      fit(avoid.left - gap * 2 - w, avoid.top),
    ];
    const best = options.reduce((a, b) => (overlap(b.l, b.t) < overlap(a.l, a.t) ? b : a));
    left = best.l;
    top = best.t;
  }
  // A menu inside a blurred or transformed panel is placed against that panel, not the window: measure where (0, 0) really is and correct for it.
  menu.style.left = "0px";
  menu.style.top = "0px";
  const origin = menu.getBoundingClientRect();
  menu.style.left = `${Math.round(left - origin.left)}px`;
  menu.style.top = `${Math.round(top - origin.top)}px`;
}

export interface MenuOptions {
  /** A menu that groups tools (Align): choosing an item does not close it; it closes on Escape or a press outside, and is placed again after each choice so it stays off what is picked. */
  keepOpen?: boolean;
  /** The items again, after a choice, when it changes what the menu shows (a ticked item moves). */
  refresh?(): readonly MenuItem[];
  /** The item under the finger or the focus (null: none), e.g. to outline it on the canvas. */
  onActive?(index: number | null): void;
  /** The menu closed, by whatever means. */
  onClose?(): void;
  /** A press outside closes the menu and does nothing else (the canvas under it is not clicked, so a pick is not cleared by the press that ends the menu). Default: on for a menu that stays open (`keepOpen`). */
  consumeOutside?: boolean;
  /** The menu opened under a finger that is still down: the click that comes when it lifts is not a choice; only a press on the menu itself arms it. */
  needPress?: boolean;
}

/** Open the menu of `items` under `anchor` (the ⋯ button, or a button that groups several tools); a second press on the button closes it. */
export function openMoreMenu(anchor: HTMLElement, items: readonly MenuItem[], label: string, opts: MenuOptions = {}): void {
  if (open && open.anchor === anchor) return closeMoreMenu(true);
  closeMoreMenu();
  const menu = document.createElement("div");
  menu.className = "pop-menu";
  if (opts.keepOpen) menu.dataset["keep"] = "true";
  if (opts.consumeOutside ?? opts.keepOpen) menu.dataset["consume"] = "true"; // (a menu that stays open for several tries: the press that ends it is only that, so the pick it worked on stays)
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  let current = items;
  const render = (): void => {
    menu.innerHTML = current
    .map((it, i) => `<button type="button" role="${it.checked === undefined ? "menuitem" : "menuitemradio"}"${it.checked === undefined ? "" : ` aria-checked="${it.checked}"`} data-i="${i}"${it.id ? ` data-id="${esc(it.id)}"` : ""} class="${it.danger ? "is-danger" : ""}${it.checked ? " is-checked" : ""}"${it.disabled ? " disabled" : ""} aria-label="${esc(it.aria ?? it.label)}">${it.icon ?? ""}${it.hint ? `<span class="menu-text"><span>${esc(it.label)}</span><span class="menu-hint">${esc(it.hint)}</span></span>` : `<span>${esc(it.label)}</span>`}${it.checked ? `<span class="menu-tick" aria-hidden="true">${ICONS.check}</span>` : ""}</button>`)
    .join("");
  };
  render();
  document.body.appendChild(menu);
  placeMenu(menu, anchor);
  anchor.setAttribute("aria-expanded", "true");
  open = { menu, anchor, onClose: opts.onClose };
  if (opts.onActive) {
    const at = (e: Event): number | null => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]"); return b ? Number(b.dataset["i"]) : null; };
    menu.addEventListener("pointerover", (e) => opts.onActive!(at(e)));
    menu.addEventListener("pointerleave", () => opts.onActive!(null));
    menu.addEventListener("focusin", (e) => opts.onActive!(at(e)));
  }
  let armed = !opts.needPress;
  menu.addEventListener("pointerdown", () => { armed = true; });
  menu.addEventListener("click", (e) => {
    if (!armed) return;
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-i]");
    if (!b || b.disabled) return;
    const index = Number(b.dataset["i"]);
    const item = current[index]!;
    if (opts.keepOpen) {
      item.run();
      if (open?.menu !== menu) return; // (the choice closed it)
      if (opts.refresh) {
        current = opts.refresh(); // (what is ticked or offered has changed)
        if (!current.length) return closeMoreMenu(); // (nothing applies any more: the button is gone too)
        render();
        (menu.querySelector<HTMLElement>(`[data-i="${index}"]:not(:disabled)`) ?? menu.querySelector<HTMLElement>("button:not(:disabled)"))?.focus(); // (so Escape still reaches the menu)
      }
      requestAnimationFrame(() => open?.menu === menu && placeMenu(menu, anchor)); // (the selection may have moved)
      return;
    }
    closeMoreMenu();
    item.run();
  });
  menu.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
}

let installed = false;
/** The keys and the closing rules shared by every menu (ours and the sidebar's and the workspace menu's, which use `.pop-menu` styling). */
export function installMenuKeys(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("keydown", (e) => {
    const inMenu = (e.target as HTMLElement | null)?.closest?.(".pop-menu, .side-menu, .nav-actions");
    if (!inMenu) {
      // a menu that stays open (grouped tools) closes on Escape wherever the focus is
      if (e.key === "Escape" && open?.menu.dataset["keep"] === "true") {
        closeMoreMenu(false);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const items = [...inMenu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const i = items.indexOf(e.target as HTMLButtonElement);
    let to: number | null = null;
    if (e.key === "ArrowDown") to = (i + 1) % items.length;
    else if (e.key === "ArrowUp") to = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = items.length - 1;
    if (to !== null && items.length) {
      items[to]!.focus();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Escape" && open && inMenu === open.menu) {
      closeMoreMenu(true);
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  document.addEventListener("pointerdown", (e) => {
    // (capture: before the canvas sees the press)
    if (open?.menu.dataset["consume"] === "true" && !(e.target as HTMLElement).closest(".pop-menu") && !open.anchor.contains(e.target as Node)) {
      closeMoreMenu();
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (open && !(e.target as HTMLElement).closest(".pop-menu") && !open.anchor.contains(e.target as Node)) closeMoreMenu();
  });
  window.addEventListener("resize", () => closeMoreMenu());
}

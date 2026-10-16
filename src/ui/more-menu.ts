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
  /** The accessible name when the visible label is not enough (default: the label). */
  aria?: string;
  run(): void;
}

/** The markup of the ⋯ button. `label` names it ("More actions for bookmark Home"). */
export function moreButton(label: string, attrs = ""): string {
  return `<button type="button" class="more-btn" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}" title="More" ${attrs}>${ICONS.ellipsis}</button>`;
}

let open: { menu: HTMLElement; anchor: HTMLElement } | null = null;

export function closeMoreMenu(refocus = false): void {
  if (!open) return;
  const { menu, anchor } = open;
  open = null;
  menu.remove();
  anchor.setAttribute("aria-expanded", "false");
  if (refocus && anchor.isConnected) anchor.focus();
}

/** Keep a menu inside the window, under its button (above it when there is no room), right edges aligned. */
export function placeMenu(menu: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
  let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 4 - h);
  // A menu inside a blurred or transformed panel is placed against that panel, not the window: measure where (0, 0) really is and correct for it.
  menu.style.left = "0px";
  menu.style.top = "0px";
  const origin = menu.getBoundingClientRect();
  menu.style.left = `${Math.round(left - origin.left)}px`;
  menu.style.top = `${Math.round(top - origin.top)}px`;
}

/** Open the menu of `items` under `anchor` (the ⋯ button); a second press on the button closes it. */
export function openMoreMenu(anchor: HTMLElement, items: readonly MenuItem[], label: string): void {
  if (open && open.anchor === anchor) return closeMoreMenu(true);
  closeMoreMenu();
  const menu = document.createElement("div");
  menu.className = "pop-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  menu.innerHTML = items
    .map((it, i) => `<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? "is-danger" : ""}"${it.disabled ? " disabled" : ""} aria-label="${esc(it.aria ?? it.label)}">${it.icon ?? ""}<span>${esc(it.label)}</span></button>`)
    .join("");
  document.body.appendChild(menu);
  placeMenu(menu, anchor);
  anchor.setAttribute("aria-expanded", "true");
  open = { menu, anchor };
  menu.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-i]");
    if (!b || b.disabled) return;
    const item = items[Number(b.dataset["i"])]!;
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
    if (!inMenu) return;
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
    if (open && !(e.target as HTMLElement).closest(".pop-menu") && !open.anchor.contains(e.target as Node)) closeMoreMenu();
  });
  window.addEventListener("resize", () => closeMoreMenu());
}

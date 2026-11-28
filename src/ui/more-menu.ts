import { popHost } from "./modal";
import { commands } from "../commands/registry";
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
  /** Every row has an icon and a very short description: the type says so, for every menu of the app. */
  icon: string;
  danger?: boolean;
  disabled?: boolean;
  /** A choice among several (the current operation): shown ticked, announced as a radio. */
  checked?: boolean;
  /** The accessible name when the visible label is not enough (default: the label). */
  aria?: string;
  /** A short line of what it does, under the label (the menu is then a list to read, not only to pick from). */
  hint: string;
  /** A line above this item: it starts a new group of the menu. */
  sep?: boolean;
  /** A number at the end of the row (how many there are of it). */
  count?: number;
  /** Its own ⋯ at the end of the row: a menu of what can be done to it (rename, delete). */
  more?: readonly MenuItem[];
  /** A group of rows: the row opens them beside it (a click, the pointer resting on it, or →), as a submenu. Its `run` is not called. */
  sub?: readonly MenuItem[];
  /** Names the item for tests and scripts (`data-id`). */
  id?: string;
  /** The id of the command it runs (ADR 0205): every menu row runs one. */
  command: string;
  run(): void;
}

/**
 * A menu row made from a command (ADR 0205): its name, hint and icon are the command's (`over` may change them, or tick it), it is off with
 * the reason when the command cannot run, and choosing it runs the command. Null when there is no such command.
 */
export function commandRow(id: string, over: Partial<MenuItem> = {}): MenuItem | null {
  const c = commands.get(id);
  if (!c) return null;
  const reason = commands.reasonOf(c);
  return { label: c.title, hint: c.hint ?? "", icon: c.icon ?? "", ...(reason ? { disabled: true, hint: `Not now: ${reason}` } : {}), ...over, id: over.id ?? id, command: id, run: () => void commands.press(id) };
}

/** The rows of these commands that can be listed now (a command that is not there is left out). */
export const commandRows = (ids: ReadonlyArray<string | readonly [string, Partial<MenuItem>]>): MenuItem[] =>
  ids.flatMap((x) => {
    const r = typeof x === "string" ? commandRow(x) : commandRow(x[0], x[1]);
    return r ? [r] : [];
  });

/**
 * A row's choice done by the host's own click handler: a button with these attributes is pressed inside `host` and gone again. For lists whose
 * rows are told apart by attributes (`data-action`), so the handler stays the one place for what a choice does.
 */
export function pressAs(host: HTMLElement, attrs: Readonly<Record<string, string>>): void {
  const b = document.createElement("button");
  b.type = "button";
  b.hidden = true;
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  host.appendChild(b);
  b.click();
  b.remove();
}

/** The markup of the ⋯ button. `label` names it ("More actions for bookmark Home"). */
export function moreButton(label: string, attrs = ""): string {
  return `<button type="button" class="more-btn" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}" title="More" ${attrs}>${ICONS.ellipsis}</button>`;
}

let open: { menu: HTMLElement; anchor: HTMLElement; onClose?: (() => void) | undefined } | null = null;
/** A row's own menu (its ⋯), beside the menu it is in, which stays open. */
let child: { menu: HTMLElement; from: HTMLElement } | null = null;
const closeChild = (refocus = false): void => {
  if (!child) return;
  const { menu, from } = child;
  child = null;
  menu.remove();
  from.setAttribute("aria-expanded", "false");
  from.parentElement?.classList.remove("has-open-menu");
  if (refocus && from.isConnected) from.focus({ preventScroll: true });
};

/** A menu row's markup: its icon, label and hint. */
const rowHtml = (it: MenuItem, i: number): string => `<button type="button" role="${it.checked === undefined ? "menuitem" : "menuitemradio"}"${it.checked === undefined ? "" : ` aria-checked="${it.checked}"`} data-i="${i}"${it.sub ? ' aria-haspopup="menu" data-sub' : ""}${it.id ? ` data-id="${esc(it.id)}"` : ""}${it.command ? ` data-command="${esc(it.command)}"` : ""} class="${it.danger ? "is-danger" : ""}${it.checked ? " is-checked" : ""}${it.sep && i > 0 ? " has-sep" : ""}"${it.disabled ? " disabled" : ""} aria-label="${esc(it.aria ?? it.label)}">${it.icon ?? ""}${it.hint ? `<span class="menu-text"><span>${esc(it.label)}</span><span class="menu-hint">${esc(it.hint)}</span></span>` : `<span>${esc(it.label)}</span>`}${it.count !== undefined ? `<span class="menu-count">${it.count}</span>` : ""}${it.checked ? `<span class="menu-tick" aria-hidden="true">${ICONS.check}</span>` : ""}${it.sub ? `<span class="menu-sub-mark" aria-hidden="true">${ICONS.chevronDown}</span>` : ""}</button>`;

export function closeMoreMenu(refocus = false): void {
  closeChild();
  if (!open) return;
  const { menu, anchor, onClose } = open;
  open = null;
  menu.remove();
  onClose?.();
  anchor.setAttribute("aria-expanded", "false");
  anchor.parentElement?.classList.remove("has-open-menu");
  if (refocus && anchor.isConnected) anchor.focus({ preventScroll: true });
}

/** What a menu or popover should not cover: the box of the selected items on screen (set by the app), or null. */
let avoidBox: () => { left: number; top: number; right: number; bottom: number } | null = () => null;
export const setMenuAvoid = (f: typeof avoidBox): void => {
  avoidBox = f;
};
/** The box menus and popovers keep clear of now (null: none). */
export const menuAvoid = (): ReturnType<typeof avoidBox> => avoidBox();

/**
 * Keep a menu inside the window, under its button (above it when there is no room), right edges aligned; and not over the selected items:
 * if that is where it would land it goes beside them instead (right, then left), or as far from them as the window allows.
 */
/** The room a menu keeps clear: a button inside a bar of the app (a horizontal one) stands for the whole bar, so the menu clears the bar's edge, not only the button's. */
export function clearRect(anchor: HTMLElement): DOMRect {
  return (anchor.closest(".toolbar, .ctx-bar, .props-near, .dock, .hud-controls, .assets-bar") ?? anchor).getBoundingClientRect();
}

export const MENU_GAP = 8; // (the space between a bar or button and the menu it opens; the same for every menu and popover)

export function placeMenu(menu: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const c = clearRect(anchor);
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const gap = 8;
  // (under a button, right edges aligned; at a point (a context menu), its left edge there, or its right edge when there is no room)
  const point = anchor.dataset["atPoint"] !== undefined;
  const at = point ? (r.left + w + gap <= window.innerWidth ? r.left : r.left - w) : r.right - w;
  const left0 = Math.max(gap, Math.min(window.innerWidth - w - gap, at));
  const space = point ? 2 : MENU_GAP;
  let top = c.bottom + space;
  if (top + h > window.innerHeight - gap) top = Math.max(gap, c.top - space - h);
  let left = left0;
  const avoid = avoidBox();
  if (avoid) {
    // (what a place covers: of the selected things, and of the menu's own bar, so it never hides the chip or button it came from)
    const over = (b: { left: number; top: number; right: number; bottom: number }, l: number, t: number): number => Math.max(0, Math.min(l + w, b.right + gap) - Math.max(l, b.left - gap)) * Math.max(0, Math.min(t + h, b.bottom + gap) - Math.max(t, b.top - gap));
    const overlap = (l: number, t: number): number => over(avoid, l, t) + over(c, l, t);
    const fit = (l: number, t: number): { l: number; t: number } => ({ l: Math.max(gap, Math.min(window.innerWidth - w - gap, l)), t: Math.max(gap, Math.min(window.innerHeight - h - gap, t)) });
    const options = [
      { l: left0, t: top },
      fit(left0, c.top - MENU_GAP - h),
      fit(left0, c.bottom + MENU_GAP),
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
  // A pop-in that is still playing moves the box: measure where it ends up, then put it back where it was (the animation goes on, it is never started again:
  // a menu placed again at every change, like a fill's options, would otherwise blink).
  const playing = menu.getAnimations().filter((a) => a.playState === "running");
  const was = playing.map((a) => a.currentTime);
  for (const a of playing) a.currentTime = Number(a.effect?.getComputedTiming().endTime ?? 0);
  const origin = menu.getBoundingClientRect();
  playing.forEach((a, i) => (a.currentTime = was[i] ?? 0));
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
  /** Closer rows, one line each (a long list to choose from: the colours of a selection). */
  compact?: boolean;
  /** The focus stays where it is (the text being typed: the keys go on into it); the menu takes none, when it opens or after a choice. Escape still closes a menu that stays open. */
  keepFocus?: boolean;
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
  if (opts.compact) menu.classList.add("is-compact");
  if (opts.consumeOutside ?? opts.keepOpen) menu.dataset["consume"] = "true"; // (a menu that stays open for several tries: the press that ends it is only that, so the pick it worked on stays)
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  let current = items;
  const render = (): void => {
    menu.innerHTML = current
    .map((it, i) => { const row = rowHtml(it, i); return it.more ? `<div class="pop-menu-row">${row}${moreButton(`More actions for ${it.label}`, `data-more-i="${i}"`)}</div>` : row; })
    .join("");
  };
  render();
  popHost().appendChild(menu);
  placeMenu(menu, anchor);
  anchor.setAttribute("aria-expanded", "true");
  anchor.parentElement?.classList.add("has-open-menu"); // (what holds the button shows it open: a class for its look)
  open = { menu, anchor, onClose: opts.onClose };
  if (opts.onActive) {
    const at = (e: Event): number | null => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]"); return b ? Number(b.dataset["i"]) : null; };
    menu.addEventListener("pointerover", (e) => opts.onActive!(at(e)));
    menu.addEventListener("pointerleave", () => opts.onActive!(null));
    menu.addEventListener("focusin", (e) => opts.onActive!(at(e)));
  }
  let armed = !opts.needPress;
  menu.addEventListener("pointerdown", () => { armed = true; });
  /** A group's rows beside the row that holds them (a submenu); a row of it runs its command. */
  const openSub = (from: HTMLElement, items: readonly MenuItem[], label: string): void => {
    if (child?.from === from) return;
    closeChild();
    const sub = document.createElement("div");
    sub.className = "pop-menu is-child is-sub";
    sub.setAttribute("role", "menu");
    sub.setAttribute("aria-label", label);
    sub.innerHTML = items.map(rowHtml).join("");
    // commands: (a row of a group runs its command)
    sub.addEventListener("click", (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-i]");
      if (!b || b.disabled) return;
      const pick = items[Number(b.dataset["i"])]!;
      closeMoreMenu();
      pick.run();
    });
    popHost().appendChild(sub);
    // (beside the menu, level with its row, as submenus stand: to the right, or to the left when the window has no room there; never over
    // the menu's own rows, which the pointer crosses on its way to it)
    const m = menu.getBoundingClientRect(), r = from.getBoundingClientRect(), w = sub.offsetWidth, h = sub.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight, gap = 4;
    const left = m.right + gap + w <= vw - gap ? m.right + gap : Math.max(gap, m.left - gap - w);
    const top = Math.max(gap, Math.min(r.top - 4, vh - gap - h));
    Object.assign(sub.style, { position: "fixed", left: `${left}px`, top: `${top}px` });
    // view-state: (the pointer reaching the group keeps it open)
    sub.addEventListener("pointerenter", () => window.clearTimeout(hover));
    from.setAttribute("aria-expanded", "true");
    child = { menu: sub, from };
  };
  // view-state: (the pointer resting on a group's row opens it; on another row, the open group closes)
  let hover = 0;
  menu.addEventListener("pointerover", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!row || row === child?.from) return;
    window.clearTimeout(hover);
    hover = window.setTimeout(() => {
      const it = current[Number(row.dataset["i"])];
      if (it?.sub && !row.hasAttribute("disabled")) openSub(row, it.sub, it.label);
      else if (child && !child.from.closest("[data-more-i]")) closeChild();
    }, child ? 350 : 160); // (with a group open, a row crossed on the way to it does not close it at once)
  });
  // view-state: (→ on a group's row opens it, its first row focused)
  menu.addEventListener("keydown", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-sub]");
    if (e.key !== "ArrowRight" || !row) return;
    const it = current[Number(row.dataset["i"])]!;
    openSub(row, it.sub!, it.label);
    child?.menu.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    e.preventDefault();
    e.stopPropagation();
  });
  // commands: (a row runs its command)
  menu.addEventListener("click", (e) => {
    if (!armed) return;
    const subOf = (e.target as HTMLElement).closest<HTMLElement>("[data-sub]");
    if (subOf) return void openSub(subOf, current[Number(subOf.dataset["i"])]!.sub!, current[Number(subOf.dataset["i"])]!.label);
    const moreOf = (e.target as HTMLElement).closest<HTMLElement>("[data-more-i]");
    if (moreOf) {
      const it = current[Number(moreOf.dataset["moreI"])]!;
      const same = child?.from === moreOf;
      closeChild();
      if (same) return;
      const sub = document.createElement("div");
      sub.className = "pop-menu is-child";
      sub.setAttribute("role", "menu");
      sub.setAttribute("aria-label", `What to do with ${it.label}`);
      sub.innerHTML = it.more!.map(rowHtml).join("");
      // commands: (a row runs its command)
      sub.addEventListener("click", (ev) => {
        const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-i]");
        if (!b || b.disabled) return;
        const pick = it.more![Number(b.dataset["i"])]!;
        closeMoreMenu();
        pick.run();
      });
      popHost().appendChild(sub);
      placeMenu(sub, moreOf);
      moreOf.setAttribute("aria-expanded", "true");
      child = { menu: sub, from: moreOf };
      sub.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
      return;
    }
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
        if (!opts.keepFocus) (menu.querySelector<HTMLElement>(`[data-i="${index}"]:not(:disabled)`) ?? menu.querySelector<HTMLElement>("button:not(:disabled)"))?.focus({ preventScroll: true }); // (so Escape still reaches the menu)
      }
      requestAnimationFrame(() => open?.menu === menu && placeMenu(menu, anchor)); // (the selection may have moved)
      return;
    }
    closeMoreMenu();
    item.run();
  });
  if (!opts.keepFocus) menu.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
}

let installed = false;
/** The keys and the closing rules shared by every menu (ours and the sidebar's and the workspace menu's, which use `.pop-menu` styling). */
export function installMenuKeys(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("keydown", (e) => {
    const inMenu = (e.target as HTMLElement | null)?.closest?.(".pop-menu");
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
      items[to]!.focus(); // (a long menu scrolls to it)
      e.preventDefault();
      e.stopPropagation();
    } else if ((e.key === "Escape" || (e.key === "ArrowLeft" && inMenu.classList.contains("is-sub"))) && child && inMenu === child.menu) {
      closeChild(true);
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

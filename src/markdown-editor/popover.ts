// The package's one small list of choices (a table's actions, a code block's language, a highlight's colour): a group of buttons by what
// opened it, closed by a choice, Escape or a press elsewhere. The arrows move between its buttons.
export interface PopItem {
  label: string;
  detail?: string;
  /** A line before this item. */
  sep?: boolean;
  disabled?: boolean;
  /** Shown as chosen. */
  on?: boolean;
  /** Chosen: what it does (it edits the note through the editor, as typing does). */
  pick(): void;
}

let close: (() => void) | null = null;

/** Close the open list, if any. */
export const closePopover = (): void => close?.();

/** Open a list of `items` under `anchor` (a rectangle, or the element). */
export function openPopover(anchor: HTMLElement | DOMRect, items: readonly PopItem[], label: string): void {
  closePopover();
  const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  const box = document.createElement("div");
  box.className = "me-pop";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", label);
  const restore = document.activeElement as HTMLElement | null;
  for (const item of items) {
    if (item.sep) box.append(Object.assign(document.createElement("div"), { className: "me-pop-sep" }));
    const b = document.createElement("button");
    b.type = "button";
    b.className = `me-pop-item${item.on ? " is-on" : ""}`;
    b.disabled = !!item.disabled;
    b.innerHTML = `<span></span>${item.detail ? "<small></small>" : ""}`;
    b.firstElementChild!.textContent = item.label;
    if (item.detail) b.lastElementChild!.textContent = item.detail;
    // view-state: (a press keeps the focus where it was)
    b.addEventListener("mousedown", (e) => e.preventDefault());
    // typing: (each choice writes the note's Markdown through the editor)
    b.addEventListener("click", () => {
      closePopover();
      item.pick();
    });
    box.append(b);
  }
  document.body.append(box);
  const w = box.offsetWidth, h = box.offsetHeight;
  const left = Math.max(4, Math.min(r.left, innerWidth - w - 4));
  const top = r.bottom + 4 + h > innerHeight - 4 ? Math.max(4, r.top - h - 4) : r.bottom + 4;
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  const outside = (e: Event): void => {
    if (!box.contains(e.target as Node)) closePopover();
  };
  const keys = (e: KeyboardEvent): void => {
    const buttons = [...box.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePopover();
      restore?.focus?.();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      buttons[(at + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", outside, true));
  document.addEventListener("keydown", keys, true);
  close = () => {
    close = null;
    box.remove();
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", keys, true);
  };
}

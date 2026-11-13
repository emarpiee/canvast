import { ICONS } from "./icons";
import { esc } from "./format";

/**
 * Value chips (ADR 0198): one button per group of controls that says what the group is set to (a section of the Properties bar: "Look ● ⁄ 2 px";
 * a group of the Actions bar: its name and the icons of what it holds), opening the group's controls under it. One look and one popover for
 * the top bar, the chips beside the selection and the Actions bar.
 */
export function chipHtml(o: { id: string; label: string; value: string; title: string; attr?: string }): string {
  return `<button type="button" class="vchip" ${o.attr ?? "data-vchip"}="${esc(o.id)}" aria-haspopup="dialog" aria-expanded="false" title="${esc(o.title)}"><span class="vchip-k">${esc(o.label)}</span>${o.value ? `<span class="vchip-v">${o.value}</span>` : ""}<span class="vchip-arrow">${ICONS.chevronDown}</span></button>`;
}

export interface ChipSpec { id: string; label: string; value: string; title: string }

/**
 * Show these chips in `host`, changing only what changed: when the same chips are there, only their values are written again, so a chip
 * whose popover is open stays the same element (the popover keeps its place under it).
 */
export function syncChips(host: HTMLElement, chips: readonly ChipSpec[], attr = "data-vchip"): void {
  const now = [...host.querySelectorAll<HTMLElement>(`[${attr}]`)];
  if (now.length !== chips.length || now.some((c, i) => c.getAttribute(attr) !== chips[i]!.id)) {
    host.innerHTML = chips.map((c) => chipHtml({ ...c, attr })).join("");
    return;
  }
  now.forEach((el, i) => {
    const c = chips[i]!;
    let v = el.querySelector<HTMLElement>(".vchip-v");
    if (!c.value) return v?.remove();
    if (!v) {
      v = document.createElement("span");
      v.className = "vchip-v";
      el.querySelector(".vchip-k")!.after(v);
    }
    if (v.innerHTML !== c.value) v.innerHTML = c.value;
  });
}

/** The one popover a chip opens: what it holds is moved in while it is open (and given back by `onClose`). */
let open: { pop: HTMLElement; anchor: HTMLElement; onClose: () => void } | null = null;
let installed = false;
/** Other floating things a press inside of does not close the popover: what its controls open (the colour picker, menus, the adjustments). */
const CHILDREN = ".vchip-pop, .colour-pop, .pop-menu, .adjust-pop";

export const chipPopoverOpen = (): HTMLElement | null => open?.anchor ?? null;

export function closeChipPopover(): void {
  if (!open) return;
  const { pop, anchor, onClose } = open;
  open = null;
  anchor.setAttribute("aria-expanded", "false");
  onClose();
  pop.remove();
}

/** Place the popover under its chip (over it when there is no room below), inside the window. */
export function placeChipPopover(): void {
  if (!open) return;
  const { pop, anchor } = open;
  const a = anchor.getBoundingClientRect();
  const gap = 6;
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const below = a.bottom + gap + h <= innerHeight || a.top - gap - h < 0;
  pop.style.left = `${Math.round(Math.max(gap, Math.min(innerWidth - w - gap, a.left)))}px`;
  pop.style.top = `${Math.round(below ? a.bottom + gap : a.top - gap - h)}px`;
}

/** Open a chip's popover with `content` in it (a second press on the same chip closes it). */
export function openChipPopover(anchor: HTMLElement, label: string, content: (pop: HTMLElement) => void, onClose: () => void): void {
  if (open?.anchor === anchor) return closeChipPopover();
  closeChipPopover();
  if (!installed) {
    installed = true;
    document.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement;
      if (open && !t.closest(CHILDREN) && !open.anchor.contains(t)) closeChipPopover();
    });
    // (capture, as the colour picker's and the menus': one Escape closes the innermost only; they mark the key as used)
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !open || e.defaultPrevented || document.querySelector(".colour-pop, .pop-menu, .adjust-pop")) return;
      e.preventDefault();
      e.stopPropagation();
      const anchor = open.anchor;
      closeChipPopover();
      anchor.focus();
    }, true);
    window.addEventListener("resize", () => closeChipPopover());
  }
  const pop = document.createElement("div");
  pop.className = "vchip-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", label);
  document.body.append(pop);
  open = { pop, anchor, onClose };
  anchor.setAttribute("aria-expanded", "true");
  content(pop);
  placeChipPopover();
}

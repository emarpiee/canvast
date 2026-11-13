import { ICONS } from "./icons";
import { placeMenu } from "./more-menu";
import { esc } from "./format";
import { captionedGroup } from "./bar";

/**
 * Value chips (ADR 0198): the Properties bar by the selection made as the Actions bar is, one named group per section (`captionedGroup`: its
 * name under or over it, on hover, or hidden, as Settings say for both bars), whose one button is the section's icon and what it is set to
 * ("Sheet", "16 : 9", a fill's dot), opening the section's options under it.
 */
export function chipHtml(o: ChipSpec): string {
  const button = `<button type="button" class="vchip" data-vchip="${esc(o.id)}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(o.label)}" title="${esc(o.title)}"><span class="vchip-ic">${o.icon}</span>${o.value ? `<span class="vchip-v">${o.value}</span>` : ""}<span class="vchip-arrow">${ICONS.chevronDown}</span></button>`;
  return captionedGroup(esc(o.label), button);
}

export interface ChipSpec { id: string; label: string; icon: string; value: string; title: string }

/**
 * Show these chips in `host`, changing only what changed: when the same chips are there, only their values are written again, so a chip
 * whose popover is open stays the same element (the popover keeps its place under it).
 */
export function syncChips(host: HTMLElement, chips: readonly ChipSpec[]): void {
  const now = [...host.querySelectorAll<HTMLElement>("[data-vchip]")];
  if (now.length !== chips.length || now.some((c, i) => c.dataset["vchip"] !== chips[i]!.id)) {
    host.innerHTML = chips.map(chipHtml).join("");
    return;
  }
  now.forEach((el, i) => {
    const c = chips[i]!;
    let v = el.querySelector<HTMLElement>(".vchip-v");
    if (!c.value) return v?.remove();
    if (!v) {
      v = document.createElement("span");
      v.className = "vchip-v";
      el.querySelector(".vchip-ic")!.after(v);
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

/** Place the popover by its chip as every menu is placed (`placeMenu`): inside the window, and never over the selected things. */
export function placeChipPopover(): void {
  if (open) placeMenu(open.pop, open.anchor);
}

/**
 * The chips were drawn again (the selection moved them, or they moved between the top and the selection): the open popover follows its chip,
 * the new element of the same id, so it never stays behind at a corner of the window. Without that chip it closes.
 */
export function followChip(chip: HTMLElement | null): void {
  if (!open || open.anchor === chip) return;
  if (!chip) return closeChipPopover();
  open.anchor.setAttribute("aria-expanded", "false");
  open.anchor = chip;
  chip.setAttribute("aria-expanded", "true");
  placeChipPopover();
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

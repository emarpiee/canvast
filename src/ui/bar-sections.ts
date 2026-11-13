import { isOff } from "./bar";
import { esc } from "./format";

/**
 * The sections of the Properties bar (ADR 0198): every control of the bar belongs to one, named once here, so the bar can be shown as it is
 * (one row), as value chips (one chip per section, its controls in a popover), in the Properties panel (a heading per section) or beside the
 * selection, with the same controls each time (ui/properties-layout.ts). A control's section is its own `data-section`, else its group's.
 */
export interface Section {
  id: string;
  label: string;
}

/** The sections, in the order they show. */
export const SECTIONS: readonly Section[] = [
  { id: "kind", label: "Kind" },
  { id: "mask", label: "Mask" },
  { id: "look", label: "Look" },
  { id: "text", label: "Text" },
  { id: "shape", label: "Shape" },
  { id: "picture", label: "Picture" },
  { id: "size", label: "Size" },
  { id: "layout", label: "Auto layout" },
  { id: "inlayout", label: "In layout" },
  { id: "position", label: "On sheet" },
  { id: "brush", label: "Brush" },
  { id: "eraser", label: "Eraser" },
  { id: "lasso", label: "Lasso" },
  { id: "options", label: "Options" },
];
const ORDER = new Map(SECTIONS.map((s, i) => [s.id, i]));
export const sectionLabel = (id: string): string => SECTIONS.find((s) => s.id === id)?.label ?? id;

/** Give the bar's controls their sections: a selector and its section, a group's going to every control in it that has none of its own. */
export function assignSections(row: HTMLElement, map: ReadonlyArray<readonly [selector: string, section: string]>): void {
  for (const [sel, id] of map) for (const el of row.querySelectorAll<HTMLElement>(sel)) if (!el.dataset["section"]) el.dataset["section"] = id;
}

/** The controls of the bar: what each group holds (the unit that is shown, hidden or moved to a section). */
const items = (row: HTMLElement): HTMLElement[] => [...row.querySelectorAll<HTMLElement>(":scope > .tb-group")].flatMap((g) => [...g.children] as HTMLElement[]);
const sectionOf = (item: HTMLElement): string => item.dataset["section"] ?? item.parentElement?.dataset["section"] ?? "options";

/** Whether a control shows now, judged inside the bar only (wherever the bar itself is placed). */
function shows(el: HTMLElement, row: HTMLElement): boolean {
  for (let e: HTMLElement | null = el; e && e !== row; e = e.parentElement) if (isOff(e)) return false;
  return true;
}

/** The sections that have a control showing, in their order. */
export function shownSections(row: HTMLElement): string[] {
  const ids = new Set<string>();
  for (const it of items(row)) if (shows(it, row)) ids.add(sectionOf(it));
  return [...ids].sort((a, b) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99));
}

/** Show only the controls of these sections (null: all of them). A group left with none is left out too. */
export function showSections(row: HTMLElement, ids: ReadonlySet<string> | null): void {
  for (const g of row.querySelectorAll<HTMLElement>(":scope > .tb-group")) {
    let any = false;
    for (const it of g.children as HTMLCollectionOf<HTMLElement>) {
      const off = ids !== null && !ids.has(sectionOf(it));
      if (it.hasAttribute("data-sec-off") !== off) it.toggleAttribute("data-sec-off", off);
      any ||= !off;
    }
    if (g.hasAttribute("data-sec-off") === any) g.toggleAttribute("data-sec-off", !any);
  }
}

/** Order the controls by section (the Properties panel stacks them: `order` in a column), or back to the bar's own order. */
export function orderBySection(row: HTMLElement, on: boolean): void {
  for (const g of row.querySelectorAll<HTMLElement>(":scope > .tb-group")) {
    g.style.order = "";
    for (const it of g.children as HTMLCollectionOf<HTMLElement>) it.style.order = on ? String(2 * (ORDER.get(sectionOf(it)) ?? 99) + 1) : "";
  }
}

const unitOf = (label: string): string => (/\(px/.test(label) ? " px" : /%|per ?cent/i.test(label) ? "%" : "");
const nameOf = (el: Element): string => (el.getAttribute("aria-label") ?? "").split(/:\s/)[0]!.trim();

/**
 * What a section is set to now, read from its controls (so every kind and tool is covered without a word of its own): the colours as
 * swatches, then the first values (a number with its unit, a choice, the option on). HTML, short.
 */
export function sectionSummary(row: HTMLElement, id: string): string {
  const swatches: string[] = [];
  const words: string[] = [];
  for (const it of items(row)) {
    if (sectionOf(it) !== id || !shows(it, row)) continue;
    const els = [it, ...it.querySelectorAll<HTMLElement>("*")].filter((e) => shows(e, row));
    for (const el of els) {
      if (el.classList.contains("swatch") && el.querySelector("[data-paint-chip], [data-colour-chip]")) {
        const chip = el.querySelector<HTMLElement>("[data-paint-chip], [data-colour-chip]")!;
        const bg = chip.style.getPropertyValue("--paint") || chip.style.background;
        swatches.push(el.classList.contains("is-none") || !bg ? `<span class="vchip-sw is-none" title="${esc(nameOf(el))}: none"></span>` : `<span class="vchip-sw" style="background:${esc(bg)}" title="${esc(nameOf(el))}"></span>`);
      } else if (el instanceof HTMLInputElement && (el.type === "number" || el.type === "text") && (el.value || el.placeholder)) {
        words.push(el.value ? `${el.value}${unitOf(el.getAttribute("aria-label") ?? "")}` : el.placeholder);
      } else if (el instanceof HTMLInputElement && el.type === "range") {
        const out = el.nextElementSibling;
        if (out?.classList.contains("size-out") && out.textContent) words.push(out.textContent);
      } else if (el instanceof HTMLSelectElement && el.value) {
        words.push(el.selectedOptions[0]?.textContent?.trim() ?? "");
      } else if (el.getAttribute("role") === "radio" && el.getAttribute("aria-checked") === "true") {
        words.push(el.textContent?.trim() || nameOf(el));
      }
    }
  }
  const text = words.filter(Boolean).slice(0, 3).map((w) => esc(w.length > 18 ? `${w.slice(0, 17)}…` : w)).join(" · ");
  return swatches.slice(0, 3).join("") + (text ? `<span class="vchip-t">${text}</span>` : "");
}

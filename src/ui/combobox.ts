import { placeMenu } from "./more-menu";

/**
 * Every dropdown of the app is this one list (ADR 0198), installed once for the whole page: a `<select>` stays the field (its value, its
 * events, its look in a bar), but a press on it or an arrow key opens this list instead of the browser's own.
 *
 * - The arrow keys move through the choices; one rested on for a moment is applied (the font, the order...) and the list stays open, so the
 *   next can be tried at once. Enter or a click applies it and closes the list; Escape closes it; typing jumps to a choice by its first letters.
 * - It is placed as every menu (`placeMenu`): by its field, inside the window and off the selected things; it is as tall as its room allows,
 *   at most a set number of rows, and scrolls.
 * - A field with `data-native` keeps the browser's own list (none does today).
 */
const DWELL_MS = 900;

let open: { select: HTMLSelectElement; pop: HTMLElement; items: HTMLElement[]; at: number; timer: number; typed: string; typedAt: number } | null = null;

const usable = (s: EventTarget | null): s is HTMLSelectElement =>
  s instanceof HTMLSelectElement && !s.multiple && s.size <= 1 && !s.disabled && !s.hasAttribute("data-native");

/** Choose option `i` of the open list: the field takes it, with the events a choice by hand sends. */
function apply(i: number): void {
  if (!open) return;
  const item = open.items[i];
  if (!item) return;
  const s = open.select;
  const index = Number(item.dataset["index"]);
  if (s.selectedIndex === index) return;
  s.selectedIndex = index;
  s.dispatchEvent(new Event("input", { bubbles: true }));
  s.dispatchEvent(new Event("change", { bubbles: true }));
  for (const it of open?.items ?? []) it.setAttribute("aria-selected", String(it === item));
}

function highlight(i: number, dwell: boolean): void {
  if (!open) return;
  const n = open.items.length;
  if (!n) return;
  open.at = Math.max(0, Math.min(n - 1, i));
  open.items.forEach((it, k) => it.classList.toggle("is-active", k === open!.at));
  open.items[open.at]!.scrollIntoView({ block: "nearest" });
  clearTimeout(open.timer);
  // (a choice the keys rest on is taken after a moment, the list staying open: a font tried without closing anything)
  if (dwell) open.timer = window.setTimeout(() => apply(open?.at ?? -1), DWELL_MS);
}

export function closeCombobox(): void {
  if (!open) return;
  clearTimeout(open.timer);
  open.pop.remove();
  open.select.setAttribute("aria-expanded", "false");
  open = null;
}

function openFor(select: HTMLSelectElement): void {
  closeCombobox();
  const pop = document.createElement("div");
  pop.className = "pop-menu combo-pop"; // (the look of every menu, and what treats a press in a menu as inside it treats this one so too)
  pop.setAttribute("role", "listbox");
  pop.setAttribute("aria-label", select.getAttribute("aria-label") ?? select.title ?? "Choices");
  const items: HTMLElement[] = [];
  const row = (o: HTMLOptionElement, index: number): HTMLElement => {
    const it = document.createElement("div");
    it.setAttribute("role", "option");
    it.className = "combo-item";
    it.dataset["index"] = String(index);
    it.textContent = o.textContent;
    it.setAttribute("aria-selected", String(index === select.selectedIndex));
    if (o.disabled) it.setAttribute("aria-disabled", "true");
    else items.push(it);
    return it;
  };
  let index = 0;
  for (const child of select.children) {
    if (child instanceof HTMLOptGroupElement) {
      if (!child.children.length) continue;
      const head = document.createElement("div");
      head.className = "combo-group";
      head.textContent = child.label;
      pop.append(head);
      for (const o of child.querySelectorAll("option")) pop.append(row(o, index++));
    } else if (child instanceof HTMLOptionElement) pop.append(row(child, index++));
  }
  pop.style.minWidth = `${select.getBoundingClientRect().width}px`;
  // (inside a modal dialog the list belongs to it: what is outside a modal cannot be used)
  (select.closest("dialog") ?? document.body).append(pop);
  open = { select, pop, items, at: 0, timer: 0, typed: "", typedAt: 0 };
  select.setAttribute("aria-expanded", "true");
  placeMenu(pop, select);
  highlight(Math.max(0, items.findIndex((it) => Number(it.dataset["index"]) === select.selectedIndex)), false);
  pop.addEventListener("pointerdown", (e) => e.preventDefault()); // (the field keeps the focus, and with it the keys)
  pop.addEventListener("pointermove", (e) => {
    const it = (e.target as HTMLElement).closest<HTMLElement>(".combo-item");
    const i = it ? items.indexOf(it) : -1;
    if (i >= 0 && i !== open?.at) highlight(i, false);
  });
  pop.addEventListener("click", (e) => {
    const it = (e.target as HTMLElement).closest<HTMLElement>(".combo-item");
    const i = it ? items.indexOf(it) : -1;
    if (i < 0) return;
    apply(i);
    closeCombobox();
  });
}

let installed = false;
/** Make every dropdown of the page this list (once, at start: it works by events, for dropdowns made later too). */
export function installCombobox(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as HTMLElement;
    if (open && !open.pop.contains(t) && t !== open.select) closeCombobox();
    if (e.button !== 0 || !usable(t)) return;
    e.preventDefault(); // (no list of the browser's own)
    t.focus({ preventScroll: true });
    if (open?.select === t) closeCombobox();
    else openFor(t);
  }, true);
  // (a press may still open the browser's list on a platform that does so on mousedown only)
  document.addEventListener("mousedown", (e) => {
    if (e.button === 0 && usable(e.target)) e.preventDefault();
  }, true);
  document.addEventListener("keydown", (e) => {
    const s = e.target;
    if (!usable(s)) return;
    const k = e.key;
    if (!open || open.select !== s) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === " " || k === "Enter" || k === "F4") {
        e.preventDefault();
        e.stopPropagation();
        openFor(s);
      }
      return;
    }
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };
    if (k in step) highlight(open.at + step[k]!, true);
    else if (k === "Home") highlight(0, true);
    else if (k === "End") highlight(open.items.length - 1, true);
    else if (k === "Enter" || k === " ") {
      apply(open.at);
      closeCombobox();
    } else if (k === "Escape") closeCombobox();
    else if (k === "Tab") {
      closeCombobox();
      return; // (Tab moves on as usual)
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // typed letters: the first choice that starts with them
      const now = performance.now();
      open.typed = (now - open.typedAt < 700 ? open.typed : "") + k.toLowerCase();
      open.typedAt = now;
      const i = open.items.findIndex((it) => (it.textContent ?? "").toLowerCase().startsWith(open!.typed));
      if (i >= 0) highlight(i, true);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  window.addEventListener("resize", () => closeCombobox());
  document.addEventListener("scroll", (e) => {
    if (open && !open.pop.contains(e.target as Node)) closeCombobox();
  }, true);
}

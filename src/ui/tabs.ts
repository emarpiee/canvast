import { esc } from "./format";

/** One tab of a tab strip (role, selection, the keyboard's roving focus). `inner` is what it shows; the strip is a `.styles-tabs` with role tablist. */
export const tabHtml = (id: string, name: string, selected: boolean, inner: string): string =>
  `<button type="button" role="tab" class="styles-tab" data-tab="${esc(id)}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}" aria-label="${esc(name)}" title="${esc(name)}">${inner}</button>`;

/** The tab an arrow key, Home or End on a tab goes to; null when the key is not one of them or the press is not on a tab. */
export function tabFromKey(e: KeyboardEvent, ids: readonly string[]): string | null {
  const on = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
  if (!on || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return null;
  const at = ids.indexOf(on.dataset["tab"]!);
  return ids[e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length]!;
}

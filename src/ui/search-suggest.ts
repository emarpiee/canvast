import { applySuggestion, suggest } from "../search/suggest";
import type { SuggestSources, Suggested } from "../search/suggest";
import { esc } from "./format";

/**
 * The suggestion chips under a search box (ADR 0083), the same in the canvas search and the library search: what could complete the word
 * under the cursor. Pressing a chip, or Tab for the first one, puts it into the text. `sources` says what exists (tags, file types).
 */
export function mountSuggest(box: HTMLElement, input: HTMLInputElement, sources: () => SuggestSources): { refresh(): void } {
  let current: Suggested = { start: 0, end: 0, items: [] };
  const refresh = (): void => {
    current = suggest(input.value, input.selectionStart ?? input.value.length, sources());
    box.hidden = !current.items.length;
    box.innerHTML = current.items
      .map((it, i) => `<button type="button" class="sg sg-${it.kind}" data-sg="${i}" title="${it.kind === "type" ? "A file type" : it.kind === "tag" ? "A tag" : "An operator"}${i === 0 ? " (Tab)" : ""}">${esc(it.label)}${it.kind === "operator" && it.note === "operator" ? "" : `<span class="sg-n">${esc(it.note)}</span>`}</button>`)
      .join("");
  };
  const accept = (i: number): void => {
    const item = current.items[i];
    if (!item) return;
    const r = applySuggestion(input.value, current, item);
    input.value = r.value;
    input.setSelectionRange(r.caret, r.caret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    refresh();
  };
  // The press must not take the focus from the box, or the pop that holds the chips would close.
  box.addEventListener("pointerdown", (e) => e.preventDefault());
  box.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-sg]");
    if (b) accept(Number(b.dataset["sg"]));
  });
  input.addEventListener("input", refresh);
  input.addEventListener("click", refresh);
  input.addEventListener("focus", refresh);
  input.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") refresh();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && current.items.length) {
      e.preventDefault();
      accept(0);
    }
  });
  refresh();
  return { refresh };
}

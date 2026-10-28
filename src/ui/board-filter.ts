import { esc } from "./format";

/**
 * A list of boards and their canvases that may be long (the board and canvas switcher, Place on…), made short: a search field over it
 * keeps only the boards and canvases whose names hold what is typed, and with more than FOLD_FROM boards each one is folded to its name
 * but the one holding the open canvas (a click on a folded board's name unfolds it). One behaviour for every such list.
 */
const FOLD_FROM = 4;

export interface BoardList {
  /** Each board's section in the list. */
  board: string;
  /** Its name row, inside the section (a click on it folds or unfolds the board). */
  head: string;
  /** Its canvas rows, inside the section. */
  row: string;
  /** Whether a section holds the open canvas (it stays unfolded). */
  current(section: HTMLElement): boolean;
}

/** What is typed in a list's search field and which boards were unfolded, kept while the list is drawn again. */
export interface BoardFilterState {
  query: string;
  open: Set<number>;
}
export const boardFilterState = (): BoardFilterState => ({ query: "", open: new Set() });

/** The search field, put at the top of the list. */
export const boardFilterHtml = (state: BoardFilterState, testid: string): string =>
  `<div class="board-filter"><input type="search" class="board-filter-input" data-testid="${testid}" placeholder="Find a board or canvas" aria-label="Find a board or canvas" value="${esc(state.query)}" autocomplete="off" spellcheck="false"></div>`;

/** Fold, filter and wire a list drawn with `boardFilterHtml` at its top (call it after each drawing). */
export function wireBoardFilter(menu: HTMLElement, list: BoardList, state: BoardFilterState): void {
  const sections = [...menu.querySelectorAll<HTMLElement>(list.board)];
  const fold = sections.length > FOLD_FROM;
  const input = menu.querySelector<HTMLInputElement>(".board-filter-input");
  const apply = (): void => {
    const q = state.query.trim().toLowerCase();
    sections.forEach((s, i) => {
      const name = (s.querySelector(list.head)?.textContent ?? "").toLowerCase();
      const rows = [...s.querySelectorAll<HTMLElement>(list.row)];
      if (q) {
        const boardHit = name.includes(q);
        let any = boardHit;
        for (const r of rows) {
          const hit = boardHit || (r.textContent ?? "").toLowerCase().includes(q);
          r.hidden = !hit;
          any ||= hit;
        }
        s.hidden = !any;
        s.classList.remove("is-folded");
      } else {
        for (const r of rows) r.hidden = false;
        s.hidden = false;
        s.classList.toggle("is-folded", fold && !list.current(s) && !state.open.has(i));
      }
    });
  };
  input?.addEventListener("input", () => {
    state.query = input.value;
    apply();
  });
  sections.forEach((s, i) => {
    const head = s.querySelector<HTMLElement>(list.head);
    head?.addEventListener("click", (e) => {
      if (!s.classList.contains("is-folded") && !state.open.has(i)) return;
      if ((e.target as HTMLElement).closest("button, input")) return;
      if (state.open.has(i)) state.open.delete(i);
      else state.open.add(i);
      apply();
    });
  });
  apply();
}

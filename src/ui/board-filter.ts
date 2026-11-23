import type { WorkspaceTree } from "../app/session";
import { esc } from "./format";
import { ICONS } from "./icons";

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
  // view-state: (the filter of the board list)
  input?.addEventListener("input", () => {
    state.query = input.value;
    apply();
  });
  sections.forEach((s, i) => {
    const head = s.querySelector<HTMLElement>(list.head);
    // view-state: (the filter of the board list)
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

/**
 * A list to pick a canvas from, by board (Place on…, a Pins window's choice): the board and canvas switcher's own rows and look, its
 * canvases as rows `data-<attr>="canvas"` with their id, the current one marked; with `newRows`, + New canvas and + New board with a
 * canvas as well. Put the search field (`boardFilterHtml`) over it and wire it with `wireBoardFilter`, as every such list.
 */
export function canvasPickHtml(tree: WorkspaceTree, current: string | null, o: { attr: string; newRows?: boolean }): string {
  const a = o.attr;
  return (
    tree.boards
      .map(
        ({ board, canvases }) => `<section class="nav-board" aria-label="Board ${esc(board.name)}">
            <div class="nav-board-head"><span class="nav-board-icon">${ICONS.squareStack}</span><span class="nav-board-name">${esc(board.name)}</span><span class="nav-board-n">${canvases.length} ${canvases.length === 1 ? "canvas" : "canvases"}</span></div>
            <ul class="nav-canvases">${canvases
              .map((c) => {
                const active = current === c.id;
                return `<li class="nav-canvas-row${active ? " is-current" : ""}"><button type="button" role="menuitem" class="nav-canvas${active ? " is-active" : ""}" data-${a}="canvas" data-id="${c.id}"><span class="nav-name">${esc(c.name)}</span><span class="nav-count">${c.objectCount === 0 ? "empty" : `${c.objectCount} object${c.objectCount === 1 ? "" : "s"}`}</span></button></li>`;
              })
              .join("")}</ul>
            ${o.newRows ? `<button type="button" role="menuitem" class="nav-add" data-${a}="new-canvas" data-id="${board.id}" aria-label="New canvas in ${esc(board.name)}">+ New canvas</button>` : ""}
          </section>`,
      )
      .join("") + (o.newRows ? `<button type="button" role="menuitem" class="nav-add nav-add-board" data-${a}="new-board">+ New board with a canvas</button>` : "")
  );
}

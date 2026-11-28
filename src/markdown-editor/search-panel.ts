// The editor's find bar (Ctrl+F; Ctrl+H or the arrow opens replace): one compact row, the words looked for with how many there are and
// which is shown ("3 of 12"), previous and next, and toggles for case, a regular expression and whole words; under it, when opened, the
// replacement with Replace and Replace all. Enter finds the next, Shift+Enter the previous, Escape closes; the editor's look and words.
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, setSearchQuery } from "@codemirror/search";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";

export interface FindWords {
  find: string;
  replace: string;
  next: string;
  previous: string;
  matchCase: string;
  regexp: string;
  wholeWord: string;
  showReplace: string;
  replaceOne: string;
  replaceAll: string;
  close: string;
  /** "{n} of {m}"; with none found, `none`. */
  count: string;
  none: string;
}

const ICON = (d: string): string => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  up: ICON('<path d="m18 15-6-6-6 6"/>'),
  down: ICON('<path d="m6 9 6 6 6-6"/>'),
  close: ICON('<path d="M18 6 6 18M6 6l12 12"/>'),
  more: ICON('<path d="m9 18 6-6-6-6"/>'),
  replace: ICON('<path d="M14 4h6v6M20 4l-7 7M4 14v6h6"/><path d="M4 20l7-7"/>'),
  replaceAll: ICON('<path d="M3 7h13l-3-3M3 7l3 3M21 17H8l3 3M21 17l-3-3"/>'),
};

/** The find bar, for `search({ createPanel })`. */
export const findBar = (w: FindWords) => (view: EditorView): Panel => {
  const dom = document.createElement("div");
  dom.className = "me-find";
  dom.setAttribute("role", "search");
  const field = (cls: string, label: string): HTMLInputElement => {
    const i = document.createElement("input");
    i.className = `me-find-field ${cls}`;
    i.placeholder = label;
    i.setAttribute("aria-label", label);
    i.setAttribute("main-field", "true");
    i.spellcheck = false;
    return i;
  };
  const button = (cls: string, label: string, inner: string, run: () => void, toggle = false): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `me-btn ${cls}`;
    b.title = label;
    b.setAttribute("aria-label", label);
    if (toggle) b.setAttribute("aria-pressed", "false");
    b.innerHTML = inner;
    // view-state: (the find bar's own controls: what is looked for and how; Replace writes the note through the editor's commands)
    b.addEventListener("click", () => (run(), toggle ? undefined : search.focus()));
    return b;
  };
  const search = field("is-find", w.find);
  const replace = field("is-replace", w.replace);
  replace.removeAttribute("main-field");
  const count = document.createElement("output");
  count.className = "me-find-count";
  const q0 = getSearchQuery(view.state);
  search.value = q0.search;
  replace.value = q0.replace;
  let caseOn = q0.caseSensitive, reOn = q0.regexp, wordOn = q0.wholeWord;
  const commit = (): void => {
    const q = new SearchQuery({ search: search.value, replace: replace.value, caseSensitive: caseOn, regexp: reOn, wholeWord: wordOn });
    if (!q.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(q) });
  };
  const toggle = (b: HTMLButtonElement, on: boolean): void => b.setAttribute("aria-pressed", String(on));
  const caseB = button("me-find-case", w.matchCase, "<span>Aa</span>", () => ((caseOn = !caseOn), toggle(caseB, caseOn), commit()), true);
  const reB = button("me-find-re", w.regexp, "<span>.*</span>", () => ((reOn = !reOn), toggle(reB, reOn), commit()), true);
  const wordB = button("me-find-word", w.wholeWord, "<span><u>ab</u></span>", () => ((wordOn = !wordOn), toggle(wordB, wordOn), commit()), true);
  toggle(caseB, caseOn);
  toggle(reB, reOn);
  toggle(wordB, wordOn);
  const more = button("me-find-more", w.showReplace, ICONS.more, () => {
    row2.hidden = !row2.hidden;
    more.setAttribute("aria-expanded", String(!row2.hidden));
    (row2.hidden ? search : replace).focus();
  });
  more.setAttribute("aria-expanded", "false");
  const row1 = document.createElement("div");
  row1.className = "me-find-row";
  const box = document.createElement("div");
  box.className = "me-find-box";
  box.append(search, count, caseB, wordB, reB);
  row1.append(more, box, button("me-find-prev", w.previous, ICONS.up, () => findPrevious(view)), button("me-find-next", w.next, ICONS.down, () => findNext(view)), button("me-find-close", w.close, ICONS.close, () => closeSearchPanel(view)));
  const row2 = document.createElement("div");
  row2.className = "me-find-row is-replace";
  row2.hidden = true;
  const rbox = document.createElement("div");
  rbox.className = "me-find-box";
  rbox.append(replace);
  row2.append(rbox, button("me-find-replace", w.replaceOne, ICONS.replace, () => replaceNext(view)), button("me-find-replace-all", w.replaceAll, ICONS.replaceAll, () => replaceAll(view)));
  dom.append(row1, row2);
  for (const i of [search, replace]) {
    // typing: (what is looked for, as it is typed)
    i.addEventListener("input", commit);
    // typing: (Enter and Shift+Enter go through the matches, Escape closes)
    i.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (i === replace) replaceNext(view);
        else (e.shiftKey ? findPrevious : findNext)(view);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeSearchPanel(view);
        view.focus();
      }
    });
  }
  /** How many there are and which one is selected. */
  const recount = (): void => {
    const q = getSearchQuery(view.state);
    if (!q.search || !q.valid) return void (count.textContent = "");
    let n = 0, at = 0;
    const sel = view.state.selection.main;
    const cur = q.getCursor(view.state);
    for (let r = cur.next(); !r.done && n < 9999; r = cur.next()) {
      n++;
      if (r.value.from === sel.from && r.value.to === sel.to) at = n;
    }
    count.textContent = n ? w.count.replace("{n}", String(at || "–")).replace("{m}", String(n)) : w.none;
    dom.classList.toggle("is-none", !n);
  };
  recount();
  return {
    dom,
    top: true,
    mount: () => (search.focus(), search.select()),
    update(u: ViewUpdate) {
      for (const tr of u.transactions)
        for (const e of tr.effects)
          if (e.is(setSearchQuery) && !e.value.eq(new SearchQuery({ search: search.value, replace: replace.value, caseSensitive: caseOn, regexp: reOn, wholeWord: wordOn }))) {
            search.value = e.value.search;
            replace.value = e.value.replace;
            caseOn = e.value.caseSensitive;
            reOn = e.value.regexp;
            wordOn = e.value.wholeWord;
            toggle(caseB, caseOn);
            toggle(reB, reOn);
            toggle(wordB, wordOn);
          }
      if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))) recount();
    },
  };
};

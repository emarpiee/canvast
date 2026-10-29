import { loadRecent, saveRecent } from "../search/history";
import type { RecentSearch, SearchWay } from "../search/history";
import { byUse, forget, keep, matching, MAX_SAVED, parseSaved, sameSearch, touch } from "../search/saved";
import type { SavedSearch } from "../search/saved";
import { esc } from "./format";
import { ICONS } from "./icons";

/**
 * The "Saved" and "Recent" chips of a search box (ADR 0071), the same in the canvas search and the library search. With nothing typed, the
 * saved searches used last (up to SHOW_SAVED, with how many more there are) and the recent ones; while typing, the saved searches that hold
 * the typed words, so a long list is found by typing rather than scrolled. Each list is its box's own (the library's, the canvas's).
 */
const PREFIX: Record<SearchWay, string> = { all: "", name: "/ ", tag: "# ", bookmark: "@ " };
const SHOW_SAVED = 8;

/** Where a box's saved searches are kept (a setting, as JSON). */
export interface SavedStore {
  get(): string;
  set(value: string): void;
}

const savedOf = (store: SavedStore | undefined): SavedSearch[] => (store ? (parseSaved(store.get()) ?? []) : []);

const chip = (r: { q: string; m: SearchWay }, kind: "recent" | "saved"): string =>
  `<span class="cs-chip${kind === "saved" ? " is-saved" : ""}"><button type="button" data-${kind} data-q="${esc(r.q)}" data-m="${r.m}" title="Search again">${esc(PREFIX[r.m] + r.q)}</button><button type="button" data-forget="${kind}" data-q="${esc(r.q)}" data-m="${r.m}" aria-label="Remove ${esc(r.q)} from ${kind} searches" title="Remove">×</button></span>`;

/** Draw the chips into `box` for what is `typed` (hidden when there are none). */
export function paintRecent(box: HTMLElement, key: string, typed: string, saved?: SavedStore): void {
  const list = savedOf(saved);
  const t = typed.trim();
  const shown = t ? matching(list, t, SHOW_SAVED) : byUse(list).slice(0, SHOW_SAVED);
  const more = t ? 0 : list.length - shown.length;
  const recent = t ? [] : loadRecent(key).filter((r) => !list.some((s) => sameSearch(s, r.q, r.m)));
  const rows: string[] = [];
  if (shown.length)
    rows.push(
      `<div class="cs-recent-row" data-testid="search-saved"><span class="cs-recent-title">Saved</span>${shown.map((s) => chip(s, "saved")).join("")}${more > 0 ? `<span class="cs-recent-more">${more} more: type to find them</span>` : ""}</div>`,
    );
  if (recent.length) rows.push(`<div class="cs-recent-row"><span class="cs-recent-title">Recent</span>${recent.map((r) => chip(r, "recent")).join("")}<button type="button" class="cs-clear-all" data-forget-all>Clear recent</button></div>`);
  box.hidden = !rows.length;
  box.innerHTML = rows.join("");
}

/** One click does it: search again (`pick`), remove one, or clear the recent ones. `repaint` redraws the chips afterwards. */
export function wireRecent(box: HTMLElement, key: string, pick: (r: RecentSearch) => void, repaint: () => void, saved?: SavedStore): void {
  box.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!t) return;
    const q = t.dataset["q"] ?? "";
    const m = (t.dataset["m"] ?? "all") as SearchWay;
    if (t.hasAttribute("data-recent")) pick({ q, m });
    else if (t.hasAttribute("data-saved")) {
      saved?.set(JSON.stringify(touch(savedOf(saved), q, m, Date.now())));
      pick({ q, m });
    } else if (t.dataset["forget"] === "saved") {
      saved?.set(JSON.stringify(forget(savedOf(saved), q, m)));
      repaint();
    } else if (t.dataset["forget"] === "recent") {
      saveRecent(key, loadRecent(key).filter((r) => !(r.q === q && r.m === m)));
      repaint();
    } else if (t.hasAttribute("data-forget-all")) {
      saveRecent(key, []);
      repaint();
    }
  });
}

/** The button in the box that saves the search typed (pressed while it is saved; pressing it again removes it). */
export const saveToggleHtml = (): string => `<button type="button" class="cs-save" aria-pressed="false" aria-label="Save this search" title="Save this search" hidden>${ICONS.save}</button>`;

export function paintSaveToggle(btn: HTMLButtonElement, typed: string, way: SearchWay, saved: SavedStore): void {
  const list = savedOf(saved);
  const on = list.some((s) => sameSearch(s, typed, way));
  btn.hidden = !typed.trim();
  btn.setAttribute("aria-pressed", String(on));
  const full = !on && list.length >= MAX_SAVED;
  btn.disabled = full;
  btn.title = on ? "Saved: press to remove it from the saved searches" : full ? `${MAX_SAVED} searches are saved: remove one to save another` : "Save this search";
}

/** Press: save the search typed, or remove it when it is saved. `changed` repaints. */
export function wireSaveToggle(btn: HTMLButtonElement, input: HTMLInputElement, way: () => SearchWay, saved: SavedStore, changed: () => void): void {
  btn.addEventListener("click", () => {
    const list = savedOf(saved);
    const on = list.some((s) => sameSearch(s, input.value, way()));
    const next = on ? forget(list, input.value.trim(), way()) : keep(list, input.value, way(), Date.now());
    if (next) saved.set(JSON.stringify(next));
    changed();
    input.focus();
  });
}

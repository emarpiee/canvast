/**
 * The parts every search panel is made of (the canvas search, the library's search): the row of ways to search, a line saying what to
 * type, and the keys at the bottom. One look for both; each panel lists only the ways that apply to it.
 */
export type SearchWay = "all" | "name" | "tag" | "bookmark";

const WAY_HTML: Record<SearchWay, string> = { all: "All", name: "<kbd>/</kbd>Name", tag: "<kbd>#</kbd>Tag", bookmark: "<kbd>@</kbd>Bookmark" };

/** The ways to search, as tabs ("All" selected at first). */
export const searchWaysHtml = (ways: readonly SearchWay[]): string =>
  `<div class="cs-modes" role="tablist" aria-label="Search by">${ways.map((w) => `<button type="button" role="tab" data-m="${w}" aria-selected="${w === "all"}">${WAY_HTML[w]}</button>`).join("")}</div>`;

/** The line that says what to type (shown while nothing is typed). */
export const searchHelpLineHtml = (text: string): string => `<p class="cs-empty" data-search-help>${text}</p>`;

/** The keys at the bottom of the panel. */
export const searchKeysHtml = (keys: ReadonlyArray<readonly [key: string, does: string]>): string =>
  `<p class="cs-hint">${keys.map(([k, d]) => `<kbd>${k}</kbd> ${d}`).join(" · ")}</p>`;

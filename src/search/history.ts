/**
 * Recent successful searches (ADR 0071), kept on this device in `localStorage` (a convenience: blocked storage just means an empty list).
 * The canvas search and the library search each keep their own list, the same way.
 */
export type SearchWay = "all" | "name" | "tag" | "bookmark";
export interface RecentSearch {
  q: string;
  m: SearchWay;
}
export const CANVAS_RECENT = "canvast.search.recent";
export const ASSETS_RECENT = "canvast.search.recent.assets";
const MAX_RECENT = 12;
const WAYS: readonly string[] = ["all", "name", "tag", "bookmark"];

export const loadRecent = (key: string): RecentSearch[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as RecentSearch[]).filter((r) => r && typeof r.q === "string" && WAYS.includes(r.m)).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
};

export const saveRecent = (key: string, list: readonly RecentSearch[]): void => {
  try {
    if (list.length) localStorage.setItem(key, JSON.stringify(list));
    else localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
};

/** Put a search first (once). The caller decides when a search counts as successful: it found something and was used. */
export const rememberSearch = (key: string, q: string, m: SearchWay): void => {
  const text = q.trim();
  if (!text) return;
  saveRecent(key, [{ q: text, m }, ...loadRecent(key).filter((r) => !(r.q === text && r.m === m))].slice(0, MAX_RECENT));
};

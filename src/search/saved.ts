/**
 * Saved searches: searches kept on purpose, beside the recent ones (search/history.ts). The library and the canvas each keep their own list,
 * as a device setting (so they travel in a workspace backup and the library index like the other settings). A saved search is its text and
 * its way (all, name, tag, bookmark); its name is that text. The list is ordered by when each was last used, newest first, so the few shown
 * when the box is empty are the ones in use; the rest are found by typing (they are suggested as the box is filled).
 */
import type { SearchWay } from "./history";

/** A saved search's look: it comes back with the search, so a search can be a view of the library (the library's list only). */
export interface SavedLook {
  layout: "grid" | "list";
  order: string[];
  hidden: string[];
  sort: string;
  reversed: boolean;
}

export interface SavedSearch {
  q: string;
  m: SearchWay;
  /** When it was last saved or used (ms). */
  u: number;
  look?: SavedLook;
}

/** Most kept in one list; saving more asks to remove one first. */
export const MAX_SAVED = 200;
export const MAX_SAVED_LENGTH = 500;
const WAYS: readonly string[] = ["all", "name", "tag", "bookmark"];
/** Room for one look in the stored text. */
const MAX_LOOK_LENGTH = 4000;
const isWords = (v: unknown): boolean => Array.isArray(v) && v.every((w) => typeof w === "string");
const isLook = (l: SavedLook): boolean => !!l && (l.layout === "grid" || l.layout === "list") && isWords(l.order) && isWords(l.hidden) && typeof l.sort === "string" && typeof l.reversed === "boolean";

/** The stored text if it is a valid list, otherwise undefined (the settings validator). */
export const validSaved = (v: unknown): string | undefined => {
  if (typeof v !== "string" || v.length > MAX_SAVED * (MAX_SAVED_LENGTH + 64 + MAX_LOOK_LENGTH)) return undefined;
  return parseSaved(v) ? v : undefined;
};

export function parseSaved(text: string): SavedSearch[] | null {
  try {
    const raw = JSON.parse(text || "[]") as unknown;
    if (!Array.isArray(raw) || raw.length > MAX_SAVED) return null;
    const ok = raw.every((r: SavedSearch) => r && typeof r.q === "string" && r.q.trim() !== "" && r.q.length <= MAX_SAVED_LENGTH && WAYS.includes(r.m) && Number.isFinite(r.u) && (r.look === undefined || isLook(r.look)));
    return ok ? (raw as SavedSearch[]) : null;
  } catch {
    return null;
  }
}

export const sameSearch = (a: { q: string; m: SearchWay }, q: string, m: SearchWay): boolean => a.q === q.trim() && a.m === m;

/** Newest use first. */
export const byUse = (list: readonly SavedSearch[]): SavedSearch[] => [...list].sort((a, b) => b.u - a.u);

/** Save a search (or mark it used, if it is saved): null when the list is full. */
export function keep(list: readonly SavedSearch[], q: string, m: SearchWay, now: number): SavedSearch[] | null {
  const text = q.trim();
  if (!text) return [...list];
  const rest = list.filter((s) => !sameSearch(s, text, m));
  if (rest.length === list.length && list.length >= MAX_SAVED) return null;
  const look = list.find((s) => sameSearch(s, text, m))?.look;
  return [{ q: text.slice(0, MAX_SAVED_LENGTH), m, u: now, ...(look ? { look } : {}) }, ...rest];
}

export const forget = (list: readonly SavedSearch[], q: string, m: SearchWay): SavedSearch[] => list.filter((s) => !sameSearch(s, q, m));

/** The list with one saved search's look replaced. */
export const withLook = (list: readonly SavedSearch[], q: string, m: SearchWay, look: SavedLook): SavedSearch[] => list.map((s) => (sameSearch(s, q, m) ? { ...s, look } : s));

/** Mark a saved search used (it moves to the front); the list is unchanged when it is not saved. */
export const touch = (list: readonly SavedSearch[], q: string, m: SearchWay, now: number): SavedSearch[] => (list.some((s) => sameSearch(s, q, m)) ? keep(list, q, m, now)! : [...list]);

/** The saved searches whose text holds every typed word (any order), the ones that start with the first word first; not the one typed in full. */
export function matching(list: readonly SavedSearch[], typed: string, limit: number): SavedSearch[] {
  const t = typed.trim().toLowerCase();
  if (!t) return [];
  const words = t.split(/\s+/);
  return byUse(list)
    .filter((s) => s.q.toLowerCase() !== t && words.every((w) => s.q.toLowerCase().includes(w)))
    .sort((a, b) => Number(!a.q.toLowerCase().startsWith(words[0]!)) - Number(!b.q.toLowerCase().startsWith(words[0]!)))
    .slice(0, limit);
}

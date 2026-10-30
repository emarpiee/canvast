/**
 * What the Library lists, for a scope, a search and a sort (ADR 0069, 0071): shared by the Library view (the browser build lists from
 * memory) and the desktop app's main process (which lists a library of a million items from its database, a page at a time).
 */
import type { AssetFolder, CatalogEntry, Usage } from "./asset-catalog";
import { folderPath, meta } from "./asset-catalog";
import { chipOf, extOf } from "./file-kind";
import type { Extra, Filter } from "./filters";
import { parseFilter } from "./filters";
import type { Look } from "./look";
import { tagIsOrUnder } from "../doc/tags";
import { evalQuery } from "../search/query";
import type { Query } from "../search/query";

/**
 * From how many items the desktop app's Library lists a page at a time (`CatalogStore.pages`); below it, the whole library is in the
 * page, as in the browser (every feature works over it, Similar images too). Tests lower it.
 */
export const libraryPaging = { from: 20_000 };

export type Way = "all" | "name" | "tag";
type Has = { has(hash: string): boolean };
export type UsageFilter = "all" | "used" | "unused";
export type SortKey = "newest" | "name" | "size" | "uses" | "pixels" | "type" | "tags" | "folder" | "favourite" | "width" | "height" | "canvases";
/** A listed item: its entry, how it is used, whether its file is there. */
export type ListedEntry = CatalogEntry & Usage & { present: boolean };

/** What the view lists: its scope, search, usage filter and sort, and what only the page knows (where items are used, canvas tags). */
export interface LibraryQuery {
  scope: string;
  text: string;
  way: Way;
  usage: UsageFilter;
  sort: SortKey;
  reversed: boolean;
  /** Items placed on canvases: instances, canvases, those canvases' ids. */
  used: Record<string, [number, number, string[]]>;
  /** Each canvas's name and its board's, lower case (the `on:` keyword). */
  canvasNames: Record<string, string[]>;
  /** Scope `folder:`: the folder and those under it. */
  inFolders?: string[];
  /** Scope `ctag:`: the items the canvas tag is on. */
  canvasTagged?: string[];
  /** Hidden mode: the hidden items instead of the shown ones. */
  hidden?: boolean;
}

/** What a keyword reads besides the entry: the canvases' names, files' lengths and pictures' looks (unknown where not given). */
export interface MatchContext {
  folders: readonly AssetFolder[];
  canvasNames?: (ids: readonly string[]) => string[];
  duration?: (hash: string) => number | null | undefined;
  look?: (hash: string) => Look | null | undefined;
  /** Told when a word needs what is not known yet (a look, a length): the item does not match until it is. */
  unknown?: (f: Filter) => void;
}

/** The search and usage filter, made once for a query (the lower-case forms of each item are kept with it). */
export function matcher(ctx: MatchContext): (e: ListedEntry, query: Query | null, usage: UsageFilter, way: Way) => boolean {
  const filters = new Map<string, Filter | null>();
  const filterOf = (w: string): Filter | null => {
    if (!filters.has(w)) filters.set(w, parseFilter(w));
    return filters.get(w)!;
  };
  const lowered = new WeakMap<object, { m: ReturnType<typeof meta>; tags: string[]; name: string }>();
  const lowerOf = (e: ListedEntry): { m: ReturnType<typeof meta>; tags: string[]; name: string } => {
    let l = lowered.get(e);
    if (!l) {
      const m = meta(e);
      l = { m, tags: m.tags.map((t) => t.toLowerCase()), name: e.name.toLowerCase() };
      lowered.set(e, l);
    }
    return l;
  };
  const extraOf = (e: ListedEntry, m: ReturnType<typeof meta>): Extra => ({
    hidden: m.hidden,
    favorite: m.favorite,
    tags: m.tags.length,
    folders: m.folderIds.length ? folderPath(ctx.folders, m.folderIds[0]!).map((n) => n.toLowerCase()) : [],
    note: m.note.toLowerCase(),
    fields: m.fields.map((f) => ({ key: f.key.toLowerCase(), value: f.value.toLowerCase() })),
    on: () => ctx.canvasNames?.(e.canvasIds) ?? [],
    duration: () => ctx.duration?.(e.hash),
  });
  return (e, query, usage, how) => {
    const { m, tags, name } = lowerOf(e);
    let notes: string | null = null; // the note and the fields, lowercased only when a word gets that far
    const wordsOk = evalQuery(query, ({ text: w }) => {
      if (w.startsWith("#")) return tags.some((t) => tagIsOrUnder(t, w.slice(1))); // a tag and the tags nested under it
      // `.png` is the file type: a word that starts with a dot matches files with that extension (a lone dot: files that have one).
      if (w.startsWith(".")) return w.length > 1 ? chipOf(e.name, e.type).toLowerCase() === w.slice(1) : extOf(e.name) !== "";
      const f = filterOf(w);
      if (f) {
        const verdict = f.test(e, ctx.look?.(e.hash), extraOf(e, m));
        if (verdict === "unknown") {
          ctx.unknown?.(f);
          return false;
        }
        return verdict;
      }
      const inTags = tags.some((t) => t.includes(w));
      if (how === "tag") return inTags;
      if (how === "name") return name.includes(w);
      if (name.includes(w) || e.type.toLowerCase().includes(w) || e.hash.startsWith(w) || inTags) return true;
      notes ??= [m.note, ...m.fields.flatMap((f) => [f.key, f.value])].join("\n").toLowerCase();
      return notes.includes(w);
    });
    return wordsOk && (usage === "all" || (usage === "used" ? e.instances > 0 : e.instances === 0));
  };
}

/**
 * Whether an item is in a scope. Hidden items are listed in hidden mode only, and only they are (`hiddenMode`). `inFolders`: a folder's
 * subtree (scope `folder:`); `canvasTagged`: the items a canvas tag is on (scope `ctag:`); `similar`: the items in a look-alike group.
 */
export function inScope(e: ListedEntry, scope: string, sets: { inFolders?: Has | null; canvasTagged?: Has | null; similar?: Has | null } = {}, hiddenMode = false): boolean {
  const m = meta(e);
  if (m.hidden !== hiddenMode) return false;
  if (scope === "similar") return !!sets.similar?.has(e.hash);
  if (scope === "favorites") return m.favorite;
  if (scope === "unfiled") return m.folderIds.length === 0;
  if (scope.startsWith("folder:")) return !!sets.inFolders && m.folderIds.some((id) => sets.inFolders!.has(id));
  if (scope.startsWith("ext:")) return chipOf(e.name, e.type).toLowerCase() === scope.slice(4);
  if (scope.startsWith("tag:")) return m.tags.some((t) => tagIsOrUnder(t, scope.slice(4)));
  if (scope.startsWith("ctag:")) return !!sets.canvasTagged?.has(e.hash);
  return true;
}

/** Sort items in place by `key` (then by hash, so the order is the same every time); text keys are made once per item. */
export function sortListed<T extends ListedEntry>(rows: T[], key: SortKey, reversed: boolean, folders: readonly AssetFolder[], collator: Intl.Collator): T[] {
  // Text sorts compare a key made once per item (a folder path or the joined tags, made in every comparison, made sorting slow).
  const textKey: Partial<Record<SortKey, (e: T) => string>> = {
    type: (e) => chipOf(e.name, e.type),
    tags: (e) => meta(e).tags.join(" "),
    folder: (e) => (meta(e).folderIds[0] ? folderPath(folders, meta(e).folderIds[0]!).join(" › ") : ""),
  };
  const keyOf = textKey[key];
  const keys = keyOf ? new Map(rows.map((e) => [e, keyOf(e)])) : null;
  const byKey = (a: T, b: T): number => collator.compare(keys!.get(a)!, keys!.get(b)!);
  const byName = (a: T, b: T): number => collator.compare(a.name, b.name);
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    newest: (a, b) => b.importedAt - a.importedAt,
    name: byName,
    size: (a, b) => b.size - a.size,
    uses: (a, b) => b.instances - a.instances,
    pixels: (a, b) => b.pixelW * b.pixelH - a.pixelW * a.pixelH,
    type: byKey,
    tags: (a, b) => byKey(a, b) || byName(a, b),
    folder: (a, b) => byKey(a, b) || byName(a, b),
    favourite: (a, b) => Number(meta(b).favorite) - Number(meta(a).favorite),
    width: (a, b) => b.pixelW - a.pixelW,
    height: (a, b) => b.pixelH - a.pixelH,
    canvases: (a, b) => b.canvases - a.canvases,
  };
  const flip = reversed ? -1 : 1;
  return rows.sort((a, b) => flip * cmp[key](a, b) || (a.hash < b.hash ? -1 : 1));
}

/**
 * The sidebar's counts: hidden and shown items, then favourites, unfiled, each tag (by its lower-case form), file type and folder (with its
 * subfolders) of the shown items, or of the hidden ones in hidden mode (`hiddenMode`).
 */
export interface SideCounts {
  hidden: number;
  shown: number;
  favourites: number;
  unfiled: number;
  tags: Map<string, { label: string; n: number }>;
  types: Map<string, number>;
  folders: Map<string, number>;
}
export function countSide(entries: Iterable<CatalogEntry>, folders: readonly AssetFolder[], hiddenMode = false): SideCounts {
  const c: SideCounts = { hidden: 0, shown: 0, favourites: 0, unfiled: 0, tags: new Map(), types: new Map(), folders: new Map() };
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
  for (const e of entries) {
    const m = meta(e);
    if (m.hidden) c.hidden++;
    else c.shown++;
    if (m.hidden !== hiddenMode) continue; // (what is hidden is counted in hidden mode only, and only it is)
    if (m.favorite) c.favourites++;
    if (!m.folderIds.length) c.unfiled++;
    for (const t of m.tags) {
      const k = t.toLowerCase();
      const tc = c.tags.get(k);
      if (tc) tc.n++;
      else c.tags.set(k, { label: t, n: 1 });
    }
    // The file types in the workspace: one chip per extension, with how many files have it.
    const k = chipOf(e.name, e.type).toLowerCase();
    c.types.set(k, (c.types.get(k) ?? 0) + 1);
    // A folder counts what is in it and in the folders under it, each item once.
    const under = new Set<string>();
    for (let id of m.folderIds) {
      for (let guard = 0; id && !under.has(id) && guard < 1000; guard++) {
        under.add(id);
        id = parentOf.get(id) ?? "";
      }
    }
    for (const id of under) c.folders.set(id, (c.folders.get(id) ?? 0) + 1);
  }
  return c;
}

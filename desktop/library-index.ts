/**
 * The desktop Library view's lists (main process): the active items, read from the database once and kept in step as each one
 * changes, listed for a scope, a search and a sort with the same code as the browser build (`src/assets/library-match.ts`). The page
 * gets the order (hashes) and each item's picture shape for the layout, and asks for the items it draws: a library of a million items
 * never comes to the page whole.
 */
import type { AssetFolder, CatalogEntry } from "../src/assets/asset-catalog";
import { FOLDERS_KEY } from "../src/assets/asset-catalog";
import { countSide, inScope, matcher, sortListed } from "../src/assets/library-match";
import type { ListedEntry, SortKey, UsageFilter, Way } from "../src/assets/library-match";
import { parseQuery } from "../src/search/query";
import type { Library } from "./library-db";

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

export interface QueryResult {
  /** The items listed, in order, as one string of 64-character hashes. */
  hashes: string;
  /** Each one's picture shape (width / height), for the layout. */
  ratios: Float32Array;
  /** Active items of the mode (shown ones, or hidden ones in hidden mode), and their bytes. */
  total: number;
  bytes: number;
}

const NONE: string[] = [];

export class LibraryIndex {
  private items: Map<string, ListedEntry> | null = null;
  /** Changes since the sorted lists were made. */
  private version = 0;
  private sorted: { key: string; version: number; rows: ListedEntry[] } | null = null;
  private side: { version: number; hidden: boolean; counts: ReturnType<typeof countSide> } | null = null;
  private usedBefore: string[] = [];

  constructor(private readonly lib: Library) {
    lib.listeners.push((op) => {
      if (op.t === "meta" && op.k === FOLDERS_KEY) this.version++; // (folder sorts and counts)
      if (op.t !== "entry" || !this.items) return;
      this.version++;
      const e = op.v;
      if (e && e.state === "active") this.items.set(op.hash, { ...e, instances: 0, canvases: 0, canvasIds: [], present: true });
      else this.items.delete(op.hash);
    });
  }

  /** Every active item (read once). */
  private all(): Map<string, ListedEntry> {
    if (this.items) return this.items;
    const items = new Map<string, ListedEntry>();
    for (const [json] of this.lib.db.prepare("SELECT json FROM entries WHERE state = 'active'").raw().iterate() as IterableIterator<[string]>) {
      const e = JSON.parse(json) as ListedEntry; // (the parsed entry itself takes the listing's fields: a million are not copied)
      e.instances = 0;
      e.canvases = 0;
      e.canvasIds = NONE;
      e.present = true;
      items.set(e.hash, e);
    }
    this.version++;
    return (this.items = items);
  }

  private folders(): AssetFolder[] {
    return (this.lib.meta(FOLDERS_KEY) as AssetFolder[] | undefined) ?? [];
  }

  /** The items `q` lists, in order. `absent`: the items whose file is not there. */
  query(q: LibraryQuery, absent: ReadonlySet<string>): QueryResult {
    const items = this.all();
    // Usage and presence, which the page and the folder know: set where they changed since the last query.
    for (const h of this.usedBefore) {
      const it = items.get(h);
      if (it) Object.assign(it, { instances: 0, canvases: 0, canvasIds: [] });
    }
    this.usedBefore = Object.keys(q.used);
    for (const [h, [instances, canvases, canvasIds]] of Object.entries(q.used)) {
      const it = items.get(h);
      if (it) Object.assign(it, { instances, canvases, canvasIds });
    }
    for (const it of items.values()) it.present = !absent.has(it.hash);
    const folders = this.folders();
    // Sorted once per sort and change (a usage sort, every time: the page's usage changes without the library changing).
    const key = `${q.sort}\u0001${q.reversed}`;
    const usageSort = q.sort === "uses" || q.sort === "canvases";
    if (!this.sorted || this.sorted.key !== key || this.sorted.version !== this.version || usageSort) {
      this.sorted = { key, version: this.version, rows: sortListed([...items.values()], q.sort, q.reversed, folders, new Intl.Collator()) };
    }
    const words = q.text.trim() ? parseQuery(q.text).query : null;
    const match = matcher({ folders, canvasNames: (ids) => ids.flatMap((id) => q.canvasNames[id] ?? []) });
    const sets = { inFolders: q.inFolders ? new Set(q.inFolders) : null, canvasTagged: q.canvasTagged ? new Set(q.canvasTagged) : null };
    const rows = this.sorted.rows.filter((e) => inScope(e, q.scope, sets, q.hidden === true) && (!words && q.usage === "all" ? true : match(e, words, q.usage, q.way)));
    const ratios = new Float32Array(rows.length);
    rows.forEach((e, i) => (ratios[i] = Math.max(0.4, Math.min(3, e.pixelW / Math.max(1, e.pixelH)))));
    // (the items of the mode: hidden ones are counted in hidden mode only, and only they are)
    let bytes = 0, total = 0;
    for (const e of items.values()) if (!!e.hidden === (q.hidden === true)) (bytes += e.size), total++;
    return { hashes: rows.map((e) => e.hash).join(""), ratios, total, bytes };
  }

  /** The sidebar's counts (made again only after a change), as plain lists; of the hidden items in hidden mode (`hidden`). */
  counts(hidden = false): { hidden: number; shown: number; favourites: number; unfiled: number; tags: Array<[string, string, number]>; types: Array<[string, number]>; folders: Array<[string, number]> } {
    const items = this.all();
    if (!this.side || this.side.version !== this.version || this.side.hidden !== hidden) this.side = { version: this.version, hidden, counts: countSide(items.values(), this.folders(), hidden) };
    const c = this.side.counts;
    return { hidden: c.hidden, shown: c.shown, favourites: c.favourites, unfiled: c.unfiled, tags: [...c.tags].map(([k, v]) => [k, v.label, v.n]), types: [...c.types], folders: [...c.folders] };
  }

  /** Every field name the active items use (for the inspector's suggestions). */
  fieldKeys(): string[] {
    const keys = new Set<string>();
    for (const e of this.all().values()) for (const f of e.fields ?? []) if (f.key) keys.add(f.key);
    return [...keys].sort((a, b) => a.localeCompare(b));
  }

  /** Forget everything (the database was emptied). */
  reset(): void {
    this.items = null;
    this.sorted = null;
    this.side = null;
  }
}

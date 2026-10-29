/**
 * The desktop build's library (SQLite, main process): each item's entry and stored-original record (the two IndexedDB stores of the
 * browser build, `assetCatalog` and `assets`, without bytes), and what this device last read or wrote of it in the folder (`seen`).
 * The part files in `.canvast/library/` stay the truth the devices share; this is this device's working copy, made again from
 * them when it is gone. Opening a library of a million items reads the part files here, not in the page (ADR 0177).
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { CatalogEntry } from "../src/assets/asset-catalog";
import type { AssetRecord } from "../src/assets/asset-library";
import type { LibraryItem } from "../src/storage/library-mirror";
import { entryOf, itemOf, readItem, seen } from "../src/storage/library-mirror";

export type LibraryDb = InstanceType<typeof Database>;
/** An item as stored: its entry, its original's record (no bytes), and the fingerprint of its line as last read or written. */
export interface LibraryRow {
  entry: CatalogEntry;
  rec: AssetRecord | undefined;
  seen: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  hash TEXT PRIMARY KEY, state TEXT NOT NULL, imported INTEGER NOT NULL, name TEXT NOT NULL, folder TEXT, favorite INTEGER NOT NULL,
  hidden INTEGER NOT NULL, size INTEGER NOT NULL, type TEXT NOT NULL, tags TEXT NOT NULL, file TEXT, entry TEXT NOT NULL, rec TEXT, seen TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS items_file ON items(file);
CREATE INDEX IF NOT EXISTS items_listed ON items(state, imported);
CREATE INDEX IF NOT EXISTS items_folder ON items(folder);
CREATE TABLE IF NOT EXISTS parts (key TEXT PRIMARY KEY, fp TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
`;

export function openLibraryDb(file: string): LibraryDb {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL"); // (safe with WAL: a crash may lose the last moments, never corrupts)
  db.pragma("cache_size = -65536");
  db.exec(SCHEMA);
  return db;
}

type Stored = { entry: string; rec: string | null; seen: string | null };
const rowOf = (r: Stored): LibraryRow => ({ entry: JSON.parse(r.entry) as CatalogEntry, rec: r.rec ? (JSON.parse(r.rec) as AssetRecord) : undefined, seen: r.seen });

export function getRows(db: LibraryDb, hashes: readonly string[]): Map<string, LibraryRow> {
  const get = db.prepare<[string], Stored>("SELECT entry, rec, seen FROM items WHERE hash = ?");
  const out = new Map<string, LibraryRow>();
  for (const h of hashes) {
    const r = get.get(h);
    if (r) out.set(h, rowOf(r));
  }
  return out;
}

/** Store rows (an entry with no record keeps the one stored); in one transaction. */
export function putRows(db: LibraryDb, rows: ReadonlyArray<{ entry: CatalogEntry; rec?: AssetRecord | null; seen?: string | null }>): void {
  const put = putter(db);
  db.transaction(() => {
    for (const r of rows) put(r.entry, r.rec, r.seen);
  })();
}

/** A statement that stores one row: `rec` undefined keeps the stored record, null removes it; `seen` undefined keeps the stored one. */
function putter(db: LibraryDb): (entry: CatalogEntry, rec: AssetRecord | null | undefined, seen: string | null | undefined) => void {
  const get = db.prepare<[string], { rec: string | null; seen: string | null }>("SELECT rec, seen FROM items WHERE hash = ?");
  const put = db.prepare("INSERT OR REPLACE INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  return (e, rec, seenNow) => {
    const was = rec === undefined || seenNow === undefined ? get.get(e.hash) : undefined;
    const recText = rec === undefined ? (was?.rec ?? null) : rec ? JSON.stringify(stubOf(rec)) : null;
    const file = recText ? ((JSON.parse(recText) as AssetRecord).file ?? null) : null;
    put.run(e.hash, e.state, e.importedAt, e.name, e.folderIds?.[0] ?? null, e.favorite ? 1 : 0, e.hidden ? 1 : 0, e.size, e.type, (e.tags ?? []).join("\n"), file, JSON.stringify(e), recText, seenNow === undefined ? (was?.seen ?? null) : seenNow);
  };
}

/** A record without its bytes (the database never holds an original). */
const stubOf = (r: AssetRecord): AssetRecord => {
  const { blob: _b, ...rest } = r as AssetRecord & { blob?: Blob };
  return rest as AssetRecord;
};

export interface SyncResult {
  /** Whether anything was taken from the folder. */
  took: boolean;
  /** Every part listed could be read (none missing or damaged). */
  whole: boolean;
  /** Items read from parts that changed. */
  read: number;
}

/**
 * Take what changed in the library's part files since this device last read or wrote them (`LibraryMirror.adopt`, here): only parts
 * whose text changed are read. An item this device changed since (its line differs from what it last saw) keeps this device's
 * version. With `deletions` (the library read whole, the hidden items not locked), an item no longer in its part was erased on
 * another device and is marked deleted here; `extra` are the hidden items of the sealed index, which no part holds.
 */
export function syncLibrary(db: LibraryDb, keys: readonly string[], readPart: (key: string) => Buffer | null, extra: readonly LibraryItem[], deletions: boolean, onPart?: (done: number, total: number) => void): SyncResult {
  const fpOf = db.prepare<[string], { fp: string }>("SELECT fp FROM parts WHERE key = ?");
  const setFp = db.prepare("INSERT OR REPLACE INTO parts VALUES (?, ?)");
  const dropFp = db.prepare("DELETE FROM parts WHERE key = ?");
  const get = db.prepare<[string], Stored>("SELECT entry, rec, seen FROM items WHERE hash = ?");
  const inRange = db.prepare<[string, string], Stored & { hash: string }>("SELECT hash, entry, rec, seen FROM items WHERE hash >= ? AND hash < ? AND seen IS NOT NULL");
  const sealed = db.prepare<[], Stored & { hash: string }>("SELECT hash, entry, rec, seen FROM items WHERE file LIKE '.hidden/%' AND seen IS NOT NULL");
  const forget = db.prepare("UPDATE items SET seen = NULL WHERE hash = ?");
  const put = putter(db);
  let took = false;
  let whole = true;
  let read = 0;
  const present = new Set<string>(extra.map((i) => i.hash));
  /** Ranges of hashes whose items were all read again (parts changed or gone): what is not there any more was erased. */
  const looked: string[] = [];
  /** Parts unchanged since last read: their items are all there still. */
  const unchanged = new Set<string>();
  const take = (it: LibraryItem): void => {
    const text = JSON.stringify(it);
    const v = seen(text);
    const r = get.get(it.hash);
    if (r?.seen === v) return; // (nothing new from the folder)
    const row = r && rowOf(r);
    if (row && seen(JSON.stringify(itemOf(row.entry, row.rec))) !== (row.seen ?? "")) return; // changed here too: this device's stays
    const rec = it.file && (!row?.rec || row.rec.ext)
      ? ({ hash: it.hash, type: it.type, size: it.size, name: row?.rec?.name ?? it.name, pixelW: it.pixelW, pixelH: it.pixelH, importedAt: it.importedAt, ...(it.card ? { card: true } : {}), ...(it.duration !== undefined ? { duration: it.duration } : {}), ...(it.frames !== undefined ? { frames: it.frames } : {}), ext: 1, file: it.file } as AssetRecord)
      : undefined;
    put(entryOf(it, row?.entry), rec, v);
    took = true;
  };
  const listed = new Set(keys);
  const gone = (db.prepare("SELECT key FROM parts").all() as Array<{ key: string }>).map((r) => r.key).filter((k) => !listed.has(k));
  let done = 0;
  for (const key of keys) {
    const bytes = readPart(key);
    const fp = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
    if (fp !== null && fpOf.get(key)?.fp === fp) {
      unchanged.add(key);
      onPart?.(++done, keys.length);
      continue;
    }
    let raw: { format?: unknown; items?: unknown } | null = null;
    try {
      raw = bytes ? (JSON.parse(bytes.toString("utf8")) as { format?: unknown; items?: unknown }) : null;
    } catch {
      raw = null;
    }
    if (!raw || raw.format !== "canvast-library-items" || !Array.isArray(raw.items)) {
      whole = false; // missing (a sync tool still bringing it) or damaged: nothing in it counts as erased
      onPart?.(++done, keys.length);
      continue;
    }
    const items = raw.items.map(readItem).filter((i): i is LibraryItem => i !== null);
    // One transaction per part: a library of a million items is taken in steps, each kept whole (a stop half-way loses nothing).
    db.transaction(() => {
      for (const it of items) (present.add(it.hash), take(it));
      setFp.run(key, fp);
    })();
    read += items.length;
    looked.push(key);
    onPart?.(++done, keys.length);
  }
  db.transaction(() => {
    for (const it of extra) take(it);
    for (const k of gone) dropFp.run(k);
    if (!deletions || !whole) return;
    const candidates = [...[...looked, ...gone].flatMap((k) => inRange.all(k, `${k}z`)), ...sealed.all()];
    for (const c of candidates) {
      if (present.has(c.hash) || unchanged.has(c.hash.slice(0, 2)) || unchanged.has(c.hash.slice(0, 1))) continue;
      const row = rowOf(c);
      if (seen(JSON.stringify(itemOf(row.entry, row.rec))) !== c.seen) continue; // changed here: kept
      if (row.entry.state === "active") put({ ...row.entry, state: "deleted", deletedAt: Date.now() }, undefined, null);
      else forget.run(c.hash);
      took = true;
    }
  })();
  return { took, whole, read };
}

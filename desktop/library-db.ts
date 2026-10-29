/**
 * The desktop build's library (SQLite, main process, ADR 0177): the two stores the browser build keeps in IndexedDB, `assetCatalog`
 * (entries) and the records of `assets` (where each original's file is; never bytes), and what this device last read or wrote of each
 * item in the folder (`seen`, a fingerprint of its line). The part files in `.canvast/library/` stay the truth the devices share;
 * this is this device's working copy, made again from them when it is gone. A library of a million items is read here, not in the page.
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { CatalogEntry } from "../src/assets/asset-catalog";
import type { AssetRecord } from "../src/assets/asset-library";
import type { LibraryItem } from "../src/storage/library-mirror";
import type { LibraryOp } from "../src/storage/desktop-bridge";
export type { LibraryOp };
import { entryOf, itemOf, readItem, seen } from "../src/storage/library-mirror";

export type LibraryDb = InstanceType<typeof Database>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  hash TEXT PRIMARY KEY, state TEXT NOT NULL, imported INTEGER NOT NULL, name TEXT NOT NULL, folder TEXT, favorite INTEGER NOT NULL,
  hidden INTEGER NOT NULL, size INTEGER NOT NULL, type TEXT NOT NULL, tags TEXT NOT NULL, json TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS entries_listed ON entries(state, imported);
CREATE INDEX IF NOT EXISTS entries_folder ON entries(folder);
CREATE TABLE IF NOT EXISTS recs (hash TEXT PRIMARY KEY, file TEXT, json TEXT NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS recs_file ON recs(file);
CREATE TABLE IF NOT EXISTS seen (hash TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
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

/** A record without its bytes (the database never holds an original). */
const stubOf = (r: AssetRecord): AssetRecord => {
  const { blob: _b, ...rest } = r as AssetRecord & { blob?: Blob };
  return rest as AssetRecord;
};

/** The library's statements, made once per database. */
export class Library {
  private readonly s;

  constructor(readonly db: LibraryDb) {
    this.s = {
      entry: db.prepare<[string], { json: string }>("SELECT json FROM entries WHERE hash = ?"),
      rec: db.prepare<[string], { json: string }>("SELECT json FROM recs WHERE hash = ?"),
      seen: db.prepare<[string], { v: string }>("SELECT v FROM seen WHERE hash = ?"),
      putEntry: db.prepare("INSERT OR REPLACE INTO entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      delEntry: db.prepare("DELETE FROM entries WHERE hash = ?"),
      putRec: db.prepare("INSERT OR REPLACE INTO recs VALUES (?, ?, ?)"),
      delRec: db.prepare("DELETE FROM recs WHERE hash = ?"),
      putSeen: db.prepare("INSERT OR REPLACE INTO seen VALUES (?, ?)"),
      delSeen: db.prepare("DELETE FROM seen WHERE hash = ?"),
      meta: db.prepare<[string], { v: string }>("SELECT v FROM meta WHERE k = ?"),
      putMeta: db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)"),
      delMeta: db.prepare("DELETE FROM meta WHERE k = ?"),
      byFile: db.prepare<[string], { hash: string }>("SELECT hash FROM recs WHERE file = ?"),
    };
  }

  entry(hash: string): CatalogEntry | undefined {
    const r = this.s.entry.get(hash);
    return r ? (JSON.parse(r.json) as CatalogEntry) : undefined;
  }
  rec(hash: string): AssetRecord | undefined {
    const r = this.s.rec.get(hash);
    return r ? (JSON.parse(r.json) as AssetRecord) : undefined;
  }
  seenOf(hash: string): string | undefined {
    return this.s.seen.get(hash)?.v;
  }
  meta(k: string): unknown {
    const r = this.s.meta.get(k);
    return r ? JSON.parse(r.v) : undefined;
  }
  /** The hash of the record that names `file`, if any. */
  byFile(file: string): string | undefined {
    return this.s.byFile.get(file)?.hash;
  }

  /** Entries, records and seen marks of some items (missing ones left out). */
  get(hashes: readonly string[]): Array<[string, CatalogEntry | null, AssetRecord | null, string | null]> {
    const out: Array<[string, CatalogEntry | null, AssetRecord | null, string | null]> = [];
    for (const h of hashes) {
      const e = this.entry(h) ?? null;
      const r = this.rec(h) ?? null;
      if (e || r) out.push([h, e, r, this.seenOf(h) ?? null]);
    }
    return out;
  }

  /** Every entry (`where` a plain condition on the columns, e.g. "state = 'deleted'"), as one JSON array text: one string crosses to the page, not a million objects. */
  entriesText(where = "1"): string {
    const rows = this.db.prepare<[], { json: string }>(`SELECT json FROM entries WHERE ${where}`).raw().all() as unknown as string[][];
    return `[${rows.map((r) => r[0]).join(",")}]`;
  }
  /** Every record, as one JSON array text. */
  recsText(): string {
    const rows = this.db.prepare("SELECT json FROM recs").raw().all() as unknown as string[][];
    return `[${rows.map((r) => r[0]).join(",")}]`;
  }

  /** Apply changes in one transaction (all or nothing). */
  apply(ops: readonly LibraryOp[]): void {
    this.db.transaction(() => {
      for (const op of ops) this.one(op);
    })();
  }

  private one(op: LibraryOp): void {
    const s = this.s;
    if (op.t === "entry") {
      if (!op.v) return void s.delEntry.run(op.hash);
      const e = op.v;
      s.putEntry.run(op.hash, e.state, e.importedAt, e.name, e.folderIds?.[0] ?? null, e.favorite ? 1 : 0, e.hidden ? 1 : 0, e.size, e.type, (e.tags ?? []).join("\n"), JSON.stringify(e));
    } else if (op.t === "rec") {
      if (!op.v) return void s.delRec.run(op.hash);
      const r = stubOf(op.v);
      s.putRec.run(op.hash, r.ext && r.file ? r.file : null, JSON.stringify(r));
    } else if (op.t === "seen") {
      if (op.v === null) s.delSeen.run(op.hash);
      else s.putSeen.run(op.hash, op.v);
    } else if (op.v === undefined || op.v === null) s.delMeta.run(op.k);
    else s.putMeta.run(op.k, JSON.stringify(op.v));
  }

  /**
   * Take what changed in the library's part files since this device last read or wrote them (what `LibraryMirror.adopt` does in the
   * page's storage): only parts whose text changed are read. An item this device changed since (its line is not what it last saw) keeps
   * this device's version. With `deletions` (the library read whole, the hidden items not locked) an item no longer in its part was
   * erased on another device and is marked deleted here; `extra` are the hidden items of the sealed index, which no part holds.
   */
  sync(keys: readonly string[], readPart: (key: string) => Buffer | null, extra: readonly LibraryItem[], deletions: boolean, onPart?: (done: number, total: number) => void): SyncResult {
    const fpOf = this.db.prepare<[string], { fp: string }>("SELECT fp FROM parts WHERE key = ?");
    const setFp = this.db.prepare("INSERT OR REPLACE INTO parts VALUES (?, ?)");
    const dropFp = this.db.prepare("DELETE FROM parts WHERE key = ?");
    const inRange = this.db.prepare<[string, string], { hash: string; v: string }>("SELECT hash, v FROM seen WHERE hash >= ? AND hash < ?");
    const sealed = this.db.prepare<[], { hash: string; v: string }>("SELECT seen.hash, seen.v FROM seen JOIN recs ON recs.hash = seen.hash WHERE recs.file LIKE '.hidden/%'");
    let took = false;
    let whole = true;
    let read = 0;
    const present = new Set<string>(extra.map((i) => i.hash));
    /** Parts read again (changed) or gone: what of theirs is not there any more was erased. */
    const looked: string[] = [];
    /** Parts unchanged since last read: their items are all there still. */
    const unchanged = new Set<string>();
    const changedHere = (hash: string, was: string | undefined): boolean => {
      const e = this.entry(hash);
      return !!e && seen(JSON.stringify(itemOf(e, this.rec(hash)))) !== (was ?? "");
    };
    const take = (it: LibraryItem): void => {
      const v = seen(JSON.stringify(it));
      const was = this.seenOf(it.hash);
      if (was === v) return; // (nothing new from the folder)
      if (changedHere(it.hash, was)) return; // changed here too: this device's stays
      const rec = this.rec(it.hash);
      const ops: LibraryOp[] = [{ t: "entry", hash: it.hash, v: entryOf(it, this.entry(it.hash)) }, { t: "seen", hash: it.hash, v }];
      if (it.file && (!rec || rec.ext)) {
        const stub = { hash: it.hash, type: it.type, size: it.size, name: rec?.name ?? it.name, pixelW: it.pixelW, pixelH: it.pixelH, importedAt: it.importedAt, ...(it.card ? { card: true } : {}), ...(it.duration !== undefined ? { duration: it.duration } : {}), ...(it.frames !== undefined ? { frames: it.frames } : {}), ext: 1, file: it.file };
        ops.push({ t: "rec", hash: it.hash, v: stub as unknown as AssetRecord });
      }
      for (const op of ops) this.one(op);
      took = true;
    };
    const listed = new Set(keys);
    const gone = (this.db.prepare("SELECT key FROM parts").all() as Array<{ key: string }>).map((r) => r.key).filter((k) => !listed.has(k));
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
      this.db.transaction(() => {
        for (const it of items) (present.add(it.hash), take(it));
        setFp.run(key, fp);
      })();
      read += items.length;
      looked.push(key);
      onPart?.(++done, keys.length);
    }
    this.db.transaction(() => {
      for (const it of extra) take(it);
      for (const k of gone) dropFp.run(k);
      if (!deletions || !whole) return;
      for (const c of [...[...looked, ...gone].flatMap((k) => inRange.all(k, `${k}z`)), ...sealed.all()]) {
        if (present.has(c.hash) || unchanged.has(c.hash.slice(0, 2)) || unchanged.has(c.hash.slice(0, 1))) continue;
        if (changedHere(c.hash, c.v)) continue; // changed here: kept
        const e = this.entry(c.hash);
        if (e?.state === "active") this.one({ t: "entry", hash: c.hash, v: { ...e, state: "deleted", deletedAt: Date.now() } });
        this.one({ t: "seen", hash: c.hash, v: null });
        took = true;
      }
    })();
    return { took, whole, read };
  }
}

export interface SyncResult {
  /** Whether anything was taken from the folder. */
  took: boolean;
  /** Every part listed could be read (none missing or damaged). */
  whole: boolean;
  /** Items read from parts that changed. */
  read: number;
}

/**
 * The desktop build's library in the page (ADR 0177): the entries and the originals' records live in the main process's SQLite file
 * (`desktop/library-db.ts`), reached through `LibraryCalls`; thumbnails, the password locks and the canvases (which items use) stay
 * in the page's IndexedDB. `DesktopCatalog` is the browser build's `AssetCatalog` on that storage, operation for operation.
 */
import type { AssetFolder, AssetLocation, CatalogEntry, CatalogListing, GcReport, MetaChange, MetaSnapshot, PasswordKind, ThumbRecord } from "../assets/asset-catalog";
import { AssetInUseError, CatalogInputError, FOLDERS_KEY, entryFromRecord, folderName, folderSubtree, meta, normalizeFields, normalizeNote, normalizeTags, usageOf, listedFolders, inHiddenFolder, unhiddenFolders } from "../assets/asset-catalog";
import type { AssetRecord } from "../assets/asset-library";
import { ImportError, MAX_IMPORT_BYTES, storedStub } from "../assets/asset-library";
import { isHiddenFile } from "./hidden-vault";
import { cleanFileName } from "../doc/rename-rules";
import { formatTag, formatTags, renamedTag, tagIsOrUnder } from "../doc/tags";
import type { LibraryCalls, LibraryOp } from "./desktop-bridge";
import { externalFolder } from "./external-folder";
import { done, idbGet, req } from "./idb";
import type { CatalogStore, LibraryPages, OriginalStore } from "./store";

/** The library calls, with every change made one after another (a read, then its write, never interleaved with another's). */
export class DesktopLibrary {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readonly calls: LibraryCalls) {}

  /** Run `fn` after every change asked before it has finished (the page's stand-in for an IndexedDB readwrite transaction). */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async entry(hash: string): Promise<CatalogEntry | undefined> {
    return (await this.calls.get([hash]))[0]?.[1] ?? undefined;
  }
  async rec(hash: string): Promise<AssetRecord | undefined> {
    return (await this.calls.get([hash]))[0]?.[2] ?? undefined;
  }
  /** Entries and records of some items. */
  async rows(hashes: readonly string[]): Promise<{ entries: Map<string, CatalogEntry>; recs: Map<string, AssetRecord>; seen: Map<string, string> }> {
    const entries = new Map<string, CatalogEntry>();
    const recs = new Map<string, AssetRecord>();
    const seen = new Map<string, string>();
    for (let at = 0; at < hashes.length; at += 5000) {
      for (const [h, e, r, s] of await this.calls.get(hashes.slice(at, at + 5000))) {
        if (e) entries.set(h, e);
        if (r) recs.set(h, r);
        if (s !== null) seen.set(h, s);
      }
    }
    return { entries, recs, seen };
  }
  async entries(which: "all" | "active" | "deleted" | "hidden" = "all"): Promise<CatalogEntry[]> {
    return JSON.parse(await this.calls.entries(which)) as CatalogEntry[];
  }
  async recs(which: "all" | "sealed" = "all"): Promise<AssetRecord[]> {
    return JSON.parse(await this.calls.recs(which)) as AssetRecord[];
  }
  async folders(): Promise<AssetFolder[]> {
    return ((await this.calls.meta(FOLDERS_KEY)) as AssetFolder[] | null) ?? [];
  }
  async apply(ops: readonly LibraryOp[]): Promise<void> {
    if (!ops.length) return;
    // Undo snapshots taken since record what each entry was before its first change (see `DesktopCatalog.snapshotMeta`).
    const open = this.journals();
    const changed = open.length ? [...new Set(ops.flatMap((o) => (o.t === "entry" ? [o.hash] : [])))] : [];
    if (changed.length) {
      const { entries } = await this.rows(changed.filter((h) => open.some((j) => !j.has(h))));
      for (const h of changed) {
        const e = entries.get(h);
        for (const j of open) if (!j.has(h)) j.set(h, e && e.state === "active" ? { name: e.name, ...meta(e) } : null);
      }
    }
    await this.calls.apply(ops);
  }

  /** Undo snapshots still held (a snapshot dropped from the undo list is let go): each entry's state before its first change since. */
  private readonly snaps = new Set<WeakRef<Map<string, SnapEntry | null>>>();
  journal(): Map<string, SnapEntry | null> {
    const m = new Map<string, SnapEntry | null>();
    this.snaps.add(new WeakRef(m));
    return m;
  }
  private journals(): Array<Map<string, SnapEntry | null>> {
    const out: Array<Map<string, SnapEntry | null>> = [];
    for (const r of this.snaps) {
      const m = r.deref();
      if (m) out.push(m);
      else this.snaps.delete(r);
    }
    return out;
  }
}

const putEntry = (e: CatalogEntry): LibraryOp => ({ t: "entry", hash: e.hash, v: e });
/** What an undo snapshot keeps of an entry. */
type SnapEntry = { name: string } & ReturnType<typeof meta>;
/** A snapshot of the desktop library (copy on write): the entries changed since, as they were then (null: not an active item then). */
interface JournalSnapshot extends MetaSnapshot {
  readonly journal: Map<string, SnapEntry | null>;
}
const putFolders = (folders: AssetFolder[]): LibraryOp => ({ t: "meta", k: FOLDERS_KEY, v: folders });

export class DesktopCatalog implements CatalogStore {
  /**
   * The hidden items' key: a hidden item's thumbnail is stored encrypted with it (made once, never readable on disk), and read only
   * while it is open (ADR 0177).
   */
  vault: { isOpen(): boolean; seal(bytes: Uint8Array<ArrayBuffer>, item: object): Promise<Uint8Array<ArrayBuffer>>; open(sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> } | null = null;

  constructor(
    readonly db: IDBDatabase,
    readonly lib: DesktopLibrary,
  ) {}

  async healStubs(): Promise<void> {
    // (records here never held bytes)
  }

  async thumbHashes(): Promise<string[]> {
    const tx = this.db.transaction("thumbs", "readonly");
    return (await req(tx.objectStore("thumbs").getAllKeys())) as string[];
  }

  async thumb(hash: string): Promise<ThumbRecord | undefined> {
    const tx = this.db.transaction("thumbs", "readonly");
    const rec = await req(tx.objectStore("thumbs").get(hash) as IDBRequest<(ThumbRecord & { sealed?: string }) | undefined>);
    if (rec?.sealed === undefined) return rec;
    // (a hidden item's: opened with the key, or none while it is locked)
    const bytes = this.vault?.isOpen() ? await this.vault.open(new Uint8Array(await rec.blob.arrayBuffer())).catch(() => null) : null;
    return bytes ? { hash: rec.hash, w: rec.w, h: rec.h, blob: new Blob([bytes], { type: rec.sealed }) } : undefined;
  }

  /** (`AssetCatalog.healThumbs`: thumbnails of types that do not always decode, dropped once.) */
  async healThumbs(): Promise<void> {
    const KEY = "thumbVersion";
    if (((await idbGet<number>(this.db, "meta", KEY)) ?? 1) >= 2) return;
    const ok = /^(image\/(png|jpeg|webp|gif|avif|bmp)|video\/|audio\/)/;
    const drop = (await this.lib.entries()).filter((e) => !ok.test(e.type)).map((e) => e.hash);
    const tx = this.db.transaction(["meta", "thumbs"], "readwrite");
    for (const h of drop) tx.objectStore("thumbs").delete(h);
    tx.objectStore("meta").put(2, KEY);
    await done(tx);
  }

  renameAssets(changes: ReadonlyArray<{ hash: string; name: string }>): Promise<number> {
    return this.lib.serial(async () => {
      const { entries } = await this.lib.rows(changes.map((c) => c.hash));
      const ops: LibraryOp[] = [];
      for (const c of changes) {
        const name = cleanFileName(c.name);
        if (!name) throw new CatalogInputError("a name cannot be empty");
        const e = entries.get(c.hash);
        if (!e || e.state !== "active" || e.name === name) continue;
        const next = { ...e, name };
        entries.set(c.hash, next);
        ops.push(putEntry(next));
      }
      await this.lib.apply(ops);
      return ops.length;
    });
  }

  async lock(kind: PasswordKind): Promise<string | null> {
    return (await idbGet<string>(this.db, "meta", `${kind}Lock`)) ?? null;
  }

  async setLock(kind: PasswordKind, lock: string | null): Promise<void> {
    const tx = this.db.transaction("meta", "readwrite", { durability: "strict" });
    if (lock === null) tx.objectStore("meta").delete(`${kind}Lock`);
    else tx.objectStore("meta").put(lock, `${kind}Lock`);
    await done(tx);
  }

  healTags(): Promise<void> {
    return this.lib.serial(async () => {
      if (((await this.lib.calls.meta("tagFormat")) as number | null) ?? 0) return;
      const ops: LibraryOp[] = [];
      for (const e of await this.lib.entries()) {
        const tags = e.tags ?? [];
        if (!tags.length) continue;
        let next: string[];
        try {
          next = formatTags(tags);
        } catch {
          next = tags;
        }
        if (next.length !== tags.length || next.some((t, i) => t !== tags[i])) ops.push(putEntry({ ...e, tags: next }));
      }
      await this.lib.apply([...ops, { t: "meta", k: "tagFormat", v: 1 }]);
    });
  }

  async putThumb(rec: ThumbRecord): Promise<void> {
    // Not for an item erased in the meantime: nothing would ever remove it.
    const e = await this.lib.entry(rec.hash);
    if (!e) return;
    let put: ThumbRecord & { sealed?: string } = rec;
    if (e.hidden) {
      if (!this.vault?.isOpen()) return;
      put = { ...rec, blob: new Blob([await this.vault.seal(new Uint8Array(await rec.blob.arrayBuffer()), {})]), sealed: rec.blob.type };
    }
    const tx = this.db.transaction("thumbs", "readwrite");
    tx.objectStore("thumbs").put(put);
    await done(tx);
  }

  async relist(prev: CatalogListing): Promise<CatalogListing | null> {
    const folders = listedFolders(await this.lib.folders());
    const entries = await this.lib.entries();
    const was = new Map(prev.entries.map((e) => [e.hash, e]));
    const active = entries.filter((e) => e.state === "active");
    if (active.length !== prev.entries.length) return null;
    const out: CatalogListing["entries"] = [];
    for (const e of active) {
      const p = was.get(e.hash);
      if (!p) return null;
      out.push({ ...e, instances: p.instances, canvases: p.canvases, canvasIds: p.canvasIds, present: p.present });
    }
    return { entries: out, missing: prev.missing, pendingDeletion: entries.length - active.length, ...folders };
  }

  async list(): Promise<CatalogListing> {
    // (which files are there is looked at in the main process: the records of a million files never come here)
    const [folders, entries, absent] = await Promise.all([this.lib.folders(), this.lib.entries(), this.lib.calls.absent()]);
    const usage = await this.usage();
    // (originals whose bytes the page's storage still holds: an import's, not written out yet)
    const held = new Set((await req(this.db.transaction("assets", "readonly").objectStore("assets").getAllKeys())) as string[]);
    const gone = new Set(absent);
    const present = (h: string): boolean => held.has(h) || !gone.has(h);
    const known = new Set(entries.map((e) => e.hash));
    return {
      entries: entries.filter((e) => e.state === "active").map((e) => ({ ...e, ...usageOf(usage, e.hash), present: present(e.hash) })),
      missing: [...usage.keys()].filter((h) => !held.has(h) && !known.has(h)).map((hash) => ({ hash, ...usageOf(usage, hash) })),
      pendingDeletion: entries.filter((e) => e.state === "deleted").length,
      ...listedFolders(folders),
    };
  }

  readonly pages: LibraryPages = {
    query: (q) => this.lib.calls.query(q),
    counts: (hidden) => this.lib.calls.counts(hidden),
    fieldKeys: () => this.lib.calls.fieldKeys(),
    listed: (hashes) => this.lib.calls.listed(hashes),
    folders: () => this.lib.folders(),
    usage: () => this.usage(),
  };

  /** How many stored instances use each item, and on which canvases (keys only). */
  private async usage(): Promise<Map<string, { instances: number; canvases: Set<string> }>> {
    const usage = new Map<string, { instances: number; canvases: Set<string> }>();
    const tx = this.db.transaction("objects", "readonly");
    await new Promise<void>((resolve, reject) => {
      const cur = tx.objectStore("objects").index("assetId").openKeyCursor();
      cur.onerror = () => reject(cur.error);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve();
        const hash = c.key as string;
        let u = usage.get(hash);
        if (!u) usage.set(hash, (u = { instances: 0, canvases: new Set() }));
        u.instances++;
        u.canvases.add((c.primaryKey as [string, string])[0]);
        c.continue();
      };
    });
    return usage;
  }

  private async uses(hash: string): Promise<number> {
    return req(this.db.transaction("objects", "readonly").objectStore("objects").index("assetId").count(hash));
  }

  async updateMeta(hash: string, change: MetaChange): Promise<CatalogEntry> {
    return (await this.updateMetaEach([{ hash, change }]))[0]!;
  }

  /** (`AssetCatalog.updateMetaEach`: all or nothing.) */
  updateMetaEach(changes: ReadonlyArray<{ hash: string; change: MetaChange }>): Promise<CatalogEntry[]> {
    return this.lib.serial(async () => {
      let folders: AssetFolder[] | null = changes.some(({ change: c }) => c.addFolders || c.removeFolders || c.clearFolder || c.hidden === false) ? await this.lib.folders() : null;
      const known = changes.some(({ change: c }) => c.addFolders || c.removeFolders || c.clearFolder) ? new Set(folders!.map((f) => f.id)) : null;
      const { entries } = await this.lib.rows(changes.map((c) => c.hash));
      const out: CatalogEntry[] = [];
      let unhid = false;
      for (const { hash, change } of changes) {
        const e = entries.get(hash);
        if (!e || e.state !== "active") throw new CatalogInputError("the item is not in the library");
        const m = meta(e);
        const next: CatalogEntry = { ...e, ...m };
        if (change.favorite !== undefined) next.favorite = change.favorite;
        if (change.thumb !== undefined) next.thumb = change.thumb;
        if (change.hidden !== undefined) next.hidden = change.hidden;
        // Shown again from a hidden folder: that folder and the ones above it are shown again too (their other items stay hidden).
        if (change.hidden === false && m.folderIds.length) {
          folders ??= await this.lib.folders();
          const byId = new Map(folders.map((f) => [f.id, f]));
          for (let f = byId.get(m.folderIds[0]!); f; f = f.parentId ? byId.get(f.parentId) : undefined) if (f.hidden) (delete f.hidden, (unhid = true));
        }
        if (change.note !== undefined) next.note = normalizeNote(change.note);
        if (change.fields !== undefined) next.fields = normalizeFields(change.fields);
        if (!next.note) delete next.note;
        if (!next.fields?.length) delete next.fields;
        if (change.addTags || change.removeTags) {
          const drop = new Set((change.removeTags ?? []).map((t) => t.toLowerCase()));
          next.tags = normalizeTags([...m.tags.filter((t) => !drop.has(t.toLowerCase())), ...(change.addTags ?? [])]);
        }
        if (known) {
          if ((change.addFolders ?? []).some((id) => !known.has(id))) throw new CatalogInputError("that folder no longer exists");
          const drop = new Set(change.removeFolders ?? []);
          const added = change.addFolders ?? [];
          if (change.addFolders || change.removeFolders || change.clearFolder) next.folderIds = change.clearFolder ? [] : added.length ? [added[added.length - 1]!] : m.folderIds.filter((id) => !drop.has(id));
          // Filed into a hidden folder: hidden with it.
          if (added.length && !next.hidden && inHiddenFolder(folders!, next.folderIds![0]!)) next.hidden = true;
        }
        entries.set(hash, next);
        out.push(next);
      }
      await this.lib.apply([...out.map(putEntry), ...(unhid ? [putFolders(folders!)] : [])]);
      return out;
    });
  }

  hideFolder(id: string): Promise<number> {
    return this.lib.serial(async () => {
      const folders = await this.lib.folders();
      if (!folders.some((f) => f.id === id)) throw new CatalogInputError("that folder no longer exists");
      const inside = folderSubtree(folders, id);
      const ops: LibraryOp[] = [putFolders(folders.map((f) => (inside.has(f.id) ? { ...f, hidden: true as const } : f)))];
      let n = 0;
      for (const e of await this.lib.entries("active")) {
        if (e.hidden || !(e.folderIds ?? []).some((x) => inside.has(x))) continue;
        ops.push(putEntry({ ...e, hidden: true }));
        n++;
      }
      await this.lib.apply(ops);
      return n;
    });
  }

  /** (`AssetCatalog.showFolder`.) */
  showFolder(id: string): Promise<number> {
    return this.lib.serial(async () => {
      const all = await this.lib.folders();
      if (!all.some((f) => f.id === id)) throw new CatalogInputError("that folder no longer exists");
      const { folders, inside } = unhiddenFolders(all, id);
      const ops: LibraryOp[] = [putFolders(folders)];
      for (const e of await this.lib.entries("hidden")) {
        if (e.state !== "active" || !(e.folderIds ?? []).some((x) => inside.has(x))) continue;
        ops.push(putEntry({ ...e, hidden: false }));
      }
      await this.lib.apply(ops);
      return ops.length - 1;
    });
  }

  renameTag(from: string, to: string): Promise<number> {
    const target = formatTag(to);
    if (!target) return Promise.reject(new CatalogInputError("a tag needs a name"));
    const key = from.toLowerCase();
    return this.lib.serial(async () => {
      const ops: LibraryOp[] = [];
      for (const e of await this.lib.entries("active")) {
        if (!(e.tags ?? []).some((t) => tagIsOrUnder(t, key))) continue;
        ops.push(putEntry({ ...e, tags: normalizeTags((e.tags ?? []).map((t) => renamedTag(t, key, target) ?? t)) }));
      }
      await this.lib.apply(ops);
      return ops.length;
    });
  }

  deleteTag(tag: string): Promise<number> {
    const key = tag.toLowerCase();
    return this.lib.serial(async () => {
      const ops: LibraryOp[] = [];
      for (const e of await this.lib.entries("active")) {
        if (!(e.tags ?? []).some((t) => t.toLowerCase() === key)) continue;
        ops.push(putEntry({ ...e, tags: (e.tags ?? []).filter((t) => t.toLowerCase() !== key) }));
      }
      await this.lib.apply(ops);
      return ops.length;
    });
  }

  createFolder(name: string, parentId: string | null, id: string): Promise<AssetFolder> {
    return this.lib.serial(async () => {
      const folders = await this.lib.folders();
      if (parentId && !folders.some((f) => f.id === parentId)) throw new CatalogInputError("the parent folder no longer exists");
      const f: AssetFolder = { id, name: folderName(name), parentId, ...(parentId && inHiddenFolder(folders, parentId) ? { hidden: true as const } : {}) };
      await this.lib.apply([putFolders([...folders, f])]);
      return f;
    });
  }

  renameFolder(id: string, name: string): Promise<void> {
    return this.lib.serial(async () => {
      const folders = await this.lib.folders();
      const f = folders.find((x) => x.id === id);
      if (!f) throw new CatalogInputError("that folder no longer exists");
      f.name = folderName(name);
      await this.lib.apply([putFolders(folders)]);
    });
  }

  deleteFolder(id: string): Promise<{ folders: number; unfiled: number }> {
    return this.lib.serial(async () => {
      const folders = await this.lib.folders();
      const gone = folderSubtree(folders, id);
      const ops: LibraryOp[] = [putFolders(folders.filter((f) => !gone.has(f.id)))];
      for (const e of await this.lib.entries()) {
        const ids = e.folderIds ?? [];
        if (ids.some((x) => gone.has(x))) ops.push(putEntry({ ...e, folderIds: ids.filter((x) => !gone.has(x)) }));
      }
      await this.lib.apply(ops);
      return { folders: gone.size, unfiled: ops.length - 1 };
    });
  }

  async hiddenHashes(): Promise<Set<string>> {
    return new Set((await this.lib.entries("hidden")).flatMap((e) => (e.state === "active" ? [e.hash] : [])));
  }

  entry(hash: string): Promise<CatalogEntry | undefined> {
    return this.lib.entry(hash);
  }

  /** Every stored instance of an item, grouped by canvas (in key order). */
  async locations(hash: string): Promise<AssetLocation[]> {
    const tx = this.db.transaction("objects", "readonly");
    const keys = (await req(tx.objectStore("objects").index("assetId").getAllKeys(hash))) as unknown as Array<[string, string]>;
    const by = new Map<string, string[]>();
    for (const [canvasId, id] of keys) (by.get(canvasId) ?? by.set(canvasId, []).get(canvasId)!).push(id);
    return [...by].map(([canvasId, ids]) => ({ canvasId, ids }) as AssetLocation);
  }

  /** Every original without an entry gets one (a record here, or bytes still in the page's storage). */
  reconcile(): Promise<number> {
    return this.lib.serial(async () => {
      const ops: LibraryOp[] = [];
      const known = new Set<string>();
      // Records with no entry: the library saves the two together, so only one moved in from the page's storage can lack it (looked at once).
      if (!(await this.lib.calls.meta("orphansChecked"))) {
        for (const r of JSON.parse(await this.lib.calls.orphans()) as AssetRecord[]) (known.add(r.hash), ops.push(putEntry(entryFromRecord(r))));
        ops.push({ t: "meta", k: "orphansChecked", v: 1 });
      }
      const tx = this.db.transaction("assets", "readonly");
      const held = (await req(tx.objectStore("assets").getAllKeys())) as string[];
      for (const k of (await this.lib.rows(held)).entries.keys()) known.add(k);
      for (const k of held) {
        if (known.has(k)) continue;
        const r = await idbGet<AssetRecord>(this.db, "assets", k);
        if (r) (known.add(k), ops.push(putEntry(entryFromRecord({ ...r, hash: k }))));
      }
      await this.lib.apply(ops);
      return ops.length;
    });
  }

  /**
   * An undo snapshot that copies nothing now: from here on, the first change to each entry records what it was (`DesktopLibrary.apply`).
   * A library of a million items is not read for each edit. (`entries` holds only those changed since.)
   */
  async snapshotMeta(): Promise<MetaSnapshot> {
    const journal = this.lib.journal();
    const entries = new Map<string, SnapEntry>();
    const snap: JournalSnapshot = { journal, folders: await this.lib.folders(), get entries() {
      entries.clear();
      for (const [h, v] of journal) if (v) entries.set(h, v);
      return entries;
    } };
    return snap;
  }

  restoreMeta(s: MetaSnapshot): Promise<number> {
    return this.lib.serial(async () => {
      const ops: LibraryOp[] = [];
      const { entries } = await this.lib.rows([...s.entries.keys()]);
      for (const e of entries.values()) {
        if (e.state !== "active") continue;
        const was = s.entries.get(e.hash);
        if (!was) continue;
        if (JSON.stringify({ name: e.name, ...meta(e) }) === JSON.stringify(was)) continue;
        const next: CatalogEntry = { ...e, ...was };
        if (!next.note) delete next.note;
        if (!next.fields?.length) delete next.fields;
        ops.push(putEntry(next));
      }
      await this.lib.apply([...ops, putFolders(s.folders)]);
      return ops.length;
    });
  }

  markDeletedEach(hashes: readonly string[]): Promise<{ gone: string[]; inUse: number }> {
    return this.lib.serial(async () => {
      const { entries } = await this.lib.rows(hashes);
      const gone: string[] = [];
      let inUse = 0;
      const ops: LibraryOp[] = [];
      for (const hash of hashes) {
        if ((await this.uses(hash)) > 0) {
          inUse++;
          continue;
        }
        const e = entries.get(hash);
        if (!e) continue;
        ops.push(putEntry({ ...e, state: "deleted", deletedAt: Date.now() }));
        gone.push(hash);
      }
      await this.lib.apply(ops);
      return { gone, inUse };
    });
  }

  markDeleted(hash: string): Promise<void> {
    return this.lib.serial(async () => {
      const n = await this.uses(hash);
      if (n > 0) throw new AssetInUseError(hash, n);
      const e = await this.lib.entry(hash);
      if (!e) throw new Error(`item ${hash} is not in the library`);
      await this.lib.apply([putEntry({ ...e, state: "deleted", deletedAt: Date.now() })]);
    });
  }

  /** (`AssetCatalog.collect`.) A deleted item used again comes back; one no root needs loses its entry, record, thumbnail and file. */
  collect(roots: ReadonlySet<string>): Promise<GcReport> {
    return this.lib.serial(async () => {
      const report: GcReport = { swept: [], bytesFreed: 0, retained: [], restored: [] };
      const deleted = await this.lib.entries("deleted");
      const { recs } = await this.lib.rows(deleted.map((e) => e.hash));
      const ops: LibraryOp[] = [];
      const files = new Map<string, string>();
      for (const e of deleted) {
        if ((await this.uses(e.hash)) > 0) {
          ops.push(putEntry({ ...e, state: "active", deletedAt: null }));
          report.restored.push(e.hash);
        } else if (roots.has(e.hash)) {
          report.retained.push(e.hash);
        } else {
          const r = recs.get(e.hash);
          if (r?.ext) files.set(e.hash, r.file ?? e.hash);
          ops.push({ t: "entry", hash: e.hash, v: null }, { t: "rec", hash: e.hash, v: null }, { t: "seen", hash: e.hash, v: null });
          report.swept.push(e.hash);
          report.bytesFreed += e.size;
        }
      }
      await this.lib.apply(ops);
      if (report.swept.length) {
        const tx = this.db.transaction(["assets", "thumbs"], "readwrite", { durability: "strict" });
        for (const h of report.swept) (tx.objectStore("assets").delete(h), tx.objectStore("thumbs").delete(h));
        await done(tx);
      }
      for (const h of report.swept) if (files.has(h)) await externalFolder.remove(h, files.get(h));
      return report;
    });
  }
}

/** The originals of the desktop build (`IdbOriginals` on the library): files of the workspace folder, each named by its record. */
export class DesktopOriginals implements OriginalStore {
  onNotice: ((text: string) => void) | null = null;

  constructor(
    private readonly db: IDBDatabase,
    private readonly lib: DesktopLibrary,
    private readonly catalog: DesktopCatalog,
  ) {}

  /** A record here, or (bytes an import has not written out yet) in the page's storage. */
  private async recOf(hash: string): Promise<AssetRecord | undefined> {
    return (await this.lib.rec(hash)) ?? (await idbGet<AssetRecord>(this.db, "assets", hash).catch(() => undefined));
  }

  async get(hash: string): Promise<AssetRecord | undefined> {
    const [row] = await this.lib.calls.get([hash]);
    let rec = row?.[2] ?? (await idbGet<AssetRecord>(this.db, "assets", hash).catch(() => undefined));
    if (!rec) return rec;
    if (rec.ext && rec.size > MAX_IMPORT_BYTES) {
      // Too big to read into the page (a card, opened in the system's app): only whether its file is there.
      if (!(await externalFolder.hasMany([{ hash, size: rec.size, file: rec.file }]))[0]) return undefined;
      rec = { ...rec, blob: new Blob([]) };
    } else if (rec.ext) {
      const blob = await externalFolder.read(hash, rec.size, rec.type, rec.file);
      if (!blob) return undefined;
      rec = { ...rec, blob };
    }
    // The name is the entry's: renaming an item changes its entry, never the stored bytes.
    const entry = row?.[1];
    return entry && entry.name !== rec.name ? { ...rec, name: entry.name } : rec;
  }

  async locked(hash: string): Promise<boolean> {
    if (!externalFolder.unseal || externalFolder.unseal.ready()) return false;
    const rec = await this.recOf(hash);
    return !!rec?.ext && isHiddenFile(rec.file);
  }

  async fileOf(hash: string): Promise<string | null> {
    const rec = await this.recOf(hash);
    return rec?.ext && rec.file && !isHiddenFile(rec.file) ? rec.file : null;
  }

  async entryState(hash: string): Promise<CatalogEntry["state"] | undefined> {
    return (await this.lib.entry(hash))?.state;
  }

  /** Write the original into the workspace folder (when new), then its record and entry, as one change (`IdbOriginals.put`). */
  async put(record: AssetRecord, writeBytes: boolean): Promise<void> {
    const toFolder = writeBytes && externalFolder.ready;
    const kept = toFolder && !record.ext && record.file ? record.file : "";
    const file = kept || (toFolder ? await externalFolder.fileFor(record.hash, record.name, record.type) : "");
    if (toFolder && !kept) {
      try {
        await externalFolder.write(record.hash, record.blob, file);
      } catch (err) {
        externalFolder.release(file);
        throw new ImportError((err as Error).message);
      }
    }
    try {
      if (writeBytes && !toFolder) {
        // (no folder to write to: kept in the page's storage until the next write of the library puts it there)
        const tx = this.db.transaction("assets", "readwrite", { durability: "strict" });
        tx.objectStore("assets").put(record, record.hash);
        await done(tx);
      }
      await this.lib.serial(async () => {
        const e = await this.lib.entry(record.hash);
        const ops: LibraryOp[] = [];
        if (toFolder) ops.push({ t: "rec", hash: record.hash, v: storedStub({ ...record, blob: new Blob([]), ext: 1, file }) });
        if (!e) ops.push(putEntry(entryFromRecord(record)));
        else if (e.state !== "active") ops.push(putEntry({ ...e, state: "active", deletedAt: null }));
        await this.lib.apply(ops);
      });
    } finally {
      if (file && !kept) externalFolder.release(file);
    }
  }

  putThumb(rec: ThumbRecord): Promise<void> {
    return this.catalog.putThumb(rec);
  }
}

/** The library's own keys of the page's storage (`meta`), moved with it. */
const MOVED_META = [FOLDERS_KEY, "hiddenBlanked", "hiddenNoWait", "libraryMoving", "tagFormat"];

/**
 * Once, when this device first opens the workspace with its library in SQLite (0.51): what the page's storage held of the library
 * moves there (the entries, the records of files, the library folders and this device's marks of what it last saw in the folder), so
 * nothing this device had not written to the folder yet is lost. Bytes an import has not written out stay where they are. How many items.
 */
export async function moveIdbLibrary(db: IDBDatabase, lib: DesktopLibrary): Promise<number> {
  if ((await lib.calls.meta("fromIdb")) !== null) return 0;
  const tx = db.transaction(["assetCatalog", "assets", "meta"], "readonly");
  const entries = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
  const stubKeys = (await req(tx.objectStore("assets").index("ext").getAllKeys())) as string[];
  const stubs = (await req(tx.objectStore("assets").index("ext").getAll())) as AssetRecord[];
  const meta = tx.objectStore("meta");
  const metas = await Promise.all(MOVED_META.map((k) => req(meta.get(k) as IDBRequest<unknown>)));
  const state = (await req(meta.get("libraryMirror") as IDBRequest<{ folders?: string; items?: Record<string, string> } | undefined>)) ?? {};
  const parts = (await req(meta.getAll(IDBKeyRange.bound("libraryPart:", "libraryPart:￿")) as IDBRequest<Array<Record<string, string>>>)) ?? [];
  const seen: Record<string, string> = Object.assign({}, state.items ?? {}, ...parts);
  const ops: LibraryOp[] = [
    ...entries.map(putEntry),
    ...stubs.map((r, i): LibraryOp => ({ t: "rec", hash: stubKeys[i]!, v: { ...r, hash: stubKeys[i]! } })),
    ...Object.entries(seen).flatMap(([hash, v]): LibraryOp[] => (/^[0-9a-f]{64}$/.test(hash) ? [{ t: "seen", hash, v }] : [])),
  ];
  for (let at = 0; at < ops.length; at += 5000) await lib.apply(ops.slice(at, at + 5000));
  await lib.apply([
    ...MOVED_META.flatMap((k, i): LibraryOp[] => (metas[i] === undefined ? [] : [{ t: "meta", k, v: metas[i] }])),
    { t: "meta", k: "libraryMirror", v: { folders: state.folders ?? "" } },
    // (a library made from the folder's files has its tags formatted already: read through `readItem`)
    ...(metas[MOVED_META.indexOf("tagFormat")] === undefined && !entries.length ? [{ t: "meta", k: "tagFormat", v: 1 } as LibraryOp] : []),
    { t: "meta", k: "fromIdb", v: 1 }, // (last: a stop before it moves it all again, the same)
  ]);
  // The page's copies go (the library's own storage has them now); bytes waiting to be written out stay.
  const wtx = db.transaction(["assetCatalog", "assets", "meta"], "readwrite", { durability: "strict" });
  wtx.objectStore("assetCatalog").clear();
  for (const k of stubKeys) wtx.objectStore("assets").delete(k);
  for (const k of [...MOVED_META, "libraryMirror"]) wtx.objectStore("meta").delete(k);
  wtx.objectStore("meta").delete(IDBKeyRange.bound("libraryPart:", "libraryPart:￿"));
  await done(wtx);
  return entries.length;
}

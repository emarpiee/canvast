import { externalFolder } from "../storage/external-folder";
import type { ObjectId } from "../doc/model";
import { plural } from "../doc/plural";
import { cleanFileName } from "../doc/rename-rules";
import { isCard } from "./file-kind";
import { formatTag, formatTags, renamedTag, tagIsOrUnder } from "../doc/tags";
import { done, req } from "../storage/idb";
import type { AssetRecord } from "./asset-library";
import type { CatalogStore } from "../storage/store";

/**
 * The workspace's shared asset catalog (ADR 0007).
 *
 * Three things are kept apart:
 *   - the original bytes, `assets[hash]` (content-addressed, stored once);
 *   - the catalog entry, `assetCatalog[hash]` (metadata only, so listing the
 *     library never loads bytes);
 *   - placed instances, the image objects on canvases that name the hash in
 *     `data.assetId`. They are found through the `objects.assetId` index, so
 *     usage is always derived from the stored objects and never from a counter
 *     that could drift.
 *
 * Originals are only ever erased by the mark-and-sweep `collect`, and only
 * when the user has deleted the asset from the library, no stored instance
 * references it, and the caller's live roots (open document, undo/redo
 * history, unsaved changes) do not either. Deleting instances, canvases or
 * boards never erases an original.
 */
export type CatalogState = "active" | "deleted";

export interface CatalogEntry {
  hash: string;
  name: string;
  type: string;
  size: number;
  pixelW: number;
  pixelH: number;
  importedAt: number;
  /** Kept as a card: the browser cannot show this file (ADR 0078). */
  card?: boolean;
  state: CatalogState;
  deletedAt: number | null;
  /** Organization (ADR 0011). Absent on entries written before v0.6.0: read through `meta()`. */
  tags?: string[];
  favorite?: boolean;
  /** Kept out of every list, search and picker except the Hidden scope of the library (for a workspace shown in public). Not encrypted (yet). */
  hidden?: boolean;
  /** The folder the asset is filed in: at most one (older libraries may hold several; the first counts). Filing never copies the original. */
  folderIds?: string[];
  /** A plain-text note (no Markdown). Absent when empty. */
  note?: string;
  /** Fields the user names (a link, a source, an author...), in their order. Absent when there are none. */
  fields?: AssetField[];
}

/** A user-named field of an asset: any key, any value, both plain text. */
export interface AssetField {
  key: string;
  value: string;
}

/** A library folder. Order is by name; nesting by `parentId`. */
export interface AssetFolder {
  id: string;
  name: string;
  parentId: string | null;
}

/** Organization fields of an entry, with defaults for entries that predate them. */
export function meta(e: CatalogEntry): { tags: string[]; favorite: boolean; hidden: boolean; folderIds: string[]; note: string; fields: AssetField[] } {
  return { tags: e.tags ?? [], favorite: e.favorite ?? false, hidden: e.hidden ?? false, folderIds: (e.folderIds ?? []).slice(0, 1), note: e.note ?? "", fields: e.fields ?? [] };
}

export class CatalogInputError extends Error {}

const MAX_TAGS = 100;
const MAX_FOLDER_NAME = 120;
export const MAX_NOTE = 20_000;
export const MAX_FIELDS = 50;
export const MAX_FIELD_KEY = 64;
export const MAX_FIELD_VALUE = 2_000;

/** A note as stored: line ends made `\n`, the ends trimmed. */
export function normalizeNote(note: string): string {
  const n = note.replace(/\r\n?/g, "\n").trim();
  if (n.length > MAX_NOTE) throw new CatalogInputError(`a note can be at most ${MAX_NOTE} characters`);
  return n;
}

/** Fields as stored: keys on one line and trimmed, values trimmed; a field with neither a key nor a value is dropped. */
export function normalizeFields(fields: readonly AssetField[]): AssetField[] {
  const out = fields
    .map((f) => ({ key: f.key.replace(/\s+/g, " ").trim(), value: f.value.replace(/\r\n?/g, "\n").trim() }))
    .filter((f) => f.key || f.value);
  if (out.length > MAX_FIELDS) throw new CatalogInputError(`an item can have at most ${MAX_FIELDS} fields`);
  if (out.some((f) => f.key.length > MAX_FIELD_KEY)) throw new CatalogInputError(`a field name can be at most ${MAX_FIELD_KEY} characters`);
  if (out.some((f) => f.value.length > MAX_FIELD_VALUE)) throw new CatalogInputError(`a field value can be at most ${MAX_FIELD_VALUE} characters`);
  return out;
}

/** Format tags the way Obsidian does (ADR 0084) and drop repeats that differ only in case (the first spelling wins). */
export function normalizeTags(tags: readonly string[]): string[] {
  const out = formatTags(tags);
  if (out.length > MAX_TAGS) throw new CatalogInputError(`an item can have at most ${MAX_TAGS} tags`);
  return out;
}

function folderName(name: string): string {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n) throw new CatalogInputError("a folder needs a name");
  if (n.length > MAX_FOLDER_NAME) throw new CatalogInputError(`a folder name can be at most ${MAX_FOLDER_NAME} characters`);
  return n;
}

/** Ids of `id` and every folder below it. */
export function folderSubtree(folders: readonly AssetFolder[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) (out.add(f.id), (grew = true));
  }
  return out;
}

/** Folder name path from the top, e.g. ["Refs", "Hands"]. */
export function folderPath(folders: readonly AssetFolder[], id: string): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: string[] = [];
  for (let f = byId.get(id); f && path.length < 64; f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f.name);
  return path;
}

/** The `meta` key of the library folders. */
export const FOLDERS_KEY = "assetFolders";

export interface Usage {
  /** Stored image instances that reference the asset, across all canvases. */
  instances: number;
  /** Distinct canvases holding those instances. */
  canvases: number;
}

export interface CatalogListing {
  /** Active library entries, with usage and whether the original bytes are present. */
  entries: Array<CatalogEntry & Usage & { present: boolean }>;
  /** Hashes referenced by stored instances with no original bytes stored. */
  missing: Array<{ hash: string } & Usage>;
  /** Entries deleted by the user but still retained (needed by undo history). */
  pendingDeletion: number;
  folders: AssetFolder[];
}

export interface AssetLocation {
  canvasId: string;
  ids: ObjectId[];
}

export interface GcReport {
  /** Originals erased (deleted by the user, unreferenced, unrooted). */
  swept: string[];
  bytesFreed: number;
  /** Deleted by the user but still needed by live roots (undo history): kept. */
  retained: string[];
  /** Deleted by the user but referenced by a stored instance again: restored to the library. */
  restored: string[];
}

export class AssetInUseError extends Error {
  constructor(
    readonly hash: string,
    readonly instances: number,
  ) {
    super(`the item is still used by ${plural(instances, "instance")}; remove ${instances === 1 ? "it" : "them"} first`);
  }
}

export function entryFromRecord(r: AssetRecord): CatalogEntry {
  return {
    hash: r.hash,
    name: r.name,
    type: r.type,
    size: r.size,
    pixelW: r.pixelW,
    pixelH: r.pixelH,
    importedAt: r.importedAt,
    ...(r.card ? { card: true } : {}),
    state: "active",
    deletedAt: null,
    tags: [],
    favorite: false,
    folderIds: [],
  };
}

const usageOf = (m: Map<string, { instances: number; canvases: Set<string> }>, hash: string): Usage => {
  const u = m.get(hash);
  return { instances: u?.instances ?? 0, canvases: u?.canvases.size ?? 0 };
};

/** A persisted lower-quality thumbnail of an asset (derived data: never hashed, regenerated from the original when missing). */
export interface ThumbRecord {
  hash: string;
  blob: Blob;
  w: number;
  h: number;
}

/** What organizing can change, for undo: each active asset's name, tags, favourite flag and folder, and the folders. */
export interface MetaSnapshot {
  readonly entries: ReadonlyMap<string, { name: string } & ReturnType<typeof meta>>;
  readonly folders: AssetFolder[];
}

/** A change to an asset's tags, favourite flag, folder, note or fields. */
export interface MetaChange {
  /** The whole note (it replaces the stored one). */
  note?: string;
  /** All the fields, in order (they replace the stored ones). */
  fields?: readonly AssetField[];
  favorite?: boolean;
  hidden?: boolean;
  addTags?: readonly string[];
  removeTags?: readonly string[];
  addFolders?: readonly string[];
  removeFolders?: readonly string[];
  clearFolder?: boolean;
}

/** The two passwords: of the Hidden items, and of the whole workspace (asked when the app opens). */
export type PasswordKind = "hidden" | "workspace";

export class AssetCatalog implements CatalogStore {
  constructor(readonly db: IDBDatabase) {}

  async thumbHashes(): Promise<string[]> {
    const tx = this.db.transaction("thumbs", "readonly");
    return (await req(tx.objectStore("thumbs").getAllKeys())) as string[];
  }

  async thumb(hash: string): Promise<ThumbRecord | undefined> {
    const tx = this.db.transaction("thumbs", "readonly");
    return req(tx.objectStore("thumbs").get(hash) as IDBRequest<ThumbRecord | undefined>);
  }

  /**
   * Thumbnails are derived data. Version 2 (ADR 0078): a picture the browser cannot decode at a size (an SVG, say) once got a file card as its
   * thumbnail; those thumbnails are dropped once, so the library shows the picture itself again. Only types that always decode are kept.
   */
  async healThumbs(): Promise<void> {
    const KEY = "thumbVersion";
    const tx = this.db.transaction(["meta", "thumbs", "assetCatalog"], "readwrite");
    const committed = done(tx);
    tx.objectStore("meta").delete("assetSmartFolders"); // smart folders were removed (ADR 0082)
    const v = await req(tx.objectStore("meta").get(KEY) as IDBRequest<number | undefined>);
    if ((v ?? 1) < 2) {
      const ok = /^(image\/(png|jpeg|webp|gif|avif|bmp)|video\/|audio\/)/;
      const entries = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
      for (const e of entries) if (!ok.test(e.type)) tx.objectStore("thumbs").delete(e.hash);
      tx.objectStore("meta").put(2, KEY);
    }
    await committed;
  }

  /**
   * Rename assets (ADR 0085): the catalog entry's name changes; the stored original is untouched. A file shown as a card has its name and
   * extension in its picture, so its thumbnail is dropped and made again. Returns how many names changed.
   */
  async renameAssets(changes: ReadonlyArray<{ hash: string; name: string }>): Promise<number> {
    return this.write(["assetCatalog", "thumbs"], async (tx) => {
      let n = 0;
      for (const c of changes) {
        const name = cleanFileName(c.name);
        if (!name) throw new CatalogInputError("a name cannot be empty");
        const e = await req(tx.objectStore("assetCatalog").get(c.hash) as IDBRequest<CatalogEntry | undefined>);
        if (!e || e.state !== "active" || e.name === name) continue;
        tx.objectStore("assetCatalog").put({ ...e, name });
        n++;
      }
      return n;
    });
  }

  /** The kept form of a password (assets/hidden-lock.ts): the Hidden items' or the whole workspace's, or null when there is none. Stays in this browser: no archive carries it unless the person chose to. */
  async lock(kind: PasswordKind): Promise<string | null> {
    const tx = this.db.transaction(["meta"], "readonly");
    return (await req(tx.objectStore("meta").get(`${kind}Lock`) as IDBRequest<string | undefined>)) ?? null;
  }

  async setLock(kind: PasswordKind, lock: string | null): Promise<void> {
    await this.write(["meta"], async (tx) => {
      if (lock === null) tx.objectStore("meta").delete(`${kind}Lock`);
      else tx.objectStore("meta").put(lock, `${kind}Lock`);
    });
  }

  /** Tags stored in an older form (spaces, punctuation) are formatted once the way Obsidian writes them (ADR 0084). */
  async healTags(): Promise<void> {
    const tx = this.db.transaction(["assetCatalog", "meta"], "readwrite");
    const committed = done(tx);
    const v = await req(tx.objectStore("meta").get("tagFormat") as IDBRequest<number | undefined>);
    if ((v ?? 0) < 1) {
      const all = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
      for (const e of all) {
        const tags = e.tags ?? [];
        if (!tags.length) continue;
        let next: string[];
        try {
          next = formatTags(tags);
        } catch {
          next = tags;
        }
        if (next.length !== tags.length || next.some((t, i) => t !== tags[i])) tx.objectStore("assetCatalog").put({ ...e, tags: next });
      }
      tx.objectStore("meta").put(1, "tagFormat");
    }
    await committed;
  }

  /** False in the desktop build, where a hidden item is encrypted: its thumbnail is made in memory only, never stored (ADR 0177). */
  keepHiddenThumbs = true;

  /** Store a thumbnail. Derived data, so any tab may write it, and a failure only means it is made again next time. */
  async putThumb(rec: ThumbRecord): Promise<void> {
    const tx = this.db.transaction(["thumbs", "assetCatalog"], "readwrite");
    const committed = done(tx);
    // Not for an asset erased in the meantime: nothing would ever remove it.
    const e = await req(tx.objectStore("assetCatalog").get(rec.hash) as IDBRequest<CatalogEntry | undefined>);
    if (e && (this.keepHiddenThumbs || !e.hidden)) tx.objectStore("thumbs").put(rec);
    await committed;
  }

  /**
   * The library again after a change to its organization only (names, tags, folders, flags): usage and whether each original is
   * present are taken from `prev`, so neither the objects nor the originals are gone through. Null when items came or went (use list()).
   */
  async relist(prev: CatalogListing): Promise<CatalogListing | null> {
    const tx = this.db.transaction(["assetCatalog", "meta"], "readonly");
    const folders = ((await req(tx.objectStore("meta").get(FOLDERS_KEY) as IDBRequest<AssetFolder[] | undefined>)) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const entries = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
    const was = new Map(prev.entries.map((e) => [e.hash, e]));
    const active = entries.filter((e) => e.state === "active");
    if (active.length !== prev.entries.length) return null;
    const out: CatalogListing["entries"] = [];
    for (const e of active) {
      const p = was.get(e.hash);
      if (!p) return null;
      out.push({ ...e, instances: p.instances, canvases: p.canvases, present: p.present });
    }
    return { entries: out, missing: prev.missing, pendingDeletion: entries.filter((e) => e.state === "deleted").length, folders };
  }

  /** The whole library with usage, in one read-only transaction (keys only for usage; no bytes are read). */
  async list(): Promise<CatalogListing> {
    const tx = this.db.transaction(["assetCatalog", "assets", "objects", "meta"], "readonly");
    const folders = ((await req(tx.objectStore("meta").get(FOLDERS_KEY) as IDBRequest<AssetFolder[] | undefined>)) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const entries = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
    const blobKeys = new Set((await req(tx.objectStore("assets").getAllKeys())) as string[]);
    const stubs = (await req(tx.objectStore("assets").index("ext").getAll())) as Array<{ hash: string; size: number; file?: string }>; // (stubs hold no bytes)
    const usage = new Map<string, { instances: number; canvases: Set<string> }>();
    await new Promise<void>((resolve, reject) => {
      const cur = tx.objectStore("objects").index("assetId").openKeyCursor();
      cur.onerror = () => reject(cur.error);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve();
        const hash = c.key as string;
        const canvasId = (c.primaryKey as [string, string])[0];
        let u = usage.get(hash);
        if (!u) usage.set(hash, (u = { instances: 0, canvases: new Set() }));
        u.instances++;
        u.canvases.add(canvasId);
        c.continue();
      };
    });
    const known = new Set(entries.map((e) => e.hash));
    // An original kept in the library folder is present only while its file is (ADR 0159).
    const have = await externalFolder.hasMany(stubs);
    stubs.forEach((s, k) => have[k] || blobKeys.delete(s.hash));
    return {
      entries: entries.filter((e) => e.state === "active").map((e) => ({ ...e, ...usageOf(usage, e.hash), present: blobKeys.has(e.hash) })),
      missing: [...usage.keys()].filter((h) => !blobKeys.has(h) && !known.has(h)).map((hash) => ({ hash, ...usageOf(usage, hash) })),
      pendingDeletion: entries.filter((e) => e.state === "deleted").length,
      folders,
    };
  }

  /**
   * Change an entry's organization. Changes are applied to the stored entry
   * inside one transaction (add/remove, never "replace with what the screen
   * showed"), so quick successive edits and edits from another tab never
   * overwrite each other. Tags are normalized; folders must exist.
   */
  async updateMeta(hash: string, change: MetaChange): Promise<CatalogEntry> {
    return (await this.updateMetaEach([{ hash, change }]))[0]!;
  }

  /**
   * Change the tags, favourite flag or folder of many assets in one transaction: a change to hundreds of picked items is one write (and
   * one flush to disk), not one each. All or nothing.
   */
  async updateMetaEach(changes: ReadonlyArray<{ hash: string; change: MetaChange }>): Promise<CatalogEntry[]> {
    return this.write(["assetCatalog", "meta"], async (tx) => {
      const known = changes.some(({ change: c }) => c.addFolders || c.removeFolders || c.clearFolder) ? new Set((await this.readFolders(tx)).map((f) => f.id)) : null;
      const out: CatalogEntry[] = [];
      for (const { hash, change } of changes) {
        const e = await req(tx.objectStore("assetCatalog").get(hash) as IDBRequest<CatalogEntry | undefined>);
        if (!e || e.state !== "active") throw new CatalogInputError("the item is not in the library");
        const m = meta(e);
        const next: CatalogEntry = { ...e, ...m };
        if (change.favorite !== undefined) next.favorite = change.favorite;
        if (change.hidden !== undefined) next.hidden = change.hidden;
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
          // One folder per asset: adding replaces the folder; removing clears it.
          const added = change.addFolders ?? [];
          if (change.addFolders || change.removeFolders || change.clearFolder) next.folderIds = change.clearFolder ? [] : added.length ? [added[added.length - 1]!] : m.folderIds.filter((id) => !drop.has(id));
        }
        tx.objectStore("assetCatalog").put(next);
        out.push(next);
      }
      return out;
    });
  }

  /**
   * Rename a tag on every asset that has it (case-insensitive); renaming onto an existing tag merges the two. Saved searches that
   * name the tag follow. Returns how many assets changed.
   */
  async renameTag(from: string, to: string): Promise<number> {
    const target = formatTag(to);
    if (!target) throw new CatalogInputError("a tag needs a name");
    const key = from.toLowerCase();
    return this.write(["assetCatalog"], async (tx) => {
      const all = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
      let n = 0;
      for (const e of all) {
        // The tag and the tags nested under it (project/design) are renamed together, as in Obsidian.
        if (e.state !== "active" || !(e.tags ?? []).some((t) => tagIsOrUnder(t, key))) continue;
        tx.objectStore("assetCatalog").put({ ...e, tags: normalizeTags((e.tags ?? []).map((t) => renamedTag(t, key, target) ?? t)) });
        n++;
      }
      return n;
    });
  }

  /** Remove a tag from every asset that has it. The assets stay. Returns how many assets changed. */
  async deleteTag(tag: string): Promise<number> {
    const key = tag.toLowerCase();
    return this.write(["assetCatalog"], async (tx) => {
      const all = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
      let n = 0;
      for (const e of all) {
        if (e.state !== "active" || !(e.tags ?? []).some((t) => t.toLowerCase() === key)) continue;
        tx.objectStore("assetCatalog").put({ ...e, tags: (e.tags ?? []).filter((t) => t.toLowerCase() !== key) });
        n++;
      }
      return n;
    });
  }

  async createFolder(name: string, parentId: string | null, id: string): Promise<AssetFolder> {
    return this.write(["meta"], async (tx) => {
      const folders = await this.readFolders(tx);
      if (parentId && !folders.some((f) => f.id === parentId)) throw new CatalogInputError("the parent folder no longer exists");
      const f: AssetFolder = { id, name: folderName(name), parentId };
      tx.objectStore("meta").put([...folders, f], FOLDERS_KEY);
      return f;
    });
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.write(["meta"], async (tx) => {
      const folders = await this.readFolders(tx);
      const f = folders.find((x) => x.id === id);
      if (!f) throw new CatalogInputError("that folder no longer exists");
      f.name = folderName(name);
      tx.objectStore("meta").put(folders, FOLDERS_KEY);
    });
  }

  /** Delete a folder and its subfolders. Assets filed there stay in the library; only the filing is removed. */
  async deleteFolder(id: string): Promise<{ folders: number; unfiled: number }> {
    return this.write(["meta", "assetCatalog"], async (tx) => {
      const folders = await this.readFolders(tx);
      const gone = folderSubtree(folders, id);
      tx.objectStore("meta").put(folders.filter((f) => !gone.has(f.id)), FOLDERS_KEY);
      let unfiled = 0;
      for (const e of await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>)) {
        const ids = e.folderIds ?? [];
        if (!ids.some((x) => gone.has(x))) continue;
        tx.objectStore("assetCatalog").put({ ...e, folderIds: ids.filter((x) => !gone.has(x)) });
        unfiled++;
      }
      return { folders: gone.size, unfiled };
    });
  }

  private async readFolders(tx: IDBTransaction): Promise<AssetFolder[]> {
    return (await req(tx.objectStore("meta").get(FOLDERS_KEY) as IDBRequest<AssetFolder[] | undefined>)) ?? [];
  }

  /** One readwrite transaction; aborts (writing nothing) if `body` throws. */
  private async write<T>(stores: string[], body: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = this.db.transaction(stores, "readwrite", { durability: "strict" });
    const committed = done(tx);
    try {
      const r = await body(tx);
      await committed;
      return r;
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // already finished
      }
      await committed.catch(() => undefined);
      throw err;
    }
  }

  /** The hashes of the active items that are hidden. */
  async hiddenHashes(): Promise<Set<string>> {
    const tx = this.db.transaction("assetCatalog", "readonly");
    const all = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
    return new Set(all.flatMap((e) => (e.hidden && e.state === "active" ? [e.hash] : [])));
  }

  async entry(hash: string): Promise<CatalogEntry | undefined> {
    const tx = this.db.transaction("assetCatalog", "readonly");
    return req(tx.objectStore("assetCatalog").get(hash) as IDBRequest<CatalogEntry | undefined>);
  }

  /** Every stored instance of an asset, grouped by canvas (in key order). */
  async locations(hash: string): Promise<AssetLocation[]> {
    const tx = this.db.transaction("objects", "readonly");
    const keys = (await req(tx.objectStore("objects").index("assetId").getAllKeys(hash))) as unknown as Array<[string, string]>;
    const by = new Map<string, ObjectId[]>();
    for (const [canvasId, id] of keys) {
      let ids = by.get(canvasId);
      if (!ids) by.set(canvasId, (ids = []));
      ids.push(id);
    }
    return [...by].map(([canvasId, ids]) => ({ canvasId, ids }));
  }

  /**
   * Repair the catalog from the bytes that are actually stored: every
   * original without an entry gets one (schema-2 data, or an interrupted
   * write). Never deletes anything. Returns the number of entries created.
   */
  async reconcile(): Promise<number> {
    const tx = this.db.transaction(["assetCatalog", "assets"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    const known = new Set((await req(tx.objectStore("assetCatalog").getAllKeys())) as string[]);
    const missingKeys = ((await req(tx.objectStore("assets").getAllKeys())) as string[]).filter((k) => !known.has(k));
    for (const k of missingKeys) {
      const r = await req(tx.objectStore("assets").get(k) as IDBRequest<AssetRecord | undefined>);
      if (r) tx.objectStore("assetCatalog").put(entryFromRecord({ ...r, hash: k }));
    }
    await committed;
    return missingKeys.length;
  }

  /**
   * Delete an asset from the library. Refused while any stored instance uses
   * it. The original is not erased here; `collect` does that once nothing
   * (including undo history) can bring an instance back.
   */
  async snapshotMeta(): Promise<MetaSnapshot> {
    const tx = this.db.transaction(["assetCatalog", "meta"], "readonly");
    const all = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
    const folders = await this.readFolders(tx);
    return { entries: new Map(all.filter((e) => e.state === "active").map((e) => [e.hash, { name: e.name, ...meta(e) }])), folders };
  }

  /** Put back what a snapshot holds (only the assets that differ, and the folders), in one transaction; returns how many assets changed. */
  async restoreMeta(s: MetaSnapshot): Promise<number> {
    return this.write(["assetCatalog", "meta"], async (tx) => {
      const store = tx.objectStore("assetCatalog");
      const all = await req(store.getAll() as IDBRequest<CatalogEntry[]>);
      let n = 0;
      for (const e of all) {
        const was = s.entries.get(e.hash);
        if (!was || e.state !== "active") continue;
        const now = { name: e.name, ...meta(e) };
        if (JSON.stringify(now) === JSON.stringify(was)) continue;
        const next: CatalogEntry = { ...e, ...was };
        if (!next.note) delete next.note;
        if (!next.fields?.length) delete next.fields;
        store.put(next);
        n++;
      }
      tx.objectStore("meta").put(s.folders, FOLDERS_KEY);
      return n;
    });
  }

  /** Delete many from the library in one transaction (one flush to disk, not one each): those in use are kept and counted. */
  async markDeletedEach(hashes: readonly string[]): Promise<{ gone: string[]; inUse: number }> {
    return this.write(["assetCatalog", "objects"], async (tx) => {
      const gone: string[] = [];
      let inUse = 0;
      for (const hash of hashes) {
        if ((await req(tx.objectStore("objects").index("assetId").count(hash))) > 0) {
          inUse++;
          continue;
        }
        const e = await req(tx.objectStore("assetCatalog").get(hash) as IDBRequest<CatalogEntry | undefined>);
        if (!e) continue;
        tx.objectStore("assetCatalog").put({ ...e, state: "deleted", deletedAt: Date.now() } satisfies CatalogEntry);
        gone.push(hash);
      }
      return { gone, inUse };
    });
  }

  async markDeleted(hash: string): Promise<void> {
    const tx = this.db.transaction(["assetCatalog", "objects"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    try {
      const n = await req(tx.objectStore("objects").index("assetId").count(hash));
      if (n > 0) throw new AssetInUseError(hash, n);
      const e = await req(tx.objectStore("assetCatalog").get(hash) as IDBRequest<CatalogEntry | undefined>);
      if (!e) throw new Error(`item ${hash} is not in the library`);
      tx.objectStore("assetCatalog").put({ ...e, state: "deleted", deletedAt: Date.now() } satisfies CatalogEntry);
      await committed;
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // already finished
      }
      await committed.catch(() => undefined);
      throw err;
    }
  }

  /**
   * Mark-and-sweep over deleted entries, in one transaction so no commit can
   * interleave between the reference check and the erase.
   *
   * Mark: a deleted entry is live if a stored instance references it (it is
   * then restored to the library) or if it is in `roots`, the hashes the
   * caller can still bring back without storage (open document, undo/redo
   * history, queued saves). Sweep: everything else loses its bytes and entry.
   */
  async collect(roots: ReadonlySet<string>): Promise<GcReport> {
    const report: GcReport = { swept: [], bytesFreed: 0, retained: [], restored: [] };
    const files = new Map<string, string>(); // swept originals kept in the library folder, and their file names
    const tx = this.db.transaction(["assetCatalog", "assets", "objects", "thumbs"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    const catalog = tx.objectStore("assetCatalog");
    const deleted = (await req(catalog.getAll() as IDBRequest<CatalogEntry[]>)).filter((e) => e.state === "deleted");
    for (const e of deleted) {
      const refs = await req(tx.objectStore("objects").index("assetId").count(e.hash));
      if (refs > 0) {
        catalog.put({ ...e, state: "active", deletedAt: null } satisfies CatalogEntry);
        report.restored.push(e.hash);
      } else if (roots.has(e.hash)) {
        report.retained.push(e.hash);
      } else {
        const stub = await req(tx.objectStore("assets").get(e.hash) as IDBRequest<{ ext?: number; file?: string } | undefined>);
        if (stub?.ext) files.set(e.hash, stub.file ?? e.hash);
        tx.objectStore("assets").delete(e.hash);
        tx.objectStore("thumbs").delete(e.hash);
        catalog.delete(e.hash);
        report.swept.push(e.hash);
        report.bytesFreed += e.size;
      }
    }
    await committed;
    for (const h of report.swept) if (files.has(h)) await externalFolder.remove(h, files.get(h)); // a file of the library folder goes with its original
    return report;
  }
}

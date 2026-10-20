/**
 * IndexedDB schema and small promise helpers.
 *
 * Database "canvast", version 10 (see docs/adr/0006-workspace-storage.md and
 * docs/adr/0007-asset-catalog-and-gc.md):
 *
 *   meta         key string        → MetaRecord (schema info, current workspace, migrations)
 *   workspaces   keyPath "id"      → WorkspaceRecord
 *   boards       keyPath "id"      → BoardRecord
 *   canvases     keyPath "id"      → CanvasRecord            (index "boardId")
 *   objects      keyPath [canvasId, id] → ObjectRecord        (one record per canvas object;
 *                                                             index "assetId" on data.assetId, v3;
 * *                                                             multi-entry index "tags" on data.tags: in-canvas tags, ADR 0062; v8;
 *                                                             v9 dropped the mention indexes "refs" and "kind" and the `refs` field)
 *   canvasViews  key canvasId      → SerializedCamera         (per-device view state; no revision)
 *   assets       key sha256        → AssetRecord              (original bytes, stored once; index "ext" on the stubs of originals kept in the library folder, ADR 0159; v10)
 *   assetCatalog keyPath "hash"    → CatalogEntry             (metadata only, no bytes; v3)
 *   thumbs       keyPath "hash"    → ThumbRecord              (lower-quality WebP thumbnail of an asset, derived data, v6)
 *   bookmarks    keyPath "canvasId" → { canvasId, items: Bookmark[] }  (named saved views, ADR 0025; v5)
 *   frames       keyPath [canvasId, id] → FrameRecord + canvasId (nested frames, ADR 0014; v4).
 *                                          Objects name their frame; absent = the world frame, which is
 *                                          the absolute form of earlier versions, so old data needs no conversion.
 *
 * Legacy (version 1, read-only after migration, never deleted here):
 *   snapshots    key "main" | "camera" → Phase 0B whole-document snapshot
 *
 * The upgrade callback only creates stores and indexes. Converting legacy
 * data happens afterwards in one verified readwrite transaction
 * (migrate-v1.ts), so a failed conversion never leaves a half-upgraded
 * schema.
 */
export const DB_NAME = "canvast";
export const DB_VERSION = 10;

export interface OpenOptions {
  /** Called while an upgrade waits for other tabs to close their connections. */
  onBlocked?: () => void;
  /** Called when another tab needs this connection closed for an upgrade. */
  onVersionChange?: () => void;
}

export function openDb(name = DB_NAME, opts: OpenOptions = {}): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser context"));
      return;
    }
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const has = (s: string): boolean => db.objectStoreNames.contains(s);
      if (!has("snapshots")) db.createObjectStore("snapshots"); // legacy v1, kept for migration
      if (!has("assets")) db.createObjectStore("assets");
      // v10: originals kept in the library folder are stubs with ext = 1 (ADR 0159); the index lists them.
      const assetsStore = req.transaction!.objectStore("assets");
      if (!assetsStore.indexNames.contains("ext")) assetsStore.createIndex("ext", "ext");
      if (!has("meta")) db.createObjectStore("meta");
      if (!has("workspaces")) db.createObjectStore("workspaces", { keyPath: "id" });
      if (!has("boards")) db.createObjectStore("boards", { keyPath: "id" });
      if (!has("canvases")) db.createObjectStore("canvases", { keyPath: "id" }).createIndex("boardId", "boardId");
      if (!has("objects")) db.createObjectStore("objects", { keyPath: ["canvasId", "id"] });
      if (!has("canvasViews")) db.createObjectStore("canvasViews");
      // v3: usage lookups. Strokes have no assetId, so the index holds image instances only.
      const objects = req.transaction!.objectStore("objects");
      if (!objects.indexNames.contains("assetId")) objects.createIndex("assetId", "data.assetId");
      // v9: mentions were removed (ADR 0125): drop their indexes and the derived `refs` field of stored texts.
      for (const name of ["refs", "kind"]) if (objects.indexNames.contains(name)) objects.deleteIndex(name);
      if (event.oldVersion > 0 && event.oldVersion < 9) {
        objects.openCursor().onsuccess = (e) => {
          const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!c) return;
          const v = c.value as { data?: Record<string, unknown> };
          if (v.data && "refs" in v.data) {
            delete v.data["refs"];
            c.update(v);
          }
          c.continue();
        };
      }
      // v8: in-canvas tags (ADR 0062), listed across the workspace from this index.
      if (!objects.indexNames.contains("tags")) objects.createIndex("tags", "data.tags", { multiEntry: true });
      if (!has("assetCatalog")) db.createObjectStore("assetCatalog", { keyPath: "hash" });
      if (!has("frames")) db.createObjectStore("frames", { keyPath: ["canvasId", "id"] });
      if (!has("bookmarks")) db.createObjectStore("bookmarks", { keyPath: "canvasId" });
      if (!has("thumbs")) db.createObjectStore("thumbs", { keyPath: "hash" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        opts.onVersionChange?.();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    // Keep waiting: the request completes once other tabs close their connections.
    req.onblocked = () => opts.onBlocked?.();
  });
}

export function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export function idbGetAll<T>(db: IDBDatabase, store: string, query?: IDBKeyRange): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll(query);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

/** Put a value; resolves only after the transaction has committed durably. */
export function idbPut(db: IDBDatabase, store: string, key: IDBValidKey | undefined, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite", { durability: "strict" });
    if (key === undefined) tx.objectStore(store).put(value);
    else tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Wrap a request in a promise (for use inside an open transaction). */
export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Resolve when a transaction commits; reject with its error if it aborts. */
export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

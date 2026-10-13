/**
 * Minimal promise wrapper over IndexedDB for the Phase 0B snapshot.
 *
 * Database "canvast", version 1:
 *   snapshots  key "main" → SnapshotRecord (objects + camera)
 *   assets     key sha256  → AssetRecord (original bytes, deduplicated)
 */
export const DB_NAME = "canvast";
export const DB_VERSION = 1;

export function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser context"));
      return;
    }
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots");
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });
}

export function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** Put a value; resolves only after the transaction has committed durably. */
export function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite", { durability: "strict" });
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

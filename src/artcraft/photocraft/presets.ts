/**
 * PhotoCraft's brush presets (and its other preset files) as its web build keeps them: the browser database `photocraft.presets`, store
 * `files`, a Blob under each key (its `apps/photocraft-web/src/indexed_presets.rs`). canvast reads them after PhotoCraft has run and puts
 * the workspace's back before it starts, so they live with the workspace (state.ts). This is PhotoCraft's own database, not canvast's
 * storage: the one place canvast opens it (scripts/check-storage.mjs names this file).
 */
const DATABASE = "photocraft.presets";
const FILES = "files";

export interface PresetFile {
  key: IDBValidKey;
  blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const req = indexedDB.open(DATABASE, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(FILES)) req.result.createObjectStore(FILES);
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error ?? new Error("PhotoCraft's presets could not be opened"));
    req.onblocked = () => no(new Error("PhotoCraft's presets are in use"));
  });
}

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((ok, no) => {
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () => no(tx.error ?? new Error("PhotoCraft's presets could not be written"));
  });

/** Every preset file it keeps, in key order. */
export async function readPresets(): Promise<PresetFile[]> {
  const db = await open();
  try {
    const tx = db.transaction(FILES, "readonly");
    const store = tx.objectStore(FILES);
    const out: PresetFile[] = [];
    await new Promise<void>((ok, no) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return ok();
        if (c.value instanceof Blob) out.push({ key: c.key, blob: c.value });
        c.continue();
      };
      req.onerror = () => no(req.error);
    });
    return out;
  } finally {
    db.close();
  }
}

/** Its preset files made exactly `files` (none: its built-in presets only). Only while PhotoCraft is not running. */
export async function writePresets(files: readonly PresetFile[]): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(FILES, "readwrite");
    const store = tx.objectStore(FILES);
    store.clear();
    for (const f of files) store.put(f.blob, f.key);
    await done(tx);
  } finally {
    db.close();
  }
}

/**
 * The desktop build's storage (ADR 0177): the same storage as the browser build, in this workspace's own IndexedDB (a
 * storage partition per workspace folder), which the workspace folder follows (`WorkspaceMirror`): boards as folders,
 * canvases as `.cvst` files, `.canvast/workspace.json` and `library.json`. Every original is a readable file under
 * `library/`, written through the library-folder code (ADR 0159) with readable names and moved when it is filed or renamed.
 */
import type { DeleteMode, DesktopBridge } from "./desktop-bridge";
import type { Dir } from "./external-folder";
import { externalFolder } from "./external-folder";
import { openBrowserStorage } from "./idb-storage";
import type { IdbStorage } from "./idb-storage";
import type { FolderSync, FolderWriting, OpenHooks } from "./store";
import { LIBRARY_JSON } from "./library-mirror";
import { WORKSPACE_FILE, WorkspaceMirror, watched } from "./workspace-mirror";
import { BOARDS_DIR, WORKSPACE_NAMING } from "./workspace-names";
import { HIDDEN_JSON, HiddenVault } from "./hidden-store";
import { resetAllData } from "./reset";
import type { AssetCatalog } from "../assets/asset-catalog";


/** The workspace folder as a directory of the library-folder code; paths are relative to the workspace. */
export function bridgeDir(bridge: DesktopBridge, name: string, deleteTo: () => DeleteMode = () => "trash"): Dir {
  const notFound = (path: string): DOMException => new DOMException(`${path} is not there`, "NotFoundError");
  return {
    name,
    async getFileHandle(path, o) {
      if (!o?.create && !(await bridge.exists(path))) throw notFound(path);
      return {
        async getFile() {
          const bytes = await bridge.read(path);
          if (!bytes) throw notFound(path);
          return new File([bytes as Uint8Array<ArrayBuffer>], path.slice(path.lastIndexOf("/") + 1));
        },
        async createWritable() {
          const parts: Blob[] = [];
          return {
            write: async (b: Blob) => void parts.push(b),
            close: async () => bridge.write(path, new Uint8Array(await new Blob(parts).arrayBuffer())),
          };
        },
      };
    },
    removeEntry: (path) => bridge.remove(path, deleteTo()),
  };
}

export async function openDesktopStorage(raw: DesktopBridge, opts: OpenHooks): Promise<IdbStorage> {
  // What the app itself writes, moves or deletes is noted for a few seconds, so its own changes are not taken for outside ones.
  const recent = new Map<string, number>();
  const note = (...paths: string[]): void => {
    const now = Date.now();
    for (const p of paths) recent.set(p, now);
  };
  const bridge: DesktopBridge = {
    ...raw,
    write: (p, b, o) => (note(p), raw.write(p, b, o)),
    rename: (a, b) => (note(a, b), raw.rename(a, b)),
    remove: (p, how) => (note(p), raw.remove(p, how)),
    erase: (p) => (note(p), raw.erase(p)),
    makeFolder: (p) => (note(p), raw.makeFolder(p)),
    removeEmptyFolder: (p) => (note(p), raw.removeEmptyFolder(p)),
  };
  const ws = await bridge.workspace();
  if (!ws) throw new Error("the desktop app did not say which workspace folder is open");
  const storage = await openBrowserStorage(opts);
  externalFolder.naming = WORKSPACE_NAMING;
  externalFolder.saveHandle = false; // (the folder is the workspace itself, never a handle kept in the database)
  const deleteTo = (): DeleteMode => opts.deleteTo?.() ?? "trash";
  await externalFolder.use(bridgeDir(bridge, ws.name, deleteTo));
  const hidden = new HiddenVault(bridge, async () => [...(await storage.catalog.snapshotMeta()).entries.values()].filter((e) => e.hidden).length);
  const mirror = new WorkspaceMirror(storage.db, storage.workspace, bridge, deviceId(), hidden, deleteTo);
  // Hidden originals are sealed files: read through the key, in memory (none while locked); their thumbnails are never stored.
  externalFolder.unseal = {
    open: async (blob) => {
      const bytes = await hidden.open(new Uint8Array(await blob.arrayBuffer()));
      return bytes && new Blob([bytes]);
    },
    ready: () => hidden.isOpen(),
  };
  (storage.catalog as AssetCatalog).keepHiddenThumbs = false;
  mirror.onError = (text) => opts.onNotice?.(text);
  const writingFns = new Set<(done: number, total: number) => void>();
  let writingNow: { done: number; total: number } | null = null;
  mirror.onProgress = (done, total) => {
    writingNow = total ? { done, total } : null;
    for (const fn of writingFns) fn(done, total);
  };
  const folderWriting: FolderWriting = {
    subscribe: (fn) => (writingFns.add(fn), () => void writingFns.delete(fn)),
    now: () => writingNow,
  };
  const tree = (): void => mirror.tree();
  const canvases = (r: { canvases: string[] }): void => r.canvases.forEach((id) => mirror.canvas(id));
  const workspace = watched(storage.workspace, {
    // The folder is read before the session opens anything (its current canvas may be one the folder brought).
    startup: async (r) => {
      await mirror.start();
      const current = await storage.workspace.current();
      return current ? { ...r, current } : r;
    },
    commit: (_r, id) => mirror.canvas(id),
    saveBookmarks: (_r, id) => mirror.canvas(id),
    changeObjectTag: canvases,
    removeAssetInstances: canvases,
    formatStoredTags: () => mirror.everything(),
    saveCamera: () => mirror.device(),
    setCurrent: () => mirror.device(),
    createWorkspace: tree,
    createBoard: tree,
    createCanvas: tree,
    duplicateCanvas: tree,
    duplicateBoard: tree,
    moveCanvas: tree,
    moveBoard: tree,
    renameWorkspace: tree,
    setViewGround: tree,
    renameBoard: tree,
    renameCanvas: tree,
    deleteCanvas: tree,
    deleteBoard: tree,
    saveStyles: tree,
  });
  const backups = watched(storage.backups, { applyImport: () => mirror.everything(), recordBackup: () => mirror.device() });
  const library = (): void => mirror.library();
  const folderSync: FolderSync = {
    start(on) {
      mirror.importFiles = (files) => on.importFiles(files);
      void mirror.rescan(() => on.libraryChanged());
      const check = (): void =>
        void on.beforeCheck().then(async () => {
          const r = await mirror.recheck();
          if (r.tree) await on.canvasesChanged(r.canvases);
        });
      mirror.onContested = check;
      raw.onChanged((paths) => {
        const now = Date.now();
        for (const [p, t] of recent) if (now - t > 5000) recent.delete(p);
        // Library paths the app itself just wrote (or a folder holding one) are not looked through again: that costs a listing of
        // the whole library. Canvas and index files are always compared, by their headers and contents, which is cheap: another
        // device may write the same file a moment after this one did.
        const ownWrite = (p: string): boolean => [...recent.keys()].some((r) => r === p || r.startsWith(`${p}/`));
        if (paths.some((p) => (p === "library" || p.startsWith("library/")) && !ownWrite(p))) void mirror.rescan(() => on.libraryChanged());
        if (paths.some((p) => p === LIBRARY_JSON || p === HIDDEN_JSON)) void mirror.rereadLibrary(() => on.libraryChanged());
        if (paths.some((p) => p === WORKSPACE_FILE || p.startsWith(`${BOARDS_DIR}/`))) check();
      });
    },
  };
  const catalog = watched(storage.catalog, {
    setLock: tree,
    renameAssets: library,
    updateMeta: library,
    updateMetaEach: library,
    renameTag: library,
    deleteTag: library,
    createFolder: library,
    renameFolder: library,
    deleteFolder: library,
    restoreMeta: library,
    markDeleted: library,
    markDeletedEach: library,
    collect: library,
    reconcile: (n) => void (n && mirror.library()),
  });
  const originals = watched(storage.originals, { put: library });
  // Rebuild from the folder: what is not in the folder yet is written first, then only the working copy goes (the settings stay).
  const resetAll = async (onBlocked?: () => void): Promise<void> => {
    await mirror.flush();
    await resetAllData({ db: storage.db, keepSettings: true, ...(onBlocked ? { onBlocked } : {}) });
  };
  return { ...storage, resetAll, workspace, backups, catalog, originals, libraryFolder: null, workspaceFolder: ws.path, hidden, folderSync, folderWriting, flush: () => mirror.flush() };
}

/** This device's id in the workspace folder (`.canvast/devices/<id>.json`), made once and kept. */
function deviceId(): string {
  const key = "canvast.deviceId";
  try {
    const kept = localStorage.getItem(key);
    if (kept && /^[0-9a-f]{32}$/.test(kept)) return kept;
    const made = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, made);
    return made;
  } catch {
    return "0".repeat(32);
  }
}

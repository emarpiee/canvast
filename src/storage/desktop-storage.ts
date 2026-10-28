/**
 * The desktop build's storage (ADR 0177): the same storage as the browser build, in this workspace's own IndexedDB (a
 * storage partition per workspace folder), which the workspace folder follows (`WorkspaceMirror`): boards as folders,
 * canvases as `.cvst` files, `.canvast/workspace.json` and `library.json`. Every original is a readable file under
 * `library/`, written through the library-folder code (ADR 0159) with readable names and moved when it is filed or renamed.
 */
import type { DesktopBridge } from "./desktop-bridge";
import type { Dir } from "./external-folder";
import { externalFolder } from "./external-folder";
import { openBrowserStorage } from "./idb-storage";
import type { IdbStorage } from "./idb-storage";
import type { OpenHooks } from "./store";
import { WorkspaceMirror, watched } from "./workspace-mirror";
import { WORKSPACE_NAMING } from "./workspace-names";
import { HiddenVault } from "./hidden-store";
import type { AssetCatalog } from "../assets/asset-catalog";


/** The workspace folder as a directory of the library-folder code; paths are relative to the workspace. */
export function bridgeDir(bridge: DesktopBridge, name: string): Dir {
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
    removeEntry: (path) => bridge.remove(path),
  };
}

export async function openDesktopStorage(bridge: DesktopBridge, opts: OpenHooks): Promise<IdbStorage> {
  const ws = await bridge.workspace();
  if (!ws) throw new Error("the desktop app did not say which workspace folder is open");
  const storage = await openBrowserStorage(opts);
  externalFolder.naming = WORKSPACE_NAMING;
  externalFolder.saveHandle = false; // (the folder is the workspace itself, never a handle kept in the database)
  await externalFolder.use(bridgeDir(bridge, ws.name));
  const hidden = new HiddenVault(bridge, async () => [...(await storage.catalog.snapshotMeta()).entries.values()].filter((e) => e.hidden).length);
  const mirror = new WorkspaceMirror(storage.db, storage.workspace, bridge, deviceId(), hidden);
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
  return { ...storage, workspace, backups, catalog, originals, libraryFolder: null, workspaceFolder: ws.path, hidden, flush: () => mirror.flush() };
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

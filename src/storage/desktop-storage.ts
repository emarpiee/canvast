/**
 * The desktop build's storage (ADR 0177, step 2): boards, canvases and the library's entries are still in this
 * workspace's own IndexedDB (a storage partition per workspace folder), and every new original is a readable file
 * under `library/` in the workspace folder, through the library-folder code (ADR 0159) with readable names.
 */
import type { DesktopBridge } from "./desktop-bridge";
import type { Dir } from "./external-folder";
import { externalFolder } from "./external-folder";
import { openBrowserStorage } from "./idb-storage";
import type { IdbStorage } from "./idb-storage";
import type { OpenHooks } from "./store";
import { WorkspaceMirror, watched } from "./workspace-mirror";
import { WORKSPACE_NAMING } from "./workspace-names";


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
  const mirror = new WorkspaceMirror(storage.db, storage.workspace, bridge, deviceId());
  mirror.onError = (text) => opts.onNotice?.(text);
  const tree = (): void => mirror.tree();
  const canvases = (r: { canvases: string[] }): void => r.canvases.forEach((id) => mirror.canvas(id));
  const workspace = watched(storage.workspace, {
    startup: () => void mirror.start(),
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
  const catalog = watched(storage.catalog, { setLock: tree });
  return { ...storage, workspace, backups, catalog, libraryFolder: null, workspaceFolder: ws.path, flush: () => mirror.flush() };
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

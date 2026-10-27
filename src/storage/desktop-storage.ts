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
  return { ...storage, libraryFolder: null, workspaceFolder: ws.path };
}

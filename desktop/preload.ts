/**
 * The desktop build's bridge (ADR 0177): the only way the sandboxed page reaches the main process. It exposes
 * `window.canvastDesktop`, a few calls that each go through one IPC channel; the page never gets Node or Electron.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../src/storage/desktop-bridge";

const bridge: DesktopBridge = {
  workspace: () => ipcRenderer.invoke("canvast:workspace"),
  read: (path) => ipcRenderer.invoke("canvast:read", path),
  exists: (path) => ipcRenderer.invoke("canvast:exists", path),
  head: (path) => ipcRenderer.invoke("canvast:head", path),
  write: (path, bytes, opts) => ipcRenderer.invoke("canvast:write", path, bytes, opts?.durable !== false),
  syncFiles: (paths) => ipcRenderer.invoke("canvast:syncFiles", paths),
  openFile: (path) => ipcRenderer.invoke("canvast:openFile", path),
  showFile: (path) => ipcRenderer.invoke("canvast:showFile", path),
  sizes: (paths) => ipcRenderer.invoke("canvast:sizes", paths),
  remove: (path, how) => ipcRenderer.invoke("canvast:remove", path, how ?? "trash"),
  list: (path) => ipcRenderer.invoke("canvast:list", path),
  exportTo: {
    begin: (name) => ipcRenderer.invoke("canvast:export", "begin", name),
    write: (id, path, bytes) => ipcRenderer.invoke("canvast:export", "write", id, path, bytes),
    end: (id) => ipcRenderer.invoke("canvast:export", "end", id),
  },
  lib: {
    get: (hashes) => ipcRenderer.invoke("canvast:lib", "get", hashes),
    entries: (which) => ipcRenderer.invoke("canvast:lib", "entries", which ?? "all"),
    recs: (which) => ipcRenderer.invoke("canvast:lib", "recs", which ?? "all"),
    write: (only, compatMax) => ipcRenderer.invoke("canvast:lib", "write", only, compatMax),
    byFile: (file) => ipcRenderer.invoke("canvast:lib", "byFile", file),
    meta: (key) => ipcRenderer.invoke("canvast:lib", "meta", key),
    apply: (ops) => ipcRenderer.invoke("canvast:lib", "apply", ops),
    sync: (keys, extra, deletions, all) => ipcRenderer.invoke("canvast:lib", "sync", keys, extra, deletions, all === true),
    parts: () => ipcRenderer.invoke("canvast:lib", "parts"),
    pending: () => ipcRenderer.invoke("canvast:lib", "pending"),
    orphans: () => ipcRenderer.invoke("canvast:lib", "orphans"),
    absent: () => ipcRenderer.invoke("canvast:lib", "absent"),
    query: (q) => ipcRenderer.invoke("canvast:lib", "query", q),
    counts: (hidden) => ipcRenderer.invoke("canvast:lib", "counts", hidden === true),
    fieldKeys: () => ipcRenderer.invoke("canvast:lib", "fieldKeys"),
    listed: (hashes) => ipcRenderer.invoke("canvast:lib", "listed", hashes),
    unnamed: () => ipcRenderer.invoke("canvast:lib", "unnamed"),
    holds: (dir) => ipcRenderer.invoke("canvast:lib", "holds", dir),
    reset: () => ipcRenderer.invoke("canvast:lib", "reset"),
    onProgress: (fn) => void ipcRenderer.on("canvast:libProgress", (_e, done: number, total: number) => fn(done, total)),
  },
  tree: (path) => ipcRenderer.invoke("canvast:tree", path),
  canvasFiles: () => ipcRenderer.invoke("canvast:canvasFiles"),
  onChanged: (fn) => void ipcRenderer.on("canvast:changed", (_e, paths: string[]) => fn(paths)),
  hash: (path) => ipcRenderer.invoke("canvast:hash", path),
  libraryChanges: () => ipcRenderer.invoke("canvast:libraryChanges"),
  libraryLookDone: () => ipcRenderer.invoke("canvast:libraryLookDone"),
  emptyOldTrash: (days) => ipcRenderer.invoke("canvast:emptyOldTrash", days),
  scrypt: (password, salt, N, r, p) => ipcRenderer.invoke("canvast:scrypt", password, salt, N, r, p),
  rename: (from, to) => ipcRenderer.invoke("canvast:rename", from, to),
  erase: (path) => ipcRenderer.invoke("canvast:erase", path),
  makeFolder: (path) => ipcRenderer.invoke("canvast:makeFolder", path),
  removeEmptyFolder: (path) => ipcRenderer.invoke("canvast:removeEmptyFolder", path),
  onClosing: (write) => {
    ipcRenderer.on("canvast:closing", () => {
      void write()
        .catch(() => undefined)
        .then((close) => ipcRenderer.invoke(close === false ? "canvast:keepOpen" : "canvast:closed"));
    });
  },
  holdClose: () => ipcRenderer.invoke("canvast:holdClose"),
  workspaces: () => ipcRenderer.invoke("canvast:workspaces"),
  switchWorkspace: (to) => ipcRenderer.invoke("canvast:switchWorkspace", to),
  forgetWorkspace: (path) => ipcRenderer.invoke("canvast:forgetWorkspace", path),
};

contextBridge.exposeInMainWorld("canvastDesktop", bridge);

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
  tree: (path) => ipcRenderer.invoke("canvast:tree", path),
  canvasFiles: () => ipcRenderer.invoke("canvast:canvasFiles"),
  onChanged: (fn) => void ipcRenderer.on("canvast:changed", (_e, paths: string[]) => fn(paths)),
  hash: (path) => ipcRenderer.invoke("canvast:hash", path),
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

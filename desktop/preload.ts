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
  write: (path, bytes) => ipcRenderer.invoke("canvast:write", path, bytes),
  remove: (path) => ipcRenderer.invoke("canvast:remove", path),
  list: (path) => ipcRenderer.invoke("canvast:list", path),
  rename: (from, to) => ipcRenderer.invoke("canvast:rename", from, to),
  erase: (path) => ipcRenderer.invoke("canvast:erase", path),
  makeFolder: (path) => ipcRenderer.invoke("canvast:makeFolder", path),
  removeEmptyFolder: (path) => ipcRenderer.invoke("canvast:removeEmptyFolder", path),
  onClosing: (write) => {
    ipcRenderer.on("canvast:closing", () => {
      void write()
        .catch(() => undefined)
        .finally(() => ipcRenderer.invoke("canvast:closed"));
    });
  },
};

contextBridge.exposeInMainWorld("canvastDesktop", bridge);

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
  write: (path, bytes) => ipcRenderer.invoke("canvast:write", path, bytes),
  remove: (path) => ipcRenderer.invoke("canvast:remove", path),
  list: (path) => ipcRenderer.invoke("canvast:list", path),
};

contextBridge.exposeInMainWorld("canvastDesktop", bridge);

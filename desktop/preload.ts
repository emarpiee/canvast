/**
 * The desktop build's bridge (ADR 0177): the only way the sandboxed page reaches the main process. It exposes
 * `window.canvastDesktop`, a few calls that each go through one IPC channel; the page never gets Node or Electron.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../src/storage/desktop-bridge";

const bridge: DesktopBridge = {
  workspace: () => ipcRenderer.invoke("canvast:workspace"),
};

contextBridge.exposeInMainWorld("canvastDesktop", bridge);

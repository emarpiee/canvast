/**
 * What the desktop build's preload gives the page as `window.canvastDesktop` (ADR 0177). Absent in the browser build,
 * which is how the app knows where it runs. Types only, shared by the page and `desktop/preload.ts`.
 */
export interface DesktopWorkspace {
  /** The workspace folder's full path. */
  path: string;
  /** Its folder name. */
  name: string;
}

/** Paths are relative to the workspace folder and `/`-separated; the main process refuses any that would leave it. */
export interface DesktopBridge {
  /** The workspace folder this window is open on. */
  workspace(): Promise<DesktopWorkspace | null>;
  /** A file's bytes, or null when there is no such file. */
  read(path: string): Promise<Uint8Array | null>;
  /** Whether a file is there. */
  exists(path: string): Promise<boolean>;
  /** Write a file whole: a temporary file is written, flushed and renamed over it, so it is never half written. Folders are made. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Move a file into the workspace's `.trash/` (nothing when it is not there). */
  remove(path: string): Promise<void>;
  /** The names of the files (not folders) in a folder; empty when there is none. */
  list(path: string): Promise<string[]>;
}

/** The bridge when the app runs in the desktop build, else null. */
export function desktopBridge(): DesktopBridge | null {
  return (globalThis as { canvastDesktop?: DesktopBridge }).canvastDesktop ?? null;
}

declare global {
  interface Window {
    /** Set by the desktop build's preload; absent in the browser. */
    canvastDesktop?: DesktopBridge;
  }
}

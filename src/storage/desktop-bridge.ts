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
  /** The first kilobyte of a file as text (a canvas file's header), or null when there is no such file. */
  head(path: string): Promise<string | null>;
  /** Whether a file is there. */
  exists(path: string): Promise<boolean>;
  /** Write a file whole: a temporary file is written, flushed and renamed over it, so it is never half written. Folders are made. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Move a file or a folder into the workspace's `.trash/` (nothing when it is not there). */
  remove(path: string): Promise<void>;
  /** Rename or move a file or a folder inside the workspace (folders are made; refused when the target is taken). */
  rename(from: string, to: string): Promise<void>;
  /** Delete a file for good, not into `.trash/` (a readable copy of a hidden item must not be kept); nothing when it is not there. */
  erase(path: string): Promise<void>;
  /** Make a folder (and its parents) when it is not there. */
  makeFolder(path: string): Promise<void>;
  /** Remove a folder only when it is empty; whether it was removed. */
  removeEmptyFolder(path: string): Promise<boolean>;
  /** When the window closes, `write` runs first (to write what is not in the folder yet); the window waits for it, up to 15 s. */
  onClosing(write: () => Promise<void>): void;
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

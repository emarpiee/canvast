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

/** Where a deleted file of the workspace folder goes. */
export type DeleteMode = "trash" | "system" | "erase";

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
  /**
   * Write a file whole: a temporary file is written, flushed and renamed over it, so it is never half written. Folders are made.
   * `durable: false` does not wait for the disk to confirm it (many files at once): `syncFiles` does that later, for all of them.
   */
  write(path: string, bytes: Uint8Array, opts?: { durable?: boolean }): Promise<void>;
  /** The size of each file of the workspace folder, or null when it is not there (or not a plain file), in one call; nothing is read. */
  sizes(paths: string[]): Promise<Array<number | null>>;
  /** Open a file of the workspace folder in the system's default app for its kind. An error in plain words, or "" when it opened. */
  openFile(path: string): Promise<string>;
  /** Wait until the files written with `durable: false` are really on the disk (one request for the whole disk where it can). */
  syncFiles(paths: string[]): Promise<void>;
  /**
   * Delete a file or a folder the way the person chose (ADR 0177, "Deleting"): into the workspace's `.trash/` (the default),
   * into the system's trash, or for good. Nothing when it is not there.
   */
  remove(path: string, how?: DeleteMode): Promise<void>;
  /** Rename or move a file or a folder inside the workspace (folders are made; refused when the target is taken). */
  rename(from: string, to: string): Promise<void>;
  /** Delete a file for good, not into `.trash/` (a readable copy of a hidden item must not be kept); nothing when it is not there. */
  erase(path: string): Promise<void>;
  /** Make a folder (and its parents) when it is not there. */
  makeFolder(path: string): Promise<void>;
  /** Remove a folder only when it is empty; whether it was removed. */
  removeEmptyFolder(path: string): Promise<boolean>;
  /**
   * When the window closes, `write` runs first (to write what is not in the folder yet); the window waits for it, up to 15 s
   * (or as long as it takes after `holdClose`). `write` resolving to false keeps the window open.
   */
  onClosing(write: () => Promise<boolean | void>): void;
  /** Stop the 15 s limit of a close in progress (the page asks the person first). */
  holdClose(): Promise<void>;
  /** The open workspace folder and the recent ones (newest first), each with whether its folder is still there. */
  workspaces(): Promise<{ current: string; recent: Array<{ path: string; name: string; exists: boolean }> } | null>;
  /**
   * Switch to a recent workspace (its path), another folder ("open": a folder dialog) or a new one ("new": named in a dialog, made
   * empty). The window then closes as always (its work written first, asked when files are still being written) and the app
   * starts again on it. False when nothing was chosen.
   */
  switchWorkspace(to: string): Promise<boolean>;
  /** Take a workspace off the recent list (not the open one; its folder is not touched). */
  forgetWorkspace(path: string): Promise<void>;
  /** Every file under a folder, at any depth, with its size (names starting with a dot, and what is in such folders, left out). */
  tree(path: string): Promise<Array<{ path: string; size: number }>>;
  /** A file's SHA-256 (hex), read in the main process; null when there is no such file. */
  hash(path: string): Promise<string | null>;
  /** The canvas files of the boards: `.canvast/boards/<board>/<name>.cvst`. */
  canvasFiles(): Promise<string[]>;
  /** Told, a moment after the folder changed (by anyone, the app too), which paths changed. */
  onChanged(fn: (paths: string[]) => void): void;
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

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

export interface DesktopBridge {
  /** The workspace folder this window is open on. */
  workspace(): Promise<DesktopWorkspace | null>;
}

/** The bridge when the app runs in the desktop build, else null. */
export function desktopBridge(): DesktopBridge | null {
  return (globalThis as { canvastDesktop?: DesktopBridge }).canvastDesktop ?? null;
}

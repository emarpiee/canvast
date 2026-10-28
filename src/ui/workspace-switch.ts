import { desktopBridge } from "../storage/desktop-bridge";
import { ICONS } from "./icons";
import { openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";

/** How many recent workspaces the switcher lists (the newest; the start dialog shows three). */
const RECENT_SHOWN = 5;

/** Whether this is the desktop build, which can switch workspace folders. */
export const canSwitchWorkspace = (): boolean => !!desktopBridge();

/**
 * The desktop build's workspace switcher (from the navigator's menu, Settings > Storage and the command palette): the open
 * workspace, the recent ones (the latest few whose folders are there), another folder, a new one, and clearing the recent list.
 * Switching closes the window as always, its work written first, then the app starts again on the folder chosen.
 */
export async function openWorkspaceSwitcher(anchor: HTMLElement): Promise<void> {
  const bridge = desktopBridge();
  const ws = await bridge?.workspaces();
  if (!bridge || !ws) return;
  const go = (to: string): void => void bridge.switchWorkspace(to);
  const others = ws.recent.filter((w) => w.path !== ws.current);
  const here = ws.recent.find((w) => w.path === ws.current);
  const items: MenuItem[] = [
    { label: here?.name ?? ws.current.split(/[\\/]/).pop() ?? ws.current, icon: ICONS.folderClock, hint: ws.current, checked: true, id: "current", run: () => undefined },
    // (a recent one whose folder is gone is left out: it can only be cleared)
    ...others
      .filter((w) => w.exists)
      .slice(0, RECENT_SHOWN)
      .map((w): MenuItem => ({ label: w.name, icon: ICONS.folderClock, hint: w.path, aria: `Switch to the workspace ${w.name}`, id: "recent", run: () => go(w.path) })),
    { label: "Open a folder…", icon: ICONS.folderOpen, hint: "A workspace folder, or any folder to start one in", sep: true, id: "open", run: () => go("open") },
    { label: "New workspace…", icon: ICONS.folderRoot, hint: "A new, empty folder you name", id: "new", run: () => go("new") },
    ...(others.length
      ? [{ label: "Clear the recent list", icon: ICONS.listX, hint: "Only the open workspace stays on it; no folder is touched", sep: true, id: "clear", run: () => void Promise.all(others.map((w) => bridge.forgetWorkspace(w.path))) }]
      : []),
  ];
  openMoreMenu(anchor, items, "Switch workspace");
}

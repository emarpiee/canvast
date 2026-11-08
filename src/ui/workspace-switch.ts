import { desktopBridge } from "../storage/desktop-bridge";
import { ICONS } from "./icons";
import { openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { chooseDialog, confirmDialog, promptDialog } from "./confirm";

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
    { label: "Open a folder…", icon: ICONS.folderOpen, hint: "A workspace, or a folder to start one in", sep: true, id: "open", run: () => go("open") },
    { label: "New workspace…", icon: ICONS.folderRoot, hint: "A new, empty folder you name", id: "new", run: () => go("new") },
    ...(bridge.guest ? [{ label: "Connect to a shared workspace…", icon: ICONS.connectShared, hint: "Look at another computer's, on this network", id: "connect", run: () => void connectShared() }] : []),
    ...(others.length
      ? [{ label: "Clear the recent list", icon: ICONS.listX, hint: "Keeps the open one; no folder is touched", sep: true, id: "clear", run: () => void Promise.all(others.map((w) => bridge.forgetWorkspace(w.path))) }]
      : []),
  ];
  openMoreMenu(anchor, items, "Switch workspace");
}

/**
 * Connect to a workspace another computer shares (ADR 0184): the ones found on this network, or an address typed; the first time, its
 * certificate's fingerprint is shown to compare with that computer's Settings > Sharing. It opens in a window of its own.
 */
export async function connectShared(): Promise<void> {
  const guest = desktopBridge()?.guest;
  if (!guest) return;
  const found = await guest.find();
  let address = "";
  if (found.length) {
    const pick = await chooseDialog({
      title: "Connect to a shared workspace",
      lines: ["These computers share a workspace on this network. You can look at it; nothing you do changes it."],
      choices: [...found.map((h) => ({ value: `${h.address}:${h.port}`, label: h.name, help: `${h.address}:${h.port}` })), { value: "", label: "Another address…", help: "As Settings > Sharing shows it on the other computer" }],
      confirmLabel: "Next",
    });
    if (pick === null) return;
    address = pick;
  }
  let problem = "";
  for (;;) {
    if (!address) {
      const typed = await promptDialog({ title: "Connect to a shared workspace", lines: [...(problem ? [problem] : []), "The address Settings > Sharing shows on the computer that shares it, such as 192.168.1.5:47000."], value: "", confirmLabel: "Next" });
      if (typed === null) return;
      address = typed;
    }
    const host = await guest.check(address);
    if ("error" in host) {
      problem = host.error;
      address = "";
      continue;
    }
    const ok =
      host.known ||
      (await confirmDialog({
        title: "Is this the computer you mean?",
        lines: ["Compare this fingerprint with the one in Settings > Sharing on that computer. Connect only if they are the same: another fingerprint means another computer."],
        facts: [["Address", `${host.address}:${host.port}`], ["Fingerprint", host.fingerprint]],
        confirmLabel: "Connect",
        danger: false,
      }));
    if (ok) await guest.open({ address: host.address, port: host.port, fingerprint: host.fingerprint });
    return;
  }
}

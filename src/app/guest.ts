/**
 * A guest's start (ADR 0184): a page a host serves pairs once (the host's code, then the host allows this device), keeps its token in
 * this site's storage, and reads the workspace through the host. Removed by the host, it pairs again.
 */
import type { DesktopBridge } from "../storage/desktop-bridge";
import { hostCalls, hostStats, isGuestPage, remoteBridge } from "../storage/remote-bridge";
import { promptDialog } from "../ui/confirm";

const TOKEN = "canvast.guest.token";

/** A short name for this device, shown to the host ("Firefox on Linux"). */
function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const system = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}

/** The bridge of this page's host, once paired; null when this page is not a guest's. Throws when the person does not pair. */
export async function guestBridge(): Promise<DesktopBridge | null> {
  if (!isGuestPage()) return null;
  let token = localStorage.getItem(TOKEN);
  if (token && !(await hostCalls(location.origin, token)("canvast:workspace").then(() => true, () => false))) {
    localStorage.removeItem(TOKEN); // (removed by the host, or another host on this address)
    token = null;
  }
  let problem = "";
  while (!token) {
    const code = await promptDialog({
      title: "Connect to this shared workspace",
      lines: [...(problem ? [problem] : []), "Type the six-digit code canvast shows on the computer that shares it (Settings > Sharing). That computer is then asked to allow this device. Nothing here can change the workspace."],
      value: "",
      confirmLabel: "Connect",
    });
    if (code === null) throw new Error("Not connected: reload this page to type the sharing code.");
    const res = await fetch(`${location.origin}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.trim(), name: deviceName() }) }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as { token?: string; error?: string };
    if (res?.ok && body.token) {
      token = body.token;
      localStorage.setItem(TOKEN, token);
    } else problem = body.error ?? "The computer that shares this workspace did not answer.";
  }
  (window as unknown as { __canvastHostStats: typeof hostStats }).__canvastHostStats = hostStats; // (what this page asked its host: tests and #debug)
  return remoteBridge(location.origin, token);
}

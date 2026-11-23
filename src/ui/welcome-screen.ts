import { makeModal, showModal } from "./modal";
import { logoSvg } from "./brand";
import { esc } from "./format";
import { ICONS } from "./icons";
import { commands, pressCommand } from "../commands/registry";
import type { OptionSpec } from "../commands/types";

/** What the desktop app's welcome window gives its page (desktop/welcome-preload.ts): its choices, and the one taken. */
export interface WelcomeBridge {
  /** The recent workspaces still there, and the last one's folder when it is gone. */
  choices(): Promise<{ recent: ReadonlyArray<{ name: string; path: string }>; missing: string | null }>;
  /** `new`, `open`, `quit` or `recent-<n>`: true once a workspace is chosen (this window then closes), false when the person changed their mind. */
  choose(choice: string): Promise<boolean>;
}

/** The welcome window's bridge, when this page is it (the desktop app with no workspace to open). */
export const welcomeBridge = (): WelcomeBridge | null => (globalThis as { canvastWelcome?: WelcomeBridge }).canvastWelcome ?? null;

/**
 * The desktop app's welcome (a first start, or the last workspace's folder gone): the app itself, on an empty canvas kept in memory
 * only, with this card over it, the lock screen's look. It cannot be closed: a workspace is chosen, or the app quits.
 */
export async function openWelcomeScreen(bridge: WelcomeBridge): Promise<void> {
  const { recent, missing } = await bridge.choices();
  const gone = missing ? (missing.split(/[\\/]/).filter(Boolean).pop() ?? missing) : null;
  const dlg = makeModal({
    className: "confirm lock-screen",
    testid: "welcome",
    locked: true,
    titleId: "welcome-title",
    html: `
    <div class="lock-brand"><span class="lock-logo">${logoSvg()}</span><span class="lock-name">canvast</span></div>
    <h2 id="welcome-title">${gone ? `The workspace folder “${esc(gone)}” is not there any more` : "Choose a workspace"}</h2>
    <p class="lock-text">${gone ? `It was at ${esc(missing!)}. It may have been moved or deleted (a deleted folder may still be in the system trash).` : "A workspace is a folder: your boards, canvases and library are files in it."}</p>
    <div class="confirm-actions"><button type="button" class="is-primary" data-go="new" data-testid="welcome-new">New workspace…</button><button type="button" data-go="open" data-testid="welcome-open">Open a folder…</button></div>
    ${recent.length ? `<div class="lock-other" aria-label="Recent workspaces">${recent.map((w, i) => `<button type="button" class="assets-btn" data-go="recent-${i}" data-testid="welcome-recent" title="${esc(w.path)}">${ICONS.folderOpen}<span>${esc(w.name)}</span></button>`).join("")}</div>` : ""}
    <div class="lock-other"><button type="button" class="assets-btn" data-go="quit" data-testid="welcome-quit">${ICONS.x}<span>Quit</span></button></div>`,
  });
  // (each choice is the desktop app's: its folder dialogs, then the workspace's own window; this card stays while one is open)
  // (commands, ADR 0205, refused to outside callers: only the person picks or makes a folder, or quits)
  let busy = false;
  const choose = async (go: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (busy) return { ok: false, error: "A choice is open." };
    busy = true;
    try {
      return (await bridge.choose(go).catch(() => false)) ? { ok: true } : { ok: false, error: "Nothing was chosen." };
    } finally {
      busy = false;
    }
  };
  const INDEX: OptionSpec = { name: "index", type: "number", doc: "which recent workspace, from 0", required: true };
  commands.setProvider("welcome", () => [
    { id: "welcome.new", group: "Welcome", kind: "settings", title: "New workspace…", hint: "An empty folder you name", risk: "refused", why: () => null, exec: () => choose("new") },
    { id: "welcome.open", group: "Welcome", kind: "settings", title: "Open a folder…", hint: "An existing workspace, or a folder to start one in", risk: "refused", why: () => null, exec: () => choose("open") },
    { id: "welcome.recent", group: "Welcome", kind: "settings", title: "Open a recent workspace", hint: "One of the last ones", risk: "refused", options: [INDEX], why: () => (recent.length ? null : "No recent workspace."), exec: (o) => choose(`recent-${Number(o["index"])}`) },
    { id: "welcome.quit", group: "Welcome", kind: "settings", title: "Quit", hint: "No workspace is opened", risk: "refused", why: () => null, exec: () => choose("quit") },
  ]);
  dlg.addEventListener("click", (e) => {
    const go = (e.target as HTMLElement).closest<HTMLElement>("[data-go]")?.dataset["go"];
    if (!go) return;
    const r = /^recent-(\d)$/.exec(go);
    void pressCommand(r ? "welcome.recent" : `welcome.${go}`, r ? { index: Number(r[1]) } : {});
  });
  showModal(dlg);
}

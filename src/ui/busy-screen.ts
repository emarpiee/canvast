import type { EditorState } from "../app/editor-state";
import type { Progress } from "../app/progress";
import { esc } from "./format";
import { logoSvg } from "./brand";

/** The screen in front of the app while work that must not be interrupted runs, with how far it is. */
export interface BusyScreen {
  /** `fraction` null: work of unknown length (the bar moves without a number). */
  update(fraction: number | null, detail: string): void;
  close(): void;
}

/** The busy screen showing now, if any: more work for the same task reports on it (one bar, never two). */
let current: BusyScreen | null = null;
export const currentBusy = (): BusyScreen | null => current;

/**
 * A screen in front of the whole app while work runs that nothing should change half-way (an import, its files being written into
 * the workspace folder): nothing can be clicked or typed until it ends, and Escape does nothing. Its bar is the notices' bar.
 */
export function openBusyScreen(title: string, lines: string[], start = false): BusyScreen {
  const dlg = document.createElement("dialog");
  dlg.className = start ? "confirm busy-screen start-screen" : "confirm busy-screen";
  dlg.dataset["testid"] = start ? "start-screen" : "busy-screen";
  dlg.setAttribute("aria-labelledby", "busy-title");
  dlg.innerHTML = `
    ${start ? `<div class="lock-brand"><span class="lock-logo">${logoSvg()}</span><span class="lock-name">canvast</span></div>` : ""}
    <h2 id="busy-title">${esc(title)}</h2>
    ${lines.map((l) => `<p>${esc(l)}</p>`).join("")}
    <span class="notice-bar busy-bar is-unknown" role="progressbar" aria-labelledby="busy-title" aria-valuemin="0" aria-valuemax="100"><span></span></span>
    <p class="busy-detail" data-testid="busy-detail" aria-live="polite"></p>`;
  document.body.appendChild(dlg);
  const bar = dlg.querySelector<HTMLElement>(".busy-bar")!;
  const detail = dlg.querySelector<HTMLElement>(".busy-detail")!;
  dlg.addEventListener("cancel", (e) => e.preventDefault()); // (Escape does not close it)
  dlg.showModal();
  const screen: BusyScreen = {
    update(fraction, text) {
      bar.classList.toggle("is-unknown", fraction === null);
      const pct = Math.round(Math.min(1, Math.max(0, fraction ?? 0)) * 100);
      (bar.firstElementChild as HTMLElement).style.width = `${pct}%`;
      if (fraction === null) bar.removeAttribute("aria-valuenow");
      else bar.setAttribute("aria-valuenow", String(pct));
      detail.textContent = text;
    },
    close() {
      if (current === screen) current = null;
      dlg.close();
      dlg.remove();
    },
  };
  current = screen;
  return screen;
}

/** A busy screen used as a task's progress (as `beginProgress`): `done` and `fail` close it and say the result as a message. */
export function busyProgress(editor: EditorState, title: string, lines: string[] = []): Progress {
  const screen = openBusyScreen(title, lines);
  const end = (message?: string): void => {
    screen.close();
    if (message) {
      editor.message = message;
      editor.changed();
    }
  };
  return { update: (fraction, detail) => screen.update(fraction, detail ?? ""), done: (result) => end(result), fail: (text) => end(text) };
}

/**
 * The screen in front of the app while a workspace opens (the logo, the workspace's name and what is being done), so nothing can be
 * used half-loaded. It steps aside for the lock screen and is closed once everything is ready.
 */
export function openStartScreen(name: string): BusyScreen {
  const screen = openBusyScreen(name ? `Opening “${name}”` : "Opening the workspace", [], true);
  screen.update(null, "Reading the workspace");
  return screen;
}

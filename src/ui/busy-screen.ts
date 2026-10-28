import { esc } from "./format";

/** The screen in front of the app while work that must not be interrupted runs, with how far it is. */
export interface BusyScreen {
  update(fraction: number, detail: string): void;
  close(): void;
}

/**
 * A screen in front of the whole app while work runs that nothing should change half-way (the files of an import being written
 * into the workspace folder): nothing can be clicked or typed until it ends, and Escape does nothing. Its bar is the notices' bar.
 */
export function openBusyScreen(title: string, lines: string[]): BusyScreen {
  const dlg = document.createElement("dialog");
  dlg.className = "confirm busy-screen";
  dlg.dataset["testid"] = "busy-screen";
  dlg.setAttribute("aria-labelledby", "busy-title");
  dlg.innerHTML = `
    <h2 id="busy-title">${esc(title)}</h2>
    ${lines.map((l) => `<p>${esc(l)}</p>`).join("")}
    <span class="notice-bar busy-bar" role="progressbar" aria-labelledby="busy-title" aria-valuemin="0" aria-valuemax="100"><span></span></span>
    <p class="busy-detail" data-testid="busy-detail" aria-live="polite"></p>`;
  document.body.appendChild(dlg);
  const bar = dlg.querySelector<HTMLElement>(".busy-bar")!;
  const detail = dlg.querySelector<HTMLElement>(".busy-detail")!;
  dlg.addEventListener("cancel", (e) => e.preventDefault()); // (Escape does not close it)
  dlg.showModal();
  return {
    update(fraction, text) {
      const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      (bar.firstElementChild as HTMLElement).style.width = `${pct}%`;
      bar.setAttribute("aria-valuenow", String(pct));
      detail.textContent = text;
    },
    close() {
      dlg.close();
      dlg.remove();
    },
  };
}

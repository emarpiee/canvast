import { esc } from "./format";

export interface ConfirmOptions {
  title: string;
  /** Plain-text lines shown as paragraphs. */
  lines: string[];
  confirmLabel: string;
  /** Style the confirm button as destructive (default true). */
  danger?: boolean;
}

/**
 * Modal confirmation for destructive or significant actions. A native modal <dialog> keeps
 * focus inside and closes on Escape (which answers "no"). The default focus
 * is Cancel, so pressing Enter by reflex never deletes anything.
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const dlg = document.createElement("dialog");
  dlg.className = "confirm";
  dlg.dataset["testid"] = "confirm-dialog";
  dlg.setAttribute("aria-labelledby", "confirm-title");
  dlg.innerHTML = `
    <h2 id="confirm-title">${esc(opts.title)}</h2>
    ${opts.lines.map((l) => `<p>${esc(l)}</p>`).join("")}
    <div class="confirm-actions">
      <button type="button" data-testid="confirm-cancel" value="cancel">Cancel</button>
      <button type="button" class="${opts.danger === false ? "is-primary" : "is-danger"}" data-testid="confirm-ok" value="ok">${esc(opts.confirmLabel)}</button>
    </div>`;
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    let answer = false;
    dlg.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      answer = b.value === "ok";
      dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(answer);
    });
    dlg.showModal();
    dlg.querySelector<HTMLButtonElement>('[value="cancel"]')!.focus();
  });
}

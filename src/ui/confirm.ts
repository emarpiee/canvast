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

export interface ChooseOptions {
  title: string;
  lines: string[];
  /** The ways to go on: one is picked (the first is selected). */
  choices: Array<{ value: string; label: string; help: string }>;
  confirmLabel: string;
}

/** Modal choice between a few options (radio buttons). Resolves with the picked value, or null when cancelled. */
export function chooseDialog(opts: ChooseOptions): Promise<string | null> {
  const dlg = document.createElement("dialog");
  dlg.className = "confirm";
  dlg.dataset["testid"] = "choose-dialog";
  dlg.setAttribute("aria-labelledby", "choose-title");
  dlg.innerHTML = `
    <h2 id="choose-title">${esc(opts.title)}</h2>
    ${opts.lines.map((l) => `<p>${esc(l)}</p>`).join("")}
    <div class="choose-list" role="radiogroup" aria-labelledby="choose-title">
      ${opts.choices.map((c, i) => `<label class="choose-item"><input type="radio" name="choose" value="${esc(c.value)}"${i === 0 ? " checked" : ""}><span><strong>${esc(c.label)}</strong><small>${esc(c.help)}</small></span></label>`).join("")}
    </div>
    <div class="confirm-actions">
      <button type="button" data-testid="choose-cancel" value="cancel">Cancel</button>
      <button type="button" class="is-primary" data-testid="choose-ok" value="ok">${esc(opts.confirmLabel)}</button>
    </div>`;
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    let answer: string | null = null;
    dlg.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      if (b.value === "ok") answer = dlg.querySelector<HTMLInputElement>('input[name="choose"]:checked')?.value ?? null;
      dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(answer);
    });
    dlg.showModal();
    dlg.querySelector<HTMLInputElement>('input[name="choose"]:checked')?.focus();
  });
}

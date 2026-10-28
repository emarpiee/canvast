import { esc } from "./format";
import { ICONS } from "./icons";

/** A password input with a button that shows what was typed and hides it again (`attrs`: the input's own attributes). */
export function secretFieldHtml(attrs: string): string {
  return `<span class="secret-field"><input type="password" class="prompt-input" ${attrs}><button type="button" class="secret-reveal" data-testid="secret-reveal" aria-pressed="false" aria-label="Show the password" title="Show the password">${ICONS.passwordShow}</button></span>`;
}

/** Make the reveal button of every secret field in `root` work (the input keeps the focus and the caret). */
export function wireSecretFields(root: HTMLElement): void {
  for (const field of root.querySelectorAll<HTMLElement>(".secret-field")) {
    const input = field.querySelector<HTMLInputElement>("input")!;
    const btn = field.querySelector<HTMLButtonElement>(".secret-reveal")!;
    btn.addEventListener("pointerdown", (e) => e.preventDefault()); // (the input keeps the focus)
    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", String(show));
      const label = show ? "Hide the password" : "Show the password";
      btn.setAttribute("aria-label", label);
      btn.title = label;
      btn.innerHTML = show ? ICONS.passwordHide : ICONS.passwordShow;
    });
  }
}

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

export interface PromptOptions {
  title: string;
  lines: string[];
  value: string;
  confirmLabel: string;
  /** The text is a password: hidden as it is typed. */
  secret?: boolean;
}

/** Modal question with one line to type in. Resolves with the text (possibly empty) when confirmed, or null when cancelled. */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  const dlg = document.createElement("dialog");
  dlg.className = "confirm";
  dlg.dataset["testid"] = "prompt-dialog";
  dlg.setAttribute("aria-labelledby", "prompt-title");
  dlg.innerHTML = `
    <h2 id="prompt-title">${esc(opts.title)}</h2>
    ${opts.lines.map((l) => `<p>${esc(l)}</p>`).join("")}
    ${opts.secret
      ? secretFieldHtml(`data-testid="prompt-input" aria-labelledby="prompt-title" autocomplete="new-password" spellcheck="false" value="${esc(opts.value)}"`)
      : `<input type="text" class="prompt-input" data-testid="prompt-input" aria-labelledby="prompt-title" autocomplete="off" spellcheck="false" value="${esc(opts.value)}">`}
    <div class="confirm-actions">
      <button type="button" data-testid="prompt-cancel" value="cancel">Cancel</button>
      <button type="button" class="is-primary" data-testid="prompt-ok" value="ok">${esc(opts.confirmLabel)}</button>
    </div>`;
  document.body.appendChild(dlg);
  const input = dlg.querySelector<HTMLInputElement>(".prompt-input")!;
  wireSecretFields(dlg);
  return new Promise((resolve) => {
    let answer: string | null = null;
    dlg.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b || b.classList.contains("secret-reveal")) return;
      if (b.value === "ok") answer = input.value;
      dlg.close();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      answer = input.value;
      dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(answer);
    });
    dlg.showModal();
    input.focus();
    input.select();
  });
}

import { logoSvg } from "./brand";

/**
 * The screen in front of a workspace that has a password: nothing is read or drawn until the right one is typed. It cannot be closed (Escape does
 * nothing). A gate, not encryption.
 */
export function openLockScreen(check: (typed: string) => Promise<boolean>): Promise<void> {
  const dlg = document.createElement("dialog");
  dlg.className = "confirm lock-screen";
  dlg.dataset["testid"] = "lock-screen";
  dlg.setAttribute("aria-labelledby", "lock-title");
  dlg.innerHTML = `
    <div class="lock-brand"><span class="lock-logo">${logoSvg()}</span><span class="lock-name">canvast</span></div>
    <h2 id="lock-title">This workspace is locked</h2>
    <p class="lock-text">Enter the password to open it.</p>
    <input type="password" class="prompt-input" data-testid="lock-input" aria-labelledby="lock-title" autocomplete="current-password" spellcheck="false">
    <p class="lock-error" data-lock-error role="alert" hidden>That is not the password.</p>
    <div class="confirm-actions"><button type="button" class="is-primary" data-testid="lock-ok">Open</button></div>`;
  document.body.appendChild(dlg);
  const input = dlg.querySelector<HTMLInputElement>(".prompt-input")!;
  const error = dlg.querySelector<HTMLElement>("[data-lock-error]")!;
  return new Promise((resolve) => {
    let busy = false;
    const submit = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      const ok = await check(input.value).catch(() => false);
      busy = false;
      if (ok) {
        dlg.close();
        dlg.remove();
        resolve();
        return;
      }
      error.hidden = false;
      input.value = "";
      input.focus();
    };
    dlg.addEventListener("cancel", (e) => e.preventDefault()); // (Escape does not close it)
    dlg.querySelector("[data-testid=lock-ok]")!.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      void submit();
    });
    dlg.showModal();
    input.focus();
  });
}

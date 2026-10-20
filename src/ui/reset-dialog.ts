import { plural } from "../doc/plural";
import { esc } from "./format";

export interface ResetDeps {
  /** What is about to be deleted, one plain line each. */
  summary: string[];
  /** When the last backup was made, in words ("never" counts: it is the strongest reason to export first). */
  lastBackup: string;
  /** The library folder, when one is in use: how many files it holds. */
  folderFiles: number | null;
  /** What to do before deleting; each resolves true when it worked. */
  exportFull(): Promise<boolean>;
  exportFiles(): Promise<boolean>;
  saveLibrary: (() => Promise<boolean>) | null;
}

export const RESET_WORD = "DELETE";

/**
 * The warning before "start from scratch": what goes, what to do first (each suggestion is a button that runs here and
 * ticks off), a note that the library folder's files are never touched, and a word to type. Resolves true to delete.
 */
export function confirmReset(d: ResetDeps): Promise<boolean> {
  const dlg = document.createElement("dialog");
  dlg.className = "confirm reset-dialog";
  dlg.dataset["testid"] = "reset-dialog";
  dlg.setAttribute("aria-labelledby", "reset-title");
  const step = (id: string, label: string, help: string): string => `<div class="reset-step"><button type="button" data-step="${id}">${esc(label)}</button><span>${esc(help)}</span><b data-done="${id}" aria-live="polite"></b></div>`;
  dlg.innerHTML = `
    <h2 id="reset-title">Delete all canvast data?</h2>
    <p><strong>This cannot be undone.</strong> canvast starts again as if it was never used in this browser.</p>
    <ul class="reset-list">${d.summary.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <h3>Before you delete</h3>
    <p class="reset-last">Last backup: ${esc(d.lastBackup)}</p>
    ${step("full", "Export a backup (.canvast)", "Everything, including the files: the way back.")}
    ${step("files", "Export all files as ZIP", "Just your original files, as they were.")}
    ${d.saveLibrary ? step("library", "Save library to the folder", "Your canvases and the library's names and tags, beside the files in the library folder.") : ""}
    ${d.folderFiles !== null ? `<p class="reset-kept" data-testid="reset-kept"><strong>The ${plural(d.folderFiles, "file")} in the library folder ${d.folderFiles === 1 ? "is" : "are"} not touched.</strong> canvast never deletes files from your disk in bulk. They stay where they are; to remove them, delete the folder yourself.</p>` : ""}
    <label class="reset-type"><span>Type <strong>${RESET_WORD}</strong> to confirm</span><input type="text" data-testid="reset-word" autocomplete="off" spellcheck="false"></label>
    <div class="confirm-actions">
      <button type="button" data-testid="reset-cancel" value="cancel">Cancel</button>
      <button type="button" class="is-danger" data-testid="reset-ok" value="ok" disabled>Delete everything</button>
    </div>`;
  document.body.appendChild(dlg);
  const ok = dlg.querySelector<HTMLButtonElement>('[value="ok"]')!;
  const word = dlg.querySelector<HTMLInputElement>('[data-testid="reset-word"]')!;
  word.addEventListener("input", () => (ok.disabled = word.value.trim() !== RESET_WORD));
  return new Promise((resolve) => {
    let answer = false;
    dlg.addEventListener("click", async (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      const id = b.dataset["step"];
      if (id) {
        const run = id === "full" ? d.exportFull : id === "files" ? d.exportFiles : d.saveLibrary;
        const mark = dlg.querySelector<HTMLElement>(`[data-done="${id}"]`)!;
        b.disabled = true;
        mark.textContent = "…";
        try {
          mark.textContent = (await run!()) ? "Done ✓" : "Failed";
        } catch {
          mark.textContent = "Failed";
        }
        b.disabled = false;
        return;
      }
      if (b.value === "ok" && word.value.trim() === RESET_WORD) answer = true;
      if (b.value) dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(answer);
    });
    dlg.showModal();
    dlg.querySelector<HTMLButtonElement>('[value="cancel"]')!.focus();
  });
}

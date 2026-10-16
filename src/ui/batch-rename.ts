import { applyRule, ruleProblem, splitName } from "../doc/rename-rules";
import type { RenameMode, RenameRule } from "../doc/rename-rules";
import { esc } from "./format";

/**
 * The rename dialog (ADR 0085), for one thing or many, in the manner of a file manager's batch rename: *How to rename* (enumerate,
 * replace text, add text, change the extension), the fields of that way, and a preview of the new names before anything changes. One item
 * is just a name to edit. It knows nothing about what is renamed: give it names, get names back, so assets, layers, bookmarks or boards can
 * all use it. The rules themselves are in `doc/rename-rules.ts`.
 */
export interface RenameItem {
  id: string;
  name: string;
}

export interface RenameOptions {
  /** What is being renamed, for the title ("3 assets"). Default: "items". */
  noun?: string;
  /** Names have file extensions (the default): offers "Keep the file extension" and "Change the extension". */
  extensions?: boolean;
}

const MODES: ReadonlyArray<[RenameMode, string]> = [
  ["enumerate", "Enumerate"],
  ["replace", "Replace text"],
  ["add", "Add text"],
  ["extension", "Change the extension"],
];

let lastMode: RenameMode = "enumerate";

/** Resolves with the items whose name changed (id and new name), or null when cancelled or nothing changed. */
export function openBatchRename(items: readonly RenameItem[], opts: RenameOptions = {}): Promise<RenameItem[] | null> {
  const ext = opts.extensions !== false;
  const one = items.length === 1;
  const noun = opts.noun ?? "items";
  const dlg = document.createElement("dialog");
  dlg.className = "confirm rename-dialog";
  dlg.dataset["testid"] = "rename-dialog";
  dlg.setAttribute("aria-labelledby", "rn-title");
  const modes = MODES.filter(([m]) => ext || m !== "extension");
  dlg.innerHTML = `
    <h2 id="rn-title">${one ? "Rename" : `Rename ${items.length} ${esc(noun)}`}</h2>
    ${
      one
        ? `<label class="rn-field"><span>New name</span><input type="text" class="rn-input" data-rn="one" value="${esc(items[0]!.name)}" aria-label="New name" maxlength="200" autocomplete="off" spellcheck="false"></label>`
        : `<div class="rn-row"><label for="rn-mode">How to rename:</label>
             <select id="rn-mode" data-rn="mode">${modes.map(([m, l]) => `<option value="${m}">${esc(l)}</option>`).join("")}</select></div>
           <div class="rn-fields" data-for="enumerate">
             <label class="rn-field"><span>Rename the ${items.length} selected ${esc(noun)} to</span><input type="text" class="rn-input" data-rn="pattern" value="New name #" aria-label="Name pattern" maxlength="200" autocomplete="off" spellcheck="false"></label>
             <label class="rn-inline"><span># is replaced by ascending numbers, starting with</span><input type="number" class="rn-num" data-rn="start" value="1" min="0" step="1" aria-label="First number"></label>
           </div>
           <div class="rn-fields" data-for="replace" hidden>
             <label class="rn-field"><span>Replace</span><input type="text" class="rn-input" data-rn="find" aria-label="Text to find" autocomplete="off" spellcheck="false"></label>
             <label class="rn-field"><span>with</span><input type="text" class="rn-input" data-rn="with" aria-label="Replace with" autocomplete="off" spellcheck="false"></label>
             <div class="rn-checks"><label><input type="checkbox" data-rn="case"> Match the case</label><label><input type="checkbox" data-rn="regex"> Regular expression</label></div>
           </div>
           <div class="rn-fields" data-for="add" hidden>
             <label class="rn-field"><span>Text to add</span><input type="text" class="rn-input" data-rn="text" aria-label="Text to add" autocomplete="off" spellcheck="false"></label>
             <div class="rn-checks"><label><input type="radio" name="rn-where" value="before" data-rn="where"> Before the name</label><label><input type="radio" name="rn-where" value="after" data-rn="where" checked> After the name</label></div>
           </div>
           <div class="rn-fields" data-for="extension" hidden>
             <label class="rn-field"><span>New extension (empty removes it)</span><input type="text" class="rn-input" data-rn="ext" aria-label="New extension" maxlength="8" autocomplete="off" spellcheck="false" placeholder="png"></label>
           </div>
           ${ext ? `<label class="rn-keep"><input type="checkbox" data-rn="keep" checked> Keep the file extension</label>` : ""}
           <h3 class="rn-h">Preview</h3>
           <ul class="rn-preview" data-testid="rename-preview" aria-live="polite"></ul>`
    }
    <p class="rn-error" role="alert" data-testid="rename-error"></p>
    <div class="confirm-actions">
      <button type="button" value="cancel" data-testid="rename-cancel">Cancel</button>
      <button type="button" class="is-primary" value="ok" data-testid="rename-ok">Rename</button>
    </div>`;
  document.body.appendChild(dlg);
  const q = <T extends HTMLElement>(sel: string): T => dlg.querySelector<T>(sel)!;
  const field = (k: string): HTMLInputElement => q<HTMLInputElement>(`[data-rn="${k}"]`);
  const modeSel = one ? null : q<HTMLSelectElement>('[data-rn="mode"]');
  if (modeSel) modeSel.value = modes.some(([m]) => m === lastMode) ? lastMode : "enumerate";
  const ok = q<HTMLButtonElement>('[value="ok"]');
  const err = q<HTMLElement>(".rn-error");

  const rule = (): RenameRule => {
    const mode = (modeSel?.value ?? "enumerate") as RenameMode;
    const keepExt = ext ? field("keep").checked : false;
    if (mode === "enumerate") return { mode, pattern: field("pattern").value, start: Math.floor(Number(field("start").value)), keepExt };
    if (mode === "replace") return { mode, find: field("find").value, with: field("with").value, matchCase: field("case").checked, regex: field("regex").checked, keepExt };
    if (mode === "add") return { mode, text: field("text").value, where: (dlg.querySelector<HTMLInputElement>('[data-rn="where"]:checked')?.value ?? "after") as "before" | "after", keepExt };
    return { mode: "extension", ext: field("ext").value };
  };
  const newNames = (): string[] => {
    if (one) {
      const v = field("one").value.trim();
      return [v || items[0]!.name];
    }
    return applyRule(items.map((i) => i.name), rule());
  };
  const refresh = (): void => {
    if (modeSel) {
      for (const f of dlg.querySelectorAll<HTMLElement>(".rn-fields")) f.hidden = f.dataset["for"] !== modeSel.value;
      const keep = dlg.querySelector<HTMLElement>(".rn-keep");
      if (keep) keep.hidden = modeSel.value === "extension";
    }
    const problem = one ? null : ruleProblem(rule());
    err.textContent = problem ?? "";
    const next = newNames();
    const changed = next.filter((n, i) => n !== items[i]!.name).length;
    ok.disabled = !!problem || changed === 0;
    if (!one) {
      // Every name, whole: the old one, then the new one under it (long names wrap); the list scrolls.
      q<HTMLElement>(".rn-preview").innerHTML = items
        .map((it, i) => {
          const same = next[i] === it.name;
          return `<li class="${same ? "is-same" : ""}"><span class="rn-old">${esc(it.name)}</span><span class="rn-new"><span class="rn-arrow" aria-hidden="true">→</span> ${esc(next[i]!)}</span></li>`;
        })
        .join("");
      q<HTMLElement>(".rn-h").textContent = `Preview (${changed === items.length ? `all ${items.length} change` : `${changed} of ${items.length} change`})`;
    }
  };
  dlg.addEventListener("input", refresh);
  dlg.addEventListener("change", refresh);

  return new Promise((resolve) => {
    let answer: RenameItem[] | null = null;
    const finish = (): void => {
      const next = newNames();
      const out = items.flatMap((it, i) => (next[i] && next[i] !== it.name ? [{ id: it.id, name: next[i]! }] : []));
      if (modeSel) lastMode = modeSel.value as RenameMode;
      answer = out.length ? out : null;
      dlg.close();
    };
    dlg.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      if (b.value === "ok" && !b.disabled) finish();
      else if (b.value === "cancel") dlg.close();
    });
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && !ok.disabled) {
        e.preventDefault();
        finish();
      }
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(answer);
    });
    refresh();
    dlg.showModal();
    // The name to edit gets the focus, with the part before the extension selected (a file manager does the same).
    const first = one ? field("one") : (modeSel as HTMLElement);
    first.focus();
    if (one) {
      const v = field("one").value;
      field("one").setSelectionRange(0, ext ? splitName(v).stem.length : v.length);
    }
  });
}

/** The workspace's `.trash/` in the library: its files, what each is, Restore and Delete for good. Only what the storage gives for the mode: never the system's trash. */
import { plural } from "../doc/plural";
import type { TrashFile } from "../storage/store";
import { confirmDialog } from "./confirm";
import { esc, fmtBytes } from "./format";
import { ICONS } from "./icons";

export interface TrashDeps {
  list(): Promise<TrashFile[]>;
  read(path: string): Promise<Blob | null>;
  restore(path: string): Promise<"restored" | "already" | "shut">;
  erase(path: string): Promise<void>;
  say(text: string): void;
  changed(n: number): void;
  readOnly(): boolean;
}

/** How many rows are drawn at once: a long trash shows more on asking. */
const PAGE = 300;
const PICTURE = /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i;

/** The search box's word for this view, and what else it says (a filter by name). */
export const TRASH_WORD = /(^|\s)is:trash(?=\s|$)/i;

export function mountTrashView(box: HTMLElement, deps: TrashDeps): { show(words: string): Promise<void>; refresh(): Promise<void> } {
  let files: TrashFile[] = [];
  let words: string[] = [];
  let shown = PAGE;
  const urls = new Set<string>();
  const seeing = new IntersectionObserver((seen) => {
    for (const s of seen) {
      if (!s.isIntersecting) continue;
      seeing.unobserve(s.target);
      void deps.read((s.target as HTMLElement).dataset["path"]!).then((blob) => {
        if (!blob || !s.target.isConnected) return;
        const url = URL.createObjectURL(blob);
        urls.add(url);
        (s.target as HTMLImageElement).src = url;
      });
    }
  });
  const draw = (): void => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
    const fit = files.filter((f) => words.every((w) => f.name.toLowerCase().includes(w)));
    const dis = deps.readOnly() ? " disabled" : "";
    box.innerHTML = fit.length
      ? `<ul class="trash-list" data-testid="trash-list">${fit.slice(0, shown).map((f) => `<li class="trash-row" data-testid="trash-row">
          ${PICTURE.test(f.name) ? `<img class="trash-thumb" alt="" data-path="${esc(f.path)}">` : `<span class="trash-thumb">${ICONS.fileText}</span>`}
          <span class="trash-name" title="${esc(f.name)}">${esc(f.name)}</span>
          <span class="trash-size">${fmtBytes(f.size)}</span>
          <button type="button" class="assets-btn" data-trash="restore" data-path="${esc(f.path)}"${dis}>${ICONS.archiveRestore}<span>Restore</span></button>
          <button type="button" class="assets-btn is-danger" data-trash="erase" data-path="${esc(f.path)}" data-name="${esc(f.name)}"${dis}>${ICONS.trash2}<span>Delete for good</span></button>
        </li>`).join("")}</ul>${fit.length > shown ? `<button type="button" class="assets-btn" data-trash="more">Show ${plural(Math.min(PAGE, fit.length - shown), "more file")}</button>` : ""}`
      : `<p class="asset-note" data-testid="trash-empty">${files.length ? "No file in the trash has that name." : "The trash is empty. Only this workspace's .trash folder is listed, not your system's trash."}</p>`;
    for (const img of box.querySelectorAll("img[data-path]")) seeing.observe(img);
  };
  const refresh = async (): Promise<void> => {
    files = await deps.list().catch(() => []);
    deps.changed(files.length);
    if (!box.hidden) draw();
  };
  box.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-trash]");
    if (!b || b.disabled) return;
    if (b.dataset["trash"] === "more") {
      shown += PAGE;
      return draw();
    }
    const path = b.dataset["path"]!;
    if (b.dataset["trash"] === "restore") {
      b.disabled = true;
      void deps.restore(path).then((r) => {
        deps.say(r === "restored" ? "Restored to the library." : r === "already" ? "The library already has this file: the copy stays in the trash." : "It could not be opened with this key: it stays in the trash.");
        return refresh();
      }).catch((err: unknown) => {
        deps.say(`Could not restore it: ${(err as Error).message}`);
        return refresh();
      });
      return;
    }
    void confirmDialog({ title: `Delete “${b.dataset["name"]}” for good?`, lines: ["It is erased from the workspace's .trash folder and cannot be brought back."], confirmLabel: "Delete for good" }).then(async (ok) => {
      if (!ok) return;
      await deps.erase(path);
      await refresh();
    });
  });
  return {
    refresh,
    async show(typed) {
      words = typed.replace(TRASH_WORD, " ").toLowerCase().split(/\s+/).filter(Boolean);
      shown = PAGE;
      await refresh();
      draw();
    },
  };
}

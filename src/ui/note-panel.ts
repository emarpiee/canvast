import { noteKindOf } from "../notes/note-file";
import { esc } from "./format";
import { OpenNote } from "./note-session";
import type { NoteDeps, NotePlace } from "./note-session";
import { panelHtml } from "./panel";

/** What the canvas's note panel needs besides what every open note reads. */
export interface NotePanelDeps extends NoteDeps {
  /** Files into the library (the library's own import): their hashes. */
  importFiles(files: File[]): Promise<string[]>;
  /** An item that is not a note, followed from a link: shown in the library. */
  showInLibrary(hash: string): void;
  /** Hidden items are listed (hidden mode, kept on outside the library). */
  hidden(): boolean;
}

/**
 * The note panel on a canvas (a double-click on a note's card, or Edit note in its Actions bar): the notes editor in a large panel over
 * the canvas, the same editor and the same saving as in the library (`OpenNote`). Closing asks about unsaved changes; the canvas stays
 * where it was, and the card shows the saved version at once (it follows the new version, as every placement does).
 */
export function mountNotePanel(deps: NotePanelDeps): { open(hash: string): Promise<boolean> } {
  let dlg: HTMLDialogElement | null = null;
  let note: OpenNote | null = null;
  const shut = (): void => {
    note?.close(true);
    note = null;
    dlg?.close();
    dlg?.remove();
    dlg = null;
  };
  const leave = async (): Promise<boolean> => {
    if (note && !(await note.leave())) return false;
    shut();
    return true;
  };
  const place: NotePlace = {
    importFiles: (files) => deps.importFiles(files),
    // A link to another note opens it here; to anything else, in the library.
    show: async (hash) => {
      const rec = await deps.assets.record(hash).catch(() => undefined);
      if (rec && noteKindOf(rec.name)) await open(hash);
      else if (await leave()) deps.showInLibrary(hash);
    },
    showCanvas: () => shut(),
    moved: () => undefined, // (the card on the canvas follows the new version by itself)
    refresh: async () => undefined,
    hidden: () => deps.hidden(),
  };
  const open = async (hash: string): Promise<boolean> => {
    const rec = await deps.assets.record(hash).catch(() => undefined);
    if (!rec || !noteKindOf(rec.name)) return false;
    // (a hidden note's card is a padlock: it opens only while the hidden items show)
    const e = await deps.session.catalog?.entry(hash).catch(() => undefined);
    if (e?.hidden && !deps.assets.revealing) {
      deps.session.editor.message = "This note is hidden: open it in the library's hidden mode.";
      deps.session.editor.changed();
      return true;
    }
    if (!(await leave())) return true;
    const d = document.createElement("dialog");
    d.className = "note-panel";
    d.dataset["testid"] = "note-panel";
    d.setAttribute("aria-label", `Note: ${rec.name}`);
    d.innerHTML = panelHtml({ title: esc(rec.name), body: `<div class="viewer-note" data-testid="note-editor"><div></div></div>` });
    document.body.append(d);
    dlg = d;
    d.showModal();
    // Esc and the ✕ close it, asking first about unsaved changes (a menu of the editor that is open takes Esc first).
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (!document.querySelector(".sun-editor .se-dropdown[style*='block'], .sun-editor .se-modal-area[style*='block']")) void leave();
    });
    d.querySelector("[data-close]")!.addEventListener("click", () => void leave());
    try {
      note = await OpenNote.open(d.querySelector<HTMLElement>(".viewer-note > div")!, hash, rec.name, rec.blob, deps, place);
    } catch (e) {
      shut();
      deps.session.editor.message = `The notes editor could not open “${rec.name}”: ${(e as Error).message}.`;
      deps.session.editor.changed();
    }
    return true;
  };
  return { open };
}

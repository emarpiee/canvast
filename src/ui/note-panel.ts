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
 * The note panel on a canvas (a double-click on a note's card, Edit note in its Actions bar, a new note of the Note tool): a panel of
 * the dock (`el`, ADR 0123), so it floats, docks to a side and is resized like the others, and the canvas stays usable beside it. Inside,
 * the same editor and saving as in the library (`OpenNote`). Closing asks about unsaved changes; the card on the canvas shows the saved
 * version at once (it follows the new version, as every placement does).
 */
export function mountNotePanel(el: HTMLElement, deps: NotePanelDeps): { open(hash: string): Promise<boolean>; readonly hash: string | null } {
  let note: OpenNote | null = null;
  const shut = (): void => {
    note?.close(true);
    note = null;
    el.hidden = true;
    el.replaceChildren();
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
    if (note?.hash === hash) return (el.hidden = false), true; // (already open here)
    // (a hidden note's card is a padlock: it opens only while the hidden items show)
    const e = await deps.session.catalog?.entry(hash).catch(() => undefined);
    if (e?.hidden && !deps.assets.revealing) {
      deps.session.editor.message = "This note is hidden: open it in the library's hidden mode.";
      deps.session.editor.changed();
      return true;
    }
    if (!(await leave())) return true;
    el.innerHTML = panelHtml({ title: esc(rec.name), body: `<div class="viewer-note" data-testid="note-editor"><div></div></div>` });
    el.setAttribute("aria-label", `Note: ${rec.name}`);
    el.querySelector("[data-close]")!.addEventListener("click", () => void leave());
    el.hidden = false;
    try {
      note = await OpenNote.open(el.querySelector<HTMLElement>(".viewer-note > div")!, hash, rec.name, rec.blob, deps, place);
    } catch (err) {
      shut();
      deps.session.editor.message = `The notes editor could not open “${rec.name}”: ${(err as Error).message}.`;
      deps.session.editor.changed();
    }
    return true;
  };
  return {
    open,
    get hash() {
      return note?.hash ?? null;
    },
  };
}

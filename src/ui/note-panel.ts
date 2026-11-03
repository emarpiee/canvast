import { noteKindOf } from "../notes/note-file";
import { openBatchRename } from "./batch-rename";
import { esc } from "./format";
import { ICONS } from "./icons";
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
export function mountNotePanel(
  hosts: { panel: HTMLElement; window: HTMLElement },
  deps: NotePanelDeps,
  /** Where a note opens (Settings > Notes): the dock's panel, or the window centred over the canvas. */
  mode: () => "panel" | "window",
): { open(hash: string): Promise<boolean>; close(): Promise<boolean>; closeHidden(): void; readonly hash: string | null } {
  let el = hosts.panel; // (the host of the note open now)
  let note: OpenNote | null = null;
  let hiddenOpen = false; // (the note open is a hidden item)
  const shut = (): void => {
    note?.close(true);
    note = null;
    hiddenOpen = false;
    el.hidden = true;
    el.replaceChildren();
  };
  const leave = async (): Promise<boolean> => {
    if (note && !(await note.leave())) return false;
    shut();
    return true;
  };
  const place: NotePlace = {
    styleKey: "notes.panelStyle",
    root: () => el,
    importFiles: (files) => deps.importFiles(files),
    // A link to another note opens it here; to anything else, in the library.
    show: async (hash) => {
      const rec = await deps.assets.record(hash).catch(() => undefined);
      if (rec && noteKindOf(rec.name)) await open(hash, note?.hash === hash);
      else if (await leave()) deps.showInLibrary(hash);
    },
    showCanvas: () => shut(),
    moved: () => undefined, // (the card on the canvas follows the new version by itself)
    refresh: async () => undefined,
    hidden: () => deps.hidden(),
  };
  const open = async (hash: string, /** Opened again: the note became another kind. */ fresh = false): Promise<boolean> => {
    const rec = await deps.assets.record(hash).catch(() => undefined);
    if (!rec || !noteKindOf(rec.name)) return false;
    if (note?.hash === hash && !fresh) return (el.hidden = false), true; // (already open here)
    // (a hidden note's card is a padlock: it opens only while the hidden items show)
    const e = await deps.session.catalog?.entry(hash).catch(() => undefined);
    if (e?.hidden && !deps.assets.revealing) {
      deps.session.editor.message = "This note is hidden: open it in the library's hidden mode.";
      deps.session.editor.changed();
      return true;
    }
    if (!(await leave())) return true;
    el = hosts[mode()];
    hiddenOpen = !!e?.hidden;
    const name0 = (await deps.session.catalog?.entry(hash).catch(() => undefined))?.name ?? rec.name;
    const tools = deps.session.readOnly ? "" : `<button type="button" class="layer-btn" data-rename aria-label="Rename this note" title="Rename this note (F2)">${ICONS.textCursorInput}</button>`;
    el.innerHTML = panelHtml({ title: esc(name0), tools, body: `<div class="viewer-note" data-testid="note-editor"><div></div></div>` });
    el.setAttribute("aria-label", `Note: ${name0}`);
    el.querySelector(".panel-head h2")?.setAttribute("title", name0);
    el.querySelector("[data-close]")!.addEventListener("click", () => void leave());
    el.querySelector("[data-rename]")?.addEventListener("click", () => void rename());
    el.hidden = false;
    try {
      note = await OpenNote.open(el.querySelector<HTMLElement>(".viewer-note > div")!, hash, name0, rec.blob, deps, place);
    } catch (err) {
      shut();
      deps.session.editor.message = `The notes editor could not open “${rec.name}”: ${(err as Error).message}.`;
      deps.session.editor.changed();
    }
    return true;
  };
  /** The library's own rename dialog (one item: the name without its extension; `.note.html` stays whole), from the header. */
  const rename = async (): Promise<void> => {
    const n = note;
    if (!n || deps.session.readOnly) return;
    const name = (await deps.session.catalog?.entry(n.hash).catch(() => undefined))?.name ?? n.name;
    const result = await openBatchRename([{ id: n.hash, name }], { noun: "note" });
    if (!result || !(await deps.session.renameAssets([{ hash: n.hash, name: result[0]!.name }]))) return;
    if (note !== n) return;
    n.name = result[0]!.name;
    el.querySelector(".panel-head h2")!.textContent = n.name;
    el.querySelector(".panel-head h2")!.setAttribute("title", n.name);
    for (const a of ["aria-label", "title"]) el.querySelector("[data-close]")?.setAttribute(a, `Hide the ${n.name} panel`);
    el.setAttribute("aria-label", `Note: ${n.name}`);
    deps.session.editor.message = `Renamed to “${n.name}”.`;
    deps.session.editor.changed();
  };
  for (const host of [hosts.panel, hosts.window])
    host.addEventListener("keydown", (e) => {
      if (e.key === "F2" && !e.ctrlKey && !e.altKey && !e.metaKey) (e.preventDefault(), void rename());
    });
  return {
    open: (hash) => open(hash),
    close: leave,
    // Hidden items are no longer shown (hidden mode ended, the hidden items locked): a hidden note open here closes, its changes saved (OpenNote.close).
    closeHidden: () => void (hiddenOpen && shut()),
    get hash() {
      return note?.hash ?? null;
    },
  };
}

import { openBatchRename } from "./batch-rename";
import { esc } from "./format";
import { ICONS } from "./icons";
import { viewKindOf } from "./file-views";
import type { FileViewKind, OpenView, ViewDeps, ViewPlace } from "./file-views";
import { OpenNote } from "./note-session";
import { panelHtml } from "./panel";

/** What the canvas's file panel needs besides what every open file reads. */
export interface FilePanelDeps extends ViewDeps {
  /** Files into the library (the library's own import): their hashes. */
  importFiles(files: File[]): Promise<string[]>;
  /** An item that is not a note, followed from a link: shown in the library. */
  showInLibrary(hash: string): void;
  /** Hidden items are listed (hidden mode, kept on outside the library). */
  hidden(): boolean;
}

/**
 * The file panel on a canvas (a double-click on a card, its Actions bar, a new note of the Note tool): a panel of the dock (`el`, ADR 0123),
 * so it floats, docks to a side and is resized like the others, and the canvas stays usable beside it. Inside, the same view as in the
 * library's viewer, for whatever kind of file opens in one (ui/file-views.ts). Closing asks about unsaved changes; a card on the canvas shows
 * the saved version at once (it follows the new version, as every placement does).
 */
export function mountFilePanel(
  hosts: { panel: HTMLElement; window: HTMLElement },
  deps: FilePanelDeps,
  /** Where a file opens (Settings > Notes): the dock's panel, or the window centred over the canvas. */
  mode: () => "panel" | "window",
): { open(hash: string, setPreview?: ViewPlace["setPreview"]): Promise<boolean>; close(): Promise<boolean>; closeHidden(): void; readonly hash: string | null } {
  let el = hosts.panel; // (the host of the file open now)
  let note: OpenView | null = null;
  let kind: FileViewKind | null = null;
  let name = "";
  let hiddenOpen = false; // (the file open is a hidden item)
  const label = (k: FileViewKind): string => k.noun[0]!.toUpperCase() + k.noun.slice(1);
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
  const place: ViewPlace = {
    styleKey: "notes.panelStyle",
    root: () => el,
    importFiles: (files) => deps.importFiles(files),
    // A link to another note opens it here; to anything else, in the library.
    show: async (hash) => {
      const rec = await deps.assets.record(hash).catch(() => undefined);
      if (rec && (await viewKindOf({ hash, name: rec.name, blob: rec.blob }))) await open(hash, undefined, note?.hash === hash);
      else if (await leave()) deps.showInLibrary(hash);
    },
    showCanvas: () => shut(),
    moved: () => undefined, // (the card on the canvas follows the new version by itself)
    refresh: async () => undefined,
    hidden: () => deps.hidden(),
  };
  const open = async (hash: string, setPreview?: ViewPlace["setPreview"], /** Opened again: the note became another kind. */ fresh = false): Promise<boolean> => {
    const rec = await deps.assets.record(hash).catch(() => undefined);
    const k = rec ? await viewKindOf({ hash, name: rec.name, blob: rec.blob }) : null;
    if (!rec || !k) return false;
    if (note?.hash === hash && !fresh) return (el.hidden = false), true; // (already open here)
    // (a hidden file's card is a padlock: it opens only while the hidden items show)
    const e = await deps.session.catalog?.entry(hash).catch(() => undefined);
    if (e?.hidden && !deps.assets.revealing) {
      deps.session.editor.message = `This ${k.noun} is hidden: open it in the library's hidden mode.`;
      deps.session.editor.changed();
      return true;
    }
    if (!(await leave())) return true;
    el = hosts[mode()];
    hiddenOpen = !!e?.hidden;
    const name0 = (await deps.session.catalog?.entry(hash).catch(() => undefined))?.name ?? rec.name;
    kind = k;
    name = name0;
    const tools = deps.session.readOnly ? "" : `<button type="button" class="layer-btn" data-rename aria-label="Rename this ${k.noun}" title="Rename this ${k.noun} (F2)">${ICONS.textCursorInput}</button>`;
    el.innerHTML = panelHtml({ title: esc(name0), tools, body: `<div class="viewer-note"${k.id === "note" ? ' data-testid="note-editor"' : ""}><div></div></div>` });
    el.setAttribute("aria-label", `${label(k)}: ${name0}`);
    el.querySelector(".panel-head h2")?.setAttribute("title", name0);
    el.querySelector("[data-close]")!.addEventListener("click", () => void leave());
    el.querySelector("[data-rename]")?.addEventListener("click", () => void rename());
    el.hidden = false;
    try {
      note = await k.open(el.querySelector<HTMLElement>(".viewer-note > div")!, { hash, name: name0, blob: rec.blob }, deps, { ...place, ...(setPreview ? { setPreview } : {}) });
    } catch (err) {
      shut();
      deps.session.editor.message = `This ${k.noun} could not be opened (“${rec.name}”): ${(err as Error).message}.`;
      deps.session.editor.changed();
    }
    return true;
  };
  /** The library's own rename dialog (one item: the name without its extension; `.note.html` stays whole), from the header. */
  const rename = async (): Promise<void> => {
    const n = note, k = kind;
    if (!n || !k || deps.session.readOnly) return;
    const was = (await deps.session.catalog?.entry(n.hash).catch(() => undefined))?.name ?? name;
    const result = await openBatchRename([{ id: n.hash, name: was }], { noun: k.noun });
    if (!result || !(await deps.session.renameAssets([{ hash: n.hash, name: result[0]!.name }]))) return;
    if (note !== n) return;
    name = result[0]!.name;
    if (n instanceof OpenNote) n.name = name;
    el.querySelector(".panel-head h2")!.textContent = name;
    el.querySelector(".panel-head h2")!.setAttribute("title", name);
    for (const a of ["aria-label", "title"]) el.querySelector("[data-close]")?.setAttribute(a, `Hide the ${name} panel`);
    el.setAttribute("aria-label", `${label(k)}: ${name}`);
    deps.session.editor.message = `Renamed to “${name}”.`;
    deps.session.editor.changed();
  };
  for (const host of [hosts.panel, hosts.window])
    host.addEventListener("keydown", (e) => {
      if (e.key === "F2" && !e.ctrlKey && !e.altKey && !e.metaKey) (e.preventDefault(), void rename());
    });
  return {
    open: (hash, setPreview) => open(hash, setPreview),
    close: leave,
    // Hidden items are no longer shown (hidden mode ended, the hidden items locked): a hidden note open here closes, its changes saved (OpenNote.close).
    closeHidden: () => void (hiddenOpen && shut()),
    get hash() {
      return note?.hash ?? null;
    },
  };
}

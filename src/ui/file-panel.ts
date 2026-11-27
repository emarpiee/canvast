import { openBatchRename } from "./batch-rename";
import { esc } from "./format";
import { ICONS } from "./icons";
import { viewKindOf } from "./file-views";
import type { CardActions, FileViewKind, OpenView, ViewDeps, ViewPlace } from "./file-views";
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
): { open(hash: string, card?: CardActions): Promise<boolean>; close(): Promise<boolean>; closeHidden(): void; readonly hash: string | null } {
  let el = hosts.panel; // (the host of the file open now)
  /** The file being opened (its view shown, not ready: its hash), and whether Escape came meanwhile. */
  let opening = "", escaped = false;
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
  const open = async (hash: string, card?: CardActions, /** Opened again: the note became another kind. */ fresh = false): Promise<boolean> => {
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
    // view-state: (closes the panel)
    el.querySelector("[data-close]")!.addEventListener("click", () => void leave());
    el.querySelector("[data-rename]")?.addEventListener("click", () => void rename()); // view-state: (opens the rename dialog of this file)
    el.hidden = false;
    try {
      opening = hash;
      escaped = false;
      note = await k.open(el.querySelector<HTMLElement>(".viewer-note > div")!, { hash, name: name0, blob: rec.blob }, deps, { ...place, ...card }).finally(() => void (opening = ""));
      // (Escape pressed while it was still opening, its words already shown: it closes now)
      if (escaped) return void (await leave()), true;
      if (k.id !== "note") el.querySelector<HTMLElement>(".viewer-note [tabindex]")?.focus({ preventScroll: true });
      // a note: the caret in its words at once, so the keys (Escape too) are the note's from the first one, not the canvas's behind it
      // (after the double-click that opened it has ended: its last release would take the focus back to the canvas)
      else setTimeout(() => {
        const words = el.querySelector<HTMLElement>(".cm-content[contenteditable='true']");
        if (words && !el.contains(document.activeElement)) words.focus({ preventScroll: true });
      }, 50);
    } catch (err) {
      shut();
      deps.session.editor.message = `This ${k.noun} could not be opened (“${rec.name}”): ${(err as Error).message}.`;
      deps.session.editor.changed();
    }
    return true;
  };
  /** The library's own rename dialog (one item: the name without its extension), from the header. */
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
      if (e.key === "F2" && !e.ctrlKey && !e.altKey && !e.metaKey) return e.preventDefault(), void rename();
      // (a view's own keys: its pages, Ctrl+S; they stop here, and do not reach the canvas behind)
      if (note?.key?.(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    });
  // view-state: Escape closes the file open on the canvas (as its × does), asking about unsaved changes. Heard first, before the editor,
  // which takes every Escape for itself: only a menu, list, dialog or find bar of its own (or of the app) that is open takes it instead.
  // (only what opens over the words: the editor's suggestions and its find bar, a menu, a dialog)
  const POPUPS = ".cm-tooltip-autocomplete, .cm-panel.cm-search, .pop-menu, dialog[open]";
  const showing = (q: Element): boolean => (q as HTMLElement).getClientRects().length > 0 && getComputedStyle(q).visibility !== "hidden";
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.isComposing) return;
    if (el.hidden) return void (hosts.panel.dataset["escape"] = `its host hidden (${el === hosts.window ? "window" : "panel"})`);
    if (!note && !opening) return void (hosts.panel.dataset["escape"] = "no note open");
    // in the file, or in the window wherever the focus is; elsewhere (the canvas, the page, whatever holds the focus after the double-click
    // that opened it) when nothing is selected or only the card it opened from: never from a field, a dialog or another panel, whose it is
    const t = e.target instanceof Element ? e.target : null;
    const inside = !!t && el.contains(t);
    const ed = deps.session.editor;
    const onlyItsCard = [...ed.selection].every((id) => { const o = deps.session.doc.get(id); return o?.kind === "image" && o.assetId.split("#")[0] === (note?.hash ?? opening); });
    const elsewhere = !!t && !!t.closest("input, textarea, select, [contenteditable='true'], dialog, .pop-menu, .layers-panel");
    // (why an Escape did not close it, kept on the panel for a test or a bug report to read)
    const why = (w: string): void => void (el.dataset["escape"] = w);
    if (!inside && el !== hosts.window && (elsewhere || !onlyItsCard || ed.editingText)) return why(elsewhere ? "a field or another panel" : ed.editingText ? "editing text" : "something else selected");
    const pop = [...document.querySelectorAll(POPUPS)].find(showing);
    if (pop) return why(`a menu open: ${pop.className}`);
    e.preventDefault();
    e.stopImmediatePropagation();
    why("closing");
    if (!note) return void (escaped = true); // (still opening: closed as soon as it is open)
    void leave().then((ok) => why(ok ? "closed" : "the note refused to leave (unsaved, not saved)"));
  }, true);
  return {
    open: (hash, card) => open(hash, card),
    close: leave,
    // Hidden items are no longer shown (hidden mode ended, the hidden items locked): a hidden note open here closes, its changes saved (OpenNote.close).
    closeHidden: () => void (hiddenOpen && shut()),
    get hash() {
      return note?.hash ?? null;
    },
  };
}

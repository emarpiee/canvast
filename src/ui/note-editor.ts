import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { ViewState } from "../app/view-state";
import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { TextObject } from "../doc/model";
import { homeObject, newObjectId } from "../doc/model";
import { normalizeUnit } from "../doc/edit-ops";
import { MAX_MARKDOWN_LENGTH } from "../text/markdown";
import { NEW_TEXT_PX } from "./text-editor";

/**
 * The note editor (ADR 0032): a panel with SunEditor (balloon toolbar) for one note's Markdown.
 * SunEditor ships inside the file as inert text and is only run when the first note opens.
 * A note is a text object with `note: true`, so it moves, turns, groups and layers like any text.
 */

/** Width of a new note card, in CSS px at the zoom where it is created. */
const NEW_NOTE_WIDTH_PX = 280;

interface Sun {
  set(md: string): void;
  get(): string;
  focus(): void;
}
declare global {
  interface Window {
    __canvastSun?: (el: HTMLElement) => Sun;
  }
}

export interface NoteEditor {
  open(target: TextObject | null, at: WorldPoint): void;
  commit(): void;
  readonly isOpen: boolean;
}

/** Runs the inert editor code on first use. */
function loadSun(el: HTMLElement): Sun {
  if (!window.__canvastSun) {
    const css = document.createElement("style");
    css.textContent = document.getElementById("canvast-sun-css")!.textContent;
    const js = document.createElement("script");
    js.textContent = document.getElementById("canvast-sun-js")!.textContent;
    document.head.append(css, js);
  }
  return window.__canvastSun!(el);
}

export function mountNoteEditor(host: HTMLElement, view: ViewState, doc: DocumentStore, editor: EditorState): NoteEditor {
  const panel = document.createElement("div");
  panel.className = "note-panel";
  panel.hidden = true;
  panel.dataset["testid"] = "note-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Note");
  panel.innerHTML = `<div class="note-host"></div>
    <div class="note-actions"><span>Ctrl+Enter or Esc saves</span><button type="button" data-act="cancel">Cancel</button><button type="button" data-act="done">Done</button></div>`;
  host.append(panel);
  const sunHost = panel.querySelector<HTMLElement>(".note-host")!;

  let sun: Sun | null = null;
  let target: TextObject | null = null;
  let isNew = false;

  const close = (): void => {
    target = null;
    panel.hidden = true;
    host.querySelector<HTMLElement>("canvas")?.focus({ preventScroll: true });
  };

  const commit = (): void => {
    if (!target || !sun) return;
    const md = sun.get();
    if (md.length > MAX_MARKDOWN_LENGTH) {
      editor.message = `Note is too long to save (${md.length.toLocaleString()} of ${MAX_MARKDOWN_LENGTH.toLocaleString()} characters).`;
      editor.changed();
      return;
    }
    const o = target;
    const wasNew = isNew;
    close();
    const cur = doc.get(o.id);
    if (wasNew || !cur || cur.kind !== "text") {
      if (md) doc.commit(doc.transaction("Add note", [homeObject(normalizeUnit({ ...o, md, z: doc.topZ() + 1 }), doc.space)]));
    } else if (!md) {
      doc.commit(doc.transaction("Delete note", [], [o.id]));
      editor.selection.delete(o.id);
    } else if (md !== cur.md) {
      doc.commit(doc.transaction("Edit note", [{ ...cur, md }]));
    }
  };

  const open = (t: TextObject | null, at: WorldPoint): void => {
    commit();
    if (editor.blockEdit()) return;
    if (t) {
      target = t;
      isNew = false;
    } else {
      const cam = view.camera;
      const f = 2 ** cam.zf;
      const size = NEW_TEXT_PX / f;
      const frame = view.frame === doc.space.world ? {} : { frame: view.frame };
      target = { id: newObjectId(), kind: "text", note: true, ...frame, anchor: at, unit: -cam.zi, z: 0, opacity: 1, attachmentTargetId: null, md: "", w: NEW_NOTE_WIDTH_PX / f, size, color: editor.penColor };
      isNew = true;
    }
    sun ??= loadSun(sunHost);
    sun.set(target.md);
    panel.hidden = false;
    sun.focus();
  };

  panel.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset["act"];
    if (act === "done") commit();
    else if (act === "cancel") close();
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      e.stopPropagation();
      commit();
    }
  });

  return {
    open,
    commit,
    get isOpen() {
      return target !== null;
    },
  };
}

import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import { ICONS } from "./icons";

/**
 * The selection action bar (ADR 0051): a small bar next to the selected objects with what is most often wanted next: duplicate,
 * group or ungroup, bring to front, send to back, lock, hide and delete. The same actions as the toolbar (it stays as it is), put
 * where the pointer already is. It follows the selection box through pan and zoom, sits below it (the rotate handle is above) or
 * above it when the screen edge is in the way, and is hidden while the selection is being moved, scaled or turned, while text is
 * being edited, and with the Hand, Pen, Text and eraser tools (which do not select).
 */
export interface ContextActions {
  duplicate(): void;
  group(): void;
  ungroup(): void;
  arrange(to: "front" | "back"): void;
  setFlag(flag: "hidden" | "locked"): void;
  deleteSelection(): void;
}

const GAP = 12;
const MARGIN = 8;

export function mountContextBar(host: HTMLElement, editor: EditorState, doc: DocumentStore, actions: ContextActions, hidden: () => boolean): { update(): void } {
  const bar = document.createElement("div");
  bar.className = "ctx-bar";
  bar.dataset["testid"] = "context-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Selection actions");
  bar.hidden = true;
  const btn = (act: string, icon: string, label: string): string => `<button type="button" data-ctx="${act}" aria-label="${label}" title="${label}">${icon}</button>`;
  bar.innerHTML =
    btn("duplicate", ICONS.copy, "Duplicate") +
    btn("group", ICONS.group, "Group") +
    btn("ungroup", ICONS.ungroup, "Ungroup") +
    btn("front", ICONS.bringToFront, "Bring to front") +
    btn("back", ICONS.sendToBack, "Send to back") +
    btn("lock", ICONS.lockKeyhole, "Lock selection") +
    btn("hide", ICONS.eyeOff, "Hide selection") +
    btn("delete", ICONS.trash, "Delete selection");
  host.appendChild(bar);
  const q = (act: string): HTMLButtonElement => bar.querySelector<HTMLButtonElement>(`[data-ctx="${act}"]`)!;

  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ctx]");
    if (!b) return;
    switch (b.dataset["ctx"]) {
      case "duplicate": actions.duplicate(); break;
      case "group": actions.group(); break;
      case "ungroup": actions.ungroup(); break;
      case "front": actions.arrange("front"); break;
      case "back": actions.arrange("back"); break;
      case "lock": actions.setFlag("locked"); break;
      case "hide": actions.setFlag("hidden"); break;
      case "delete": actions.deleteSelection(); break;
    }
  });
  // The bar must not start a drag or a selection change on the canvas below it.
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());

  let lastKey = "";
  const update = (): void => {
    const box = editor.selectionBoxOnScreen;
    const show = !hidden() && editor.selection.size > 0 && (editor.tool === "select" || editor.tool === "lasso") && editor.preview.kind === "none" && !!box;
    if (!show || !box) {
      if (!bar.hidden) bar.hidden = true;
      lastKey = "";
      return;
    }
    const sel = [...editor.selection].map((id) => doc.get(id)).filter((o) => !!o);
    q("group").hidden = sel.length < 2 || sel.every((o) => (o!.groups?.length ?? 0) > 0 && new Set(sel.map((x) => x!.groups![0])).size === 1);
    q("ungroup").hidden = !sel.some((o) => o!.groups?.length);
    bar.hidden = false;
    const xs = box.frame.corners.map((c) => c[0]);
    const ys = box.frame.corners.map((c) => c[1]);
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const vw = host.clientWidth;
    const vh = host.clientHeight;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    let top = Math.max(...ys) + GAP;
    if (top + h > vh - MARGIN) top = Math.min(...ys) - GAP - h - 24; // no room below: above the rotate handle
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    const left = Math.max(MARGIN, Math.min(cx - w / 2, vw - w - MARGIN));
    const key = `${Math.round(left)},${Math.round(top)}`;
    if (key !== lastKey) {
      bar.style.left = `${Math.round(left)}px`;
      bar.style.top = `${Math.round(top)}px`;
      lastKey = key;
    }
  };
  editor.subscribe(update);
  return { update };
}

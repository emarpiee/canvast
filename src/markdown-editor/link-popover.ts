// The link popover: the pointer resting on a `[[wiki link]]` (or Ctrl+Shift+K with the cursor on one) opens the note it names in a small
// editor over this one, to read and to write in (saved as it is typed). A link that names nothing offers to make the note; a picture shows.
import type { EditorView } from "@codemirror/view";

/** What a wiki link names, as the host finds it. */
export type LinkTarget =
  | { kind: "note"; title: string; text: string; save(text: string): Promise<void> }
  | { kind: "media"; title: string; url: string; type: string }
  | { kind: "missing"; title: string };

export interface PopoverWords {
  open: string;
  create: string;
  missing: string;
  close: string;
}

/** A small editor for the popover's note (the package's own, made by the editor so this file needs none of it). */
export type MiniEditor = (parent: HTMLElement, text: string, onChange: (text: string) => void) => { focus(): void; destroy(): void };

export interface LinkPopoverOptions {
  find(target: string): Promise<LinkTarget | null>;
  create?(target: string): Promise<boolean>;
  open(target: string): void;
  editor: MiniEditor;
  words: PopoverWords;
}

/** Wire the popover to an editor; returns what opens it at the cursor and what removes it. */
export function linkPopover(view: EditorView, opts: LinkPopoverOptions): { atCursor(): boolean; destroy(): void } {
  let box: HTMLElement | null = null;
  let current = "";
  let mini: { focus(): void; destroy(): void } | null = null;
  let flush: (() => void) | null = null;
  let openTimer = 0, closeTimer = 0;

  const close = (): void => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    flush?.();
    flush = null;
    mini?.destroy();
    mini = null;
    box?.remove();
    box = null;
    current = "";
  };
  const soonClose = (): void => {
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(close, 350);
  };

  const show = async (target: string, anchor: DOMRect, focus: boolean): Promise<void> => {
    if (current === target && box) return;
    close();
    current = target;
    const found = await opts.find(target);
    if (current !== target) return;
    box = document.createElement("div");
    box.className = "me-link-pop";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", found?.title ?? target);
    const head = document.createElement("div");
    head.className = "me-link-pop-head";
    const title = document.createElement("span");
    title.className = "me-link-pop-title";
    title.textContent = found?.title ?? target;
    head.append(title);
    const body = document.createElement("div");
    body.className = "me-link-pop-body";
    const button = (label: string, run: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "me-btn me-link-pop-btn";
      b.textContent = label;
      // view-state: (the popover's buttons open the note, make it or close the popover)
      b.addEventListener("click", run);
      return b;
    };
    if (!found || found.kind === "missing") {
      body.textContent = opts.words.missing.replace("{name}", target);
      if (opts.create) head.append(button(opts.words.create, () => void opts.create!(target).then((ok) => ok && ((current = ""), void show(target, anchor, true)))));
    } else if (found.kind === "media") {
      head.append(button(opts.words.open, () => (close(), opts.open(target))));
      const img = document.createElement(found.type.startsWith("video/") ? "video" : "img");
      (img as HTMLImageElement).src = found.url;
      if (img instanceof HTMLVideoElement) img.controls = true;
      body.append(img);
    } else {
      head.append(button(opts.words.open, () => (close(), opts.open(target))));
      // (saved a moment after typing stops, and when the popover closes)
      let pending: string | null = null;
      let timer = 0;
      flush = () => {
        clearTimeout(timer);
        if (pending !== null) void found.save(pending);
        pending = null;
      };
      mini = opts.editor(body, found.text, (text) => {
        pending = text;
        clearTimeout(timer);
        timer = window.setTimeout(() => flush?.(), 600);
      });
    }
    box.append(head, body);
    document.body.append(box);
    const w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - w - 8))}px`;
    box.style.top = `${anchor.bottom + 6 + h > innerHeight - 8 ? Math.max(8, anchor.top - h - 6) : anchor.bottom + 6}px`;
    box.addEventListener("pointerenter", () => clearTimeout(closeTimer));
    box.addEventListener("pointerleave", () => !box?.contains(document.activeElement) && soonClose());
    box.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
      view.focus();
    });
    if (focus) mini?.focus();
  };

  const linkEl = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>("[data-wiki]") : null);
  const move = (e: PointerEvent): void => {
    const a = linkEl(e.target);
    if (!a || e.buttons) {
      if (box && !box.contains(e.target as Node)) soonClose();
      clearTimeout(openTimer);
      return;
    }
    clearTimeout(closeTimer);
    const target = a.getAttribute("data-wiki")!;
    if (target === current && box) return;
    clearTimeout(openTimer);
    openTimer = window.setTimeout(() => void show(target, a.getBoundingClientRect(), false), 450);
  };
  const outside = (e: PointerEvent): void => {
    if (box && !box.contains(e.target as Node)) close();
  };
  view.dom.addEventListener("pointermove", move);
  view.dom.addEventListener("pointerleave", () => box && soonClose());
  document.addEventListener("pointerdown", outside, true);

  return {
    atCursor() {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      for (const m of line.text.matchAll(/!?\[\[([^\[\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)) {
        const a = line.from + m.index!, b = a + m[0].length;
        if (pos < a || pos > b) continue;
        const r = view.coordsAtPos(a) ?? { left: 0, right: 0, top: 0, bottom: 0 };
        void show(m[1]!.trim(), new DOMRect(r.left, r.top, 0, r.bottom - r.top), true);
        return true;
      }
      return false;
    },
    destroy() {
      close();
      view.dom.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", outside, true);
    },
  };
}

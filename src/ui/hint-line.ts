/**
 * The hint (ADR 0104): a small note floating at the bottom of the canvas, above the status bar, that says what the current tool does and what to press next
 * (`toolHint`), and, while the pointer or the keyboard focus is on a button of a toolbar, what that button does. It replaces the strip of text that
 * took the room above the canvas. Settings > Appearance > Hints and tooltips: all (this line and the browser's own tooltips),
 * this line only, or none.
 */
import type { DocumentStore } from "../doc/document-store";
import type { EditorState } from "../app/editor-state";
import { toolHint } from "./tool-hint";

export type HintMode = "all" | "bar" | "off";

/** Where the buttons that explain themselves are. */
const BARS = ".rail, .toolbar, .ctx-bar, .dock, .hud-controls, .view-switch";

export function mountHintLine(editor: EditorState, doc: DocumentStore, mode: () => HintMode): { refresh(): void } {
  // A small floating note above the status bar, out of the way of the toolbars and never in the way of the pointer.
  const el = document.createElement("div");
  el.className = "hint-float";
  el.dataset["testid"] = "tool-hint";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.hidden = true;
  document.body.appendChild(el);
  let hover: string | null = null;
  const render = (): void => {
    const text = mode() === "off" ? null : (hover ?? toolHint(editor, doc));
    el.hidden = text === null;
    if (text !== null && el.textContent !== text) el.textContent = text;
  };
  const buttonUnder = (t: EventTarget | null): HTMLElement | null => {
    const b = (t as HTMLElement | null)?.closest?.<HTMLElement>("button, [role=radio], label[data-scrub]");
    return b && b.closest(BARS) ? b : null;
  };
  // What a button says about itself: its tooltip, else its name.
  const say = (b: HTMLElement): string | null => b.dataset["tt"] ?? b.getAttribute("title") ?? b.getAttribute("aria-label");
  document.addEventListener("pointerover", (e) => {
    const b = buttonUnder(e.target);
    if (!b) return;
    hover = say(b);
    // Without the browser's tooltips the title is set aside while the pointer is over the button (it comes back when it leaves).
    if (mode() !== "all" && b.hasAttribute("title")) {
      b.dataset["tt"] = b.getAttribute("title")!;
      b.removeAttribute("title");
    }
    render();
  });
  document.addEventListener("pointerout", (e) => {
    const b = buttonUnder(e.target);
    if (!b) return;
    if (b.dataset["tt"] !== undefined) {
      b.setAttribute("title", b.dataset["tt"]);
      delete b.dataset["tt"];
    }
    hover = null;
    render();
  });
  document.addEventListener("focusin", (e) => {
    const b = buttonUnder(e.target);
    if (b && (e.target as HTMLElement).matches(":focus-visible")) {
      hover = say(b);
      render();
    }
  });
  document.addEventListener("focusout", () => {
    if (hover !== null) {
      hover = null;
      render();
    }
  });
  // A button's own words give way as soon as it is used or the tool changes (the toolbar may have moved under a pointer that did not).
  let tool = editor.tool;
  document.addEventListener("click", () => {
    if (hover !== null) {
      hover = null;
      render();
    }
  }, true);
  editor.subscribe(() => {
    if (editor.tool !== tool) {
      tool = editor.tool;
      hover = null;
    }
    render();
  });
  doc.subscribe(render);
  render();
  return { refresh: render };
}

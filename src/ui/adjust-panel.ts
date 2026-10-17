import type { Adjust } from "../doc/adjust";
import { adjustKey, cleanAdjust } from "../doc/adjust";
import type { GradientStop } from "../doc/paint";
import type { EditorState } from "../app/editor-state";
import { setAdjustPreviewing } from "../render/adjust-image";
import { buildAdjustPanel, closeAdjustChild } from "./colour-popover";
import { ICONS } from "./icons";

/**
 * The Adjust panel (ADR 0118, 0123): the non-destructive adjustments of the picked pictures, as a panel of the dock instead of a popover,
 * so it stays while the pictures are worked on, can be stacked or floated like the others, and follows the selection (another picture
 * picked: its numbers). Hidden until the Adjust button of the toolbar asks for it.
 */
export interface AdjustPanelActions {
  selectedAdjust(): { adjust: Adjust; stills: boolean; count: number } | null;
  previewAdjust(a: Adjust): void;
  commitAdjust(a: Adjust, label: string): void;
  adjustStyles(): { save(name: string, a: Adjust): Promise<void>; gradients(): Array<{ name: string; stops: readonly GradientStop[] }>; saveGradient(stops: readonly GradientStop[]): Promise<void> };
}

export function mountAdjustPanel(host: HTMLElement, editor: EditorState, actions: AdjustPanelActions): void {
  const panel = document.createElement("aside");
  panel.className = "layers-panel adjust-panel";
  panel.setAttribute("aria-label", "Adjust");
  panel.dataset["testid"] = "adjust-panel";
  panel.hidden = true;
  panel.innerHTML = `<header><h2>Adjust</h2><span class="layers-tools"><button type="button" class="layer-btn" data-close aria-label="Hide the Adjust panel" title="Hide the Adjust panel">${ICONS.x}</button></span></header><div class="adjust-body"></div>`;
  host.appendChild(panel);
  const body = panel.querySelector<HTMLElement>(".adjust-body")!;
  let shown: { ids: string; handle: { current(): Adjust } | null } | null = null;
  let scheduled = false;

  /** An unfinished slider is not kept, and the picture is drawn in full again. */
  const settle = (): void => {
    setAdjustPreviewing(false);
    if (editor.preview.kind === "replace") {
      editor.preview = { kind: "none" };
      editor.changed();
    }
  };

  const render = (): void => {
    scheduled = false;
    if (panel.hidden !== !editor.adjustOpen) {
      panel.hidden = !editor.adjustOpen;
      if (panel.hidden) {
        closeAdjustChild();
        settle();
        shown = null;
      }
    }
    if (panel.hidden) return;
    const sel = actions.selectedAdjust();
    const ids = [...editor.selection].sort().join(",");
    if (!sel) {
      if (shown?.ids !== "none") {
        closeAdjustChild();
        settle();
        body.innerHTML = `<p class="adj-empty">Select a picture, video or GIF to adjust it. The original is never changed.</p>`;
        shown = { ids: "none", handle: null };
      }
      return;
    }
    const same = shown && shown.ids === ids && shown.handle && adjustKey(cleanAdjust(shown.handle.current())) === adjustKey(sel.adjust);
    if (same) return;
    if (shown?.ids !== ids) settle();
    const handle = buildAdjustPanel(body, {
      ...sel,
      styles: actions.adjustStyles(),
      onInput: (a) => actions.previewAdjust(a),
      onChange: (a, label) => actions.commitAdjust(a, label),
      onStyles: () => {
        editor.stylesOpen = true;
        editor.changed();
      },
    });
    shown = { ids, handle };
  };
  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(render);
    }
  };
  editor.subscribe(schedule);
  render();

  panel.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("[data-close]")) return;
    editor.adjustOpen = false;
    editor.changed();
  });
  panel.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("input, select, textarea")) e.stopPropagation(); // typing here never reaches the canvas shortcuts
  });
}

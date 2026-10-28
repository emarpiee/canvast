import type { Adjust } from "../doc/adjust";
import { adjustKey, cleanAdjust } from "../doc/adjust";
import type { GradientStop } from "../doc/paint";
import type { EditorState } from "../app/editor-state";
import { setAdjustPreviewing } from "../render/adjust-image";
import { buildAdjustPanel, closeAdjustChild } from "./colour-popover";
import { ICONS } from "./icons";
import { panelHtml } from "./panel";

/**
 * The Adjust panel (ADR 0118, 0123): the non-destructive adjustments of the picked pictures, as a panel of the dock instead of a popover,
 * so it stays while the pictures are worked on, can be stacked or floated like the others, and follows the selection (another picture
 * picked: its numbers). Hidden until the Adjust button of the toolbar asks for it.
 */
export interface AdjustPanelActions {
  selectedAdjust(): { adjust: Adjust; stills: boolean; count: number } | null;
  previewAdjust(a: Adjust): void;
  commitAdjust(a: Adjust, label: string): void;
  adjustStyles(): { save(name: string, a: Adjust): Promise<void>; gradients(): Array<{ name: string; stops: readonly GradientStop[] }> };
}

export function mountAdjustPanel(host: HTMLElement, editor: EditorState, actions: AdjustPanelActions): void {
  const panel = document.createElement("aside");
  panel.className = "layers-panel adjust-panel";
  panel.setAttribute("aria-label", "Adjust");
  panel.dataset["testid"] = "adjust-panel";
  panel.hidden = true;
  panel.innerHTML = panelHtml({
    title: "Adjust",
    tools: `<button type="button" class="layer-btn" data-reset aria-label="Reset the adjustments" title="Reset the adjustments of the selected pictures">${ICONS.listRestart}</button>`,
    sub: `<div data-adj-sub></div>`,
    body: `<div class="adjust-body"></div>`,
    foot: `<div data-adj-foot></div>`,
  });
  host.appendChild(panel);
  const body = panel.querySelector<HTMLElement>(".adjust-body")!;
  const subHost = panel.querySelector<HTMLElement>("[data-adj-sub]")!;
  const footHost = panel.querySelector<HTMLElement>("[data-adj-foot]")!;
  const strips = [subHost.parentElement!, footHost.parentElement!]; // (the panel's strip under the header and its footer: there only while a picture is being adjusted)
  let shown: { ids: string; handle: { current(): Adjust; reset(): void } | null } | null = null;
  const resetBtn = panel.querySelector<HTMLElement>("[data-reset]")!;
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
    resetBtn.hidden = !sel;
    for (const e of strips) e.hidden = !sel;
    const ids = [...editor.selection].sort().join(",");
    if (!sel) {
      if (shown?.ids !== "none") {
        closeAdjustChild();
        settle();
        body.innerHTML = `<p class="adj-empty">Select a picture, video, GIF, shape or text to adjust it. The file is never changed.</p>`;
        shown = { ids: "none", handle: null };
      }
      return;
    }
    // (a preview is on while a slider or a curve point is dragged: the stored adjustments are the old ones then, and rebuilding would end the drag)
    if (shown && shown.ids === ids && shown.handle && editor.preview.kind === "replace") return;
    const same = shown && shown.ids === ids && shown.handle && adjustKey(cleanAdjust(shown.handle.current())) === adjustKey(sel.adjust);
    if (same) return;
    if (shown?.ids !== ids) settle();
    const handle = buildAdjustPanel(body, {
      ...sel,
      subHost,
      footHost,
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
    if ((e.target as HTMLElement).closest("[data-reset]")) return shown?.handle?.reset();
    if (!(e.target as HTMLElement).closest("[data-close]")) return;
    editor.adjustOpen = false;
    editor.changed();
  });
  panel.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("input, select, textarea")) e.stopPropagation(); // typing here never reaches the canvas shortcuts
  });
}

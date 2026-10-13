import * as D from "../core/dyadic";
import { LOG10_2 } from "../core/dyadic";
import { zoomLevel } from "../core/camera";
import type { ViewState } from "./view-state";
import { MAX_JUMP_LEVELS, goHome, parseZoomLevel, zoomByStep, zoomTo } from "../interaction/navigation";
import type { FrameStats } from "./frame-stats";
import { ICONS } from "../ui/icons";

export interface HudStatus {
  /** Show a short message to the user. */
  notify(message: string): void;
  /** Short save-state text, e.g. "Saved". */
  saveText(): string;
  saveState(): string;
  subscribe(fn: () => void): void;
}

/**
 * Minimal navigation overlay: zoom read-out, center position, zoom buttons
 * and a Home button. The debug panel is shown only in debug mode.
 */
export function mountHud(root: HTMLElement, view: ViewState, stats: FrameStats, debug: boolean, status: HudStatus): () => void {
  root.innerHTML = `
    <div class="hud-readout" aria-live="off">
      <button type="button" class="hud-zoom" data-testid="zoom-readout" title="Click to type a zoom level (e.g. 3000, 2^-500, 10^900)"></button>
      <input class="hud-zoom-input" data-testid="zoom-input" aria-label="Zoom level (log2), e.g. 3000, 2^-500 or 10^900" hidden spellcheck="false" autocomplete="off">
      <span class="hud-pos" data-testid="position-readout"></span>
      <button type="button" class="hud-save" data-testid="save-status" aria-haspopup="dialog" aria-expanded="false" title="Storage status"></button>
    </div>
    <div class="hud-controls" role="toolbar" aria-label="Navigation">
      <button type="button" data-action="zoom-out" aria-label="Zoom out" title="Zoom out (−)">${ICONS.minus}</button>
      <button type="button" data-action="zoom-in" aria-label="Zoom in" title="Zoom in (+)">${ICONS.plus}</button>
      <button type="button" data-action="home" aria-label="Return to origin" title="Return to origin (0)">${ICONS.house}</button>
    </div>
    <pre class="hud-debug" data-testid="debug-panel" ${debug ? "" : "hidden"}></pre>
  `;
  const zoomEl = root.querySelector<HTMLElement>(".hud-zoom")!;
  const zoomInput = root.querySelector<HTMLInputElement>(".hud-zoom-input")!;
  const posEl = root.querySelector<HTMLElement>(".hud-pos")!;
  const debugEl = root.querySelector<HTMLElement>(".hud-debug")!;
  const saveEl = root.querySelector<HTMLElement>(".hud-save")!;
  const updateSave = (): void => {
    saveEl.textContent = status.saveText();
    saveEl.dataset["state"] = status.saveState();
  };
  status.subscribe(updateSave);
  updateSave();

  root.querySelector(".hud-controls")!.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest("button")?.dataset["action"];
    if (action === "zoom-in") zoomByStep(view, 1);
    else if (action === "zoom-out") zoomByStep(view, -1);
    else if (action === "home") goHome(view);
  });

  // Click the read-out to type an absolute zoom level (anchored at the centre).
  const closeInput = (): void => {
    zoomInput.hidden = true;
    zoomEl.hidden = false;
  };
  zoomEl.addEventListener("click", () => {
    zoomInput.value = zoomLevel(view.camera).toFixed(2);
    zoomEl.hidden = true;
    zoomInput.hidden = false;
    zoomInput.focus();
    zoomInput.select();
  });
  zoomInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeInput();
      e.preventDefault();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const level = parseZoomLevel(zoomInput.value);
      if (level === null) {
        status.notify(`"${zoomInput.value}" is not a zoom level. Try 3000, 2^-500 or 10^900.`);
        return;
      }
      if (Math.abs(level - zoomLevel(view.camera)) > MAX_JUMP_LEVELS) {
        status.notify(`Jumps are limited to ${MAX_JUMP_LEVELS.toLocaleString("en")} levels at a time; zooming further is still possible step by step.`);
        return;
      }
      zoomTo(view, level);
      closeInput();
      document.getElementById("canvas")?.focus();
    }
  });
  zoomInput.addEventListener("blur", closeInput);

  const update = (): void => {
    const cam = view.camera;
    const z = zoomLevel(cam);
    const decimal = z * LOG10_2;
    zoomEl.textContent = `zoom 2^${z.toFixed(2)} (≈10^${decimal.toFixed(1)})`;
    posEl.textContent = `x ${D.toDisplay(cam.center.x)}  y ${D.toDisplay(cam.center.y)}`;
    if (debug) {
      debugEl.textContent = [
        `zi ${cam.zi}  zf ${cam.zf.toFixed(6)}`,
        `cx ${D.toString(cam.center.x).slice(0, 48)}`,
        `cy ${D.toString(cam.center.y).slice(0, 48)}`,
        `center bits x ${D.bitLength(cam.center.x.m)} y ${D.bitLength(cam.center.y.m)}`,
        `frame ms p50 ${stats.percentile(50).toFixed(2)} p95 ${stats.percentile(95).toFixed(2)}`,
        `frames ${stats.count}`,
      ].join("\n");
    }
  };
  const unsubscribe = view.subscribe(update);
  update();
  return unsubscribe;
}

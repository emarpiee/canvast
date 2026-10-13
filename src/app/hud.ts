import * as D from "../core/dyadic";
import { LOG10_2 } from "../core/dyadic";
import { zoomLevel } from "../core/camera";
import type { ViewState } from "./view-state";
import { goHome, zoomByStep } from "../interaction/navigation";
import type { FrameStats } from "./frame-stats";

/**
 * Minimal navigation overlay: zoom read-out, center position, zoom buttons
 * and a Home button. The debug panel is shown only in debug mode.
 */
export function mountHud(root: HTMLElement, view: ViewState, stats: FrameStats, debug: boolean): () => void {
  root.innerHTML = `
    <div class="hud-readout" aria-live="off">
      <span class="hud-zoom" data-testid="zoom-readout"></span>
      <span class="hud-pos" data-testid="position-readout"></span>
    </div>
    <div class="hud-controls" role="toolbar" aria-label="Navigation">
      <button type="button" data-action="zoom-out" aria-label="Zoom out" title="Zoom out (−)">−</button>
      <button type="button" data-action="zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>
      <button type="button" data-action="home" aria-label="Return to origin" title="Return to origin (0)">Home</button>
    </div>
    <pre class="hud-debug" data-testid="debug-panel" ${debug ? "" : "hidden"}></pre>
  `;
  const zoomEl = root.querySelector<HTMLElement>(".hud-zoom")!;
  const posEl = root.querySelector<HTMLElement>(".hud-pos")!;
  const debugEl = root.querySelector<HTMLElement>(".hud-debug")!;

  root.querySelector(".hud-controls")!.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest("button")?.dataset["action"];
    if (action === "zoom-in") zoomByStep(view, 1);
    else if (action === "zoom-out") zoomByStep(view, -1);
    else if (action === "home") goHome(view);
  });

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

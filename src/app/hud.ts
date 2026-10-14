import * as D from "../core/dyadic";
import { LOG10_2 } from "../core/dyadic";
import { approxIn, depthOf } from "../core/frames";
import type { ViewState } from "./view-state";
import { MAX_JUMP_LEVELS, goHome, parseZoomLevel, viewLevel, zoomByStep, zoomTo } from "../interaction/navigation";
import type { FrameStats } from "./frame-stats";
import { FpsMeter } from "./fps-meter";
import { ICONS } from "../ui/icons";

export interface HudStatus {
  /** Show a short message to the user. */
  notify(message: string): void;
  /** Short save-state text, e.g. "Saved". */
  saveText(): string;
  saveState(): string;
  subscribe(fn: () => void): void;
  /** The frames-per-second readout: shown or not, and switch it. */
  fpsOn(): boolean;
  toggleFps(): void;
  /** Adaptive quality level now (app/quality.ts). */
  quality(): number;
  /** Lines of internal state shown under the frame-rate readout (memory, queues, index). */
  diagnostics(): string[];
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
      <span class="hud-fps" data-testid="fps-readout" aria-live="off" hidden></span>
      <pre class="hud-fps hud-diag" data-testid="diagnostics" aria-live="off" hidden></pre>
      <button type="button" class="hud-save" data-testid="save-status" aria-haspopup="dialog" aria-expanded="false" title="Storage status"></button>
    </div>
    <div class="hud-controls" role="toolbar" aria-label="Navigation">
      <button type="button" data-action="fps" aria-pressed="false" aria-label="Frame rate" title="Frame rate counter: display frames per second, the time between frames and the worst one in the last second, and how long canvast takes to draw a frame">${ICONS.activity}</button>
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
    else if (action === "fps") {
      status.toggleFps();
      showFps();
    }
  });

  // Frames per second (app/fps-meter.ts): the display's frame rate, counted only while the readout is shown.
  const fpsEl = root.querySelector<HTMLElement>(".hud-fps")!;
  const diagEl = root.querySelector<HTMLElement>(".hud-diag")!;
  const fpsButton = root.querySelector<HTMLElement>('[data-action="fps"]')!;
  const meter = new FpsMeter();
  let fpsRaf = 0;
  let fpsShownAt = 0;
  const diagText = (): string =>
    [`frame draw p50 ${stats.percentile(50).toFixed(1)} · p95 ${stats.percentile(95).toFixed(1)} · p99 ${stats.percentile(99).toFixed(1)} ms`, ...status.diagnostics()].join("\n");
  const fpsText = (): string => {
    const r = meter.read();
    const q = status.quality();
    if (!r) return "… FPS";
    return `${Math.round(r.fps)} FPS · ${r.avgMs.toFixed(1)} ms · worst ${r.worstMs.toFixed(0)} ms · draw ${stats.recent(50).toFixed(1)} ms${q ? ` · quality ${q}` : ""}`;
  };
  const loop = (now: number): void => {
    meter.tick(now);
    if (now - fpsShownAt >= 250) {
      fpsShownAt = now;
      fpsEl.textContent = fpsText();
      diagEl.textContent = diagText();
    }
    fpsRaf = requestAnimationFrame(loop);
  };
  const showFps = (): void => {
    const on = status.fpsOn();
    fpsEl.hidden = diagEl.hidden = !on;
    fpsButton.setAttribute("aria-pressed", String(on));
    cancelAnimationFrame(fpsRaf);
    meter.reset();
    if (on) {
      fpsEl.textContent = "… FPS";
      fpsRaf = requestAnimationFrame(loop);
    }
  };
  showFps();

  // Click the read-out to type an absolute zoom level (anchored at the centre).
  const closeInput = (): void => {
    zoomInput.hidden = true;
    zoomEl.hidden = false;
  };
  zoomEl.addEventListener("click", () => {
    zoomInput.value = viewLevel(view).toFixed(2);
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
      if (!(Math.abs(level - viewLevel(view)) <= MAX_JUMP_LEVELS)) {
        status.notify(`Jumps are limited to 2^50 (about 10^15) levels at a time; jump again to go further.`);
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
    const fc = view.frameCamera;
    const d = depthOf(fc);
    // Depth is a BigInt (unbounded); a double shows it exactly up to 2^53 levels.
    const z = Number(d.levels) + d.frac;
    const levels = d.levels <= 2n ** 53n && d.levels >= -(2n ** 53n) ? z.toFixed(2) : `${d.levels}`;
    zoomEl.textContent = `zoom 2^${levels} (≈10^${(z * LOG10_2).toFixed(1)})`;
    const w = approxIn(fc.f.space, fc.f, { x: fc.x, y: fc.y }, fc.f.space.world);
    posEl.textContent = `x ${D.toDisplay(w.x)}  y ${D.toDisplay(w.y)}`;
    if (debug) {
      debugEl.textContent = [
        `frame #${fc.f.id} level ${fc.f.level}${fc.f.n > 1n ? ` (dive of ${fc.f.n} steps)` : ""}`,
        `zi ${cam.zi}  zf ${cam.zf.toFixed(6)}  (in frame)`,
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

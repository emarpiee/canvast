import * as D from "../core/dyadic";
import { LOG10_2 } from "../core/dyadic";
import { approxIn, depthOf } from "../core/frames";
import type { ViewState } from "./view-state";
import { MAX_JUMP_LEVELS, goHome, parseZoomLevel, viewLevel, zoomByStep, zoomTo } from "../interaction/navigation";
import type { FrameStats } from "./frame-stats";
import { FpsMeter } from "./fps-meter";
import { ICONS } from "../ui/icons";

/** Simple: zoom and whether it is saved, in plain words. More: adds position, objects and how smoothly it runs. Technical: the numbers. Hidden: nothing. */
export type InfoMode = "simple" | "more" | "technical" | "hidden";
const MODES: readonly InfoMode[] = ["simple", "more", "technical", "hidden"];
const MODE_LABEL: Record<InfoMode, string> = { simple: "Simple", more: "More", technical: "Technical", hidden: "Hidden" };
const MODE_ICON: Record<InfoMode, string> = { simple: ICONS.info, more: ICONS.list, technical: ICONS.activity, hidden: ICONS.eyeOff };

/** The zoom as a magnification a person reads: 1.33×, 250×, 10^300× (and 0.25× when zoomed out). */
export function friendlyZoom(levels: bigint, frac: number): string {
  const z = Number(levels) + frac;
  if (Math.abs(z) <= 36) {
    const f = 2 ** z;
    const text = f >= 100 ? Math.round(f).toLocaleString("en") : f >= 10 ? f.toFixed(1) : f >= 0.1 ? f.toFixed(2) : f.toPrecision(2);
    return `${text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}×`;
  }
  return `10^${Math.round(z * LOG10_2).toLocaleString("en")}×`;
}

/** The save state in plain words (the technical view keeps the exact one). */
function plainSave(state: string): string {
  switch (state) {
    case "verified":
    case "committed":
      return "Saved";
    case "queued":
    case "saving":
      return "Saving…";
    case "readonly":
      return "View only: another tab is editing";
    case "conflict":
      return "Not saved: changed in another tab";
    case "unavailable":
      return "Not saved: storage unavailable";
    default:
      return "Not saved";
  }
}

export interface HudStatus {
  /** Show a short message to the user. */
  notify(message: string): void;
  /** Short save-state text, e.g. "Saved". */
  saveText(): string;
  saveState(): string;
  subscribe(fn: () => void): void;
  /** What the readout shows (Settings > Appearance > Information shown), and a way to change it. */
  infoMode(): InfoMode;
  setInfoMode(mode: InfoMode): void;
  subscribeInfo(fn: () => void): void;
  /** How much is on the canvas and how much of it is drawn now. */
  scene(): { objects: number; drawn: number; indexing: boolean };
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
      <span class="hud-objects" data-testid="objects-readout" hidden></span>
      <span class="hud-fps" data-testid="fps-readout" aria-live="off" hidden></span>
      <pre class="hud-fps hud-diag" data-testid="diagnostics" aria-live="off" hidden></pre>
      <button type="button" class="hud-save" data-testid="save-status" aria-haspopup="dialog" aria-expanded="false" title="Storage status"></button>
    </div>
    <div class="hud-controls" role="toolbar" aria-label="Navigation">
      <button type="button" data-action="info" aria-label="Information shown" title="Information shown"></button>
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
  let lastProblem = "";
  const updateSave = (): void => {
    const state = status.saveState();
    const mode = status.infoMode();
    saveEl.textContent = mode === "technical" ? status.saveText() : plainSave(state);
    saveEl.dataset["state"] = state;
    // With the readout hidden a problem must still be seen: say it once, as a notice.
    const problem = ["readonly", "conflict", "error", "unavailable"].includes(state) ? state : "";
    if (mode === "hidden" && problem && problem !== lastProblem) status.notify(plainSave(state) + ".");
    lastProblem = problem;
  };
  status.subscribe(updateSave);

  root.querySelector(".hud-controls")!.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest("button")?.dataset["action"];
    if (action === "zoom-in") zoomByStep(view, 1);
    else if (action === "zoom-out") zoomByStep(view, -1);
    else if (action === "home") goHome(view);
    else if (action === "info") status.setInfoMode(MODES[(MODES.indexOf(status.infoMode()) + 1) % MODES.length]!);
  });

  // Frames per second (app/fps-meter.ts): the display's frame rate, counted only while a view that shows it is on.
  const fpsEl = root.querySelector<HTMLElement>(".hud-fps")!;
  const diagEl = root.querySelector<HTMLElement>(".hud-diag")!;
  const objEl = root.querySelector<HTMLElement>(".hud-objects")!;
  const readout = root.querySelector<HTMLElement>(".hud-readout")!;
  const infoButton = root.querySelector<HTMLElement>('[data-action="info"]')!;
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
  /** How the canvas is running, in a word: from the same frame meter. */
  const speedText = (): string => {
    const r = meter.read();
    if (!r) return "";
    return r.fps >= 50 ? "Running smoothly" : r.fps >= 30 ? "A little slow" : "Slow";
  };
  const sceneText = (): string => {
    const sc = status.scene();
    if (sc.indexing) return "Preparing the canvas…";
    if (sc.objects === 0) return "Nothing on the canvas yet";
    return `${sc.objects.toLocaleString("en")} object${sc.objects === 1 ? "" : "s"}, ${sc.drawn.toLocaleString("en")} in view`;
  };
  const loop = (now: number): void => {
    meter.tick(now);
    if (now - fpsShownAt >= 250) {
      fpsShownAt = now;
      const mode = status.infoMode();
      if (mode === "technical") {
        fpsEl.textContent = fpsText();
        diagEl.textContent = diagText();
      } else {
        fpsEl.textContent = speedText();
        objEl.textContent = sceneText();
      }
    }
    fpsRaf = requestAnimationFrame(loop);
  };
  /** Show what the chosen mode shows; the frame meter runs only for the modes that use it. */
  const applyMode = (): void => {
    const mode = status.infoMode();
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
    readout.hidden = mode === "hidden";
    readout.dataset["mode"] = mode;
    posEl.hidden = mode === "simple" || mode === "hidden";
    objEl.hidden = mode !== "more";
    fpsEl.hidden = mode !== "more" && mode !== "technical";
    diagEl.hidden = mode !== "technical";
    infoButton.innerHTML = MODE_ICON[mode];
    infoButton.dataset["mode"] = mode;
    infoButton.setAttribute("aria-label", `Information shown: ${MODE_LABEL[mode]}`);
    infoButton.title = `Information shown: ${MODE_LABEL[mode]}. Click for ${MODE_LABEL[next]}.`;
    cancelAnimationFrame(fpsRaf);
    meter.reset();
    if (mode === "more" || mode === "technical") {
      fpsEl.textContent = mode === "technical" ? "… FPS" : "";
      objEl.textContent = sceneText();
      fpsRaf = requestAnimationFrame(loop);
    }
    updateSave();
    update();
  };
  status.subscribeInfo(applyMode);

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
    const mode = status.infoMode();
    const w = approxIn(fc.f.space, fc.f, { x: fc.x, y: fc.y }, fc.f.space.world);
    if (mode === "technical") {
      zoomEl.textContent = `zoom 2^${levels} (≈10^${(z * LOG10_2).toFixed(1)})`;
      posEl.textContent = `x ${D.toDisplay(w.x)}  y ${D.toDisplay(w.y)}`;
    } else {
      zoomEl.textContent = `Zoom ${friendlyZoom(d.levels, d.frac)}`;
      const near = (v: string): string => (v.length > 9 ? v : String(Math.round(Number(v))));
      posEl.textContent = `Position ${near(D.toDisplay(w.x))}, ${near(D.toDisplay(w.y))}`;
    }
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
  applyMode();
  return unsubscribe;
}

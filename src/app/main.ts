import { ViewState } from "./view-state";
import { FrameStats } from "./frame-stats";
import { mountHud } from "./hud";
import { installDebugHook } from "./debug-hook";
import { attachNavigation } from "../interaction/navigation";
import { renderFrame } from "../render/canvas2d-renderer";
import type { Theme } from "../render/canvas2d-renderer";
import { LANDMARKS } from "../scene/landmarks";

declare const __CANVAST_DEBUG__: boolean;
declare const __CANVAST_VERSION__: string;

function readTheme(el: HTMLElement): Theme {
  const css = getComputedStyle(el);
  const v = (name: string): string => css.getPropertyValue(name).trim();
  return {
    background: v("--canvas-bg"),
    grid: v("--canvas-grid"),
    axis: v("--canvas-axis"),
    landmark: v("--canvas-landmark"),
    landmarkLabel: v("--canvas-landmark-label"),
  };
}

function start(): void {
  const debug = __CANVAST_DEBUG__ || location.hash.includes("debug");
  const host = document.getElementById("canvas-host")!;
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const hudRoot = document.getElementById("hud")!;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    host.textContent = "canvast could not create a 2D drawing surface in this browser.";
    return;
  }

  const view = new ViewState();
  const stats = new FrameStats();
  let theme = readTheme(document.documentElement);
  let dpr = window.devicePixelRatio || 1;
  let scheduled = false;
  let frameWaiters: Array<() => void> = [];

  const draw = (): void => {
    scheduled = false;
    const t0 = performance.now();
    renderFrame(ctx, view.camera, view.viewport, dpr, theme, LANDMARKS);
    stats.record(performance.now() - t0);
    const waiters = frameWaiters;
    frameWaiters = [];
    for (const w of waiters) w();
  };
  const invalidate = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(draw);
  };

  const resize = (): void => {
    const r = host.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    view.setViewport({ width: r.width, height: r.height });
    invalidate();
  };
  new ResizeObserver(resize).observe(host);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    theme = readTheme(document.documentElement);
    invalidate();
  });

  view.subscribe(invalidate);
  attachNavigation(canvas, view);
  mountHud(hudRoot, view, stats, debug);
  if (debug) {
    installDebugHook(view, stats, canvas, () => {
      invalidate();
      return new Promise((resolve) => frameWaiters.push(resolve));
    });
  }
  document.documentElement.dataset["version"] = __CANVAST_VERSION__;
  resize();
  canvas.focus();
}

start();

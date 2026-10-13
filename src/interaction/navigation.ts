import { canvasShortcutsActive } from "./shortcut-scope";
import { HOME, panBy, zoomAt } from "../core/camera";
import type { ScreenPoint } from "../core/camera";
import type { ViewState } from "../app/view-state";

/**
 * Wheel, trackpad, keyboard and pointer pan/pinch navigation. All input is
 * converted to two primitives, anchored zoom and pan, so every device follows
 * the same camera contract. Pointer routing (which tool gets a pointer) lives
 * in tools.ts; it hands navigation pointers to a PanGesture.
 */

/** Log2 zoom levels per pixel of plain wheel delta (100 px notch ≈ ×1.33). */
const WHEEL_ZOOM_PER_PX = 1 / 240;
/** Log2 zoom levels per pixel of ctrl+wheel delta (trackpad pinch). */
const PINCH_ZOOM_PER_PX = 1 / 100;
/**
 * Upper bound on the zoom change from one wheel event. This is a rate limit
 * for page-mode wheel deltas, not a zoom range limit.
 */
const MAX_DZ_PER_EVENT = 2;
const KEY_ZOOM_STEP = 0.5;
const LINE_HEIGHT_PX = 16;

export function zoomByStep(view: ViewState, dz: number): void {
  const vp = view.viewport;
  view.setCamera(zoomAt(view.camera, vp, { x: vp.width / 2, y: vp.height / 2 }, dz));
}

/**
 * Largest single typed/button zoom jump, in levels. This is not a zoom
 * limit (wheel, keys and auto-zoom continue past it); it only stops a typo
 * such as "1e12" from creating a trillion-bit coordinate in one step.
 * Measured on the reference machine: at 10^7 levels one zoom step takes
 * ~3 ms and the camera arithmetic per frame ~14 ms.
 */
export const MAX_JUMP_LEVELS = 10_000_000;

/** Zoom to an absolute level, keeping the world point at the viewport centre fixed. */
export function zoomTo(view: ViewState, level: number): void {
  const vp = view.viewport;
  const cam = view.camera;
  view.setCamera(zoomAt(cam, vp, { x: vp.width / 2, y: vp.height / 2 }, level - (cam.zi + cam.zf)));
}

/**
 * Parse a zoom level typed by the user: "3000", "-12.5", "2^3000",
 * "10^900" (decimal magnification), "×2^40"/"x2^40". Returns null if invalid.
 */
export function parseZoomLevel(text: string): number | null {
  const s = text.replace(/\s+/g, "").replace(/^[×x*]/i, "").replace(/−/g, "-");
  const num = "([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?)";
  let m = new RegExp(`^2\\^${num}$`, "i").exec(s);
  let level: number | null = null;
  if (m) level = Number(m[1]);
  else if ((m = new RegExp(`^10\\^${num}$`, "i").exec(s))) level = Number(m[1]) / Math.log10(2);
  else if ((m = new RegExp(`^${num}$`, "i").exec(s))) level = Number(m[1]);
  return level !== null && Number.isFinite(level) ? level : null;
}

export function goHome(view: ViewState): void {
  view.setCamera(HOME);
}

export function attachNavigation(el: HTMLElement, view: ViewState): () => void {
  const local = (e: { clientX: number; clientY: number }): ScreenPoint => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? LINE_HEIGHT_PX
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? view.viewport.height
          : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.shiftKey && !e.ctrlKey) {
      // Shift+wheel pans; many mice report the vertical wheel as deltaY here.
      view.setCamera(panBy(view.camera, -(dx || dy), dx ? -dy : 0));
      return;
    }
    const rate = e.ctrlKey ? PINCH_ZOOM_PER_PX : WHEEL_ZOOM_PER_PX;
    const dz = Math.max(-MAX_DZ_PER_EVENT, Math.min(MAX_DZ_PER_EVENT, -dy * rate));
    if (dz !== 0) view.setCamera(zoomAt(view.camera, view.viewport, local(e), dz));
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!canvasShortcutsActive(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const vp = view.viewport;
    const panStep = (e.shiftKey ? 0.5 : 0.125) * Math.min(vp.width, vp.height);
    const zoomStep = e.shiftKey ? KEY_ZOOM_STEP * 4 : KEY_ZOOM_STEP;
    switch (e.key) {
      case "+":
      case "=":
        zoomByStep(view, zoomStep);
        break;
      case "-":
      case "_":
        zoomByStep(view, -zoomStep);
        break;
      case "ArrowLeft":
        view.setCamera(panBy(view.camera, panStep, 0));
        break;
      case "ArrowRight":
        view.setCamera(panBy(view.camera, -panStep, 0));
        break;
      case "ArrowUp":
        view.setCamera(panBy(view.camera, 0, panStep));
        break;
      case "ArrowDown":
        view.setCamera(panBy(view.camera, 0, -panStep));
        break;
      case "0":
      case "Home":
        goHome(view);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  return () => {
    el.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKeyDown);
  };
}

/**
 * Pan with one pointer, pan + pinch-zoom with two or more. The gesture keeps
 * the centroid of all its pointers under the fingers.
 */
export class PanGesture {
  private readonly pointers = new Map<number, ScreenPoint>();
  private last: { centroid: ScreenPoint; spread: number } | null = null;

  constructor(private readonly view: ViewState) {}

  get size(): number {
    return this.pointers.size;
  }

  has(id: number): boolean {
    return this.pointers.has(id);
  }

  add(id: number, p: ScreenPoint): void {
    this.pointers.set(id, p);
    this.last = this.measure();
  }

  move(id: number, p: ScreenPoint): void {
    if (!this.pointers.has(id) || !this.last) return;
    this.pointers.set(id, p);
    const next = this.measure();
    let cam = this.view.camera;
    if (this.pointers.size >= 2 && this.last.spread > 0 && next.spread > 0) {
      cam = zoomAt(cam, this.view.viewport, this.last.centroid, Math.log2(next.spread / this.last.spread));
    }
    cam = panBy(cam, next.centroid.x - this.last.centroid.x, next.centroid.y - this.last.centroid.y);
    this.last = next;
    this.view.setCamera(cam);
  }

  remove(id: number): void {
    if (!this.pointers.delete(id)) return;
    this.last = this.pointers.size ? this.measure() : null;
  }

  private measure(): { centroid: ScreenPoint; spread: number } {
    let x = 0;
    let y = 0;
    for (const p of this.pointers.values()) {
      x += p.x;
      y += p.y;
    }
    const n = this.pointers.size;
    const centroid = { x: x / n, y: y / n };
    let spread = 0;
    for (const p of this.pointers.values()) spread += Math.hypot(p.x - centroid.x, p.y - centroid.y);
    return { centroid, spread: spread / n };
  }
}

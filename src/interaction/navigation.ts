import { HOME, panBy, zoomAt } from "../core/camera";
import type { ScreenPoint } from "../core/camera";
import type { ViewState } from "../app/view-state";

/**
 * Wheel, trackpad, pointer-drag, multi-touch pinch and keyboard navigation.
 * All input is converted to two primitives, anchored zoom and pan, so every
 * device follows the same camera contract.
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

  // Active pointers in CSS px relative to the element.
  const pointers = new Map<number, ScreenPoint>();
  let gesture: { centroid: ScreenPoint; spread: number } | null = null;

  const measure = (): { centroid: ScreenPoint; spread: number } => {
    let x = 0;
    let y = 0;
    for (const p of pointers.values()) {
      x += p.x;
      y += p.y;
    }
    const n = pointers.size;
    const centroid = { x: x / n, y: y / n };
    let spread = 0;
    for (const p of pointers.values()) spread += Math.hypot(p.x - centroid.x, p.y - centroid.y);
    return { centroid, spread: spread / n };
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    gesture = measure();
    el.classList.add("is-panning");
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, local(e));
    const next = measure();
    let cam = view.camera;
    if (pointers.size >= 2 && gesture.spread > 0 && next.spread > 0) {
      cam = zoomAt(cam, view.viewport, gesture.centroid, Math.log2(next.spread / gesture.spread));
    }
    cam = panBy(cam, next.centroid.x - gesture.centroid.x, next.centroid.y - gesture.centroid.y);
    gesture = next;
    view.setCamera(cam);
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    gesture = pointers.size > 0 ? measure() : null;
    if (!gesture) el.classList.remove("is-panning");
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
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
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  return () => {
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
  };
}

/**
 * The Painting view's camera (ADR 0165): plain numbers, no endless zoom. A page pixel (px, py) is at screen (x + px·scale, y + py·scale)
 * in CSS px of the view. The zoom goes from a sixteenth of the page's fitted size (never under 1 %) to 64 times; the page cannot be
 * pushed out of the view (at least a quarter of the view keeps some of it).
 */
export const MAX_SCALE = 64;
export const FIT_MARGIN = 32;

export interface PaintCamera {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly w: number;
  readonly h: number;
}

/** The camera that shows the whole page, centred, with a margin. */
export function fitCamera(page: Box, view: Box): PaintCamera {
  const scale = Math.max(1e-3, Math.min((view.w - 2 * FIT_MARGIN) / page.w, (view.h - 2 * FIT_MARGIN) / page.h));
  return { scale, x: (view.w - page.w * scale) / 2, y: (view.h - page.h * scale) / 2 };
}

const minScale = (page: Box, view: Box): number => Math.max(0.01, fitCamera(page, view).scale / 16);

/** The camera kept within its limits: the zoom in range, and the page not pushed out of the view. */
export function clampCamera(c: PaintCamera, page: Box, view: Box): PaintCamera {
  const scale = Math.min(MAX_SCALE, Math.max(minScale(page, view), c.scale));
  const keepX = Math.min(view.w / 4, page.w * scale), keepY = Math.min(view.h / 4, page.h * scale);
  const x = Math.min(view.w - keepX, Math.max(keepX - page.w * scale, c.x));
  const y = Math.min(view.h - keepY, Math.max(keepY - page.h * scale, c.y));
  return { scale, x, y };
}

/** Zoom by `factor` about the screen point (sx, sy): the page pixel under it stays under it. */
export function zoomAt(c: PaintCamera, factor: number, sx: number, sy: number, page: Box, view: Box): PaintCamera {
  const scale = Math.min(MAX_SCALE, Math.max(minScale(page, view), c.scale * factor));
  const k = scale / c.scale;
  return clampCamera({ scale, x: sx - (sx - c.x) * k, y: sy - (sy - c.y) * k }, page, view);
}

/** A zoom of exactly `scale` (100 %: 1) about the view's centre. */
export function zoomTo(c: PaintCamera, scale: number, page: Box, view: Box): PaintCamera {
  return zoomAt(c, scale / c.scale, view.w / 2, view.h / 2, page, view);
}

export const toPage = (c: PaintCamera, sx: number, sy: number): [number, number] => [(sx - c.x) / c.scale, (sy - c.y) / c.scale];

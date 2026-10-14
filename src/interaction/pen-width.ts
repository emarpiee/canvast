/**
 * Pen width (CSS px) for a new stroke. Without the thickness lock it is the
 * chosen pen size at the current zoom. With the lock it is the size the pen
 * had when the lock was set, scaled by the zoom since: the stroke gets the
 * same width on the canvas, so it matches the artwork at any zoom (strokes
 * themselves always scale with the canvas). More than LOCK_MAX_LEVELS from
 * the reference zoom the size stops following (a double cannot hold it, and
 * a brush that wide or that thin looks the same anyway).
 */
export interface PenLock {
  /** Zoom level (levels below the world frame, BigInt plus fraction) where the lock was set. */
  readonly levels: bigint;
  readonly frac: number;
  /** Pen size in CSS px at that zoom. */
  readonly px: number;
}

/** Zoom distance (levels) over which the locked size keeps following the zoom. */
export const LOCK_MAX_LEVELS = 1000;

/** Pen sizes (CSS px) the size slider covers, on a log scale. */
export const PEN_MIN_PX = 0.5;
export const PEN_MAX_PX = 128;
export const penFromSlider = (v: number): number => Math.round(PEN_MIN_PX * (PEN_MAX_PX / PEN_MIN_PX) ** (v / 100) * 10) / 10;
export const sliderFromPen = (px: number): number => Math.round((100 * Math.log(px / PEN_MIN_PX)) / Math.log(PEN_MAX_PX / PEN_MIN_PX));

export function penWidthNow(penPx: number, lock: PenLock | null, depth: { levels: bigint; frac: number }): number {
  if (!lock) return penPx;
  const d = Number(depth.levels - lock.levels) + (depth.frac - lock.frac); // Infinity when the levels are astronomically apart
  return lock.px * 2 ** Math.max(-LOCK_MAX_LEVELS, Math.min(LOCK_MAX_LEVELS, d));
}

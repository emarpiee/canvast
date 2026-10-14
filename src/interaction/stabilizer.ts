import type { ScreenPoint } from "../core/camera";

/**
 * Pen stabilizer: a lazy rope. The brush tip follows the pointer on a rope
 * of `ropePx` CSS px: it stays where it is while the pointer is within the
 * rope, and is pulled along (keeping the rope taut) when the pointer goes
 * farther. Hand wobble smaller than the rope never reaches the stroke, at any
 * zoom (the rope is on screen, so it is as strong magnified as not).
 * The result does not depend on how often the pointer reports.
 */
export const STABILIZER_MAX_ROPE_PX = 60;

/** Rope length for a strength between 0 and 100. */
export const ropeFor = (strength: number): number => (Math.max(0, Math.min(100, strength)) / 100) * STABILIZER_MAX_ROPE_PX;

export function ropeStep(tip: ScreenPoint, pointer: ScreenPoint, ropePx: number): ScreenPoint {
  const dx = pointer.x - tip.x;
  const dy = pointer.y - tip.y;
  const d = Math.hypot(dx, dy);
  if (!(d > ropePx)) return tip;
  const pull = (d - ropePx) / d;
  return { x: tip.x + dx * pull, y: tip.y + dy * pull };
}

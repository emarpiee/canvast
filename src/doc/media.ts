/**
 * Pure rules of the on-canvas players (ADR 0041).
 *
 * A step moves the paused position by `delta` (negative = back) and stays in
 * [0, duration]. Past an end, a repeating instance wraps round (the overshoot
 * continues from the other end); one that does not repeat stops at that end.
 */
export function stepTime(t: number, delta: number, duration: number, repeat: boolean): number {
  if (!(duration > 0)) return 0;
  const next = t + delta;
  if (next >= 0 && next <= duration) return next;
  if (!repeat) return next < 0 ? 0 : duration;
  return ((next % duration) + duration) % duration;
}

/** `m:ss` (or `h:mm:ss`) for a position in seconds. */
export function formatTime(s: number): string {
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The frame a GIF steps to: frames 0..count-1, wrapping when repeating, otherwise stopping at an end. */
export function stepFrame(i: number, delta: number, count: number, repeat: boolean): number {
  if (!(count > 0)) return 0;
  const next = i + delta;
  if (next >= 0 && next < count) return next;
  if (!repeat) return next < 0 ? 0 : count - 1;
  return ((next % count) + count) % count;
}

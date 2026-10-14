/**
 * Snapping while an object moves (ADR 0019). Candidates are found in screen
 * pixels (what the user sees); the alignment itself is then computed from the
 * exact world coordinates of the two lines, so snapped edges coincide exactly
 * at any depth and zoom, not just to a pixel.
 */
export const SNAP_PX = 6;
/** More candidates than this are not searched (a dense scene would make every pointer move slow). */
export const MAX_SNAP_TARGETS = 2000;

export interface Snap {
  /** Which line of the moving box matched: 0 min, 1 middle, 2 max. */
  source: number;
  /** Which target (index into the candidate list) it matched. */
  target: number;
  /** Which of that target's lines: 0 min, 1 middle, 2 max. */
  line: number;
  /** Distance in px before snapping. */
  dist: number;
}

/** The closest pair of lines within `threshold`: the moving box's three lines against every target's three. */
export function bestSnap(source: readonly [number, number, number], targets: ReadonlyArray<readonly [number, number, number]>, threshold = SNAP_PX): Snap | null {
  let best: Snap | null = null;
  const n = Math.min(targets.length, MAX_SNAP_TARGETS);
  for (let t = 0; t < n; t++) {
    const lines = targets[t]!;
    for (let s = 0; s < 3; s++) {
      for (let l = 0; l < 3; l++) {
        const dist = Math.abs(lines[l]! - source[s]!);
        if (dist <= threshold && (!best || dist < best.dist)) best = { source: s, target: t, line: l, dist };
      }
    }
  }
  return best;
}

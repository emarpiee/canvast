/**
 * Erasing part of a freehand stroke (ADR 0111): the pieces of its line that the brush did not touch. Pure; local units throughout.
 */
export interface Pt {
  x: number;
  y: number;
}

const MAX_POINTS = 200_000;

/**
 * The runs of `points` ([x0, y0, ...]) left after a brush of radius `reach` (which includes half the stroke's width) swept along `trail`.
 * null: the brush touched none of it. An empty list: all of it is gone. A run of one point is a dot ([x, y, x, y] is not needed: one point is a stroke).
 */
export function cutStroke(points: readonly number[], reach: number, trail: readonly Pt[]): number[][] | null {
  if (!(reach > 0) || trail.length === 0 || points.length < 2) return null;
  // the trail without points that add nothing (closer than a quarter of the reach)
  const t: Pt[] = [];
  for (const p of trail) if (!t.length || Math.hypot(p.x - t[t.length - 1]!.x, p.y - t[t.length - 1]!.y) >= reach / 4) t.push(p);
  // the stroke with a point at least every half reach, so a long segment cannot jump across the brush
  const pts: number[] = [points[0]!, points[1]!];
  const step = reach / 2;
  for (let i = 2; i < points.length && pts.length < MAX_POINTS; i += 2) {
    const x0 = points[i - 2]!, y0 = points[i - 1]!, x1 = points[i]!, y1 = points[i + 1]!;
    const n = Math.min(Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step), 2000);
    for (let k = 1; k < n; k++) pts.push(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
    pts.push(x1, y1);
  }
  const near = (x: number, y: number): boolean => {
    if (t.length === 1) return Math.hypot(x - t[0]!.x, y - t[0]!.y) <= reach;
    for (let j = 0; j + 1 < t.length; j++) {
      const a = t[j]!, b = t[j + 1]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
      if (Math.hypot(x - (a.x + u * dx), y - (a.y + u * dy)) <= reach) return true;
    }
    return false;
  };
  const runs: number[][] = [];
  let run: number[] = [];
  let touched = false;
  for (let i = 0; i < pts.length; i += 2) {
    if (near(pts[i]!, pts[i + 1]!)) {
      touched = true;
      if (run.length) runs.push(run);
      run = [];
    } else run.push(pts[i]!, pts[i + 1]!);
  }
  if (run.length) runs.push(run);
  return touched ? runs : null;
}

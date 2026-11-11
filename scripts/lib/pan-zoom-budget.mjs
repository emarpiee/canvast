// The pan and zoom standard: what `scripts/bench-pan.mjs --check` holds every run on the *Powers of two* showcase (at its first bookmark,
// about 7,000 objects) to. Set from the release that made panning and zooming smooth (0.56.40: frame p95 17 ms, draw p95 at most 10 ms,
// 35–144 tiles built a run, at most 1 set thrown away for a sub-pixel pan and 6 for a wheel zoom), with room for GitHub's machines.
// A run that breaks one means a change made the canvas view slower: fix the change. These numbers are never loosened to make a run pass
// (as LIMITS in tests/e2e/harness.ts); a time that fails once is run again before it counts, the counts (tiles, sets) are not timing.

/** For each run of the bench (its label): the most each measure may be. */
export const PAN_ZOOM_BUDGET = {
  // frame_p95, frame_worst, draw_p95: ms. tiles: tiles built in the run. offset / key: tile sets thrown away (a pan not whole pixels / a zoom).
  "zoom-whole-60hz": { frame_p95: 25, frame_worst: 500, draw_p95: 16, tiles: 150, offset: 2, key: 2 },
  "zoom-whole-fast-mouse": { frame_p95: 25, frame_worst: 500, draw_p95: 16, tiles: 150, offset: 2, key: 2 },
  "zoom-whole-subpixel-pointer": { frame_p95: 25, frame_worst: 500, draw_p95: 16, tiles: 150, offset: 2, key: 2 },
  "zoom-fraction-60hz": { frame_p95: 25, frame_worst: 500, draw_p95: 16, tiles: 150, offset: 2, key: 2 },
  "zoom-fraction-fast-mouse": { frame_p95: 25, frame_worst: 500, draw_p95: 16, tiles: 150, offset: 2, key: 2 },
  "wheel-zoom-slow": { frame_p95: 25, frame_worst: 500, draw_p95: 16, tiles: 300, offset: 2, key: 12 },
  "wheel-zoom-fast": { frame_p95: 25, frame_worst: 500, draw_p95: 16, tiles: 300, offset: 2, key: 12 },
};

/** The runs measured against the budget: one line per measure over its limit (empty: all within). */
export function overBudget(runs) {
  const out = [];
  for (const [label, b] of Object.entries(PAN_ZOOM_BUDGET)) {
    const r = runs.find((x) => x.label === label);
    if (!r) {
      out.push(`${label}: not run`);
      continue;
    }
    const got = { frame_p95: r.frame_ms.p95, frame_worst: r.frame_ms.worst, draw_p95: r.draw_ms.p95, tiles: r.tiles_built, offset: r.restarts.offset, key: r.restarts.key };
    for (const [k, max] of Object.entries(b)) if (got[k] > max) out.push(`${label}: ${k} ${got[k]} > ${max}`);
  }
  return out;
}

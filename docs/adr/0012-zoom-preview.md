# ADR 0012 — Zoom preview for dense scenes

- Status: accepted (Phase 1, slice 7)
- Date: 2026-10-13
- Completes the deferred item of [ADR 0009](0009-raster-tile-cache.md)

## Context

With the tile cache (ADR 0009), panning and redrawing over dense scenes run
at 60 fps. **Zooming** still rendered every frame exactly, because tiles are
never reused at another zoom. That is 87–125 ms per frame (8–11 fps) with
10K visible strokes. ADR 0009 deferred a scaled preview because it is
deliberately inexact. The deep-zoom defects reported earlier (holes, then
vanishing content) make the bound on that inexactness the key design point.

## Decision

During a zoom gesture in a **dense** scene, show the last exact tile set
scaled to the current zoom, within strict bounds, and refine back to exact
automatically.

| Rule | Value | Why |
| --- | --- | --- |
| Only in dense scenes | the last full tile-set build cost more than **12 ms** (about one frame budget) | Sparse scenes and deep-zoom work (a few objects) stay exact on **every** frame; the preview never touches the cases the deep-zoom fixes protect |
| Bounded scale | at most **1 level** (2×) from the tile set | Beyond that, an exact set is rebuilt at the current zoom immediately, so magnification of a raster is bounded at 2× |
| Refinement | **150 ms** after the zoom stops, or when the 1-level bound is crossed | The preview is never what remains on screen |
| Edits | any pending edit disables the preview | An edit is never hidden behind an old picture |
| DPR | the same DPR only | — |
| Not cached | preview frames build nothing | Tiles stay exact (ADR 0009 rule 2) |

Mechanics:
- The tile set records its zoom.
- A preview frame draws each tile with a scale of 2^Δz, positioned from the
  exact dyadic difference of the camera centres. Panning while zooming
  (pinch) is therefore placed correctly.
- Smoothing is on and set to low quality.
- After zooming out, the border the old set never covered stays empty until
  refinement. That is a visible, honest gap, not invented content.

Overlays (the draft stroke, selection, lasso) and the base layer (grid,
axes, landmarks, density preview) stay exact during previews. Only
committed objects are scaled.

## Consequences

Measured, frame p50/p95/p99 in ms (Chromium | Firefox):

| Trajectory | Scene | Direct | With preview |
| --- | --- | --- | --- |
| Zoom ±0.05 per frame in place | dense 10K | 112.6/141.7/233.3 \| 125/160/177 | **5.3/6.1/6.2** \| **6/7/8** |
| Steady zoom-in, 3 levels in 60 frames | dense 10K | 87.4/136.8/154.8 \| 121/176/185 | **4.8/6.1**/160 \| **5/7**/213 |
| Steady zoom-in | dense 1K | 10.8/15.2/18.4 \| 12/20/22 | **4.9/6.6**/18.2 \| **6/9**/26 |

- Zoom gestures over dense scenes now run at about 60 fps.
- The p99 is the one exact rebuild per level crossed (a full frame, 160–213
  ms at 10K). It is a hitch once per level instead of on every frame.

## Deferred

- **Smoother level crossings:** building the next exact set in slices
  across frames (progressive refinement) or in a worker. Today the crossing
  frame is one full exact build.
- ~~**Filling the border after zooming out** from ring tiles or the density
  preview.~~ Done, see the amendment below.

## Amendment (v0.48.1): the border after zooming out is drawn exactly

A zoom out with no prebuilt set to take over (ADR 0033) left the outer part of the view empty until the refinement: about half a second
in the showcase (150 ms, then an exact build of about 80-120 ms), reported as the view being cut off. The preview now draws the objects
outside the scaled set directly, clipped to that border (`DrawBorder`, given by `main.ts`), so a preview frame is never cut off. Such a
frame costs the preview plus a direct draw of the objects that reach the border (measured in the showcase, headless Chromium on the CPU:
about 45-50 ms instead of 22-28 ms); the prebuilt outer set, now made first, makes it rare. Whether a set covers the view is judged on
the whole tile range it was built for (`Generation.range`), not on the box of the tiles it holds, which tiles kept from panning or a set
still being made could leave with holes. Tested in `tiles.spec.ts` (the border of a zoom-out preview matches the exact picture; without
the fix 30% of it differed).

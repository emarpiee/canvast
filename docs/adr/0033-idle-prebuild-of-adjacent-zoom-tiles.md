# ADR 0033 — Idle-time prebuild of the adjacent zoom levels' tiles

- Status: accepted (Phase 4, slice 1; owner priority: maximum performance and UX)
- Related: ADR 0009 (tile cache), ADR 0012 (zoom preview), ADR 0028 (tiers and targets), `docs/testing/phase-3-bench.md` finding 1

## Context

In a dense scene a zoom gesture shows the last exact tile set scaled by at most 2x (ADR 0012). When the zoom moves more than one level from that set, the exact set is rebuilt in the same frame: about 70 ms at 10,000 visible objects on the reference machine (150 ms to 1 s for larger scenes), a visible hitch in the middle of a zoom. Building it in slices over the old set was tried and measured worse (about 12 frames of 16-38 ms instead of one of 70 ms, because the visible query and the first tile are paid in every slice). Showing the old set more than 2x enlarged breaks the bound that protects deep-zoom drawing.

## Decision

When the view has rested for 200 ms in a dense scene (the last exact build cost more than the dense threshold), the tile sets **one level in and one level out** from the current set are built in idle time, in slices of at most 6 ms per timer tick, each at the current centre and viewport and in the same frame (a level that would rebase the camera into another frame is skipped). Any frame, edit, image load or resolution change cancels or drops them.

When a zoom frame crosses the 1-level bound and a prebuilt set within one level of the new zoom exists, that set becomes the current set and previews continue from it, with no tile rendered in the frame; the previous set stays as its neighbour, so zooming back also finds a ready set. The preview bound (2x) and the refinement (an exact set 150 ms after the zoom stops) are unchanged. Zooming further than the prebuilt sets reach in one gesture falls back to the previous behaviour: one exact rebuild at the bound.

Costs: two extra tile sets (at most about 30 tiles; 0.3 MB per tile at device pixel ratio 1) while the view is at rest, and idle CPU of about one exact frame spread over about 15 slices. Not done on the lower adaptive-quality levels (`TileCache.idleBuild`).

## Measured (dense-10k, zoom in 100 steps of 0.05 levels, Chromium)

The 70 ms frame at the first crossing is gone (all zoom frames 3-11 ms); the next crossing, one level later, still rebuilds (34-37 ms, fewer objects are visible deeper) because no idle time passes during one continuous gesture.

## Not done

Chaining (building the next level while the gesture continues, in the frames that are already cheap previews) would remove the later crossings; it needs the same query and a time budget inside preview frames, and is left for a later slice.

## Amendment (after v0.15.0): only a set that covers the view takes over

A prebuilt set one level *deeper* than the camera is scaled down and leaves a border of bare background while zooming in; the shallower one is scaled up and covers. `takeAhead` now skips a set whose scaled tiles do not reach every edge of the viewport (`TileCache.covers`), and preview tiles are drawn on whole device pixels so scaling leaves no hairline seams. Found as the intermittent Firefox "curvy stroke" hole failure (a 91 px strip, 140 sample holes).

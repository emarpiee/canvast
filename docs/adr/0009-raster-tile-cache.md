# ADR 0009 — Raster tile cache for committed objects

- Status: accepted (Phase 1, slice 4)
- Date: 2026-10-13
- Implements decision 2 of [ADR 0005](0005-dense-scene-acceleration.md)

## Context

After the spatial index (ADR 0004), frame time depends on what is visible.
Dense views are bound by rasterization: with 3K–7.7K visible strokes, a
frame took 59 ms p50 and 105 ms p95. That frame is paid again even when
nothing changed except the camera position, or an overlay such as the
stroke being drawn, the selection, or the lasso. Drawing a pen stroke over a
dense area therefore ran at 6–10 fps.

## Decision

### What is cached

Committed objects only, rendered into **256 × 256 CSS px tiles**
(`src/render/tile-cache.ts`). Everything else is drawn live every frame:
- the background, grid, axes and landmarks underneath (about 2 ms per frame);
- the stroke being drawn, selection outlines and handles, the lasso and the
  marquee on top.

Frames with an active move or resize preview are rendered directly, because
the preview changes how a committed object looks.

### Exactness rules

The deep-zoom lessons from earlier phases (no stale or magnified raster, no
holes) are rules here:
1. **One zoom per tile set.** A tile set (a "generation") belongs to one
   exact zoom level (`zi`, `zf`) and one DPR.
2. **No tiles while zooming.** While the zoom changes from frame to frame
   (wheel, pinch, typed jumps), frames render directly and no tiles are
   built. Tiles are built once the zoom has held still for one frame. Tiles
   are never scaled.
3. **Whole device pixels only.** Tiles are reused only when the camera has
   panned by a whole number of device pixels (within 1e-6 px) since the set
   began. Any other pan starts a new set, so tiles are copied 1:1 and never
   resampled. The offset is computed from the exact dyadic camera centres.
4. **Same drawing code.** Tiles are drawn by `drawObjects`, with the same
   projection as a direct frame. The visibility query covers the viewport
   plus one tile on each side, and coordinates are shifted by a whole number
   of pixels.
5. **Guard border.** Each tile is rendered with an 8 px border that is
   discarded. Rasterizers compute anti-aliased coverage differently where a
   path is clipped, so without the border faint seams appeared where strokes
   cross tile edges (found by measurement; see the test log).
6. **Same batching.** A tile draws a subset of the frame's objects, but keeps
   the frame's batch runs (`batchRuns`), so it groups same-colour strokes
   exactly as a full frame would.
7. **Derived state only.** Tiles are never saved, and any document load
   (canvas switch, read-only follow, import) clears them.

### Invalidation

- Each tile records the object ids drawn into it.
- An edit (including undo and redo) marks its ids dirty. On the next frame:
  - every tile that drew one of those ids is dropped;
  - every tile the object's new state overlaps (padded box) is dropped;
  - only those tiles are rendered again.
- A tile that showed an image placeholder (original still loading) is
  dropped when the asset library reports a decoded image. Re-importing a
  missing original also triggers this.
- A theme or DPR change clears all tiles.

### Memory

Up to about `3 × visible tiles + 16` tiles are kept for panning back; the
rest are released into a pool of at most 64 canvases. At 1280 × 800 this is
20 visible tiles: about 5 MiB at DPR 1 and 21 MiB at DPR 2 for the visible
set.

### Fidelity criterion

Direct and tiled frames are compared pixel by pixel. Two benign sources of
difference remain:
- **Batching.** A batched union and separate paints differ in anti-aliasing
  where same-colour strokes overlap. The direct renderer already varies this
  way with what lies just off-screen.
- **8-bit rounding** when compositing through a transparent tile.

In a dense 3,000-stroke frame of 1,024,000 pixels:
- 0.02% of pixels differ by more than 16 levels;
- 0.003% differ by more than 60 levels;
- with batching disabled, no pixel differs by more than 53 levels.

A missing, extra or shifted object changes hundreds to thousands of pixels
by large amounts. The tests therefore require at most 0.1% of pixels over
16 levels and at most 0.02% over 60 levels.

## Consequences

The full tables are in [testing/phase-1d.md](../testing/phase-1d.md).

| Dense 10K scene, frame p50 / p95 (ms) | Chromium | Chromium CPU-only | Firefox |
| --- | --- | --- | --- |
| Pan, direct → tiles | 89 / 147 → **2.2 / 19** | 83 / 123 → **2.4 / 19** | 98 / 152 → **2 / 23** |
| Still camera, direct → tiles | 152 / 174 → **3.3 / 4.9** | 136 / 146 → **2.2 / 2.6** | 172 / 178 → **2 / 3** |
| Pan + zoom every frame (no tiles by design) | 71 / 116 → 66 / 108 | 59 / 104 → 59 / 103 | 73 / 127 → 73 / 127 |

- **Panning and drawing over dense scenes** now run at 60 fps. The p95
  frames are those that render a newly exposed column of tiles.
- **Continuous zoom over dense scenes is unchanged** (60–70 ms p50).

## Deferred, with reasons

- **A scaled preview while zooming**, with progressive refinement. It is the
  remaining dense-scene cost. It shows a deliberately inexact (resampled)
  image during the gesture, so it needs its own rules: a time limit,
  refinement on idle, and never at extreme magnification. It will be decided
  with a dedicated test.
- **Tiles during move or resize previews:** excluding the moved objects
  from tiles and drawing them live. Today those frames render directly.
- **Worker or OffscreenCanvas tile rendering.** Tiles render on the main
  thread, inside the frame that needs them.
- **DPRs where a 256 px tile is not a whole number of device pixels** (for
  example 1.1): the cache turns itself off and frames render directly.

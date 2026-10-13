# Phase 1, slice 4 test log — raster tile cache

## Environment

Same as earlier phases. Four E2E projects: `chromium`, `chromium-cpu`,
`chromium-dpr2` and `firefox` (Firefox 157). Benchmarks ran in `chromium`,
`chromium-cpu` and `firefox` at 1280 × 800 and DPR 1.

## Commands

```sh
npm run build
npx playwright test tests/e2e/tiles.spec.ts          # 6 tests × 4 projects
npx playwright test -c playwright.bench.config.ts tests/bench/tiles.bench.ts
npm test
```

## How the fidelity criterion was found

The first comparison of tiled and direct frames, in a dense 3,000-stroke
scene, showed **up to 152 levels of difference across about 42K bytes**,
with nearly identical counts in Chromium and Firefox (both rasterize with
Skia). It was investigated rather than given a tolerance:

| Step | Finding | Effect |
| --- | --- | --- |
| Map the differing pixels | Two direct frames already differ in 441–1,039 bytes (rasterizer noise on the first frames). In a 30-stroke scene, **every** larger difference sat at one tile corner. | Seam effect located |
| Disable batching (experiment) | Differences halved | Batching contributes |
| Pad the tile-membership box by the stroke half-width + 2 px | Little change | Ruled out missing fringe objects |
| Keep the frame's batch runs in each tile (`batchRuns`) | Fewer differences | Kept |
| **8 px guard border per tile** (discarded) | Seam pixels gone; 3,952 → 1,713 pixels differing by >3 | Kept |
| Disable batching again (experiment) | 471 pixels differing by >3, max 53, none over 100 | The remaining large differences are batching unions |

**Final state** (dense 3,000 strokes, 1,024,000 pixels): 0.02% of pixels
differ by more than 16 levels and 0.003% by more than 60. Those are
anti-aliasing at overlaps of same-colour strokes (batched union versus
separate paints; the direct renderer already varies this way with what is
just off-screen) plus 8-bit compositing rounding. The tests require at most
0.1% over 16 and 0.02% over 60. A missing, extra or shifted object changes
hundreds to thousands of pixels by large amounts and fails.

## End-to-end tests (`tests/e2e/tiles.spec.ts`)

| Test | Assertions |
| --- | --- |
| Same picture | Dense 3,000 strokes: tiled frame equals direct frame (criterion above) at home, and after a 300×170 px pan that reuses tiles. |
| Reuse | After the build, a still camera renders **0 tiles and runs no visibility query**. 8 pans of 5 px render at most one new column or two (fewer than a full set). While the zoom changes every frame (bench pan+zoom trajectory), **no tile is built or used**. Once it stops, frames are tiled again and match direct rendering. |
| Sub-pixel pan | A pan of 0.375 px rebuilds every visible tile (no resampling); the picture matches. |
| Edits | Drawing a stroke renders more than 0 tiles but fewer than all of them. After a move (select drag), undo, opacity 0.4 and delete, each picture matches direct rendering. |
| Deep zoom | An image and a stroke placed 1,600 levels in, viewed at +0, +8 and +30 levels (exact stroke path, image pixels as exact rectangles): tiles are used and match direct rendering. |
| Late image | After a reload, at 2^6×, the image starts as a placeholder in tiles; when its original is decoded, the tile shows its true pixel colour, with frames still tiled. |

Result: **24/24** (6 tests × 4 projects).

### Defects found while writing the tests

1. **Frame-count assumptions** (test). Each change also schedules its own
   frame, so "the last frame rendered N tiles" was unreliable, more so in
   Firefox and at DPR 2. The tests now count tiles rendered over an action
   (`renderedTotal`), and simulate a zoom gesture with the synchronous bench
   trajectory.
2. **Image refresh hook** (application). Re-importing a missing original did
   not tell the renderer (`onReady` was only called for lazy loads). Cached
   tiles would have kept showing the placeholder. `importFile` now calls it.

## Benchmarks (`tests/bench/tiles.bench.ts`)

Frame time includes rasterization (a forced 1 px readback per frame).
Firefox times are whole milliseconds (its timer resolution on `file://`).
Format: p50 / p95 / p99 ms.

| Case | Mode | Chromium direct → tiles | Chromium CPU-only direct → tiles | Firefox direct → tiles |
| --- | --- | --- | --- | --- |
| dense-1k | pan | 11.2/16.3/19.7 → **2.9/5.1/7.2** | 9.2/14.6/15.9 → **2.3/3.7/4.6** | 12/17/19 → **2/4/5** |
| dense-1k | still | 16.4/19.4/20.5 → **2.5/3.0/3.1** | 14.3/15.5/16.2 → **2.1/2.4/2.6** | 18/19/20 → **2/3/3** |
| dense-1k | pan+zoom | 8.3/13.6/14.8 → 8.3/12.9/14.8 | 7.1/11.9/12.7 → 7.3/11.9/12.6 | 9/15/16 → 9/14/15 |
| dense-10k | pan | 88.8/147.0/226.9 → **2.2/18.8/24.7** | 83.2/123.4/136.1 → **2.4/19.4/22.9** | 98/152/161 → **2/23/27** |
| dense-10k | still | 151.7/174.2/205.9 → **3.3/4.9/5.6** | 135.7/146.3/167.7 → **2.2/2.6/3.2** | 172/178/184 → **2/3/4** |
| dense-10k | pan+zoom | 71.0/115.9/194.0 → 66.3/108.1/115.2 | 58.5/104.0/110.1 → 58.9/103.2/113.1 | 73/127/137 → 73/127/141 |
| clusters-100k | pan | 2.2/3.7/5.0 → 1.6/2.8/3.2 | 2.0/3.5/7.1 → 1.8/2.8/3.0 | 2/3/4 → 2/3/7 |
| clusters-100k | still | 2.2/2.3/4.6 → 1.8/2.0/2.0 | 2.3/2.5/4.6 → 1.9/2.1/4.2 | 3/4/4 → 2/3/4 |
| clusters-100k | pan+zoom | 2.1/3.2/4.5 → 2.4/3.1/4.6 | 2.1/2.8/4.2 → 2.4/3.4/5.0 | 2/4/4 → 3/4/4 |

Conclusions:
- Panning and still-camera redraws in dense scenes drop **by 30× to 75×**
  at p50. The p95 of about 19–23 ms is the frame that renders a newly
  exposed column of tiles.
- Pan+zoom is unchanged, as designed (no tiles while the zoom changes).
- Sparse scenes are unaffected (±0.5 ms).

## Regression

`npm test` (quick suite, 4 projects) on the v0.4.0 build `4528f2b3…f65a`:
**189 passed, 3 skipped by design** (the touch test outside the touch
project), **0 failed** (E2E 16.0 min). Every earlier test (navigation,
editing, deep-zoom rendering, zoom controls, storage, assets and archives)
passes with the tile cache on, in Chromium and Firefox. Unit tests 75/75;
the offline and naming checks pass.

## Not covered (unverified)

- A hardware-GPU canvas: all runs are headless (CPU or SwiftShader raster).
- Real pen input latency while drawing over dense scenes. The still-camera
  benchmark measures the redraw, not the input pipeline.
- Memory under long sessions with frequent zoom changes. The tile set is
  bounded and canvases are pooled, but heap was not measured over time.
- Fractional DPRs where 256 px is not a whole number of device pixels (the
  cache turns itself off; not exercised).

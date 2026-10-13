# Phase 1, slice 7 test log — zoom preview for dense scenes

## Environment

Same as earlier phases: four E2E projects (`chromium`, `chromium-cpu`,
`chromium-dpr2`, `firefox`).

## End-to-end tests (`tests/e2e/tiles.spec.ts`, 4 new; 10 tests × 4 projects in all)

| Test | Assertions |
| --- | --- |
| Preview, then refine on its own | Dense 10K strokes. Two 0.25-level zoom frames are previews (no tile rendered). **With no further input**, an exact frame follows within 3 s (about 150 ms in practice), and its picture equals direct rendering (the ADR 0009 criterion). |
| Bounded scale | 0.75 levels from the set is a preview; 1.25 levels renders an exact set (more than 0 tiles rendered, not a preview). |
| Sparse and deep stay exact | One stroke drawn 1,600 levels in. Six 0.25-level zoom frames, none of them a preview. |
| Edits are never hidden | After an edit (opacity change), the next zoom frame is not a preview. |
| (updated) Zoom while panning | The pan+zoom trajectory builds at most one full set. It returns to the set's own zoom after a sub-pixel pan, where an exact rebuild is correct. |

Result: **40/40** (all tile tests, 4 projects).

### Mutation check

With the refinement timer's redraw removed, "refine on its own" **fails**
(the last frame stays a preview). Restored afterwards.

### Defect found while building

The refine timer first reset the zoom key to an empty string. That made the
next frame count as *changing*, not stable, so it would never have refined.
It was caught in review before any test run and replaced by an explicit
`refineNow` flag; the test above now guards it.

## Benchmarks

Bench modes: `zoom` (±0.05 levels per frame in place) and the new `zoomin`
(+0.05 per frame, a steady gesture). Frame p50/p95/p99 in ms:

| Mode | Scene | Chromium direct → preview | Firefox direct → preview |
| --- | --- | --- | --- |
| zoom | dense 1K | 12.1/15.6/16.3 → 5.1/5.5/5.7 | 14/19/21 → 6/7/8 |
| zoom | dense 10K | 112.6/141.7/233.3 → 5.3/6.1/6.2 | 125/160/177 → 6/7/8 |
| zoomin | dense 1K | 10.8/15.2/18.4 → 4.9/6.6/18.2 | 12/20/22 → 6/9/26 |
| zoomin | dense 10K | 87.4/136.8/154.8 → 4.8/6.1/160 | 121/176/185 → 5/7/213 |

The `zoomin` p99 is the exact rebuild on each level crossed (3 in 60
frames).

## Regression

`npm test` (quick suite, 4 projects) on the v0.7.0 build `ec455d1c…f905`:
**233 passed, 3 skipped by design** (the touch test outside the touch
project), **0 failed** (E2E 17.2 min). Unit tests 82/82; the offline and
naming checks pass.

## Not covered (unverified)

- Visual quality of preview frames on real displays (headless only).
- Hardware-GPU canvases.
- Trackpad pinch gestures, which can mix many small zoom and pan steps.

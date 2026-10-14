# Full suite, three Chromium projects (2026-10-14)

Commit `4668645` (branch `exp/electron`, since merged); three Chromium projects (no Firefox), reduced loop counts (see README).

| Item | Result |
| --- | --- |
| Command | `npm run test:full` (typecheck, unit, full E2E, offline and names checks) |
| Wall time | 21 min 44 s (build and unit tests included) |
| Unit | 130/130 |
| E2E | 214 passed, 4 skipped, 1 failed |
| Offline and names checks | Pass (run separately after the E2E failure; `npm` stopped at the failed step) |
| Failure | `tiles.spec.ts:249` dense scenes: zooming more than one level from the tile set renders exactly, in `chromium-cpu`. Known timing flake (also fails on `main`); re-run alone, 4 of 5 passed. Fixed afterwards (see below). |

Test-body time per project (sum of per-test times; the rest of the wall time is page loads and startup):

| Project | Tests run | Test-body time |
| --- | --- | --- |
| `chromium` | 89 (all specs, plus the long wheel run) | 564 s |
| `chromium-cpu` | 65 | 330 s |
| `chromium-dpr2` | 65 | 386 s |

Slowest tests:

| Test | `chromium` | `chromium-cpu` | `chromium-dpr2` |
| --- | --- | --- | --- |
| Very long wheel zoom, 2,000 notches in and out (`chromium` only) | 198 s | skipped | skipped |
| Directional pan (`navigation`) | 54 s | 54 s | 66 s |
| Wheel zoom in-first, 480 notches each way | 49 s | 49 s | 50 s |
| Wheel zoom out-first, 480 notches each way | 49 s | 49 s | 50 s |
| Curvy stroke zoom (`deep-zoom-rendering`) | 47 s | 47 s | n/a |

Estimate before the run: about 23 min. Measured: 21 min 44 s.

## Tiles flake fixed

The zoom-preview tests in `tiles.spec.ts` raced the app: they read the tile stats in a second page call, after the
~150 ms refine frame could already have replaced the preview, and the "edit during a preview" test let a frame render
the edit into the tiles before it zoomed (a preview of that set is then legitimate). `zoomBy` now returns the stats
from the same page call, and the edit test makes the edit and the zoom in one call. Before: that test failed 3 of 15
runs in `chromium-dpr2` alone. After: 108/108 passed (the three dense-scene tests, 12 repeats, 3 projects, 2.8 min).

Correction (same day): the first version of this file said 930 s for `chromium`; the sum of the per-test times is 564 s (the three projects add up to 1280 s, about the 21 min 44 s wall time). The commit message of `36dc487` repeats the old figure.

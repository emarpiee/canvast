# Full suite on the Electron branch (2026-10-14)

Branch `exp/electron` at `4668645`; three Chromium projects (no Firefox), reduced loop counts (see README).

| Item | Result |
| --- | --- |
| Command | `npm run test:full` (typecheck, unit, full E2E, offline and names checks) |
| Wall time | 21 min 44 s (build and unit tests included) |
| Unit | 130/130 |
| E2E | 214 passed, 4 skipped, 1 failed |
| Offline and names checks | Pass (run separately after the E2E failure; `npm` stopped at the failed step) |
| Failure | `tiles.spec.ts:249` dense scenes: zooming more than one level from the tile set renders exactly, in `chromium-cpu`. Known timing flake (also fails on `main`); re-run alone, 4 of 5 passed. Not fixed. |

Test-body time per project (sum of per-test times; the rest of the wall time is page loads and startup):

| Project | Tests run | Test-body time |
| --- | --- | --- |
| `chromium` | 89 (all specs, plus the long wheel run) | 930 s |
| `chromium-cpu` | 63 | 330 s |
| `chromium-dpr2` | 64 | 386 s |

Slowest tests:

| Test | `chromium` | `chromium-cpu` | `chromium-dpr2` |
| --- | --- | --- | --- |
| Very long wheel zoom, 2,000 notches in and out (`chromium` only) | 198 s | skipped | skipped |
| Directional pan (`navigation`) | 54 s | 54 s | 66 s |
| Wheel zoom in-first, 480 notches each way | 49 s | 49 s | 50 s |
| Wheel zoom out-first, 480 notches each way | 49 s | 49 s | 50 s |
| Curvy stroke zoom (`deep-zoom-rendering`) | 47 s | 47 s | n/a |

Estimate before the run: about 23 min. Measured: 21 min 44 s.

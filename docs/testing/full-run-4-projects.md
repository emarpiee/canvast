# Full suite, four projects with Firefox (2026-10-14)

Commit `ecd7a30` (version 0.9.0, reduced loop counts, Firefox restored). Started 17:17, wall time 32 min 25 s.

| Item | Result |
| --- | --- |
| Command | `npm run test:full` |
| Unit | 130/130 |
| E2E | 301 passed, 6 skipped, 1 failed |
| Failure | `deep-zoom-rendering` "zooming deep into a curvy stroke" in `firefox`: test timeout of 180 s (not a rendering failure). The test now sets its own timeout (480 s in full mode, like the directional pan). Re-run alone in full mode in Firefox: passed in 5.2 min. |
| Offline and names checks | Not reached after the E2E failure; they passed on the same `dist/` earlier the same day |

Test-body time per project (sum of per-test times):

| Project | Tests run | Time |
| --- | --- | --- |
| `chromium` | 89 | 574 s |
| `chromium-cpu` | 65 | 336 s |
| `chromium-dpr2` | 65 | 386 s |
| `firefox` | 89 | 613 s (745 s with the failed test at its real 312 s) |

Slowest tests:

| Test | Project | Time |
| --- | --- | --- |
| Very long wheel zoom, 2,000 notches in and out | `chromium` only | 198 s |
| Curvy stroke zoom, 240 steps | `firefox` | 312 s (180 s before it timed out) |
| Curvy stroke zoom | `chromium` | 54 s |
| Opacity, self-crossing stroke | `firefox` | 102 s |
| Directional pan | all Chromium | 54–66 s |

Estimate before the run: about 29 min. Measured: 32 min 25 s, about 34.5 min once the Firefox curvy test runs to the end. Firefox is the slowest project, and that one test is the largest single cost in it.

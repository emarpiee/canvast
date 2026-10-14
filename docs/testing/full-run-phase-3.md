# Full suite at the end of Phase 3 (2026-10-15)

Version 0.12.0 (Phase 3 complete; the run was made on the same code labelled 0.11.0, the version label is the only difference), four projects (`chromium`, `chromium-cpu`, `chromium-dpr2`, `firefox`), full loop counts. Started 00:08, finished about 00:45: wall time **36 min 36 s** (estimate before the run: about 35 min).

| Item | Result |
| --- | --- |
| Command | `npm run test:full` |
| Typecheck | Pass |
| Unit | 147/147 (19 files) |
| E2E | **380 passed, 6 skipped, 0 failed** |
| Offline and names checks | Pass |
| Tier benchmark | Recorded separately in [phase-3-bench.md](phase-3-bench.md) |

Test-body time per project (sum of per-test times; the rest of the wall time is page loads and startup):

| Project | Tests | Time |
| --- | --- | --- |
| `chromium` | 108 | 608 s |
| `chromium-cpu` | 82 | 364 s |
| `chromium-dpr2` | 83 | 432 s |
| `firefox` | 107 | 779 s |

Slowest tests:

| Test | Project | Time |
| --- | --- | --- |
| Curvy stroke zoom, 240 wheel steps | `firefox` | 300 s |
| Very long wheel zoom, 2,000 notches in and out | `chromium` only | 198 s |
| Opacity, self-crossing stroke | `firefox` | 102 s |
| Directional pan | `chromium-dpr2` 66 s; `chromium` and `chromium-cpu` 54 s | |
| Wheel zoom in-first and out-first, 480 notches each way | each project | about 50 s |

Compared with the Phase 2 full run (34 min 50 s): +1 min 46 s for the roughly 40 tests added in Phase 3 (decoded-image budget, adaptive quality, cooperative index build, import grid, FPS counter and diagnostics, oriented selection boxes and rotation fixes).

Known failures against the ADR 0028 targets are listed in [phase-3-bench.md](phase-3-bench.md); none is a test failure.

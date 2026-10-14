# Full suite at the end of Phase 2 (2026-10-14)

Version 0.11.0 working tree (Phase 2 complete, plus the Layers panel and bookmarks), four projects (`chromium`, `chromium-cpu`, `chromium-dpr2`, `firefox`), full loop counts. Started 20:05:31, finished 20:40:22: wall time **34 min 50 s** (estimate before the run: about 35 min).

| Item | Result |
| --- | --- |
| Command | `npm run test:full` |
| Typecheck | Pass |
| Unit | 141/141 (18 files) |
| E2E | 340 passed, 6 skipped, 2 failed |
| Failures | The same test, "hide and lock", in `chromium` and `chromium-dpr2`. A measurement flake in the test, not a fault in the feature: it compared the count of all inked pixels, which differs by a pixel or a few hundred between a frame drawn from the tile cache and one drawn directly. Fixed to compare one pixel on the stroke; the post-reload check now waits for the canvas to be painted (a read before the first frame returns black). The fixed test and the Layers panel test passed 64 of 64 runs (8 repeats, 4 projects). The full suite was **not** re-run after this fix. |
| Offline and names checks | Pass (run separately: the suite stopped at the E2E failure) |

Test-body time per project (sum of per-test times; the rest of the wall time is page loads and startup):

| Project | Tests | Time |
| --- | --- | --- |
| `chromium` | 99 | 577 s |
| `chromium-cpu` | 75 | 343 s |
| `chromium-dpr2` | 75 | 410 s |
| `firefox` | 99 | 733 s |

Slowest tests:

| Test | Project | Time |
| --- | --- | --- |
| Curvy stroke zoom, 240 wheel steps | `firefox` | 300 s |
| Very long wheel zoom, 2,000 notches in and out | `chromium` only | 198 s |
| Opacity, self-crossing stroke | `firefox` | 96 s |
| Directional pan | `firefox` 72 s; each Chromium project 54-66 s | |
| Wheel zoom in-first and out-first, 480 notches each way | each project | 49-51 s |

Compared with the last full run (v0.9.0, 4 projects, 32 min 25 s): +2 min 25 s for the 40 or so tests of Phase 2 and the settings, rotation, snapping, groups, hide and lock, eraser, recovery, Layers panel and bookmarks.

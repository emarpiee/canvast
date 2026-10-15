# Full suite at the end of Phase 6 (2026-10-16)

Version 0.15.0 (Phase 6: media, plus the gaps closed in ADR 0047), four projects (`chromium`, `chromium-cpu`, `chromium-dpr2`, `firefox`), full loop counts. The record below is the fifth start of the suite (the first four stopped early, see "Earlier starts"). Started 01:06, wall time **40 min 26 s** (estimate before the run: about 41 min).

| Item | Result |
| --- | --- |
| Command | `npm run typecheck`, `test:unit`, `test:e2e:full`, `check:offline`, `check:names` |
| Typecheck | Pass |
| Unit | 173/173 (25 files, 14.7 s) |
| E2E | **411 passed, 6 skipped, 1 failed** (40.1 min) |
| Offline and names checks | Pass (run on their own after the E2E step, which stopped the chain) |

## The one failure

`deep-zoom-rendering` "zooming deep into a curvy stroke never shows holes or spill (wheel input)" in `firefox`: 140 holes at zoom level 45. It is **intermittent and was there before Phase 6**:

| Run | Code | Result |
| --- | --- | --- |
| Full suite runs 3 and 4 | v0.15.0 candidate | passed |
| Re-run alone, 2 times, full mode | v0.15.0 candidate | 1 failed (140 holes, level 35), 1 passed |
| Re-run alone, 4 times, full mode | `0fd1f4c`, before any of the gap work | 1 failed (140 holes, level 12), 3 passed |

The hole count is 140 every time and the zoom level differs, so it is a rendering defect of Firefox's zoom path (not a timeout). It is **not fixed**; it stays open as the next bounded task (see `docs/status.md`).

## Earlier starts

| Start | Stopped at | Cause | Fix |
| --- | --- | --- | --- |
| 1 | Unit, 26 s | `groups.test.ts` timed out at 5 s with 25 parallel workers (passes alone in 0.5 s) | Unit `testTimeout` 30 s (E2E `LIMITS` untouched) |
| 2 | Unit, 27 s | `stroke-coverage.test.ts` timed out the same way | same |
| 3 | E2E, 38 min | `assets` "a video is placed" (chromium): Extract Frame gave nothing in 5 s | Extract Frame retries 4 times; the test waits for the player to be opaque and uses a 20 s expect timeout |
| 4 | E2E, 41 min | `frames` "layers panel" (firefox): my rename test, double-click not delivered after the rows redraw (a real bug) | Rename starts from two quick presses (pointer events), not `dblclick` |

## Times

| Project | Test time |
| --- | --- |
| chromium | 10.5 min |
| chromium-cpu | 6.4 min |
| chromium-dpr2 | 8.6 min |
| firefox | 14.4 min |

Slowest tests: Firefox curvy stroke zoom 318 s, Chromium 2,000-notch wheel zoom 198 s, Firefox opacity self-crossing stroke 108 s, Chromium-dpr2 directional pan 84 s, Chromium-dpr2 480-notch zoom 60 s. The same set as Phase 5.

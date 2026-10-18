# Full suite at v0.19.0, 2026-10-18

`npm run test:full` on the commit "docs: backlog row for the layer clipping toggle" (v0.19.0), in the background beside other work.

| | |
| --- | --- |
| E2E | **940 passed, 10 skipped (by design), 12 failed** in 1 h 5 min 44 s (real; user 25 min 38 s) |
| Slowest file | firefox `deep-zoom-rendering.spec.ts` 8.3 min |

## The 12 failures

| Test | Projects | Cause | What was done |
| --- | --- | --- | --- |
| frames: selection boxes follow the rotation, rotation works from outside a corner (marquee) | all four | A drag starts at (378, 240), under the dev panel, which reached x = 381 | the dev panel is at most 20 rem wide (ends at x = 370); passes |
| navigation: drag pans content exactly | all four | The same: a drag at (380, 260) landed on the dev panel | the same fix; passes |
| text: convert text to path | chromium | The same panel: the click at (300, 250) landed on it. It was not a timing flake | the same fix; passes |
| styles: gradient map on a picture | chromium-dpr2 | Did not repeat: passes alone | none |
| pictures: a video has every adjustment; adjustments: red, green and blue, levels, a curve | firefox | Did not repeat: both pass alone (a field read before its blur had landed, under load) | none |

Nothing was loosened: no `LIMITS` changed, no test deleted. The unit tests (479 in 71 files) and the 24 specs of the affected files pass on the v0.19.1 build.

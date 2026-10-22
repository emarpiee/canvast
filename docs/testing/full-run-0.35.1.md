# Full suite at v0.35.1 (Painting view P2 and P3)

Run once for the end of P2 and P3 together (2026-10-22, 11:34 to 13:06), from snapshot `test-builds/20261022-0335-437091fc`
(source of v0.35.1, before the two ratio fixes), `npm run test:full`.

**Result:** 1318 tests, **1284 passed, 29 skipped, 5 failed**, 1.5 h wall time (89.6 min of test time).

| Project | Test time |
| --- | --- |
| firefox | 36.4 min |
| chromium | 28.2 min |
| chromium-dpr2 | 13.4 min |
| chromium-cpu | 11.6 min |

| Spec (all projects) | Test time |
| --- | --- |
| navigation.spec.ts | 16.0 min |
| frames.spec.ts | 11.9 min |
| deep-zoom-rendering.spec.ts | 11.1 min |
| vectors.spec.ts | 7.7 min |
| pictures.spec.ts | 5.9 min |
| editing.spec.ts | 5.3 min |
| assets.spec.ts | 5.2 min |
| text.spec.ts | 4.2 min |
| painting.spec.ts | 3.5 min |
| sheets.spec.ts | 3.2 min |

Slowest tests: deep-zoom-rendering "zooming deep into a curvy stroke" 329 s (Firefox), 59 s (Chromium); navigation "very long wheel zoom,
2,000 notches" 202 s (Chromium); deep-zoom-rendering "a self-crossing stroke is painted once" 114 s (Firefox); navigation "directional pan
at shallow, deep and far-out zoom" 54 to 71 s per project.

## Failures and what was done

| Test | Project | Cause | Done |
| --- | --- | --- | --- |
| organize.spec.ts:345, the workspace menu exports | chromium, firefox | The locator `.nav-crumb` also matched the Paint view's "All paintings" crumb (there since v0.31.0) | Locator made the canvas's crumb (`view-canvas`); passes in both |
| frames.spec.ts:106, after giant zoom-outs, steps stay fast | firefox | A step took 551 ms (limit 500), 1.5 h into a loaded run | Passes alone; limit kept |
| frames.spec.ts:169, a stroke far above the view covers it | firefox | A step took 639 ms (limit 500), as above | Passes alone; limit kept |
| assets.spec.ts:749, audio plays only its range | chromium | The Play button did not show again in 5 s after the range's end | Passes alone (a timing flake of the media player) |

Re-run alone from a fresh snapshot (13:07): those tests and the new P4 tests (Smudge, Clone stamp, OpenRaster), Chromium and Firefox,
14 passed.

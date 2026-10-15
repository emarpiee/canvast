# Full suite at the end of Phase 7 (2026-10-16)

Version 0.16.0 (Phase 7: professional UX), four projects (`chromium`, `chromium-cpu`, `chromium-dpr2`, `firefox`), full loop counts. One start, no restarts. Started 06:55, wall time **39 min 43 s** (estimate before the run: about 41 min).

| Item | Result |
| --- | --- |
| Command | `npm run test:full` (typecheck, `test:unit`, `test:e2e:full`, `check:offline`, `check:names`) |
| Typecheck | Pass |
| Unit | 176/176 (26 files, 14.6 s) |
| E2E | **428 passed, 6 skipped, 0 failed** (39.4 min) |
| Offline and names checks | Pass (238 first-party files clean) |

The Firefox "zooming deep into a curvy stroke" test, which failed intermittently at the end of Phase 6, passed in this run (312 s). That is the first full run with the zoom-preview coverage fix (ADR 0033 amendment).

## Time per project

| Project | Test time |
| --- | --- |
| chromium | 10.6 min |
| chromium-cpu | 6.4 min |
| chromium-dpr2 | 7.8 min |
| firefox | 14.4 min |

Slowest tests: Firefox curvy stroke zoom 312 s, Chromium 2,000-notch wheel zoom 198 s, Firefox opacity self-crossing stroke 108 s, Chromium-dpr2 directional pan 72 s, Chromium-cpu and Chromium directional pan 54 s each. The same set as Phases 5 and 6.

## New in this phase

`settings.spec.ts` (4 tests: tabs and rows, shortcuts, appearance, view tabs), `a11y.spec.ts` (2), `editing.spec.ts` "selection action bar", unit `settings-view.test.ts` (3). Settings, accessibility and view-switch specs run in `chromium` and `firefox` only (DOM logic).

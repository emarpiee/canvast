# Full suite at the end of Phase 5 (2026-10-15)

Version 0.14.0 (Phase 5: creative editing), four projects (`chromium`, `chromium-cpu`, `chromium-dpr2`, `firefox`), full loop counts. Started 04:08, wall time **39 min 28 s** (estimate before the run: about 37 min).

| Item | Result |
| --- | --- |
| Command | `npm run typecheck`, `test:unit`, `test:e2e:full`, `check:offline`, `check:names` (the steps of `npm run test:full`) |
| Typecheck | Pass |
| Unit | 164/164 (22 files) |
| E2E | **400 passed, 6 skipped, 0 failed** |
| Offline and names checks | Pass |

Phase 5 added no test files: pens, arrange, clipboard, opacity, mentions and backlinks extend `frames`, `text` and the unit specs (`arrange`, `pens`, `clipboard`, `text`).

Test-body time per project (sum of per-test times):

| Project | Tests | Time |
| --- | --- | --- |
| `chromium` | 114 | 617 s |
| `chromium-cpu` | 89 | 379 s |
| `chromium-dpr2` | 89 | 442 s |
| `firefox` | 114 | 868 s |

Slowest tests: Firefox curvy stroke zoom 313 s, Chromium 2,000-notch wheel zoom 200 s, Firefox opacity self-crossing stroke 120 s. Same set as Phase 4 (36 min 24 s); the extra time is the new tests and Firefox variance.

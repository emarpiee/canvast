# Full suite at the end of Phase 4 (2026-10-15)

Version 0.13.0 (Phase 4: assets and storage), four projects (`chromium`, `chromium-cpu`, `chromium-dpr2`, `firefox`), full loop counts. Started 02:18, wall time **36 min 24 s** (estimate before the run: about 37 min).

| Item | Result |
| --- | --- |
| Command | `npm run test:full` |
| Typecheck | Pass |
| Unit | 147/147 (19 files) |
| E2E | **380 passed, 6 skipped, 0 failed** |
| Offline and names checks | Pass |

Phase 4 added no test files: the idle prebuild, persisted thumbnails, slide view and smart folders extend `tiles`, `assets` and `organize` specs.

Test-body time per project (sum of per-test times):

| Project | Tests | Time |
| --- | --- | --- |
| `chromium` | 108 | 603 s |
| `chromium-cpu` | 82 | 364 s |
| `chromium-dpr2` | 83 | 429 s |
| `firefox` | 107 | 768 s |

Slowest tests: Firefox curvy stroke zoom 294 s, Chromium 2,000-notch wheel zoom 198 s, Firefox opacity self-crossing stroke 102 s, directional pan 54-66 s per Chromium project. Same as Phase 3 (36 min 36 s).

Not covered by automated tests (checked by hand or measured once): the Assets view with 1,000 images (opens in under 250 ms in both browsers, ADR 0034); the zoom hitch at the preview bound with the idle prebuild (dense-10k: the 70 ms frame is gone, ADR 0033).

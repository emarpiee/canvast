# v0.25.0: Pattern generators, Objects fill, saved-kind folders (2026-10-21)

Checks run on the source of this slice (snapshots in `test-builds/`, one run at a time). The slice was built in steps, so each group of specs was run on the final source that touches it.

| Check | Result |
| --- | --- |
| `npm run typecheck`, `check:tokens`, `check:picker`, `check:patterns`, `check:names` | pass |
| `npm run test:unit` (82 files) | 544 passed |
| `pattern.spec`, `patterns-package.spec` (Chromium, Firefox) | 10 passed (26.7 s) |
| `pictures.spec`, `screenshot.spec`, `settings.spec` (Chromium) | 41 passed with `pattern.spec` and `patterns-package.spec` (1.5 min) |
| `pictures.spec`, `screenshot.spec`, `settings.spec` (Firefox) | 39 passed (1.9 min) |
| `vectors.spec -g "Save to library"` (Chromium, Firefox) | 2 passed (6.3 s) |

The quick suite (`npm test`, 4 browser configs) was last run on the source before the Objects and Pattern renames and before the per-kind folders: 1164 passed, 4 failed (the known CSS failures: `assets.spec` "small screens: the details panel is resizable" in Chromium and Firefox, "gallery viewer: the view tabs..." in Firefox, `files.spec` "an SVG keeps its real preview" in Firefox), 24 skipped, 53.8 min. The specs the renames touch were run again as above; the full quick suite has not been run on the final source.

Slowest test of the unit suite: `tests/unit/pattern.test.ts` "makes sound shapes from random values..." (about 10 s alone: every generator at its extremes in three box sizes), timeout 60 s.

## v0.25.1: exports are cut to the sheet

| Check | Result |
| --- | --- |
| New test `pattern.spec` "a pattern that runs past its sheet exports as the sheet's frame" | failed before the fix (SVG ratio 1.05, not 1.5), passes after |
| `sheets`, `release`, `pattern`, `pictures` (Chromium) | 50 passed (1.9 min) |
| `vectors.spec -g "SVG\|svg\|Export\|export\|PDF\|pdf\|clip\|mask\|sheet"` (Chromium) | 9 passed (16.5 s) |
| `sheets`, `pattern` (Firefox) | 23 passed (1.2 min) |

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

## v0.25.2: the default ink in SVG and PDF

| Check | Result |
| --- | --- |
| `vectors.spec` "the default outline is written to an SVG as the canvas draws it" (Chromium, Firefox) | 2 passed; before the fix the SVG held `#1f2329` on a dark canvas (the PNG outline was the light ink) |
| `vectors.spec -g "SVG\|svg\|Export\|export\|PDF\|pdf\|clip\|mask\|sheet\|outline"` (Chromium) | 19 passed (38.9 s) |
| `npm run test:unit` | 545 passed (`svg.test.ts` gained the ink test) |

## v0.25.3: WYSIWYG colours, SVG outline position, angular gradients, gradient import

| Check | Result |
| --- | --- |
| `npm test` (quick suite) on the build before the angular/network work | 1174 passed, 8 failed (55.4 min): the 4 known CSS failures plus `text.spec` "readable ink" ×4, whose test still read the removed theme mapping (rewritten) |
| `vectors`, `pattern`, `pictures`, `text` specs, `-g "angular\|network\|gradients\|both gradients\|WYSIWYG\|SVG\|Export\|PDF\|clip\|sheet\|outline\|readable ink"` (Chromium, Firefox) | 63 passed, 4 failed (3.4 min); the 4 were test-side: hint test read the focused picker button's hint, radius bound 0.85 should be 0.9 (143.5 over the 166-wide shape), text test parsed oklch |
| The 3 fixed tests re-run from a fresh snapshot (Chromium, Firefox) | 4 passed (16.7 s) + "both gradients" 2 passed (9.2 s) |
| Not re-run on the final source | the full quick suite (only the specs above ran after the angular/network changes) |

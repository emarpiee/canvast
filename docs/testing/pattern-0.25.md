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

## v0.25.4 to v0.25.11: pen stroke chip, CSS paste, Styles copy, picker copy, clipboard

Targeted specs only (the full quick suite was not re-run on the final source; the last full run is the v0.25.3 one above).

| Version | Check | Result |
| --- | --- | --- |
| 0.25.4 | `vectors.spec` "a pen stroke picked alone is recoloured…", "…flat colour only", "both gradients" (Chromium, Firefox) | 4 passed (11.3 s) |
| 0.25.5 | `vectors.spec` CSS gradient paste (Chromium) + "another design tool" | 2 passed (2.8 s); unit `svg.test.ts` 15 passed |
| 0.25.6 | CSS paste with colours; `styles.spec` gradient copy (Chromium, Firefox) | 5 passed (18.7 s) |
| 0.25.7 | all `styles.spec` + CSS paste (Chromium, Firefox) | 11 passed (34.1 s) |
| 0.25.8 | `colour-picker.spec` + `styles.spec` (Chromium, Firefox) | 14 passed (42.0 s); wider run (pictures, settings, vectors; Styles, colour, gradient) 52 passed (2.0 min) |
| 0.25.9 | copy/paste specs of vectors, frames, text, pictures (Chromium, Firefox) | 28 passed (52.5 s) |
| 0.25.10 | the same plus assets, "Export" (Chromium, Firefox) | 39 passed (1.3 min) |
| 0.25.11 | `styles.spec` + CSS paste (Chromium, Firefox) | 11 passed (37.8 s) |

### The 4 known failures, fixed (test side, no app code changed)

| Test | Cause | Fix | Result |
| --- | --- | --- | --- |
| `assets.spec` "small screens: the details panel is resizable…" (Chromium, Firefox) | The centring check took the picture's left gap as its top margin (63 px for a narrow picture), and the controls are now three rows (previews, previous/play/next, zoom), not two | Measure the room's real top margin; assert three rows in order | passed in both |
| `assets.spec` "gallery viewer: the view tabs…" (Firefox) | Firefox in the harness sends a pointerleave right after each mouse move, which undid the "pointer near the top edge" state | In Firefox the pointermove is dispatched as an event | passed in both |
| `files.spec` "an SVG keeps its real preview…" (Firefox) | In Firefox the harness reports no element as `:hover` (`document.querySelectorAll(":hover")` is empty), so the pointed-at chip cannot show | In Firefox the card is given keyboard focus (the chip shows for it too); hover stays the check in Chromium | passed in both |

Run: `assets.spec` and `files.spec` filtered to those three tests, Chromium and Firefox: 6 passed (13.8 s). Unverified: that real Firefox (not the harness) shows the chip on hover and the top controls near the top edge.

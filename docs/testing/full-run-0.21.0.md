# Full suite at v0.21.0, 2026-10-20

`npm run test:full` (`test:snap -c playwright.full.config.ts`) on 9478bb2 (v0.21.0), snapshot `test-builds/20261020-0157-1f410a2c`, Chromium 156 (three projects) and Firefox 157 on Linux, beside other work on the same machine.

| | |
| --- | --- |
| E2E | **1,125 passed, 15 skipped (by design), 16 failed** (8 tests) in 1 h 15 min 36 s |
| Slowest files | firefox `deep-zoom-rendering.spec.ts` 7.5 min · chromium `navigation.spec.ts` 6.4 min · firefox `vectors.spec.ts` 4.1 min · chromium-dpr2 `navigation.spec.ts` 3.5 min |
| Slowest tests | firefox "zooming deep into a curvy stroke never shows holes or spill (wheel input)" 329 s · chromium "very long wheel zoom: 2,000 notches in, then 2,000 out" 201 s · firefox "opacity: a self-crossing stroke is painted once" 106 s · "directional pan at shallow, deep and far-out zoom" 54–69 s in each project |

## The 16 failures

| Test | Projects | Cause | What was done |
| --- | --- | --- | --- |
| files: a 3D model becomes a card … and the buttons that fit it | chromium, chromium-cpu, chromium-dpr2 | **App bug.** The import notice (bottom centre, `bottom: 20px`) lay over the Actions bar at the bottom and took its clicks: the Export menu could not be opened while the notice showed | Notices stack above the Actions bar when it is at the bottom (`src/styles.css`, phone width too) |
| navigation: the command palette … shows its key | all four | Stale: the palette shows every key of a command since the keymap (Zoom in: `+, =`) | the test expects `+, =` |
| organize: tags can be renamed and deleted for the whole library | chromium, firefox | Stale: the dialog says "The items stay in the library" since "Assets" became "Library" | the test looks for "items stay" |
| settings: shortcuts: every key can be changed | chromium, firefox | Stale: F7 is now asked about (the browser's caret browsing) before it is used | the test checks the warning and confirms "Use F7 anyway" |
| vectors: on a phone the Actions bar stands above the bottom controls, and the colours … share the row of the Properties bar | chromium, firefox | Test selector: the colours' own bar is also a `.toolbar > .tb-options-row`, so "not in the Properties bar's row" always found them | the selector names the Properties bar; the colours are checked to be in their own bar when wider |
| assets: small screens … the viewer's picture is centred | chromium, firefox | Stale: the picture's room keeps clear of the button that hides the controls (`--viewer-bottom`), so the stage is not split equally | centred within the picture's own room, measured from `--viewer-bottom` |
| assets: gallery viewer … the picture is the same with the controls hidden | chromium | Timing: the test switches density and back, then hides the controls at once; the room for the controls follows their height through a ResizeObserver a frame later (off by 5 px, the dense–compact difference) | waits for the control row to be back to its height and polls the picture's box |

Re-run from a fresh snapshot (`20261020-0350-b4f5e488`, the fixed source): the 8 tests in all four projects, **16 passed** in 42 s. `check:tokens` passes. Nothing was loosened: no `LIMITS` changed, no test deleted.

Note: the Firefox deep-zoom wheel test (329 s) is most of that file's time and held the run for about 5 minutes; it passed.

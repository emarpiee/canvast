# Full suite, 0.57.0 (2026-11-11)

The whole end-to-end suite with the full stress loops (`Tests` workflow, `suite: full`, run 42962258775) on commit `88352902`, the last rendering change of the smooth pan and zoom work (the tile cache: sub-pixel pans, zoom runs, sets built a few tiles a frame over the old one). On GitHub's shared Ubuntu machines, every group and project in parallel.

| | |
| --- | --- |
| Result | **Passed**: 1,621 tests passed, 51 skipped (by project), 0 flaky, 0 failed |
| Wall time | 21 min 51 s (04:54:35 to 05:16:26 UTC), the longest job `desktop` |
| Jobs | 37: 9 groups × 4 browser projects (`chromium`, `chromium-cpu`, `chromium-dpr2`, `firefox`), plus `desktop` |
| Before it | the same suite on 0.56.39 failed in `tiles.spec` (light views waited for the zoom to hold still, so tiles came 150 ms later than the specs expect; the specs expected tiles two frames after a jump; they now wait for tiles) and once in `vectors.spec` (a race in the bar alignment check; it polls now) |
| After it | the first `Pan and zoom` run found that limiting that wait to heavy views made wheel zooms build and throw away sets (984 tiles); the wait applies to every view again, the tile specs wait for tiles, and a quick suite ran on that commit |

## Jobs (minutes)

| Job | Time |
| --- | --- |
| desktop | 21.8 |
| drawing · firefox | 15.7 |
| navigation · firefox | 12.8 |
| navigation · chromium | 10.6 |
| drawing · chromium | 9.6 |
| library · firefox | 9.3 |
| navigation · chromium-cpu | 8.6 |
| navigation · chromium-dpr2 | 7.5 |
| library · chromium | 7.4 |
| drawing · chromium-dpr2 | 5.3 |
| drawing · chromium-cpu | 4.3 |
| pictures · firefox | 3.7 |
| storage · firefox | 3.3 |
| pictures · chromium-cpu | 3.1 |
| storage · chromium | 2.8 |
| pictures · chromium | 2.8 |
| pictures · chromium-dpr2 | 2.7 |
| interface · firefox | 2.1 |
| interface · chromium | 2.0 |
| library · chromium-dpr2 | 1.9 |
| smoke · chromium | 1.6 |
| library · chromium-cpu | 1.5 |
| smoke · firefox | 1.5 |
| rendering · firefox | 1.4 |
| rendering · chromium | 1.3 |
| rendering · chromium-dpr2 | 1.3 |
| rendering · chromium-cpu | 1.3 |
| packages · firefox | 1.1 |
| interface · chromium-dpr2 | 1.1 |
| smoke · chromium-dpr2 | 1.0 |
| smoke · chromium-cpu | 0.9 |
| interface · chromium-cpu | 0.9 |
| storage · chromium-cpu | 0.8 |
| packages · chromium | 0.8 |
| packages · chromium-dpr2 | 0.8 |
| storage · chromium-dpr2 | 0.7 |
| packages · chromium-cpu | 0.6 |

## The 30 longest tests

From the log's timestamps between one test's start and the next in its job (so a test's time includes its fixture set-up).

| Time | Project | Spec | Test |
| --- | --- | --- | --- |
| 236 s | [firefox] | `tests/e2e/deep-zoom-rendering.spec.ts:56` | zooming deep into a curvy stroke never shows holes or spill (wheel input) |
| 201 s | [chromium] | `tests/e2e/navigation.spec.ts:100` | very long wheel zoom: 2,000 notches in, then 2,000 out, returns exactly |
| 124 s | [firefox] | `tests/e2e/text.spec.ts:318` | a font placed on the canvas is a card that shows Aa in that font, not the plain file card |
| 87 s | [desktop] | `tests/e2e/desktop.spec.ts:602` | hidden items, browser to desktop: a browser backup's hidden item (readable, marked hidden) comes in  |
| 80 s | [desktop] | `tests/e2e/desktop.spec.ts:2189` | the Trash is a state of the library: this workspace's .trash for the mode, in the library's cards, w |
| 80 s | [firefox] | `tests/e2e/deep-zoom-rendering.spec.ts:123` | opacity: a self-crossing stroke is painted once (no double blend, no holes), shallow and deep |
| 76 s | [desktop] | `tests/e2e/desktop.spec.ts:1577` | a file past what the page can hold (300 MiB): imported by the button, hidden and shown again, kept i |
| 67 s | [desktop] | `tests/e2e/desktop.spec.ts:706` | a backup exported from Settings and imported into a workspace folder: written as folders and files;  |
| 57 s | [desktop] | `tests/e2e/desktop.spec.ts:2392` | Copy of vectors reaches other programs as SVG and PNG; a hidden SVG asks first, and goes nowhere out |
| 57 s | [firefox] | `tests/e2e/text.spec.ts:653` | words of a text can be underlined, struck through, given a colour and a size of their own; they are  |
| 55 s | [chromium-cpu] | `tests/e2e/navigation.spec.ts:159` | directional pan at shallow, deep and far-out zoom returns exactly |
| 55 s | [chromium-dpr2] | `tests/e2e/navigation.spec.ts:159` | directional pan at shallow, deep and far-out zoom returns exactly |
| 54 s | [chromium] | `tests/e2e/navigation.spec.ts:159` | directional pan at shallow, deep and far-out zoom returns exactly |
| 52 s | [desktop] | `tests/e2e/desktop.spec.ts:2799` | sharing (ADR 0184): on in Settings, a guest pairs with the code and the host's Allow, reads files, n |
| 50 s | [chromium-cpu] | `tests/e2e/navigation.spec.ts:38` | continuous wheel zoom out-first: 480 notches each way, anchored, exact return |
| 50 s | [chromium-cpu] | `tests/e2e/navigation.spec.ts:38` | continuous wheel zoom in-first: 480 notches each way, anchored, exact return |
| 50 s | [chromium-dpr2] | `tests/e2e/navigation.spec.ts:38` | continuous wheel zoom out-first: 480 notches each way, anchored, exact return |
| 50 s | [chromium-dpr2] | `tests/e2e/navigation.spec.ts:38` | continuous wheel zoom in-first: 480 notches each way, anchored, exact return |
| 49 s | [chromium] | `tests/e2e/navigation.spec.ts:38` | continuous wheel zoom in-first: 480 notches each way, anchored, exact return |
| 49 s | [chromium] | `tests/e2e/navigation.spec.ts:38` | continuous wheel zoom out-first: 480 notches each way, anchored, exact return |
| 47 s | [firefox] | `tests/e2e/text.spec.ts:513` | convert text to path (Ctrl+E and the selection bar): the same pixels, the same object, one undo, a l |
| 47 s | [firefox] | `tests/e2e/navigation.spec.ts:159` | directional pan at shallow, deep and far-out zoom returns exactly |
| 47 s | [desktop] | `tests/e2e/desktop.spec.ts:2950` | sharing (ADR 0184): hidden items reach a guest only when shared, encrypted; the guest opens them wit |
| 46 s | [desktop] | `tests/e2e/desktop.spec.ts:1390` | a hidden item's picture is not read while locked, so after a restart its card shows in hidden mode;  |
| 43 s | [desktop] | `tests/e2e/desktop.spec.ts:958` | hidden items are encrypted: sealed into .hidden/ with nothing readable left, opened only with the pa |
| 43 s | [desktop] | `tests/e2e/desktop.spec.ts:2106` | a note's pictures are found by their files: pasted ones (the disk's name not the item's), one added  |
| 43 s | [desktop] | `tests/e2e/desktop.spec.ts:447` | a big library (past the size library.json is kept for) writes only what changed: a rename rewrites i |
| 42 s | [chromium-cpu] | `tests/e2e/deep-zoom-rendering.spec.ts:56` | zooming deep into a curvy stroke never shows holes or spill (wheel input) |
| 41 s | [desktop] | `tests/e2e/desktop.spec.ts:830` | a backup of many files: the busy screen shows how far its files are written into the folder, then th |
| 41 s | [desktop] | `tests/e2e/desktop.spec.ts:2878` | sharing (ADR 0184): a browser guest pairs, sees the host's library and canvas read-only, stays paire |

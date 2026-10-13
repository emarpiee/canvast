# Firefox test log (added after Phase 1, slice 3)

Firefox is the project owner's main browser, so it is now a fourth E2E
project (`firefox`) in both the quick and the full suite.

## Environment

- Firefox 157.0 (Playwright build 1555), headless, `file://`.
- Playwright does not officially support Fedora, so it installed its Ubuntu
  24.04 build of Firefox. This is close to, but not the same as, a Fedora
  user's own Firefox with their profile settings.
- Install: `npx playwright install firefox`.

## What Firefox provides on `file://` (probed)

| Item | Result |
| --- | --- |
| `isSecureContext` | true |
| Web Locks (`navigator.locks`) | available. The writer lease uses `web-locks`, as in Chromium |
| BroadcastChannel | available |
| IndexedDB | works: every storage, migration, multi-tab, assets and archive test passes |
| Storage quota (estimate) | **about 790 MiB**, against about 10 GiB in Chromium on the same machine. Persistence is not granted by default |
| `performance.now()` resolution | **1 ms**. Firefox rounds timers on pages that are not cross-origin isolated, which a `file://` page cannot be |

## First run (all specs, Firefox only, 60 s test timeout)

36 passed, 1 skipped (touch-only test), 5 failed (4.9 min):

| Test | Cause | Kind | Resolution |
| --- | --- | --- | --- |
| Archive round trip to another profile | The test checked the tree before the import finished. A fresh profile already shows "Board 1 › Canvas 1", so the breadcrumb wait passed too early in slower Firefox. | Test race | The import helper waits for the "Imported …" outcome message, cleared first so an earlier message cannot satisfy it. |
| Deep zoom into a curvy stroke (wheel input) | Hit the shortened 60 s timeout. | Test speed | Passes with the normal 180 s timeout (2.5 min). |
| Opacity: self-crossing stroke painted once | Hit the shortened 60 s timeout. | Test speed | Passes (1.9 min). |
| Continuous wheel zoom, in-first and out-first | Render p95 measured **exactly 8 ms** against the limit of under 8 ms. | **Real performance gap**, plus 1 ms timer granularity | Fixed in the renderer (below); both pass. The limit was not changed. |

### The performance defect: grid lines stroked as paths

Measured on the reference machine with the same 1280×800 grid of 4 tiers
(about 470 one-pixel lines), including rasterization:

| Method | Chromium | Firefox |
| --- | --- | --- |
| Clear only (baseline) | 0.18 ms | 0.17 ms |
| Stroked path (previous) | 2.1 ms | **14.9 ms** |
| One filled path of rects | 6.5 ms | 6.0 ms |
| `fillRect` per line (now) | **1.9 ms** | **1.9 ms** |

`drawGrid` now fills a 1-px rect per line: the same pixels as a stroke at
+0.5. Same-tier crossings blend twice, as lines of different tiers already
did. With rasterization included, the 400-frame benchmark trajectory (an
empty scene) averages **1.7 ms per frame in Firefox against 1.4 ms in
Chromium**.

### Deep zoom in Firefox

The curvy-stroke test (50 levels, 30 exact checks) gives **0 holes and 0
spill** in Firefox, with render time p50 3 ms, p95 5 ms and max 9 ms
(Chromium: 1.2 / 3 / 3.2 ms). The opacity single-paint errors are identical
(0.5 per channel, shallow and deep). The deep-item stroke test reaches level
2100.5 with no failures. The long wall-clock times of these two tests in
Firefox come from the test harness: thousands of single-pixel reads, which
are much more expensive in Firefox. They are not app frame time.

## Regression after the fix

`npm test` (quick suite) with 4 projects, on build `f64a472e…92bf`
(the final code, built before the version label changed to 0.3.1; the v0.3.1
build is `60ccde68…1a30`, differing only in that label): **165 passed, 3 skipped by design** (the touch test outside
the touch project), **0 failed** (E2E 15.6 min, of which Firefox is about
5.5 min). Unit tests 75/75; the offline and naming checks pass.

## Not covered (unverified)

- The owner's own Firefox on Fedora, with their profile settings. Firefox's
  `file://` origin rules (for example `security.fileuri.strict_origin_policy`)
  decide whether data stays available after moving the HTML file to another
  folder. The tests use one fixed path.
- Firefox with real trackpad or touch input, and Firefox on Windows and
  macOS.
- Firefox's quota limit in practice (about 790 MiB): the error path is coded
  but has not been exercised.

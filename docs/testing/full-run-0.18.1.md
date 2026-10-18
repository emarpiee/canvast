# Full suite at v0.18.1 (the backlog run), 2026-10-18

`npm run test:full` (typecheck, unit tests, E2E with the full stress loops in `chromium`, `chromium-cpu`, `chromium-dpr2` and `firefox`, offline, names, tokens and picker checks), run on the commit "docs: v0.18.1" plus the unit-test fix of that day.

| | |
| --- | --- |
| Unit tests | 442 passed (65 files) |
| E2E | **924 passed, 8 skipped (by design), 14 failed** in 1 h 23 min 36 s (real) |
| Slowest files | firefox `deep-zoom-rendering.spec.ts` 6.9 min, chromium `navigation.spec.ts` 6.3 min (the 2,000-notch wheel test alone 3.4 min) |

## The 14 failures

| Test | Projects | Cause | What was done |
| --- | --- | --- | --- |
| assets: phone layout (360 px); small screens: the details panel is resizable | chromium, firefox (2 tests each) | The library toolbar had grown (Import a folder, ADR 0134) to five rows on a phone, so the first card sat under the details sheet and a double click landed on the sheet | The thumbnail size control is hidden on a phone (four rows); both pass in both browsers |
| zoom-controls: dev panel jump buttons and auto-zoom | all four | The tool rail (moved to the top left in v0.18.0, one more tool since) covers the first column of the debug panel | The panel starts at 50 px and its buttons use the smaller text; 12 of 12 pass in chromium and firefox |
| text: convert text to path | chromium, chromium-cpu | A timing flake under load (the ink centre); passes alone, and 24 of 24 runs of it passed afterwards | none (known flake, in the backlog since v0.18.0) |
| styles: gradient map on a picture | chromium-dpr2 | A flake; 6 of 6 repeats passed | none |
| pictures: a video has every adjustment | firefox | A race reading the stored adjustment right after a field blurred | the assertion polls |
| scenarios: scenario I (1,000 view switches) | firefox | Reads the heap through the DevTools protocol, which Firefox does not have | skipped in Firefox |
| vectors: pasted SVG with `<use>` | firefox | A synthetic paste event carries no data in Firefox | skipped in Firefox |

Nothing was loosened: no `LIMITS` changed, no test deleted. A second full run at v0.19.0 is in `full-run-0.19.0.md`.

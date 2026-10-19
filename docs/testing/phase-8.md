# Phase 8 — scale and compatibility: measurements (v0.21.0, 2026-10-19)

Method: `npx playwright test -c playwright.bench.config.ts -g startup|search`, on the build in `dist/` (single file, `file://`), one worker, the machine that runs the tests (not a reference device). Raw numbers: `metrics/startup-current-*.json`, `metrics/search-current-*.json` (not committed). Milliseconds, median of 3 reloads. "Loaded" is when the stored canvas was read, "indexed" when the spatial index was complete, "first frame" is the time of the first drawn frame in the page (`startupMarks`, `src/app/debug-hook.ts`).

## Startup

Cold start with nothing stored: Chromium first frame 182 ms (loaded 209, indexed 327); Firefox first frame 321 ms (loaded 327, indexed 440).

Warm start (the page reloaded, a stored canvas read from IndexedDB):

| Browser | Objects | Loaded | Indexed | First frame | Heap (MB) |
| --- | --- | --- | --- | --- | --- |
| Chromium | 1000 | 174 | 225 | 117 | 10.4 |
| Chromium | 10000 | 387 | 446 | 146 | 53.1 |
| Chromium | 50000 | 958 | 2404 | 112 | 200.5 |
| Firefox | 1000 | 249 | 307 | 181 | n/a |
| Firefox | 10000 | 441 | 506 | 200 | n/a |
| Firefox | 50000 | 1046 | 2330 | 189 | n/a |

The first frame comes after the canvas is loaded and does not grow with the size (a fixed amount is drawn first); the index is the part that grows: about 2.4 s for 50,000 objects in both browsers, during which the canvas already shows its first frame and can be moved.

## Search at scale

One key typed in the canvas search (the matching and the list drawn), Chromium. A word every object has stops after the first results; a word or a tag no object has reads every object.

| Objects | A word every object has | A word no object has | A tag no object has |
| --- | --- | --- | --- |
| 100,000 | 18.6 ms | 42.6 ms | 41.5 ms |
| 1,000,000 | 123.7 ms | 384 ms | 361.8 ms |

Firefox at 100,000 objects: 39, 81 and 88 ms. The 1,000,000 case in Firefox did not finish inside the 15-minute limit of this run, so it has no number.

A full read of one million objects in a key press takes about 0.4 s in Chromium, which is why the filter keeps the first results coming first; the change that made it linear without a copy and a sort per key is in `src/ui/canvas-search.ts`.

## Not measured

| Item | State |
| --- | --- |
| 60 and 120 FPS on reference devices | Needs devices and a recorded method |
| Qualification matrix (`npm run qualify`) | Written, not run |
| Low-memory tier | Tested (`lowmem.spec.ts`), no device measurement |

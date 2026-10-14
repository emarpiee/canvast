# ADR 0028 — Device tiers, targets and adaptive quality

- Status: accepted (Phase 3, slice 2; the measured targets are filled in by the benchmark run recorded in `docs/testing/`)
- Related: ADR 0027 (decoded-image budget), ADR 0005, 0009, 0010, 0012 (dense scenes, tile cache, density and zoom preview), engineering plan §14.20 (scheduling and performance adaptation) and Phase 3

## Context

The plan wants frame, memory and query targets for defined device tiers, never a promise of lag-free behaviour on every machine, and an app that adapts: "adapt LOD, preview resolution, caches ... quality, refinement". Until now every machine got the same drawing work. The measured picture (`docs/testing/phase-0c.md`, `phase-1d.md`, `phase-1g.md`): off-screen content costs almost nothing; what is on screen is bounded by rasterization, which grows with the number of canvas pixels (a 4K screen at device pixel ratio 2 draws four times the pixels of the same window at ratio 1).

## Tiers and targets

A tier is a class of machine, measured by what the benchmarks can distinguish. Targets are for the frame while panning and zooming over the content that is visible (p50 / p95 / p99), and are goals on the reference hardware, not guarantees.

| Tier | How it is reproduced | Frame target (ms) | Heap target |
| --- | --- | --- | --- |
| Desktop (hardware canvas) | `chromium` project | 8 / 16 / 20 | document + caches under 1 GB at 1M objects |
| Integrated GPU | not available on the reference machine; the CPU-only tier is the stand-in | 16 / 24 / 33 | same |
| CPU-only | `chromium-cpu` (GPU off): the reference machine (i5-4460, HD 4600) | 16 / 33 / 50 | same |
| Low memory | decoded-image budget 128 MiB (`setBudget`) | frames as above; no out-of-memory | images under budget, the rest as above |

The harness limit `renderP95Ms: 8` in `tests/e2e/harness.ts` is the desktop p95 for the standard navigation scenes and is never loosened.

## Adaptive quality

`app/quality.ts`, a governor with three levels: 0 full, 1 canvas at most 1.5 device pixels per CSS px, 2 at most 1; levels 1 and 2 also make the tile cache show its zoom preview for cheaper scenes (`TileCache.denseMs` 12, 6, 3 ms).

- **Input:** the time of each rendered frame. Frames are drawn only when something changes, so the window of 60 frames is what the user is doing.
- **Rule:** a window whose 95th percentile is above 24 ms is slow; two slow windows in a row lower the level. A window below 10 ms is comfortable; four in a row raise it. Anything in between resets both counts. Whole windows and unequal thresholds give hysteresis, so the level cannot flap.
- **Effect:** resolution only: the canvas has fewer pixels and the browser scales it up (softer, never wrong); positions, picking and storage are in CSS px and do not change. Full quality returns by itself when frames are comfortable again.
- **Control:** the device setting `quality.auto` (default on) pins level 0 when off. In the debug build (the tests) the level changes only when set by hand (`setQualityLevel`), so a loaded test machine cannot change what a test measures.
- **Visible:** `qualityLevel()` in the debug hook; the Settings panel of Phase 7 gets the switch.

## Not in this slice

Adapting decode concurrency and prefetch (nothing prefetches yet), a GPU backend tier, and worker scheduling (a separate slice, decided from measured stalls).

## Consequences

- Slow machines and dense screens stay responsive at the cost of sharpness; the plan's "degrade gracefully" is now a mechanism with a unit-tested rule (`quality.test.ts`) and an end-to-end check that every level still draws, picks and reads pixels correctly.

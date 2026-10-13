# Phase 0C test log — scale and backend proof

## Environment

The same reference machine as Phase 0A/0B: Intel i5-4460 (4 cores),
Intel HD 4600, 15 GiB RAM, Fedora (kernel 7.0.13), Chrome for Testing 156
(Playwright 1.64.0, headless, 1280 × 800, DPR 1).

The `chromium` and `chromium-cpu` (GPU disabled) projects are launched with
`--enable-precise-memory-info` so heap numbers are exact.

## What is measured

`npm run bench` (`tests/bench/scale.bench.ts`) runs each case as follows:

1. It loads a deterministic scene, generated inside the page
   (`src/app/bench.ts`, seed 1), straight into the document. This bypasses
   history and saving.
2. It renders 5 warm-up frames.
3. It renders N frames synchronously along a fixed trajectory: a pan of 37
   px per frame around a square, plus a ±0.05-level zoom oscillation.

Each frame is timed from the start of rendering to a forced 1-px
`getImageData` readback, so deferred rasterization is included. The
breakdown separates "visible set" (index query plus projection) from "draw
calls" (canvas API calls for objects and overlays). The remainder is mostly
rasterization.

Scenes:

| Case | Contents |
| --- | --- |
| dense-N | N short strokes, all inside the viewport at zoom 0 |
| clusters-N | N strokes in 1,000 clusters scattered across 2^±200 world units and 2^±60 scales; the camera shows one cluster |
| mixed-1m | 1,000 strokes at home plus 999,000 strokes in far clusters |

Limits of this measurement:
- Headless Chromium rasterizes Canvas 2D on the CPU in both projects, so
  this is the **CPU-only tier**. A hardware-GPU tier was not available.
- `performance.now()` is coarsened to 0.1 ms.
- The numbers measure frame production, not input-to-photon latency.

## Results

`baseline` is the Phase 0B renderer, which projects every object exactly on
every frame (build `f88e4a58…`). `indexed` is Phase 0C, with the spatial
index, cell-relative projection and batching (build `678e37b8…`).

| Run | Project | Case | Objects | Visible | Frame p50 / p95 / p99 (ms) | Visible-set p95 (ms) | Draw calls p95 (ms) | Generate (ms) | Load + index (ms) | Heap (MB) | Frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | chromium | dense-1k | 1,000 | 319–785 | 10.9 / 15.3 / 15.9 | 5.5 | 1.4 | 10 | 3 | 9.8 | 120 |
| baseline | chromium | dense-10k | 10,000 | 3,091–7,728 | 115.4 / 152.9 / 158.2 | 65.5 | 13.6 | 31 | 16 | 26.9 | 60 |
| baseline | chromium | dense-100k | 100,000 | 31,001–70,457 | 1104.5 / 1435.0 / 1469.1 | 633.9 | 766.5 | 168 | 144 | 89.5 | 20 |
| baseline | chromium | clusters-10k | 10,000 | 1–5 | 62.7 / 65.6 / 68.6 | 63.6 | 0.1 | 34 | 17 | 14.7 | 120 |
| baseline | chromium | clusters-100k | 100,000 | 27–68 | 608.2 / 616.3 / 634.1 | 614.1 | 0.2 | 223 | 98 | 74.8 | 60 |
| baseline | chromium | clusters-1m | 1,000,000 | 323–725 | 6409.8 / 6965.8 / 7039.5 | 6958.5 | 1.2 | 1954 | 1051 | 784 | 20 |
| baseline | chromium | mixed-1m | 1,000,000 | 320–719 | 5793.6 / 6099.5 / 6179.1 | 6093.4 | 1.3 | 1716 | 1201 | 640.2 | 20 |
| indexed | chromium | dense-1k | 1,000 | 319–785 | 7.3 / 11.8 / 12.4 | 1.5 | 1.3 | 10 | 9 | 10.9 | 120 |
| indexed | chromium | dense-10k | 10,000 | 3,091–7,728 | 59.2 / 104.6 / 111.3 | 14.8 | 12.8 | 34 | 57 | 22.5 | 60 |
| indexed | chromium | dense-100k | 100,000 | 31,001–70,457 | 587.4 / 952.4 / 1009.2 | 106.7 | 633.0 | 167 | 451 | 157.7 | 20 |
| indexed | chromium | clusters-10k | 10,000 | 1–5 | 1.7 / 3.3 / 5.1 | 0.2 | 0.1 | 49 | 113 | 17.8 | 120 |
| indexed | chromium | clusters-100k | 100,000 | 27–68 | 2.2 / 2.9 / 4.2 | 0.3 | 0.2 | 232 | 594 | 114.2 | 60 |
| indexed | chromium | clusters-1m | 1,000,000 | 323–725 | 7.7 / 11.8 / 13.0 | 2.2 | 0.9 | 1795 | 6058 | 897.2 | 20 |
| indexed | chromium | mixed-1m | 1,000,000 | 320–719 | 9.6 / 12.6 / 17.2 | 3.5 | 1.0 | 1899 | 5831 | 943.1 | 20 |
| indexed | chromium-cpu | dense-1k | 1,000 | 319–785 | 7.1 / 11.6 / 12.1 | 1.5 | 1.3 | 6 | 10 | 6.3 | 120 |
| indexed | chromium-cpu | dense-10k | 10,000 | 3,091–7,728 | 58.1 / 109.3 / 117.1 | 15.2 | 12.0 | 27 | 56 | 22.2 | 60 |
| indexed | chromium-cpu | dense-100k | 100,000 | 31,001–70,457 | 574.8 / 959.9 / 1017.6 | 107.0 | 677.2 | 176 | 465 | 157.8 | 20 |
| indexed | chromium-cpu | clusters-10k | 10,000 | 1–5 | 1.6 / 2.0 / 3.1 | 0.2 | 0.1 | 39 | 71 | 15.5 | 120 |
| indexed | chromium-cpu | clusters-100k | 100,000 | 27–68 | 2.2 / 2.8 / 4.8 | 0.4 | 0.2 | 261 | 574 | 130.4 | 60 |
| indexed | chromium-cpu | clusters-1m | 1,000,000 | 323–725 | 7.7 / 11.5 / 13.8 | 1.7 | 1.0 | 1942 | 5770 | 956.9 | 20 |
| indexed | chromium-cpu | mixed-1m | 1,000,000 | 320–719 | 8.9 / 12.6 / 13.9 | 3.4 | 1.0 | 1834 | 5668 | 943 | 20 |

### Reading the results

- **Off-screen content is now essentially free.**
  - 1M objects with about 500 visible: frame p50 6,410 → 7.7 ms (about
    830×); p95 6,966 → 11.8 ms.
  - 100K objects in clusters: 608 → 2.2 ms.
  - Frame time now tracks visible content, not document size, in both
    projects.
- **Dense visible scenes improved about 2× but are rasterization-bound.**
  - 3K–7.7K visible strokes: p50 115 → 59 ms. Of the remaining p95 105 ms,
    about 15 ms is the visible set, 13 ms draw calls, and about 77 ms
    rasterization.
  - 31K–70K visible strokes: p50 1,105 → 587 ms.
  - The response is ADR 0005: a raster tile cache next; no WASM.
- **The cost moved to load.** Building the index costs about 5.8 s for 1M
  objects (`BigInt` cell computation per object), against about 1.1 s to
  load the document without it. Heap is about 940 MB for 1M objects, about
  150 MB more than the baseline. Speeding up index build (fast paths for
  small anchors, or building incrementally after first paint) is recorded
  as follow-up work.
- **1M-object documents load and render, but at about 1 GB of heap.** That
  is a real memory limit for low-memory devices; it is not hidden.

### Index query microbenchmark (unit-test harness, Node 26)

Mixed scene, view slightly zoomed:

| Scene | Levels | Levels visited | Cells probed | Candidates | Query time |
| --- | --- | --- | --- | --- | --- |
| 2,000 objects | 11 | 3 | 209 | 182 | 0.11 ms |
| 200,000 objects | 121 | 58 | 667 | 219 | 0.29 ms |

## Correctness tests added in Phase 0C

58 unit tests in total. The new ones, in `tests/unit/spatial-index.test.ts`,
check:

- objects are filed at the smallest power-of-two level containing them;
- **no false negatives:** in 300 random camera placements over 3,000 random
  objects at mixed scales, every object the exact projection considers
  visible is among the index candidates;
- **identical output:** `visibleObjects` through the index equals the
  brute-force exact result, with the same ids and paint order, and every box
  and vertex within 1e-6 px of the exact projection (150 cameras);
- incremental moves, deletes, undo and redo leave the index identical in
  effect to a fresh rebuild;
- objects 2^±3000 apart and 2^±3000 different in scale are found with fewer
  than 200 probes;
- query work does not grow with off-screen document size.

## Defects found during Phase 0C

1. **Index and projection disagreed about tiny objects.** The index skipped
   levels with cells under ¼ px, but the projection keeps anything of at
   least ⅛ px. Objects between those sizes would never be drawn. This was
   caught by the no-false-negative test before any browser run, and fixed by
   setting `MIN_CELL_PX = 1/8` with a comment tying it to the projection's
   cull.
2. **Query cost grew with the number of distant clusters.** The first
   version probed up to 166 cells per level and up to 9,736 per query. The
   fix walks the coarse summary first, so levels with nothing near the view
   cost 1–4 lookups, and it filters occupied coarse cells by coordinates
   before expanding them. Result: 667 probes and 0.29 ms.
3. **Tooling:** the bench file was not matched (`*.bench.ts` needs
   `testMatch`). A background "wait then run" helper matched its own command
   line with `pgrep -f` and never started the indexed run; this cost about
   35 minutes. Background polling now uses the task tooling instead.

## Regression

- **Full E2E suite** (navigation, editing, deep-zoom rendering, zoom
  controls; 3 projects), on build `678e37b8…` (the indexed renderer, version
  0.0.2 label): **67 passed, 2 skipped by design, 0 failed** (30.6 min).
  Every Phase 0A and 0B threshold holds with the index in the rendering and
  hit-testing path.
- **Unit tests:** 58/58.
- **Final v0.0.3 artifact** `45028f49…8859`, which differs only in the
  version string: a smoke subset (offline load, U1/U2/U4/U5, U8, deep stroke
  and image visibility, typed zoom, dev panel) passed in `chromium` and
  `chromium-cpu`, 14/14. The offline and naming checks pass.

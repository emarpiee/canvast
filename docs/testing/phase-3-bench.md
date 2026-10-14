# Phase 3 tier benchmark (2026-10-15)

`npm run bench`: 30 tests, 5.1 minutes, all ran to completion. Build: `dist/canvast.html` sha256 `acb08bb2…` (v0.11.0 plus Phase 3, before the diagnostics commit's CSS fix was in a release). Raw per-run JSON is in `metrics/` (gitignored). Reference machine: i5-4460, HD 4600. Targets are those of ADR 0028 (p50 / p95 / p99 ms).

## Current build, standard pan and zoom scenes (frame ms)

| Scene | Chromium (target 8 / 16 / 20) | Chromium CPU-only (target 16 / 33 / 50) | Firefox (no target) |
| --- | --- | --- | --- |
| dense-1k | 7.2 / 12.3 / 13.4 ✅ | 7.0 / 12.3 / 13.0 ✅ | 5 / 8 / 23 |
| dense-10k | 4.3 / 5.9 / **156** ⚠️ | 4.6 / 7.1 / **158** ⚠️ | 5 / 9 / **197** |
| dense-100k | 4.8 / 6.9 / **1007** ⚠️ | 4.6 / 6.6 / **1067** ⚠️ | 5 / 7 / **1419** |
| clusters-10k | 8.0 / 9.6 / 11.1 ✅ | 8.0 / 9.9 / 11.0 ✅ | 9 / 14 / 15 |
| clusters-100k | 8.6 / 10.6 / 17.8 ⚠️ p50 | 8.5 / 10.3 / 11.9 ✅ | 11 / 16 / 17 |
| clusters-1m | **10.9** / 12.5 / 18.8 ⚠️ p50 | 11.0 / 12.6 / 18.7 ✅ | 13 / 18 / 27 |
| mixed-1m | 9.5 / 11.0 / 23.6 ⚠️ p50, p99 | 9.4 / 11.1 / 22.9 ✅ | 11 / 17 / 33 |

## Heap and load (Chromium)

| Objects | Load | Heap | Target |
| --- | --- | --- | --- |
| 100k | 1.1-1.9 s | 150-167 MB | under 1 GB |
| 1M | 17.8-18.1 s | **1.09-1.11 GB** ⚠️ | under 1 GB |

## Tile cache, direct drawing against tiles (frame ms p50 / p95 / p99, Chromium)

| Scene | Pan direct | Pan tiles | Pan and zoom direct | Pan and zoom tiles |
| --- | --- | --- | --- | --- |
| dense-1k | 9.3 / 13.4 / 14.4 | 1.9 / 2.5 / 4.4 | 7.1 / 12.1 / 15.2 | 4.0 / 5.2 / 6.1 |
| dense-10k | 77 / 121 / 126 | 2.2 / **23.9** / **27.1** ⚠️ | 58 / 103 / 111 | 4.2 / 5.0 / 5.4 |
| clusters-100k | 8.8 / 10.1 / 12.6 | 8.1 / 9.0 / 9.2 | 8.5 / 9.2 / 9.8 | 8.6 / 9.4 / 9.8 |

## Findings (known failures against the ADR 0028 targets)

| # | Finding | Evidence | Next step |
| --- | --- | --- | --- |
| 1 | One frame in a dense-scene run costs a whole exact tile build: p99 156 ms at 10k objects, about 1 s at 100k (Firefox 1.4 s). It is not the first frame after loading. In the dense-10k trace (per-frame breakdown, Chromium) it is the frame where the zoom crosses the 1-level preview bound of ADR 0012, which rebuilds the exact set at once, and, in the panzoom benchmark, the frame where the trajectory returns to the starting zoom with a non-whole-pixel pan, which starts a new tile set. Every other frame is a 3-6 ms preview or tile reuse. | Per-frame trace of dense-10k (zoom-in and pan-zoom), 2026-10-15 | **Not changed.** Building the exact set in 8 ms slices over the old set (tried) turned one 70 ms frame into about 12 frames of 16-38 ms, which is not better; showing the old set magnified more than 2x breaks the ADR 0012 bound that protects deep-zoom drawing. Needs an owner decision (accept, or relax the bound for zooming in). |
| 2 | Panning a dense-10k scene with tiles: p95 23.9 and p99 27.1 ms against 16 / 20 on desktop (passes the CPU-only target 33 / 50). | Tile cache table | Tile re-rasterization at the leading edge while panning |
| 3 | 1M objects: p50 10.9 ms against 8, and heap 1.1 GB against under 1 GB; loading takes about 18 s. | clusters-1m and mixed-1m rows | Document-memory budget (not built): a Phase 3 known limit |
| 4 | The CPU-only tier (the reference machine) meets its target in every scene except the first-frame spike (finding 1). | CPU-only column | None |

Not run: the low-memory tier (128 MiB decoded-image budget) and an integrated-GPU tier (no such hardware). Decoded-image budget behaviour is covered by the budget test in `frames.spec.ts`.

# ADR 0164: the Painting view's brush engine is WebAssembly (P0 spike)

- Status: accepted for P1 (2026-10-21, owner's choice of WebAssembly over a TypeScript port; numbers from the P0 spike below)
- Related: Phase 0C (no WASM for the endless canvas: still true there), ADR 0027 (decoded-image budget), ADR 0120 (workspace data such as saved styles)

## Context

The Painting view is a separate view (beside Canvas, Library and Settings) for raster painting: pages measured in px, a bounded camera, raster layers with clip to the layer below and alpha lock. Its brush engine is an existing open-source Rust engine (MIT or Apache-2.0; source and notice in `THIRD_PARTY_NOTICES.md`) with every brush section of a professional painting program (computed and sampled tips, shape dynamics, scattering, texture, dual brush, colour dynamics, transfer, pose, noise, wet edges, build-up, smoothing), opacity-versus-flow stroke compositing, lock transparency, a mixer brush, the retouch dab helpers, symmetry, and `.abr` brush files read and written. The question for P0: can it run in `canvast.html` from `file://`, how big is it, and is it fast enough?

## What was built (spike)

- `scripts/build-engine.mjs` fetches the engine's source at one pinned commit into `.engine-src/` (gitignored), checks the commit, and builds `engine/` (a thin wrapper crate of our own, its own Cargo workspace, `Cargo.lock` committed) for `wasm32-unknown-unknown`. The wrapper is a plain C interface (no generated glue): layers, `stroke_begin` with the brush as the engine's JSON, `stroke_push` points (x, y, pressure, tilt x/y, rotation, time), `stroke_end`, the changed rectangle, `read_rgba8`, and an `.abr` write-and-read check. Only the engine's `paint`, `raster`, `color`, `geom` and `psd` crates are compiled; none has a build script.
- `scripts/build-spike-paint.mjs` inlines the builds into `dist-spike/paint.html` (the app's CSP plus `'wasm-unsafe-eval'`); `scripts/spike-paint-measure.mjs` measures it in Chromium and Firefox (headless, this machine); `engine/examples/bench.rs` runs the same stroke natively.

## Results (Chromium 156, Firefox 157, 2026-10-21)

| | Chromium | Firefox |
| --- | --- | --- |
| Runs from `file://` under the app's CSP + `'wasm-unsafe-eval'`, in the page and in a blob worker | yes | yes |
| Pixels as painted (the brush colour on the stroke, nothing off it) | yes | yes |
| File: speed build / size build / speed + SIMD | 799 / 652 / 810 KiB (gzip 375 / 332 / 379; base64 1,066 KiB) | same files |
| Compile + instantiate (speed build) | 81 ms | 47 ms |
| `.abr`: 200 brushes written and read back | 1.3 ms | < 1 ms |
| One frame (4 coalesced points, 6 px apart), 50 px brush, p50 / p95 | 0.7 / 1.1 ms | 1 / 2 ms |
| The same, 500 px brush, p50 / p95 / max | 5.2 / 26.4 / 32.1 ms | 6 / 27 / 32 ms |
| Through a worker (pixels transferred back), 50 px / 500 px p95 | 1.2 / 25.1 ms | 2 / 28 ms |
| Memory: one 4000 × 3000 layer painted all over / 10 such layers | 47 / 274 MiB | 47 / 274 MiB |
| Showing a page: upload a 160 px change + draw three 1280 × 800 surfaces, Canvas 2D p50 / p95 | 2.3 / 3.8 ms | 2 / 3 ms |
| The same in WebGL2 | 44 / 60 ms (software GL in headless Chromium: not a real number) | 4 / 9 ms |

- **SIMD** (`+simd128`) gains nothing (the engine is not written for it); the **size build** is 1.4 to 2 times slower for 147 KiB less. The speed build is the one.
- **Big brushes**: a 500 px soft dab costs about 9.5 ms natively and 15 ms in WebAssembly (WebAssembly is only 1.6 times slower; the cost is the engine's own, a gap its authors list). Natively, 60 % of it is the engine **compositing the stroke into the layer** after every call (whole 256 px tiles), 40 % the dabs. With the dabs alone (`stroke_feed`, no compositing), a 500 px brush in WebAssembly has a worst frame of **4.6 ms** (from 16.2 ms); 200 px 1.7 ms; 50 px 2.9 ms. Hardness matters: a hard 500 px brush costs a third of a fully soft one.

## Decision

1. **The engine is the WebAssembly speed build** (`opt-level 3`, fat LTO, `panic = "abort"`), no SIMD, inlined in `canvast.html`. `'wasm-unsafe-eval'` joins `script-src` of the app's CSP, and `check:offline` accepts it; nothing else in the CSP changes. The build fetches the pinned source and needs the Rust toolchain with the `wasm32-unknown-unknown` target; `check:repro` covers the WebAssembly too.
2. **The live stroke is shown by us, not by the engine compositing every frame**: the engine lays dabs into its stroke coverage; we read the changed coverage (its own live-preview calls, `take_dirty_rect` and `coverage_in`, made for this) and draw the layer with the stroke over it (opacity, alpha lock, erase, the layer's blend) in our display. The engine composites into the layer once, when the stroke ends. This is what brings a 500 px brush within a frame.
3. **The engine holds only the layer being painted** (and its state before the stroke); every other layer's tiles are ours (display canvases and the tile store). So its memory is one or two layers, not the painting (WebAssembly memory never shrinks).
4. **Engine host**: the worker costs nothing measurable (round trip equal to the main thread at 50 px, better at p50 for 500 px) and keeps the page free while a dab is made, so the engine runs **in a worker**, with coverage tiles transferred, not copied. `SharedArrayBuffer` is not needed (and not available from `file://`).
5. **Display: Canvas 2D first.** It meets the budget for the three-surface frame in both browsers. WebGL2 is measured again on real hardware (headed browsers on the owner's machine) before blend modes that Canvas 2D lacks (linear burn and dodge, vivid, linear and pin light, hard mix, darker and lighter colour, subtract, divide) are needed.
6. **Budgets for P1+** (never loosened once fixed): per frame while painting, the dabs ≤ 8 ms p95 at 500 px and ≤ 2 ms at 50 px, the display ≤ 4 ms p95; compile and instantiate ≤ 150 ms; `.abr` of 200 brushes ≤ 50 ms. Measured by the spike script until `npm run bench` covers the Painting view.

## Not done (next)

- The wrapper's live path (`take_dirty_rect`, `coverage_in` out to the display) is not measured yet: `coverage_in` reads one pixel at a time and may need a tile-wide read (a patch if so). Brushes whose colour changes per dab (colour dynamics, wet edges, mixer) carry colour with the coverage: their live path is decided when those sections are wired in (P2).
- The soft tip is computed per dab; a cached tip (by size, hardness, roundness, angle), as a patch kept in `engine/patches/` and applied after fetching, would cut the dab cost further. Upstream first if they take it.
- WebGL2 and pointer-to-screen latency with real input are not measured here (headless). Pressure and tilt from a real pen: not measured.
- 16-bit layers (the engine supports them) double the memory above: decided with the bit depth question.

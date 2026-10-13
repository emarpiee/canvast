# ADR 0002 — CPU-first Canvas 2D renderer, TypeScript, single-file build

- Status: accepted provisionally (Phase 0A); renderer to be re-evaluated with Phase 0C benchmarks
- Date: 2026-10-13

## Context

The app must run from a single offline HTML file opened over `file://`, on
machines with strong GPUs, weak integrated GPUs, or no hardware acceleration.
WebGL/WebGPU/OffscreenCanvas/SharedArrayBuffer cannot be assumed.

## Decision

- **Renderer:** Canvas 2D, drawing in CSS pixels with a devicePixelRatio
  backing store, redrawn on demand via `requestAnimationFrame` (no continuous
  loop). Canvas 2D is available everywhere, rasterizes on the CPU when no GPU
  is present, and needs no context-loss handling for correctness. A GPU path
  (WebGL2) may be added later as an accelerator behind the same
  camera-relative interface, never as a requirement.
- **Language:** TypeScript compiled to plain ES2020 JavaScript. Camera and
  coordinate math use native `BigInt` (implemented in the engine, not JS).
  WebAssembly is not used yet: there is no measured hot spot that justifies
  initialization and copy costs. Hypothesis to validate in Phase 0C: spatial
  index queries and stroke tessellation may benefit; decide by benchmark.
- **Build:** `esbuild` bundles `src/app/main.ts` into one IIFE that
  `scripts/build.mjs` inlines with the stylesheet into `src/index.html`. The
  output (`dist/canvast.html`) has a restrictive CSP (`default-src 'none'`,
  `connect-src 'none'`), so any accidental network access is blocked at
  runtime as well as detected by `scripts/check-offline.mjs` and the E2E
  request monitor.
- **Debug instrumentation** (`window.__canvastDebug`) is installed only in the
  debug build or when the URL hash contains `debug`, and is read-only apart
  from `setCamera` (used to reach extreme states quickly in tests).

## Consequences

- Phase 0A runs identically with GPU acceleration disabled (`chromium-cpu`
  E2E project).
- Canvas 2D throughput limits dense scenes; Phase 0C must measure 10K/100K/1M
  objects and decide whether a WebGL accelerator is warranted.
- Workers and WASM, when added, must be inlined (Blob URLs) to stay single-file
  and work under `file://`; the CSP already allows `worker-src blob:`.

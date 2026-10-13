# ADR 0005 — Dense-scene acceleration: raster tile cache before WebGL; no WASM yet

- Status: accepted provisionally (Phase 0C), based on the measurements in [testing/phase-0c.md](../testing/phase-0c.md)
- Date: 2026-10-13

## Question

The Phase 0C plan asked whether a GPU accelerator (WebGL) or WebAssembly is
justified. That decision must rest on measured bottlenecks, not on
assumptions.

## Evidence

After the spatial index (ADR 0004), the frame time of a scene depends on
what is visible, not on document size. With 1M objects and about 500
visible, p50 is 7.7–9.6 ms. What remains slow is **many visible strokes at
once**. In the default Chromium config:

| Visible strokes | Frame p50 / p95 | Finding + projecting visible objects (p95) | Recording draw calls (p95) | Remainder (≈ rasterization) |
| --- | --- | --- | --- | --- |
| 319–785 | 7.3 / 11.8 ms | 1.5 ms | 1.3 ms | ≈ 9 ms |
| 3,091–7,728 | 59 / 105 ms | 14.8 ms | 12.8 ms | ≈ 77 ms |
| 31K–70K | 587 / 952 ms | 107 ms | 633 ms | ≈ 212 ms |

The `chromium-cpu` project (GPU disabled) is within noise of the default
project. In this headless setup both rasterize Canvas 2D on the CPU, so
these numbers describe the CPU-only tier. Hardware-GPU canvas rasterization
was **not** measured.

## Decision

1. **No WebAssembly for now.** Finding and projecting visible objects is
   about 15% of a dense frame (14.8 of 105 ms p95). Even an infinitely fast
   WASM version of that work would leave the frame at about 90 ms.
   Rasterization and canvas call overhead dominate. Revisit WASM only if
   index build time (about 5.8 s for 1M objects) or exact-path geometry
   become the measured bottleneck.
2. **Next acceleration: a raster tile cache** (next phase, not Phase 0C).
   - Render committed content into screen-aligned tiles at the current zoom
     band.
   - Reuse the tiles while panning, and re-render only invalidated tiles
     after an edit.
   - During continuous zoom, scale the cached tiles as a preview, then
     refine progressively.

   This attacks the dominant cost on **every** tier, including CPU-only
   machines. A GPU accelerator would only help where a GPU exists. Required
   invariants:
   - tiles are derived state, never saved;
   - previews and selection draw on top, uncached;
   - exactness is unaffected: tiles are rendered with the same exact
     projection, and they are invalidated when the zoom band changes, so
     deep zoom never magnifies a stale raster.
3. **WebGL is deferred as an optional accelerator** behind the same
   projection and paint interfaces. It needs:
   - a hardware-GPU measurement tier, not available in this environment;
   - a fallback to Canvas 2D on context loss.

   Canvas 2D stays the reference renderer.

## Consequences

- Dense scenes with thousands of visible strokes stay below 60 fps on the
  CPU-only tier until the tile cache lands. With up to about 1,000 visible
  strokes, frames are under 12 ms at p95.
- The bench harness (`npm run bench`) and the recorded baselines in
  `metrics/bench-*.json` are the acceptance gate for the tile cache.

# ADR 0001 — Exact dyadic world coordinates with a log2 camera

- Status: accepted (Phase 0A), validated by `tests/unit/camera.test.ts` and `tests/e2e/navigation.spec.ts`
- Representation **superseded** by [ADR 0014](0014-nested-frames.md) (nested frames, 2026-10-14): positions become relative to frames so per-frame cost no longer grows with depth. The exactness rules below stay.
- Date: 2026-10-13

## Question

How can pan and zoom feel endless in both directions, with no ordinary zoom
clamp and no finite world rectangle, while every consumer (camera, hit
testing, editing, persistence, spatial index) shares one authoritative
coordinate model?

## Why doubles alone fail

An IEEE-754 double has a 53-bit significand. A position `x` resolves detail
only down to about `|x| · 2^-52`. At zoom `s` px/unit, a screen pixel is
`1/s` world units, so plain doubles break (visible jitter, then snapping) once
`s · |x| · 2^-52 > ~0.01 px`, i.e. after roughly 45 binary zoom levels near
`x = 1`, and immediately at large distances. A floating origin pushes the
problem around without removing it: the origin itself must then be stored at
higher precision, and edits made relative to a temporary origin must not leak
into saved geometry. Increasing `maxZoom` or the world size is explicitly
rejected by the product contract.

## Decision

1. **World coordinates are exact dyadic rationals** `m · 2^e` (`src/core/dyadic.ts`):
   a native `BigInt` mantissa and an integer exponent, kept canonical (odd
   mantissa). Every double converts exactly; add, subtract and multiplying by
   powers of two are exact. There is no rounding in the authoritative model.
2. **The camera** (`src/core/camera.ts`) is `{ center: dyadic point, zi, zf, pz }`
   with `scale = 2^(zi + zf)` CSS px per world unit: `zi` an integer (applied
   as an exact exponent shift) and `zf ∈ [0, 1)` (applied as a double multiply).
   There is no min or max zoom; `zi` is unbounded in practice
   (`Number.MAX_SAFE_INTEGER` levels).
3. **Projection is camera-relative and exact until the last step:**
   `screen = viewportCenter + toDouble((p − center) · 2^zi) · 2^zf`.
   The subtraction is exact, so the double only ever holds an on-screen-sized
   number. Points too far away become `±Infinity` (treated as offscreen), never
   `NaN`.
4. **Inverse:** `world = center + fromDouble(offset / 2^zf) · 2^-zi`.
5. **Anchored zoom** recomputes the center from the world point under the
   pointer: `center' = W − offset / scale'`. Anchor error is bounded by the
   input quantization below (≤ 2^-33 px), not accumulated.
6. **Exact reversibility.** Zoom deltas are quantized to `2^-20` levels and
   screen offsets to `2^-32` px. Consequently:
   - every reachable `zf` is an exact multiple of `2^-20`, so `+dz` then `−dz`
     restores the identical camera;
   - every world offset an input produces has no bits finer than
     `2^-(zi + 86)`, so zoom/pan never need to round the center at depths the
     camera still remembers.

   Without this, a zoom-out followed by a zoom-in at the same pointer lands
   about `2^k · 10^-13` px away after a `k`-level excursion: the last-bit error of
   a non-dyadic step (100/240 level per wheel notch) is magnified by the
   return trip. That was found by the unit tests during Phase 0A and fixed
   at the model level (see `docs/testing/phase-0a.md`).
7. **Precision depth `pz`** records the finest level whose sub-pixel position
   the center remembers (`pz = min(max(pz, zi), zi + 4096)`), and the center is
   rounded to `2^-(pz + 96)`. This bounds mantissa growth to about
   `log2|center| + 4096 + 96` bits while guaranteeing exact zoom-out/zoom-in
   round trips for excursions of up to 4096 binary levels (≈ 10^1233). Beyond
   that, the forgotten position is still exact to 2^-96 px at the coarser
   scale; the loss is documented and tested, never silent.
8. **Serialization** is origin-independent: `"<mantissa>p<exponent>"` strings,
   validated on load (no `NaN`, integer `zi`, `zf` on the 2^-20 grid).

## Consequences

- No pan boundary, no zoom clamp, no rebasing step that could teleport content,
  and no renderer origin that can leak into saved geometry: renderers consume
  exact camera-relative offsets.
- Per-point projection costs a few `BigInt` operations. That is fine for the
  camera, grid and landmarks (Phase 0A). For 100K+ objects (Phase 0C), objects
  will store double-precision local geometry relative to an exact dyadic
  anchor, and spatial-index cells will be projected once per frame, so
  `BigInt` work scales with visible cells rather than objects. Object geometry
  magnified more than ~2^24× past its authoring scale must be projected through
  the exact path to avoid cancellation (already done for landmark edges).
- Physical limits are honest: memory for mantissas of `|zi| + 96` bits, and
  `BigInt` speed at extreme depths (measured at |zi| = 9000 in E2E). Content
  authored as doubles resolves to 2^-53 of its own size; deeper magnification
  reveals that finite geometry the way a raster reveals pixels.

## Alternatives considered

| Option | Why not (for now) |
| --- | --- |
| Plain doubles + clamp | Violates the product contract (visible zoom stop). |
| Floating origin with double offsets | Origin still needs exact storage; offsets drift on rebase; hard to keep a single authority. |
| Hierarchical frames (nested local spaces per scale band) | Equivalent expressiveness, more moving parts. May still be used as a cache on top of dyadic anchors. |
| Decimal/arbitrary-precision library | Slower than native `BigInt`, adds a dependency, and powers of two make zoom exact. |
| WASM big-number code | Unjustified until profiling shows `BigInt` is the bottleneck; adds crossing costs. Revisit in Phase 0C with measurements. |

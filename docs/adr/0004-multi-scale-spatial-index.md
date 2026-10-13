# ADR 0004 — Multi-scale spatial index, cell-relative projection, LOD and batching

- Status: accepted (Phase 0C)
- Date: 2026-10-13
- Builds on: ADR 0001 (exact coordinates) and ADR 0003 (projection, one paint per object)

## Problem

Phase 0B projected every object, exactly and with `BigInt` arithmetic, on
every frame. The cost grew with document size, not with what is on screen.
Baseline measurements are in [testing/phase-0c.md](../testing/phase-0c.md):
for example, 6.4 s per frame to show about 500 objects out of 1M.

The index must work in an endless space:

- no world bounds and no root cell;
- objects 2^±5000 apart and 2^±5000 different in scale;
- exact coordinates.

It must never drop an object the renderer would draw.

## Decision

### 1. Index keyed by level and cell (`src/scene/spatial-index.ts`)

- Each object is filed at **level** `L`, the smallest power of two that is at
  least its world size, in the **cell** `(⌊minX/2^L⌋, ⌊minY/2^L⌋)`, with
  `BigInt` indices. It spans at most 2×2 cells at its level.
- Levels form a sparse map, and cells within a level form a sparse hash map.
  There is no tree depth, so distance and scale differences cost nothing.
- Each level also keeps a summary 2^8 times coarser, mapping each occupied
  coarse cell to its occupied fine cells.
- **Query:**
  - skip levels whose cells are under ⅛ px on screen. Objects are no larger
    than their cell, and the projection culls anything under ⅛ px, so the
    index never drops a drawable object (this is unit-tested against brute
    force);
  - for each remaining level, visit coarse cells near the view: either
    enumerate them or filter the occupied ones, whichever is cheaper;
  - inside each, enumerate fine cells or walk the occupied ones, again
    whichever is cheaper.

  Cost: O(levels + probed cells + candidates). It does not depend on how
  many objects are off-screen.
- The index is kept in sync incrementally. The document emits the ids
  changed by each transaction, including undo and redo, and a load triggers
  a full rebuild (`syncIndex`).

### 2. Cell-relative fast projection (`projectEntry`)

- Each cell's origin is projected exactly, once per frame.
- An object's anchor offset inside its cell is stored as a double, within
  about 2 cell units, so objects project as
  `cellOrigin + (ax + x·2^(unit−L))·pxPerCell` with doubles only.
- Error bound: below 2^-52 · pxPerCell px. The path is used only while
  pxPerCell ≤ 2^30 (error under 2^-22 px), the radius is ≤ 2^14 px and the
  screen extent is ≤ 2^40 px. Anything else falls back to the exact
  projection of ADR 0003.
- `ProjectedObject.proj` (the full exact projection) is computed lazily, so
  fast-path strokes never pay for it.
- Unit test: through the index, `visibleObjects` returns the same objects,
  in the same paint order, as brute-force exact projection, with every box
  and vertex within 1e-6 px.

### 3. Sub-pixel LOD

Levels whose cells are smaller than ⅛ px are not visited at all. This is the
level-of-detail cut: content far below a pixel costs nothing per frame.
Aggregated previews of such content (density dots) are **not** implemented
yet; see "Deferred".

### 4. Batched drawing

Consecutive objects in paint order are drawn with one `stroke()` call when
all of these hold:

- they are fast-path strokes;
- they are opaque;
- they share a colour, and their widths differ by at most 1/64 px.

For opaque single-colour paint, painting the union once gives the same
pixels as painting each object in turn, so this changes nothing visually.
Translucent and exact-path objects are never batched; they keep ADR 0003's
one paint per object.

## Consequences

The measured results are in the test log.

Remaining costs:
- **Dense visible scenes:** frame time is dominated by Canvas 2D
  rasterization of the visible strokes. This is the input to the WebGL/WASM
  decision.
- **Index build:** `BigInt` work per object; measured for 1M objects.

## Deferred

- **Aggregated previews of sub-pixel content.** Zoomed far out, dense
  drawings currently disappear rather than showing as density.
- **Tiling or caching rendered layers** for dense static scenes.
- **Index persistence:** the index is rebuilt on load.

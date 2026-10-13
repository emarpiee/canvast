# canvast — roadmap and status

This file is the single source of truth for project status. Every milestone
is reported in the same six parts: **Implemented / Tested / Known failures /
Unverified / Committed / Next bounded task**.

## Phase plan

| Phase | Scope | State |
| --- | --- | --- |
| 0A | Endless pan/zoom prototype, exact coordinate model, CPU rendering, navigation regression harness, single-file build | **done** (see below) |
| 0B | One editable vector type; create/select/hit-test/drag/resize at any reached scale; world↔screen round trips for objects; minimal snapshot save/reload | **done** (see below) |
| 0C | Spatial index + visibility queries, incremental drawing, LOD, resource tracking; 10K/100K/1M-object benchmarks; decision on a GPU accelerator and WASM | **next** |
| 1+ | Document/operation model, transactional storage (IndexedDB/OPFS), Workspace → Boards → Canvas, Canvas/Assets views, raster/vector/text/media content, non-destructive adjustments, Settings, portable format, collaboration | planned |

## Phase 0A — endless navigation proof

**Implemented**
- Exact dyadic world coordinates and a log2 camera with no zoom or pan bounds
  ([ADR 0001](adr/0001-exact-dyadic-world-coordinates.md)).
- Zoom anchored at the pointer for wheel, trackpad pinch (ctrl+wheel), touch
  pinch, keyboard and buttons. Pan by drag, shift+wheel, arrow keys and touch.
- Quantized inputs, so every zoom and pan operation is exactly reversible,
  plus a precision-depth budget (4,096 levels) that bounds mantissa growth.
- Canvas 2D renderer: a continuously fading hierarchical grid, the axes, and
  landmarks whose edges are projected exactly.
- HUD read-out of zoom and position, Home button, and a debug panel and
  inspection hook (`#debug` only).
- Single-file build with a strict CSP and a static offline checker.

**Tested:** see [testing/phase-0a.md](testing/phase-0a.md) for commands,
environment and measured values.

**Known failures:** none open. Defects found and fixed during the phase are
recorded in the test log.

**Unverified**
- Firefox and Safari, real trackpads and touch hardware (touch is
  CDP-emulated), Windows and macOS, high-refresh displays, and a separate
  input-to-photon latency measurement.
- The cost of `BigInt` at very large depths (|zi| ≫ 10,000).

**Committed:** see `git log` (Phase 0A commit).

**Next bounded task:** Phase 0B (done).

## Phase 0B — editing, precision and recovery

**Implemented**
- Canvas objects (`src/doc/model.ts`): freehand strokes and image instances.
  Each has an exact anchor, a scale exponent and an opacity, and no implicit
  parent.
- Tools: pen, select (click, shift, alt-cycle, drag-move, corner resize),
  box selection, lasso (Strokes / All filters), and hand. Undo/redo of every
  edit as single exact transactions.
- Image import (button, drag-drop, paste). Assets are deduplicated by SHA-256
  and stored once; magnified pixels are shown crisply, with no invented
  detail.
- IndexedDB snapshot persistence: debounced after transactions, camera
  restored, damaged items skipped and reported, save state shown in the HUD.
- Exact rendering and picking at any magnification. There is no cap, and
  each object is painted once, which is correct under opacity
  ([ADR 0003](adr/0003-objects-selection-and-projection.md)).
- Click the zoom read-out to type a level; `#debug` dev panel with jump
  buttons and auto-zoom.

**Tested:** [testing/phase-0b.md](testing/phase-0b.md) records U1, U2, U4,
U5, U7, U8, new-scale creation at ±1000 levels, the deep-zoom rendering
regressions, the zoom controls, and the full Phase 0A regression suite.

**Known failures:** none open. Four defects were found and fixed, two of
them reported by the user; see the test log.

**Unverified**
- Firefox and Safari, and real touch or pen hardware.
- Multi-tab editing (last save wins).
- Large documents: Phase 0C.

**Committed:** see `git log` (Phase 0B commit).

**Next bounded task:** Phase 0C — scale proof:
1. a multi-scale spatial index with visibility queries;
2. cell-relative fast projection, so per-object `BigInt` work drops out of
   the frame;
3. sub-pixel aggregation (LOD);
4. batched drawing of consecutive opaque same-paint objects;
5. benchmarks of dense visible scenes versus sparse distant clusters at
   10K, 100K and 1M objects (p50/p95/p99 frame and query time, build time,
   heap);
6. a decision record on WebGL or WASM backed by those numbers.

## Backlog of open questions (not blocking 0B)

- Should the default wheel action be zoom (current) or pan, with zoom on
  ctrl or pinch? This will become a Settings option. The current choice
  favours the defining endless-zoom experience.
- How should navigation history, bookmarks and search-and-reveal integrate
  with the camera serialization?
- Projecting objects through spatial-index cells: what cell size and how
  many scale bands (Phase 0C)?

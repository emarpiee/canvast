# canvast — roadmap and status

This file is the single source of truth for project status. Every milestone
is reported in the same six parts: **Implemented / Tested / Known failures /
Unverified / Committed / Next bounded task**.

## Phase plan

| Phase | Scope | State |
| --- | --- | --- |
| 0A | Endless pan/zoom prototype, exact coordinate model, CPU rendering, navigation regression harness, single-file build | **done** (see below) |
| 0B | One editable vector type; create/select/hit-test/drag/resize at any reached scale; world↔screen round trips for objects; minimal snapshot save/reload | **done** (see below) |
| 0C | Spatial index + visibility queries, incremental drawing, LOD, resource tracking; 10K/100K/1M-object benchmarks; decision on a GPU accelerator and WASM | **done** (see below) |
| 1a | Workspace → Boards → Canvas, per-object transactional storage, v1 migration, multi-tab safety, save states, storage panel | **done** (see below) |
| 1+ | Assets view and catalog with reference-checked GC, portable export/import, raster tile cache, text/media content, adjustments, Settings, collaboration | planned |

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

## Phase 0C — scale and backend proof

**Implemented**
- Multi-scale spatial index with no world bounds or depth limit, kept in
  sync incrementally from transaction change sets
  ([ADR 0004](adr/0004-multi-scale-spatial-index.md)).
- Cell-relative fast projection: no per-object `BigInt` work in the frame;
  exact fallback beyond the proven error bound.
- Sub-pixel level-of-detail cut, consistent with projection culling.
- Batched drawing of consecutive opaque strokes with the same paint.
- Benchmark harness (`npm run bench`) with deterministic dense, cluster and
  mixed scenes from 1K to 1M objects.
- Acceleration decision: raster tile cache next, WebGL deferred, no WASM
  ([ADR 0005](adr/0005-dense-scene-acceleration.md)).

**Tested:** [testing/phase-0c.md](testing/phase-0c.md):
- baseline versus indexed benchmarks in 2 projects;
- 6 new unit tests (no false negatives, brute-force equality, incremental
  consistency, extreme distances and scales, bounded query work);
- the full Phase 0A/0B regression suite.

**Known failures:** none.

**Known limits (measured):**
- Dense visible scenes are rasterization-bound: 59 ms p50 at 3K–7.7K
  visible strokes.
- 1M objects need about 940 MB of heap and about 6 s to build the index.
- No density preview for sub-pixel content.

**Unverified:** a hardware-GPU rasterization tier, Firefox and Safari, and
low-memory devices.

**Committed:** see `git log` (Phase 0C commit).

**Next bounded task:** Phase 1 begins with the document and storage
foundation:
- the Workspace → Boards → Canvas model;
- a transactional IndexedDB schema with per-object records instead of a
  single snapshot, so saves scale with the size of each edit;
- multi-tab safety;
- migration from the v1 snapshot.

The raster tile cache (ADR 0005) is scheduled as the first performance slice
after that, gated by `npm run bench`.

## Phase 1, slice 1 — workspace and storage foundation

**Implemented** ([ADR 0006](adr/0006-workspace-storage.md))
- IndexedDB schema 2: workspaces, boards, canvases, per-object records, and
  per-canvas views; the legacy store is retained.
- Incremental commits: one atomic, revision-checked transaction per
  debounced batch of changed ids, then read back to verify.
- Save states queued → saving → committed → verified, plus readonly,
  conflict, error and unavailable.
- Workspace navigator: switch, create and rename boards and canvases; each
  canvas has its own objects and camera, loaded lazily; the app reopens on the
  last canvas.
- Verified, idempotent migration of v0.0.x snapshots that never touches
  legacy records.
- Multi-tab safety: a Web Locks writer lease, a localStorage heartbeat
  fallback, and the revision check as the final guard. Read-only tabs follow
  the writer over BroadcastChannel and offer Take over.
- Storage panel: state, role, quota estimate, persistence request, backup
  status, origin caveat.

**Tested:** [testing/phase-1a.md](testing/phase-1a.md).

**Known failures:** none.

**Unverified:** Firefox and Safari `file://` storage behaviour, real quota
exhaustion, and storage eviction.

**Committed:** see `git log`.

**Next bounded task:** Assets view with a shared asset catalog. That means:
- catalog entries over the content-addressed blobs;
- usage and instance counts, and navigation from an asset to where it is
  used;
- reference-checked mark-and-sweep garbage collection;
- deleting canvases and boards safely.

## Decided and implemented: quick vs full test suites (2026-10-13)

The full E2E suite runs thousands of real input events in 3 browser
configurations and takes about 35 minutes. Most of that is a handful of
deliberate stress loops, and it grows with every feature. Decision, with the
project owner:

- **Quick suite** (target 3–5 min): every test, with short stress loops (for
  example 200 wheel notches instead of 2,400). Run it after ordinary
  changes.
- **Full suite** (the current one, unchanged): run it only when finishing a
  phase or milestone, right before that commit, and record its results in
  the test log.
- **Never skip the full suite before a phase commit.** Never rebuild `dist/`
  while any suite is running, because the tests load the built file.

**Implemented:**
- `npm test` runs the quick suite;
- `npm run test:full` runs the full suite;
- `reps(full, quick)` in `tests/e2e/harness.ts` sets loop lengths;
- the guide is [testing/README.md](testing/README.md).

**Measured:** quick E2E 7.7 min (90 tests: 87 passed and 2 skipped in the
first run; the 1 failure was a quick-mode threshold that assumed DPR 1, since
fixed and re-run 3/3) against 29 min for the full suite. That misses the
3–5 min target. The remaining time is mostly the larger pixel-sampling and
traversal tests in 3 configs. Parallel workers for the functional tests are
the next lever if needed.

## Backlog of open questions (not blocking 0B)

- Should the default wheel action be zoom (current) or pan, with zoom on
  ctrl or pinch? This will become a Settings option. The current choice
  favours the defining endless-zoom experience.
- How should navigation history, bookmarks and search-and-reveal integrate
  with the camera serialization?
- Projecting objects through spatial-index cells: what cell size and how
  many scale bands (Phase 0C)?

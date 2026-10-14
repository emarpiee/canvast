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
| 1b | Assets view and shared catalog, usage and navigation to instances, reference-checked mark-and-sweep GC, safe deletion of boards and canvases | **done** (see below) |
| 1c | Portable `.canvast` archives: four export scopes, verification, validated transactional import, backup status | **done** (see below) |
| 1d | Raster tile cache for committed objects (exact zoom, whole-pixel reuse, per-object invalidation) | **done** (see below) |
| 1e | Density preview: sub-pixel content stays visible as soft marks; one draw-or-preview rule shared by index and projection | **done** (see below) |
| 1f | Asset organization: tags, favourites, nested folders (non-exclusive), search, sidebar scopes, archive round trip | **done** (see below) |
| 1g | Zoom preview for dense scenes: a bounded scaled preview during zoom gestures, refined to exact | **done** (see below) |
| 1h | Text objects: Markdown storage, WYSIWYG editing, bundled font, exact glyph outlines at any depth | **done** (see below) |
| NF | Nested frames redesign ([ADR 0014](adr/0014-nested-frames.md), [plan](plans/nested-frames.md), [reference](reference/nested-frames.md)): constant per-frame cost at any depth | **in progress** on `exp/nested-frames`: spike and ADR done, step 3 (core) next |
| 1i | Settings scopes ([ADR 0017](adr/0017-settings-scopes.md)): device scope built (pen and select options persist), workspace and board scopes declared | **done** (see below) |
| 2 | Rendering and interaction productionization: selection and transforms including **item rotation**, **snapping and guides**, layers and groups, object eraser, per-canvas cameras | **in progress**: rotating strokes, images and text ([ADR 0018](adr/0018-item-rotation.md)) snapping while moving ([ADR 0019](adr/0019-snapping-and-guides.md)) and groups with stacking order ([ADR 0020](adr/0020-groups-and-stacking.md)) done; hide and lock ([ADR 0021](adr/0021-hide-and-lock.md)) and the object eraser ([ADR 0022](adr/0022-object-eraser.md)) done; next per-canvas cameras |
| 1+ | Persisted WebP thumbnails, slide view and recognisable broken assets ([plan](plans/asset-thumbnails.md)), video/GIF/audio, Markdown notes (mentions, backlinks), adjustments, Settings, groups, smart folders and batch asset edits, collaboration | planned |

## Nested frames redesign (branch `exp/nested-frames`)

**Implemented:** spike (`src/spike/`): frames, exact rebasing, compressed
dives, giant jumps (capped at 2^50 levels each), term-sum point walks,
re-homing; debug overlay, jump panel, HUD and `__spike` hook. ADR 0014
accepted 2026-10-14. Technical reference written.
Step 3 slice 1 (the app on frames): `src/core/frames.ts`; camera in frames
(`ViewState`); objects carry a frame and are re-homed on load and edit;
one spatial index per frame with the camera expressed per frame
(`scene/frame-index.ts`); far-finer frames as density dots; gestures,
previews, text editor, image placement, HUD (BigInt depth), dev panel and
debug hook frame-aware; one jump up to 2^50 levels (was 10^7).

**Tested:** `tests/unit/frames.test.ts` (camera bit-identical to the
absolute system, strokes within 10^-6 px, boundary rules, depth stress, one
test per regression found); `scripts/spike-measure.mjs` (flat frame time
2^10 to 2^10^12, 0 px drift, fuzz 3 × 2,500 steps in both browsers, no step
over 250 ms). Step 3 slice 1, quick suite (2026-10-14, run in a scratch
copy so `dist/` was not rebuilt): unit 108/108; E2E 262/265, the 3
failures being the timing-sensitive dense-scene zoom-preview tile tests
(they fail at the same rate on `main` on this machine: 1 in 12 each);
offline and names checks pass. After the Firefox load fix (descend,
balanced digits, Firefox BigInt limit): unit 109/109, E2E 268/269 (one
dense-scene tile-preview flake). New `tests/e2e/frames.spec.ts`: work at
2^10^12, a stroke drawn while wheel-zooming across frame changes, and
−10^12 five times then wheel, keys, drag pan and Home, in all four projects.

**Step 3 slice 2 (coarse objects):** a stroke, image or text far above the
camera is classified against the camera centre rounded to 2^-256 of its
frame's unit (`render/coarse.ts`): it covers the view (one fill; an image
shows the source pixel under the view), or it is skipped, at any level gap,
in constant time. Only an edge near the view needs the exact centre, which
stays limited to 100,000 levels (`COARSE_EXACT_MAX`). The plan's carried
exact lines could not hold stroke edges (irrational offsets); the reference
§7.3 says why. Tests: unit `coarse.test.ts` (8); E2E `frames.spec.ts` (3 new,
4 projects each).

**Step 4 (storage with frames):** IndexedDB schema 4 (store `frames`), objects
and the saved view stored in frame form, archive version 2, version 1
archives still import, unreferenced frames collected. No absolute numbers on
the save or load path, so the 2^24-level save limit and the "view not saved
deeper than 2^19" limit are gone (Firefox included). Old records are
already valid (world frame = absolute form). Details: reference §8a. Tests:
unit `frame-storage.test.ts` (4); E2E: deep work saves, reloads and travels
in an archive, frame collection, a version 1 archive; the existing storage,
archive and Firefox 2^10,000,000 tests pass.

**Thickness lock (toolbar lock button, pen tool):** with the lock, new strokes keep the same width on the canvas at any zoom (matching the artwork); without it they keep the same width on screen. Reference §8b. The size follows the zoom for 1,000 levels either way; pen sizes are three presets plus a 0.5–128 px slider. Tests: unit `pen-width.test.ts`; E2E `frames.spec.ts` (radii exact at zoom +3, −2, ±3 again, slider sizes, drawing 40 to 10^12 levels away). Not saved with the canvas; no brush-size cursor yet.

**Pen options:** stabilizer (rope 0.6–60 px), pen size follows zoom (pieces, one undo step), and on the Select tool the padlock keeps line width when resizing. Tests: unit `stabilizer.test.ts`; E2E `frames.spec.ts` (wobble hidden at home and 10^12 levels down; widths per piece; one undo; resize with and without the lock).

**Colour at depth for every kind:** each kind of object has a coarse sampler (`SAMPLERS`, compile-time enforced): text keeps its colour inside a glyph at any depth, an image keeps its source pixels (also on a pixel corner, from exact term sums). New Select-tool option: ignore the object that fills the view (cannot be picked or deleted by accident). Tests: unit `coarse.test.ts` (11); E2E `frames.spec.ts` (image corner and a letter at 10^6, 10^9, 10^12 levels; the option at 30 to 10^12 levels).

**Dimmed fill and Select size slider (ADR 0016):** an edge of a coarse object in the view past 100,000 levels is drawn as a dimmed approximate fill (every sampler has `approx`); the size slider on Select sets the thickness of the selected strokes. Tests: E2E `frames.spec.ts` (corner colour at 2·10^5 to 10^12 levels; slider with undo).

**Step 5, the depth suite (`tests/e2e/depth-suite.spec.ts`, all four projects, 20/20 on 2026-10-14):** A1 median frame time at 2^10, 10^3, 10^6, 10^9, 10^12 within 3× the 2^10 median + 3 ms; A2 ±10^12 jumps under 100 ms; A3 rebase continuity (zoom steps across frame boundaries and round trips of 0.3 to 1000 levels, at home and 10^12 levels down) under 10^-6 px (measured 4.5·10^-13); A5 draw, select, move, resize, undo, redo, open text and type at 2^10^12: the time from the last input to the frame showing it, and the slowest frame, each under 100 ms (measured in the page: 4-15 ms; the first version timed Playwright's mouse round trips, 12-25 ms each at pixel ratio 2, and failed at 108-111 ms for that reason); A7 heap flat over 15 dives (Chromium; Firefox has no heap figure, so object and stored-frame counts are checked there too). Limits fixed before the first run.

**Known failures:** none open. Accepted by design: landmark edges much coarser than the camera are not drawn (landmarks are orientation fixtures: nested squares at the origin from 2^-1024 to 2^1024 world units, so past 1,024 levels only a camera exactly on an edge could see one; not worth a summary path). Frames more than 100,000 levels finer show as a dot. Loading v0.8 data with an object far coarser than the world is fast (re-homing a coarse object took 1, 21, 40 and 166 ms at 10^4, 10^6, 3·10^6 and 10^7 levels; the old note that it was slow was wrong).

**Quick suite (2026-10-14, scratch copy):** unit 121/121; E2E 292 passed, 3 skipped, 1 failed (the known Firefox dense-scene zoom-preview flake); offline and names checks pass.

**Unverified:** the full suite on the branch (run at the end of the phase,
step 6).

**Committed:** v0.9.0 on `main`.

**Test suites (2026-10-14):** the suites were made cheaper (logic specs in `chromium` only, smaller loops, one full-only 2,000-notch run). Full suite with all four projects: 32 min 25 s, unit 130/130, E2E 301 passed, 6 skipped, 1 timeout (the Firefox curvy-stroke test needs more than 180 s in full mode; fixed, passes alone in 5.2 min); details in [testing/full-run-4-projects.md](testing/full-run-4-projects.md). Earlier run on the 3 Chromium projects: [testing/full-run-3-chromium.md](testing/full-run-3-chromium.md).

**Next bounded task:** Phase 1 remainder (settings scopes), then Phase 2.

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

**Next bounded task (done in slice 2):** Assets view with a shared asset catalog. That means:
- catalog entries over the content-addressed blobs;
- usage and instance counts, and navigation from an asset to where it is
  used;
- reference-checked mark-and-sweep garbage collection;
- deleting canvases and boards safely.

## Phase 1, slice 2 — Assets view, catalog and safe deletion

**Implemented** ([ADR 0007](adr/0007-asset-catalog-and-gc.md))
- IndexedDB schema 3:
  - an `assetCatalog` store, with metadata only (no bytes);
  - an `objects.assetId` index, so usage is always derived from stored
    instances and never from a counter.
- Top-level **Canvas | Assets** view switch. The canvas's view, selection
  and history are kept while hidden, its rendering is suspended, and canvas
  shortcuts are inactive in Assets view and inside dialogs.
- **Assets view:**
  - search, usage filter, sort and thumbnail size;
  - library-only import;
  - an inspector with metadata and a "Where it is used" list per canvas.
    **Show** opens the canvas, selects the instances and frames them exactly
    at any depth (`fitRect`, `log2Abs`).
  - **Place on** the open canvas;
  - **Delete from library**, refused while used.
- **Mark-and-sweep GC** in one transaction:
  - a deleted entry that is referenced again is restored;
  - one held by the writer's live roots (document, undo and redo history) is
    retained;
  - otherwise the bytes are erased.
  It runs at startup (after `reconcile`), after deletion, after a canvas
  switch, and after commits while anything is retained.
- **Reconcile** creates catalog entries for stored originals without one, so
  schema-2 data is upgraded. Missing originals are listed with their usage,
  and re-importing the file restores them.
- **Deleting a canvas or board** is one revision-checked transaction
  (objects, views, records, parent list). It is refused for the last canvas,
  the last board and the open canvas, and the session moves away first. A
  confirmation dialog states that originals stay in the library. Other tabs
  follow.
- If `meta.current` names a missing canvas, startup reopens the first canvas
  instead of creating a new workspace.

**Tested:** [testing/phase-1b.md](testing/phase-1b.md).

**Known failures:** none.

**Unverified**
- Libraries with many thousands of assets (grid and thumbnail cost).
- Safari (Firefox has been verified since v0.3.1).
- Deleting very large canvases (one key-range delete; the time is not
  measured).

**Committed:** see `git log`.

**Next bounded task:** choose one of:
- the raster tile cache (ADR 0005), for dense-scene frame time;
- portable export/import (backups), which the storage panel still reports
  as "none";
- asset organization (tags, folders, collections).

The recommended order is export/import first, because there is still no
backup outside the browser.

## Phase 1, slice 3 — portable archives (export and import)

**Implemented** ([ADR 0008](adr/0008-portable-archives.md))
- **`.canvast` archive:** a standard ZIP with stored entries and a CRC on
  each. It contains a versioned manifest, one JSON file per canvas (the
  canonical object serialization and the saved view), and each original
  once under `assets/<sha256>`.
- **Export scopes:** workspace (with unused library assets), board, canvas,
  and assets, each closing over the originals it references. Saves are
  flushed first; the export reads one transaction, then the archive is
  verified (directory, every CRC, the manifest) before download.
- **Backup status:** a workspace export records **Last full backup** in the
  storage panel, which states that download completion cannot be observed.
- **Import:**
  - full validation first, writing nothing: ZIP bounds, format and version,
    a CRC on each canvas file, per-object validation, and SHA-256 on each
    original;
  - a confirmation summary listing every problem;
  - one all-or-nothing transaction. Boards and canvases get new ids, object
    ids are kept, and originals are deduplicated.
  It is available from the storage panel or by dropping a file; read-only
  tabs cannot import.
- **Fix:** `serializeObject` writes `unit: -0` as `0`.

**Tested:** [testing/phase-1c.md](testing/phase-1c.md).

**Known failures:** none.

**Known limits:**
- No ZIP64: 4 GiB and 65,535 entries per archive.
- No chunked, multi-part or incremental archives.
- Compressed (re-zipped) archives are refused.

**Unverified**
- Transfer to Firefox or Safari.
- Throughput and peak memory for large workspaces.
- A tab closed in the middle of an import.

**Committed:** see `git log`.

**Next bounded task:** the raster tile cache (ADR 0005). Dense scenes are
the largest measured performance gap (about 59 ms per frame at 3K–7.7K
visible strokes). Alternatives:
- asset organization (tags, folders, collections);
- a density preview for sub-pixel content.

## Phase 2, slices 1 and 2 — rotating strokes, images and text

**Implemented:** `rot` on strokes (a whole number of 2^-32 turns, `core/angle.ts`), one rotated geometry `strokePoints` used by bounds, projection, exact coverage, picking, the coarse samplers and the index summary; `rotateAbout`; a rotate handle (Shift: 15 degree steps); preview and one-step transaction; archive version 3. [ADR 0018](adr/0018-item-rotation.md).

**Tested:** unit `rotation.test.ts` (3: exact quarter turns, rotating back is the identical object, storage and validation; 137/137 in all); E2E `frames.spec.ts` "rotate a stroke with its handle" (shape, picking, undo, reload, 10^12 levels down; 4 projects); `editing`, `deep-zoom-rendering`, `tiles`, `density` and `archive` specs in Chromium and Firefox (see README).

**Known failures:** none.

**Unverified:** the full suite since v0.9.0; rotating several strokes at once is covered by the same code path as one but has no test of its own.

**Images and text:** drawn as the unturned object seen by a moved, widened camera with the canvas turned (exact at any magnification); picking and the coarse samplers undo the turn; see ADR 0018. E2E `frames.spec.ts` "rotate an image and a text" (corner colour moves with the corner, four source pixels meet at the centre 64 px per pixel in, text stands up and is picked where it is, one undo step).

**Not built:** snapping and guides; the selection outline of a turned image or text is its bounding box.

**Committed:** v0.11.0 on `main`.

**Snapping (slice 3):** `interaction/snap.ts`; a moving selection snaps its edges and centres to other visible objects within 6 px, aligned from the exact world coordinates (exact at any depth), with a guide line and a magnet toggle (device setting `snap.enabled`). [ADR 0019](adr/0019-snapping-and-guides.md). Tested: unit `snap.test.ts`; E2E `frames.spec.ts` "snapping" (exact alignment at home and 10^12 levels down; the toggle). Not built: snapping while resizing, equal spacing, user guides.

**Groups (slice 4):** `doc/groups.ts`; `groups` on every object (outermost first), selection in whole units, enter with double-click and leave with Escape, Group, Ungroup, Bring to front, Send to back (toolbar and shortcuts); one undo step each; stored with the objects. [ADR 0020](adr/0020-groups-and-stacking.md). Tested: unit `groups.test.ts` (2); E2E `frames.spec.ts` "groups" (pick, move as one, nest, enter, ungroup, undo, reorder, reload). Not built: named layers with visibility and locking, blending, reusable instances, attach and detach.

**Hide and lock (slice 5):** `hidden` and `locked` on objects; hidden ones are left out of the spatial index (so out of drawing, picking, tiles and the density preview), locked ones are drawn and snap targets but cannot be picked; buttons Hide, Show all hidden, Lock, Unlock all; one undo step each. [ADR 0021](adr/0021-hide-and-lock.md). Tested: E2E `frames.spec.ts` "hide and lock". Not built: a list of objects to toggle one by one.

**Object eraser (slice 6):** tool E; swept brush with exact geometry (discs half a radius apart along every segment), preview, once per swipe, one transaction, locked never, whole groups or members, originals untouched. [ADR 0022](adr/0022-object-eraser.md). Tested: E2E `frames.spec.ts` "object eraser" (a one-jump swipe crosses a thin stroke; group, member and locked cases; one undo). Dense 10K scene: frames stay at 1 ms during a swipe.

**Next bounded task:** per-canvas cameras.

## Phase 1, slice 9 — settings scopes

**Implemented:** `src/settings/settings.ts` ([ADR 0017](adr/0017-settings-scopes.md)): every setting declared once with a scope, a validated default and an effect; device scope stored in `localStorage` (pen colour and size, stabilizer on and strength, pen size follows zoom, ignore the filling object, lasso filter, last view); damaged stored values fall back to the default; the old stand-alone last-view key is adopted once. Workspace and board scopes are declared; their storage (schema 5, archive 3) comes with the first setting that needs it.

**Tested:** unit `settings.test.ts` (4: defaults, rejection, reset, damaged values, legacy key, no storage; 134/134 in all); E2E `frames.spec.ts` "pen and select options come back after a reload" (4 projects); `frames`, `assets`, `organize` and `storage` specs in Chromium and Firefox: 176 passed, 4 skipped (10.5 min).

**Known failures:** none.

**Unverified:** the full suite after this slice (last full run: v0.9.0, `testing/full-run-4-projects.md`); workspace and board storage (not built).

**Committed:** v0.10.0 on `main`.

**Next bounded task:** Phase 2 (layers and groups, object eraser, per-canvas cameras).

## Phase 1, slice 8 — text objects

**Implemented** ([ADR 0013](adr/0013-text-objects.md))
- `TextObject` storing canonical Markdown (paragraphs, H1–H3, bulleted and
  numbered items, bold, italic, escapes); canonicalized on load and import.
- Bundled Inter Regular (OFL 1.1): own TrueType reader for metrics, character
  map and outlines; browser `FontFace` from memory (no CSP change).
- Browser-independent layout (greedy wrap, font advances, no kerning).
- Drawing: browser glyphs up to 2,000 px per em; exact outline projection
  above that (midpoint splitting, far pieces replaced by arcs that keep the
  winding number). Bold and italic identical in every mode. System-font
  characters pixelate at depth.
- Editing: Text tool (`T`), double-click with Select, contenteditable
  overlay with a format bar; plain-text paste; Copy Markdown (format bar and
  toolbar); commit as one transaction; read-only tabs cannot edit.
- **Fix (reported by the owner):** at 2^10,000,000 each frame took ~1.8 s,
  since Phase 0A. World → screen offsets now skip an exact subtraction when
  one operand is more than 2^128 times smaller (`diffToNumber`): ~15 ms.

**Tested:** [testing/phase-1h.md](testing/phase-1h.md).
- 10 new unit tests (font, Markdown round trip incl. 300 random documents,
  layout, model). 4 new E2E tests × 4 projects, including text placed 3,000
  levels deep and magnified 4,000 levels further.
- 2 mutation checks caught (far-piece winding disabled; old world → screen).
- Extreme depth: 1 E2E test × 4 projects at 2^10,000,000.
- Quick suite: 253 passed, 3 skipped by design, 0 failed.

**Known failures:** none. Two Firefox zoom-preview tile tests failed once
under machine load (also on v0.7.0), then passed: timing-sensitive.

**Known limits:**
- Lines with system-font characters can sit a few px lower in the editor
  than on the canvas.
- Not yet: other fonts and weights, alignment, links, code, mentions and
  backlinks (notes slice), bidirectional text and complex shaping.
- The wrap width cannot be changed on its own yet (resizing scales the text).

**Unverified:** IME composition (CJK input methods), screen readers inside
the editor, real (non-headless) displays.

**Next bounded task:** video, GIF and audio objects (§14.12), or the
Markdown notes slice (mentions, backlinks), whichever the owner picks.

## Phase 1, slice 7 — zoom preview for dense scenes

**Implemented** ([ADR 0012](adr/0012-zoom-preview.md))
- In dense scenes only (the last full tile build took more than 12 ms),
  zoom frames show the last exact tile set scaled, by at most 1 level.
- **Refinement:** exact again 150 ms after the zoom stops, or immediately
  when the 1-level bound is crossed. Pending edits disable the preview.
  Preview frames build nothing.
- Sparse scenes and deep-zoom work stay exact on every frame.
- **Bench:** a `zoomin` mode (a steady zoom gesture).

**Tested:** [testing/phase-1g.md](testing/phase-1g.md).
- Dense 10K zoom: 113 → 5.3 ms p50 (Chromium) and 125 → 6 ms (Firefox).
- A one-frame rebuild per level crossed (p99 160–213 ms).

**Known failures:** none.

**Known limits:**
- A full exact rebuild on each level crossed.
- An empty border after zooming out until refinement.

**Next bounded task:** text objects (§14.11). Done in slice 8.

## Phase 1, slice 6 — organizing the asset library

**Implemented** ([ADR 0011](adr/0011-asset-organization.md))
- **Catalog fields:** tags (normalized), a favourite flag and folder ids
  (any number). There is no schema change: old entries read with empty
  defaults.
- **Folders:** one `meta` record, nested by parent id. Deleting a folder
  removes its subfolders and filing, never assets.
- **Edits are changes applied inside one transaction** (add and remove),
  so quick or concurrent edits never overwrite each other. They are
  writer-only, and other tabs refresh.
- **Assets view:**
  - a sidebar (All, Favourites, Unfiled, folder tree, tags, with counts);
  - inspector controls for the favourite, tag chips and input, and folder
    checkboxes;
  - search on name, type and tags, with `#tag` for an exact match.
- **Archives** carry tags, favourite and folder paths. Import merges them
  (folders are matched by path, so there are no duplicates).

**Tested:** [testing/phase-1f.md](testing/phase-1f.md).

**Known failures:** none.

**Unverified:**
- libraries with tens of thousands of assets (the filter is linear);
- screen-reader behaviour.

**Next bounded task (done in slice 7):** the zoom preview for dense
scenes. Then text objects.

## Phase 1, slice 5 — density preview

**Implemented** ([ADR 0010](adr/0010-density-preview.md))
- **Ink summaries:** each index cell, mid cell and coarse cell keeps its
  covered area and mean colour, updated on every insert and remove.
- **One rule** (`tooSmallToDraw`, by index level) decides whether an object
  is drawn individually or shown as density. Index and projection now agree
  exactly.
- **Drawing:** squares up to 2 px are spread over pixels with opacity
  `1 − e^(−coverage)`, behind all drawn objects. A presence floor of 35%
  keeps any sub-pixel content findable. Squares under 2^-10 px are points.
- **Not part of the document:** never selectable, not in tiles, recomputed
  when the document or camera changes.
- **Bench:** a `zoom` mode (zoom in place, no pan).

**Tested:** [testing/phase-1e.md](testing/phase-1e.md).
- Content stays visible from 10 to 200 levels out, and content drawn 60
  levels deep is findable from home.
- Cost: at most about 1 ms (Chromium) and 4 ms (Firefox) per frame with 1M
  objects.

**Known failures:** none.

**Known limits:**
- Images use neutral grey.
- No paint-order interleaving with drawn objects.
- Cost grows with the occupied summary cells of skipped levels.

**Next bounded task (done in slice 6):** asset organization (tags,
folders, collections, and search in the Assets view).

## Phase 1, slice 4 — raster tile cache

**Implemented** ([ADR 0009](adr/0009-raster-tile-cache.md))
- Committed objects are rendered into 256 px tiles, reused while panning
  and on every redraw that does not move the camera. Overlays and the base
  layer are drawn live.
- **Exactness:**
  - tiles exist for one exact zoom and DPR, and are never scaled;
  - no tiles are used while the zoom changes;
  - tiles are reused only after whole-device-pixel pans;
  - an 8 px guard border prevents seams;
  - each tile keeps the frame's batch runs.
- **Invalidation:**
  - an edit (including undo and redo) drops the tiles that drew the object
    or that its new state overlaps;
  - a tile that showed an image placeholder refreshes when the original
    loads;
  - any document load, and any theme or DPR change, clears the tiles.
- Move and resize previews render directly.
- **Benchmarks:** a pan-only and a still-camera trajectory, plus a Firefox
  bench project.

**Tested:** [testing/phase-1d.md](testing/phase-1d.md).
- Dense 10K, p50: pan 89 → 2.2 ms, still camera 152 → 3.3 ms (Chromium).
  Firefox: 98 → 2 ms and 172 → 2 ms.
- Pan+zoom is unchanged, as designed.

**Known failures:** none.

**Known limits:**
- Continuous zoom over dense scenes is still 60–70 ms per frame.
- Tiled and direct frames differ in anti-aliasing at same-colour stroke
  overlaps (0.02% of pixels by more than 16 levels; the criterion is in the
  ADR).

**Unverified:**
- a hardware-GPU canvas;
- pen-input latency;
- long-session memory;
- fractional DPRs (the cache turns itself off).

**Next bounded task:** a zoom preview for dense scenes (deferred in ADR
0009), or asset organization (tags, folders, collections). Then a density
preview for sub-pixel content.

## Firefox support (v0.3.1, between slices 3 and 4)

**Implemented**
- A `firefox` E2E project (Firefox 157) in the quick and full suites.
- **Fix:** grid lines are drawn with `fillRect` instead of a stroked path.
  The grid cost drops from 14.9 to 1.9 ms per frame in Firefox, and from 2.1
  to 1.9 ms in Chromium.

**Tested:** [testing/firefox.md](testing/firefox.md). First run: 5 failures,
explained there. After the fix the quick suite passes in all 4 projects
(165 passed, 3 skipped by design).

**Known differences**
- Storage quota for `file://` is about 790 MiB in Firefox, against about
  10 GiB in Chromium.
- `performance.now()` has 1 ms resolution in Firefox.

**Unverified:** the owner's own Firefox profile (its `file://` origin
rules), and Firefox on Windows and macOS.

## Decided and implemented: quick vs full test suites (2026-10-13)

The full E2E suite runs thousands of real input events in 3 browser
configurations and takes about 35 minutes. Most of that is a handful of
deliberate stress loops, and it grows with every feature. Decision, with the
project owner:

- **Quick suite** (target 3–5 min): every test, with short stress loops (for
  example 200 wheel notches instead of 2,400). Run it after ordinary
  changes.
- **Full suite** (the current one, unchanged): run it only when a whole
  phase is complete, and record its results in the test log. Slices and
  milestones inside a phase are committed on the quick suite (revised
  2026-10-13, from slice 1c on).
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

# canvast

canvast is an offline-first **endless canvas**: you can pan in any direction
and zoom in or out without hitting a boundary or a zoom stop, and you can draw,
place images and edit at whatever scale you reach. The app ships as **one
self-contained HTML file** that works from `file://` with no server, account
or network connection.

> **Status: Phase 0C — scale proof.** On top of endless navigation (0A) and
> editing at any depth and distance (0B), rendering now scales with what is
> on screen rather than with document size. A million-object board renders
> in about 8–10 ms per frame when a few hundred objects are visible. Workspaces and boards,
> the Assets view, text, video, groups, export/import and settings are **not
> implemented yet**; see [Roadmap and status](docs/status.md). This README
> describes only what exists.

## What works today

### Endless navigation (Phase 0A)

- **Endless zoom in both directions.** There is no minimum or maximum zoom.
  The automated suite covers 1,000 levels of wheel zoom (≈10^301) in each
  direction, and navigation at depths of 2^±9000 (≈10^±2709).
- **Endless pan.** There is no world rectangle or edge, and the camera never
  recenters behind your back. Coordinates are exact at any distance, including
  2^5000 units from the origin.
- **Anchored zoom.** The point under the pointer, or under the pinch centre,
  stays put (measured drift ≤ 2.8e-14 px).
- **Exact round trips.** If you zoom far out and back in at the same pointer,
  or pan and pan back, you return to the same pixels.
- **Orientation aids:** a hierarchical grid, the world axes, nested reference
  squares at the origin, and a live zoom/position read-out.

### Editing (Phase 0B)

- **Pen:** freehand vector strokes in 4 colours and 3 widths. A stroke is
  authored at the current scale, so a 3 px line drawn 1,000 levels deep is a
  3 px line there. It stays crisp vector geometry at every magnification.
- **Images:** import with the toolbar button, drag-and-drop, or paste. One
  source pixel is placed as one CSS pixel, shrunk to fit if needed. Zooming in
  shows the image's real pixels as crisp blocks. No detail is invented and
  the source file is never altered.
- **Independent objects:** a stroke drawn over an image is its own object.
  Moving the image leaves the stroke where it was drawn. Drawing never selects
  or attaches to what is underneath.
- **Select tool:**
  - click to select (shift adds, alt+click cycles through overlapping
    objects);
  - drag strokes to move them;
  - drag the corner handles to resize (uniform; shift gives free aspect
    ratio for a single image);
  - drag on empty space for a box selection.
  Images must be clicked first before a drag moves them, so a huge image
  filling the screen is never grabbed by accident.
- **Lasso:** draw around strokes to select them. The default "Strokes" filter
  never selects media. "All" also selects images that are entirely enclosed.
- **Undo/redo** of every edit (draw, import, move, resize, delete), each
  undone in one step, exactly.
- **Saved automatically** in the browser (IndexedDB) shortly after each
  edit, together with the camera. Reloading the file restores the canvas and
  the view. The HUD shows the save state.
- **Correct deep-zoom rendering:** zooming far into a stroke never
  produces holes or flicker. Each object, including semi-transparent ones, is
  painted exactly once, so overlaps never double-darken.
- **Exact at every scale:** the automated suite creates, selects, drags,
  resizes and undoes objects at depth +1,000 and −1,000 levels, at distances
  of 2^1000. It also draws in two regions 2^1013 units apart and confirms that
  both stay addressable after a reload.

### Scale (Phase 0C)

- **Multi-scale spatial index.** It has no world bounds and no depth limit.
  Off-screen content costs almost nothing per frame, even when it is 2^5000
  away or 2^5000 times larger or smaller.
- **Measured on the CPU-only tier** (frame p50, with about 500 objects
  visible):
  - 10K objects: 1.7 ms;
  - 100K objects: 2.2 ms;
  - 1M objects: 7.7–9.6 ms, down from 5.8–6.4 s before the index.
- **Content far below a pixel is skipped** (level of detail).
- **Identical opaque strokes are drawn in one call.**
- **Known limit:** scenes with thousands of strokes visible at once are
  limited by Canvas 2D rasterization (about 59 ms p50 at 3K–7.7K visible
  strokes). The planned fix is a raster tile cache (ADR 0005).

### Controls

| Action | Input |
| --- | --- |
| Zoom at pointer | Mouse wheel · trackpad pinch · ctrl+wheel |
| Pan | Middle-drag · hold **Space** and drag · Hand tool drag · two-finger drag · shift+wheel · arrow keys (shift = larger steps) |
| Zoom at centre | `+` / `=` and `-` (shift = 4× step) · on-screen `+` / `−` |
| Return to origin | `0` · `Home` key · on-screen house button |
| Tools | `V` select · `P` pen · `L` lasso · `H` hand |
| Undo / redo | `Ctrl/⌘+Z` · `Ctrl/⌘+Shift+Z` or `Ctrl+Y` |
| Delete selection | `Delete` / `Backspace` |
| Select all / clear | `Ctrl/⌘+A` · `Esc` (also cancels a gesture in progress) |
| Import images | toolbar image button · drag files onto the page · paste |
| Jump to a zoom level | click the zoom read-out, type `3000`, `2^-500` or `10^900`, press Enter (Esc cancels). It zooms about the screen centre; one jump can move up to 10,000,000 levels |
| Debug + dev panel | open the file with `#debug` at the end of the URL: camera internals, frame times, ±10/100/1000-level jump buttons, and auto-zoom in/out at 1–1000 levels/s (any click, key or wheel stops it) |

## Terminology

**canvas** is the endless creative surface. **World coordinates** are the
authoritative positions of things on the canvas. The **camera** is the current
view: its centre in world coordinates plus a zoom level. A **zoom level** of
`z` means 2^z CSS pixels per world unit. An **object** is something placed on
the canvas: a stroke or an image instance. An **asset** is an imported source
file. Each asset is stored once, and placed images refer to it. The planned
organization is Workspace → Boards → Canvas, with separate Canvas and Assets
views. Those are not implemented yet.

## Quick start

Prerequisites: Node.js ≥ 22 (developed on 26.4) and npm.

```sh
npm ci                     # install pinned dev dependencies
npm run build              # → dist/canvast.html (production, minified)
npm run build:debug        # → dist/canvast-debug.html (source maps, debug panel)
```

Open `dist/canvast.html` directly in a browser, by double-clicking it or with
`file:///…/dist/canvast.html`. No development server is needed. You can copy
that single file anywhere, and it runs without this repository or a network
connection.

### Verifying offline operation

- `npm run check:offline` statically scans the built file for any external
  `src`, `href`, CSS `url()`/`@import` or code-level fetch, and fails if it
  finds one.
- The end-to-end (E2E) suite opens the built file from `file://` and fails if
  the page makes any request other than `file:`, `data:` or `blob:`.
- At runtime, the page's CSP (`default-src 'none'; connect-src 'none'`) blocks
  network access even if code tried it.
- By hand: disconnect the network, open the file, then draw, import, reload.

## Testing

```sh
npm run typecheck          # TypeScript, strict
npm run test:unit          # Vitest: exact arithmetic, camera, document, projection, selection
npm run test:e2e           # builds, then Playwright against file://dist/canvast.html#debug
npm run check:offline      # no external references in the built file
npm run check:names        # naming policy: no external product names in first-party text
npm test                   # all of the above
npm run bench              # scale benchmarks: 1K–1M objects, dense vs sparse (not part of npm test)
```

The E2E suite runs every test in three Chromium configurations: the default,
GPU disabled (`--disable-gpu --disable-accelerated-2d-canvas`), and
devicePixelRatio 2 with touch. Measurements are written to `metrics/*.json`
(gitignored). Thresholds were fixed before the runs in
`tests/e2e/harness.ts` (`LIMITS`) and are never loosened after a run. Test
image fixtures are generated in code (`tests/e2e/png.ts`); no binary
fixtures are committed.

Results with environment and caveats:

- [Phase 0A navigation](docs/testing/phase-0a.md)
- [Phase 0B editing](docs/testing/phase-0b.md)
- [Phase 0C scale benchmarks](docs/testing/phase-0c.md)

Latest results (Phase 0C): 58/58 unit tests; full E2E suite 67 passed, 2
skipped by design, 0 failed across 3 projects; scale benchmarks in
[docs/testing/phase-0c.md](docs/testing/phase-0c.md).

Phase 0B results:
- 52/52 unit tests.
- Final full E2E run: 61 passed and 2 skipped (by design). The 6 failures
  were test-harness defects; after fixing them, every failed or related test
  passed in all 3 projects (21/21).
- Details: [docs/testing/phase-0b.md](docs/testing/phase-0b.md).

## Browser support and requirements

- Requires a browser with `BigInt`, Pointer Events, `ResizeObserver`,
  Canvas 2D and IndexedDB (for saving). Roughly: Chromium ≥ 67, Firefox ≥ 68,
  Safari ≥ 14.
- **Tested** only in Chromium 156 (Playwright) on Linux. Firefox and Safari
  are **unverified** so far. Firefox's IndexedDB support for `file://` pages
  differs from Chromium's. If storage cannot be opened, the app keeps working
  in memory and says so in the HUD.
- No GPU features are used. Rendering is Canvas 2D only.

## Architecture

```
src/
  core/dyadic.ts            exact m·2^e numbers (BigInt mantissa), double-double split
  core/camera.ts            camera model, world↔screen, anchored zoom, pan
  doc/model.ts              canvas objects (stroke, image), validation, serialization
  doc/edit-ops.ts           exact translate, scale-about-point, unit renormalization
  doc/document-store.ts     authoritative object set, transactions, undo/redo
  render/projection.ts      object → screen projection shared by drawing and picking
  render/draw-objects.ts    stroke/image drawing; one paint per object (opacity)
  render/stroke-coverage.ts exact stroke coverage and edge distance for deep magnification
  render/hit-test.ts        pick, lasso and box selection policies
  render/scene-view.ts      visible objects via the spatial index (with previews)
  scene/spatial-index.ts    multi-scale spatial index (levels × BigInt cells, coarse summaries)
  render/scene-renderer.ts  objects, draft stroke, selection, lasso/marquee overlays
  render/canvas2d-renderer.ts  grid, axes, landmarks
  interaction/navigation.ts wheel/keyboard navigation and the pan/pinch gesture
  interaction/tools.ts      pointer routing: pen, select/move/resize, marquee, lasso
  assets/                   SHA-256 content addressing, decoding, pixel access
  storage/                  IndexedDB wrapper and snapshot persistence
  ui/                       toolbar and Lucide icons
  app/                      bootstrap, editor state, actions, HUD, debug hook, bench scenes
scripts/                    single-file build, offline check, naming check
tests/unit/, tests/e2e/     Vitest and Playwright suites
docs/adr/                   architecture decision records
docs/testing/               test logs with measured results
docs/status.md              roadmap and current status (single source of truth)
```

**Data flow:** input → transient preview (never stored) → one transaction
on pointer-up → validation → document mutation → redraw and a debounced
snapshot save.

- [ADR 0001](docs/adr/0001-exact-dyadic-world-coordinates.md): the exact
  coordinate model.
- [ADR 0002](docs/adr/0002-cpu-first-canvas2d-and-single-file-build.md):
  renderer, language and build.
- [ADR 0003](docs/adr/0003-objects-selection-and-projection.md): objects,
  projection, selection policy and persistence.
- [ADR 0004](docs/adr/0004-multi-scale-spatial-index.md): spatial index,
  cell-relative projection, level of detail and batching.
- [ADR 0005](docs/adr/0005-dense-scene-acceleration.md): dense-scene
  acceleration (raster tile cache before WebGL; no WASM yet).

## Storage, backups, import/export

- Data lives in the browser's IndexedDB under the database name `canvast`. It
  has two stores:
  - `snapshots`: the document and the camera;
  - `assets`: original image bytes, keyed by SHA-256 and stored once.
- **Origin caveat:** Chromium gives all `file://` pages one shared storage
  origin. Moving the HTML file to another folder keeps your data. Opening it
  in a different browser or profile does not.
- Save states shown in the HUD: *Saved*, *Unsaved changes…*, *Saving…*,
  *Save failed* (changes are only in memory) and *Storage unavailable*.
- On load, damaged objects are skipped and reported, never silently "fixed".
- **Not yet available:** export/import, backups, multi-tab coordination
  (two tabs editing at once: the last save wins), and quota reporting. Undo
  history does not survive a reload.

## Known limitations (honest list)

- **Precision budget (camera).** Zooming out more than 4,096 levels beyond
  the deepest point and back in no longer returns to the exact sub-pixel
  spot. It still lands within 2^-96 px at the coarse scale.
- **Object magnification.** Deeply magnified strokes and image pixels
  switch to an exact-arithmetic path. There is no magnification limit.
  - Verified: edges exact up to 2^5000×, visible and selectable after 1,500
    levels beyond the placement scale.
  - Each extra level of depth makes the numbers involved larger, so very
    deep views cost more CPU per frame. Measurements are in the Phase 0B
    test log.
- **Dense visible scenes.** Thousands of strokes on screen at once render
  at about 10–17 fps on the CPU-only reference machine, because Canvas 2D
  rasterization dominates. Fix planned: raster tile cache (ADR 0005).
- **Very large documents.** A 1M-object board needs about 940 MB of heap,
  and about 6 s to build the spatial index on load.
- **Far zoom-out.** Content more than about 3 levels below a pixel is not
  drawn at all. There is no density preview yet.
- **Not implemented:**
  - groups, attach/detach, locking, rotation, and a Layers panel;
  - picking that respects image transparency (images are picked by their
    bounds);
  - text, video, GIF, audio and PDF;
  - adjustments and settings;
  - Workspace/Boards and the Assets view;
  - collaboration.
- Tested only in Chromium on one Linux machine. Touch is emulated in tests.

## Security

- CSP: `default-src 'none'`. Only inline script and style are allowed.
  Images come from `blob:`/`data:` only. There is no `connect-src`, and
  `worker-src` is limited to `blob:`.
- The app makes no network requests and has no runtime dependencies.
- Imports are limited to `image/*` files of at most 256 MiB. Each file is
  decoded before it is stored, and files that fail to decode are rejected
  with a message.
- Every object is validated before it enters the document or is loaded:
  finite numbers, known kinds, well-formed ids and hashes.

## Licenses

canvast's own code has no published license yet (`UNLICENSED`). Bundled
third-party material: Lucide icons (ISC), with its notice embedded at the top
of `dist/canvast.html` and listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Development-only
dependencies, which are not shipped: TypeScript (Apache-2.0), esbuild (MIT),
Vitest (MIT), Playwright (Apache-2.0).

## Contributing and workflow

Every change follows the same loop: pick one bounded slice, implement it,
run `npm test`, update this README and the docs with measured results, then
commit. A milestone isn't done until its tests pass and it is committed.
Releases record the SHA-256 of `dist/canvast.html`, which `npm run build`
prints. Line endings are pinned to LF (`.gitattributes`), so the digest
reproduces on any checkout.

## Milestone log

| Milestone | Result | Commit |
| --- | --- | --- |
| Phase 0A — endless navigation prototype | 25/25 unit, 22/22 E2E (2 by-design skips), offline + naming checks pass; `dist/canvast.html` v0.0.1 sha256 `1411e6d0…a92` | `1ce2c05` |
| Phase 0B — editing, precision, recovery | 52/52 unit; final E2E 61 passed / 2 by-design skips, 6 harness failures fixed and re-run 21/21 across 3 projects; offline + naming checks pass; `dist/canvast.html` v0.0.2 sha256 `1f7e3cb4…0576` | see `git log` |
| Phase 0C — scale proof | 58/58 unit; E2E 67 passed / 2 by-design skips / 0 failed (3 projects); bench 1M objects 6.4 s → 7.7 ms frame p50; `dist/canvast.html` v0.0.3 sha256 `45028f49…8859` | see `git log` |

# canvast

canvast is an offline-first **endless canvas**: you can pan in any direction
and zoom in or out without hitting a boundary or a zoom stop, and you can draw,
place images and edit at whatever scale you reach. The app ships as **one
self-contained HTML file** that works from `file://` with no server, account
or network connection.

> **Status: Phase 1, slice 7 — smooth zooming over dense scenes.** On top of
> endless navigation (0A), editing at any depth (0B) and rendering that
> scales with what is on screen (0C), your work is organized as
> Workspace → Boards → Canvases with safe, incremental saving (1a), a shared
> Assets library (1b), export/import of `.canvast` archives (1c), and a raster
> tile cache that keeps panning and drawing over dense scenes at 60 fps (1d),
> a density preview that keeps far-away and tiny content visible (1e), and
> tags, favourites and folders in the Assets library (1f), and a zoom preview
> that keeps zooming over dense scenes at about 60 fps (1g). Text, video,
> groups and settings are **not implemented
> yet**; see [Roadmap and status](docs/status.md). This README describes only
> what exists.
>
> **v0.13.0:** Assets keep a small thumbnail (made at import) and open in a full-window slide view, a lost original keeps its picture, saved searches (smart folders) in the Assets sidebar, and dense scenes zoom without a hitch at the preview bound (Phase 4). **v0.12.0:** a frame rate counter with diagnostics, adaptive quality, a decoded-image budget, big documents that open without freezing, and a grid for batch imports (Phase 3). **v0.11.0:** strokes, images and text can be rotated with a handle above the selection (ADR 0018), a moving selection snaps to other objects with guide lines (ADR 0019), objects can be grouped, nested and re-stacked (ADR 0020), hidden or locked (ADR 0021), removed with the object eraser (ADR 0022), the canvas redraws itself if the browser resets the drawing surface (ADR 0023), a floating Layers panel lists, selects, hides, locks and reorders objects (ADR 0024), and a Bookmarks panel saves places and zooms to come back to (ADR 0025).
>
> **v0.10.0:** pen and select options and the last view now persist across reloads (device settings, ADR 0017).
>
> **v0.9.0 — nested frames:** the canvas costs the same at any depth (2^10 to
> 2^10^12 and beyond), with pen options (size slider, thickness lock,
> stabilizer). See the [changelog](CHANGELOG.md) and ADR 0014–0016.

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

- **Pen:** freehand vector strokes in 4 colours, a size slider (0.5–128 px) with 3 presets, a thickness lock (new strokes keep the same width on the canvas at any zoom; on the Select tool it keeps line width when resizing), a stabilizer with adjustable strength, and "pen size follows zoom" while drawing; on the Select tool the size slider sets the thickness of the selected strokes (nested-frames branch; see ADR 0015, 0016). A stroke is
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

### Workspace and storage (Phase 1)

- **Workspace → Boards → Canvases.** The breadcrumb at top-left (for example
  "Board 1 › Canvas 2") opens a menu to switch canvases, add a canvas or a
  board, and rename them. Each canvas keeps its own objects and camera. The
  app reopens on the last canvas you used.
- **Incremental, transactional saving.** Each change writes only the objects
  it touched, in one atomic transaction. The save indicator shows Unsaved
  changes… → Saving… → Saved → Saved (verified), the last only after the
  write is read back. Click it for the storage panel: tab role, space used,
  persistence permission, and backup status.
- **Safe in multiple tabs.** The first tab edits. Others are read-only and
  follow its changes live, with a **Take over** button. A stale tab can never
  overwrite newer data: its save is rejected and reported as a conflict.
- **Upgrades keep your data.** A canvas saved by the previous version
  (v0.0.x) is migrated into Board 1 › Canvas 1 automatically and verified
  object by object. The old data is kept unchanged.
- **Deleting boards and canvases.** Each has a **Delete** button in the
  breadcrumb menu. A confirmation says what will be removed. Images placed
  there stay in the Assets library. A board always keeps at least one canvas,
  and the workspace at least one board.

### Assets view (Phase 1)

- **Canvas | Assets** at top-left switches between the endless canvas and
  the asset library. The canvas keeps its view, selection and undo history
  while you are in Assets.
- **One original, many instances.** Each imported file is stored once.
  Every image you place is an instance that refers to it, on any board or
  canvas.
- **The library** shows each asset with its size, type and usage (for
  example "4 uses · 3 canvases"). You can search, filter (in use or unused),
  sort, and resize thumbnails. **Import** adds files to the library without
  placing them.
- **Details:** click an asset to see where it is used. **Show** opens that
  canvas, selects the instances and zooms to them, at any depth. **Place on
  …** puts a new instance on the open canvas.
- **Safe deletion:**
  - **Delete from library** is only possible when no instance uses the
    asset.
  - The original is erased only once nothing can bring it back. While undo
    could still re-place it, it is kept, and undoing returns it to the
    library.
  - Deleting instances, canvases or boards never erases an original.
- **Missing originals** (for example, cleared storage) are shown with their
  usage. Importing the same file again restores every instance.
- **Organizing:**
  - In an asset's details: ☆ marks it a favourite, the tag box adds tags
    (Enter; separate several with commas), and the folder checkboxes file
    it. One image can be in several folders without being copied.
  - The sidebar shows All, Favourites, Unfiled, your folders (nested; a
    folder also shows its subfolders) and your tags.
  - Hover or tab to a folder for **+** (a subfolder), **Rename** and
    **Delete**. Deleting a folder never deletes images.
  - **Search** matches names, types and tags; `#tag` matches one tag
    exactly.
  - Tags, favourites and folders are included in `.canvast` backups.
    Importing merges them without duplicating folders.

### Backups: export and import (Phase 1)

- **Export workspace backup** in the storage panel (click the save
  indicator) downloads one `.canvast` file. It holds every board, canvas,
  object and saved view, plus every original in the library, each stored
  once. The file is checked before it is saved. The panel then shows **Last
  full backup**. The browser does not report whether the download finished,
  so keep the file somewhere safe.
- **Smaller exports:**
  - **Export** next to a board or canvas in the breadcrumb menu;
  - **Export as archive** for one asset in the Assets view.
  Each includes only the originals it uses.
- **Import archive…** in the storage panel, or drop a `.canvast` file on the
  page:
  - the file is checked completely first, and you see what it contains and
    any problems before anything is written;
  - imported boards and canvases are added; nothing existing is replaced;
  - originals you already have are not stored twice.
- A `.canvast` file is a standard ZIP: you can open it with any unzip tool
  to inspect it. Do not re-compress it, because canvast only reads its own
  uncompressed archives.

### Text (Phase 1)

- **Text tool** (`T`): click on the canvas and type. With the Select tool,
  **double-click** a text to edit it. Esc, **Done** or clicking away
  finishes; emptying a text deletes it.
- **Format bar** while editing: Bold, Italic (`Ctrl/⌘+B`, `Ctrl/⌘+I`),
  Heading 1–3, Body, bulleted and numbered lists. Pasted text arrives as
  plain text.
- **What you edit is what you get:** the editor sits exactly over the text,
  in the same font, size and line breaks.
- **Markdown inside.** Each text is stored as a Markdown entry.
  **Copy Markdown** is in the format bar, and in the toolbar when text is
  selected.
- **No zoom limit.** Zoom into a letter as far as you like: beyond 2,000 px
  per letter canvast draws the font's real outlines, exactly. Characters the
  bundled font (Inter) lacks, such as Chinese or emoji, use a system font
  and pixelate at extreme depth.
- Text resizes as a whole with the corner handles; the pen colours apply to
  new text.

### Controls

| Action | Input |
| --- | --- |
| Zoom at pointer | Mouse wheel · trackpad pinch · ctrl+wheel |
| Pan | Middle-drag · hold **Space** and drag · Hand tool drag · two-finger drag · shift+wheel · arrow keys (shift = larger steps) |
| Zoom at centre | `+` / `=` and `-` (shift = 4× step) · on-screen `+` / `−` |
| Return to origin | `0` · `Home` key · on-screen house button |
| Tools | `V` select · `P` pen · `L` lasso · `H` hand · `T` text |
| Edit text | Text tool click · double-click with Select · `Esc` or `Ctrl/⌘+Enter` to finish |
| Undo / redo | `Ctrl/⌘+Z` · `Ctrl/⌘+Shift+Z` or `Ctrl+Y` |
| Delete selection | `Delete` / `Backspace` |
| Select all / clear | `Ctrl/⌘+A` · `Esc` (also cancels a gesture in progress) |
| Import images | toolbar image button · drag files onto the page · paste (in Assets view these add to the library only) |
| Export / import | storage panel (click the save indicator): **Export workspace backup**, **Import archive…** · menu **Export** per board or canvas · drop a `.canvast` file on the page |
| Switch view | **Canvas** / **Assets** at top-left (←/→ move between them) |
| Jump to a zoom level | click the zoom read-out, type `3000`, `2^-500` or `10^900`, press Enter (Esc cancels). It zooms about the screen centre; one jump can move up to 10,000,000 levels |
| Debug + dev panel | open the file with `#debug` at the end of the URL: camera internals, frame times, ±10/100/1000-level jump buttons, and auto-zoom in/out at 1–1000 levels/s (any click, key or wheel stops it) |

## Terminology

**canvas** is the endless creative surface. **World coordinates** are the
authoritative positions of things on the canvas. The **camera** is the current
view: its centre in world coordinates plus a zoom level. A **zoom level** of
`z` means 2^z CSS pixels per world unit. An **object** is something placed on
the canvas: a stroke, an image instance or a text. An **asset** is an imported source
file. Each asset is stored once, and placed images are **instances** that
refer to it. A **workspace** holds **boards**; each board holds one or more
**canvases**. **Canvas view** shows one canvas; **Assets view** shows the
workspace's shared library.

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

**Which suite to run** (full guide: [docs/testing/README.md](docs/testing/README.md)):

| Command | Time | When |
| --- | --- | --- |
| `npm test` | ~16 min | After every ordinary change (quick E2E suite: short stress loops) |
| `npm run test:full` | ~50 min | Only when a whole phase is complete (full stress loops); log the result |
| `npm run test:unit` | ~15 s | While developing |
| `npm run bench` (scale + tile-cache benchmarks, 3 browser setups) | ~15–25 min | After rendering or performance changes (scale benchmarks, not a gate) |

Both E2E lengths run the same tests; only the stress-loop counts differ.
Never rebuild `dist/` while a suite is running.

Individual commands: `npm run typecheck`, `npm run test:e2e` (quick),
`npm run test:e2e:full`, `npm run check:offline`, `npm run check:names`.

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
- [Phase 1 slice 1 storage](docs/testing/phase-1a.md)

Latest results (Phase 1 slice 1): 58/58 unit tests; full E2E suite 88
passed, 2 skipped by design, 0 failed across 3 projects
([docs/testing/phase-1a.md](docs/testing/phase-1a.md)).

Phase 0C: 67 passed, 2 skipped, 0 failed; scale benchmarks in
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
- **Tested** in Chromium 156 (3 configurations) and **Firefox 157** on Linux
  (Playwright), on every test run. Safari is **unverified**.
  - Firefox on `file://` supports everything canvast uses (IndexedDB, Web
    Locks, BroadcastChannel), and its frame times are close to Chromium's.
  - Firefox gives a local file about **790 MiB** of storage (Chromium about
    10 GiB), which limits the size of the image library. Export a backup
    regularly.
  - Details: [docs/testing/firefox.md](docs/testing/firefox.md).
- If storage cannot be opened, the app keeps working in memory and says so
  in the HUD.
- No GPU features are used. Rendering is Canvas 2D only.

## Architecture

```
src/
  core/dyadic.ts            exact m·2^e numbers (BigInt mantissa), double-double split
  core/camera.ts            camera model, world↔screen, anchored zoom, pan
  doc/model.ts              canvas objects (stroke, image, text), validation, serialization
  doc/edit-ops.ts           exact translate, scale-about-point, unit renormalization
  doc/document-store.ts     authoritative object set, transactions, undo/redo
  render/projection.ts      object → screen projection shared by drawing and picking
  render/draw-objects.ts    stroke/image drawing; one paint per object (opacity)
  render/stroke-coverage.ts exact stroke coverage and edge distance for deep magnification
  render/hit-test.ts        pick, lasso and box selection policies
  render/scene-view.ts      visible objects via the spatial index (with previews)
  scene/spatial-index.ts    multi-scale spatial index (levels × BigInt cells, coarse summaries)
  render/scene-renderer.ts  objects (with batch runs), draft stroke, selection, lasso/marquee overlays
  render/tile-cache.ts      raster tile cache for committed objects (exact zoom, whole-pixel reuse)
  render/density.ts         density preview of sub-pixel content (ink summaries from the index)
  render/canvas2d-renderer.ts  grid, axes, landmarks
  render/draw-text.ts       text drawing: browser glyphs, exact glyph outlines at any depth
  text/                     TrueType reader, Markdown model and canonical form, layout,
                            bundled font (Inter Regular)
  interaction/navigation.ts wheel/keyboard navigation and the pan/pinch gesture
  interaction/tools.ts      pointer routing: pen, select/move/resize, marquee, lasso
  assets/                   SHA-256 content addressing, decoding, pixel access; asset catalog,
                            usage lookups and mark-and-sweep garbage collection
  storage/                  IndexedDB schema, workspace repository, incremental persistence,
                            v1 migration, multi-tab writer lease, ZIP container, archive export/import
  ui/                       toolbar, text editor overlay, view switch, workspace navigator, Assets view, confirmation
                            dialog, storage panel, dev panel, Lucide icons
  app/                      bootstrap, editor state, actions, HUD, debug hook, bench scenes
scripts/                    single-file build, offline check, naming check
tests/unit/, tests/e2e/     Vitest and Playwright suites
docs/adr/                   architecture decision records
docs/testing/               test logs with measured results
docs/status.md              roadmap and current status (single source of truth)
```

**Data flow:**
1. Input produces a transient preview, which is never stored.
2. On pointer-up, the gesture becomes one transaction, which is validated.
3. The document is mutated, and the changed ids update the spatial index.
4. The canvas redraws.
5. After a 150 ms debounce, the changed objects are written in one atomic,
   revision-checked IndexedDB commit, then read back to verify it.

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
- [ADR 0006](docs/adr/0006-workspace-storage.md): workspace storage —
  hierarchy, per-object commits, migration, multi-tab safety.
- [ADR 0007](docs/adr/0007-asset-catalog-and-gc.md): asset catalog, Assets
  view, reference-checked garbage collection, safe deletion of boards and
  canvases.
- [ADR 0008](docs/adr/0008-portable-archives.md): portable archives —
  format, export scopes, verification, validated transactional import.
- [ADR 0009](docs/adr/0009-raster-tile-cache.md): raster tile cache —
  exactness rules, invalidation, fidelity criterion, measurements.
- [ADR 0010](docs/adr/0010-density-preview.md): density preview — ink
  summaries, one draw-or-preview rule, presence floor, cost.
- [ADR 0011](docs/adr/0011-asset-organization.md): organizing the asset
  library — tags, favourites, folders, search, archive merge.
- [ADR 0012](docs/adr/0012-zoom-preview.md): zoom preview for dense scenes —
  bounds, refinement, measurements.
- [ADR 0013](docs/adr/0013-text-objects.md): text objects — Markdown model,
  bundled font, layout, exact outlines at any depth, editing.

## Storage, backups, import/export

- **Where data lives:** IndexedDB database `canvast`, schema version 3
  (details in [ADR 0006](docs/adr/0006-workspace-storage.md) and
  [ADR 0007](docs/adr/0007-asset-catalog-and-gc.md)). It has these stores:
  - `workspaces`, `boards`, `canvases`;
  - `objects`, with one record per object, indexed by the asset an image
    uses;
  - `canvasViews`, the per-canvas camera;
  - `assets`, the original image bytes, keyed by SHA-256 and stored once;
  - `assetCatalog`, the library entries (metadata only);
  - `meta`;
  - the legacy `snapshots` store from v0.0.x, kept unchanged after migration.
- **Origin caveat:** Chromium gives all `file://` pages one shared storage
  origin. Moving the HTML file to another folder keeps your data. Opening it
  in a different browser, profile or private window does not, and clearing
  site data deletes it.
- **Save states:**
  - *Unsaved changes…* (queued) and *Saving…*;
  - *Saved* (transaction committed) and *Saved (verified)* (read back);
  - *Read-only*, *Not saved — changed in another tab*, *Save failed*, and
    *Storage unavailable*.
- On load, damaged objects are skipped and reported, never silently "fixed".
- **What can delete data:** deleting objects, canvases and boards (canvas
  and board deletion is confirmed and cannot be undone), and **Delete from
  library**, which erases an unused original once undo can no longer need
  it. Nothing else deletes anything.
- **Backups:** `.canvast` archives (ZIP-compatible, uncompressed). They
  contain a versioned `manifest.json`, one JSON file per canvas, and each
  original once under `assets/<sha256>`, with a CRC on every entry. See
  [ADR 0008](docs/adr/0008-portable-archives.md).
  - Import checks every checksum and content hash before writing anything,
    then writes in one transaction.
  - Limit: 4 GiB and 65,535 files per archive.
- **Not yet available:**
  - incremental or multi-part backups.

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
- **Dense visible scenes.**
  - Panning and drawing over thousands of visible strokes now run at 60 fps,
    thanks to the raster tile cache
    ([ADR 0009](docs/adr/0009-raster-tile-cache.md)): 2–3 ms per frame,
    against 89–172 ms before.
  - **Zooming** over such scenes shows a briefly scaled image of the last
    exact frame ([ADR 0012](docs/adr/0012-zoom-preview.md)): about 5 ms
    per frame, against 87–125 ms before.
    - It snaps to the exact picture 150 ms after you stop, and every time
      you pass a whole zoom level. Those crossings take one full frame each
      (about 0.16–0.2 s at 10K strokes).
    - Scenes with few objects, including anything you work on deep inside
      the canvas, are always drawn exactly.
- **Very large documents.** A 1M-object board needs about 940 MB of heap,
  and about 6 s to build the spatial index on load.
- **Far zoom-out.** Content too small to draw stroke by stroke appears as a
  soft mark in its own colour (the density preview,
  [ADR 0010](docs/adr/0010-density-preview.md)). Anything there keeps at
  least a faint dot, so you can find it and zoom in.
  - It is a preview: shapes inside a pixel are not resolved, and images
    show as neutral grey.
  - Marks cannot be selected; zoom in to edit.
- **Not implemented:**
  - groups, attach/detach, locking, rotation, and a Layers panel;
  - picking that respects image transparency (images are picked by their
    bounds);
  - video, GIF, audio and PDF;
  - in text: other fonts and weights, alignment, links, code, mentions and
    backlinks, right-to-left and complex scripts (Arabic, Indic), and
    changing the wrap width on its own;
  - adjustments and settings;
  - smart folders, ratings, batch editing of several assets and
    similar-image review; dragging an asset onto the canvas (use Place);
  - collaboration.
- **Text and system fonts.** Characters the bundled font lacks use the
  system font: their width comes from the browser, so such text can wrap
  differently on another computer, and in the editor its line can sit a
  few px lower than on the canvas.
- **Large backups.** One archive holds at most 4 GiB and 65,535 files, and it
  is built in the browser before download. Export and import speed for large
  workspaces has not been measured.
- **Large asset libraries.** Thumbnails are generated in memory each
  session, and the grid draws every card. Very large libraries (many
  thousands of assets) have not been measured.
- Tested in Chromium and Firefox on one Linux machine. Touch is emulated in tests.

## Security

- CSP: `default-src 'none'`. Only inline script and style are allowed.
  Images come from `blob:`/`data:` only. There is no `connect-src`, and
  `worker-src` is limited to `blob:`.
- The app makes no network requests and has no runtime dependencies. The
  bundled font is handed to the browser from memory, so no font source is
  allowed either.
- Imports are limited to `image/*` files of at most 256 MiB. Each file is
  decoded before it is stored, and files that fail to decode are rejected
  with a message.
- Every object is validated before it enters the document or is loaded:
  finite numbers, known kinds, well-formed ids and hashes.

## Licenses

canvast's own code has no published license yet (`UNLICENSED`). Bundled
third-party material: Lucide icons (ISC) and the Inter Regular font (SIL Open
Font License 1.1), with their notices embedded at the top of
`dist/canvast.html` and listed in
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
| Phase 1 slice 1 — workspace and storage foundation | 58/58 unit; E2E 88 passed / 2 by-design skips / 0 failed (3 projects); `dist/canvast.html` v0.1.0 sha256 `c1fb8b7f…ac4` | see `git log` |
| Phase 1 slice 2 — Assets view, catalog, GC, safe deletion | 68/68 unit; full E2E 112 passed / 2 by-design skips / 0 failed (3 projects, 34.5 min); 2 mutation checks caught; `dist/canvast.html` v0.2.0 sha256 `9db358e8…31b7` | see `git log` |
| Phase 1 slice 3 — portable archives (export/import) | 75/75 unit; quick E2E 121 passed / 2 by-design skips / 3 failed (one stale assertion, fixed and re-run 3/3); 2 mutation checks caught; `dist/canvast.html` v0.3.0 sha256 `2db91b09…9d9a` | see `git log` |
| Firefox support (v0.3.1) | Firefox 157 added as a 4th E2E project; grid drawing 7.8× faster in Firefox; quick E2E 165 passed / 3 by-design skips / 0 failed (4 projects); tested build `f64a472e…92bf` (same code, pre-bump label); `dist/canvast.html` v0.3.1 sha256 `60ccde68…1a30` | see `git log` |
| Phase 1 slice 4 — raster tile cache | tiles 24/24 (4 projects); dense 10K pan 89→2.2 ms, still 152→3.3 ms p50 (Chromium), Firefox 98→2 / 172→2 ms; quick E2E 189 passed / 3 by-design skips / 0 failed (4 projects); `dist/canvast.html` v0.4.0 sha256 `4528f2b3…f65a` | see `git log` |
| Phase 1 slice 5 — density preview | 79/79 unit (4 new); density 3 tests × 4 projects; cost ≤ ~1 ms Chromium / ≤ 4 ms Firefox at 1M objects; quick E2E 201 passed / 3 by-design skips / 0 failed (4 projects); `dist/canvast.html` v0.5.0 sha256 `5d1504dc…0ede0` | see `git log` |
| Phase 1 slice 6 — asset organization | 82/82 unit (3 new); organize 4 tests × 4 projects (12/12 repeated); 1 mutation check caught; quick E2E 217 passed / 3 by-design skips / 0 failed (4 projects); `dist/canvast.html` v0.6.0 sha256 `07154eec…26b4` | see `git log` |
| Phase 1 slice 7 — zoom preview | tiles 40/40 (4 projects); dense 10K zoom 113→5.3 ms p50 (Chromium), 125→6 ms (Firefox); 1 mutation check caught; quick E2E 233 passed / 3 by-design skips / 0 failed (4 projects); `dist/canvast.html` v0.7.0 sha256 `ec455d1c…f905` | see `git log` |
| Phase 1 slice 8 — text objects | 94/94 unit (12 new); text 16/16 and extreme depth 4/4 (4 projects); 2 mutation checks caught; owner-reported hang at 2^10,000,000 fixed (1.8 s → 15 ms per frame); quick E2E 253 passed / 3 by-design skips / 0 failed (4 projects); `dist/canvast.html` v0.8.0 sha256 `457ea053…6fb2` | see `git log` |
| v0.9.0 — nested frames | 130/130 unit; depth suite A1 A2 A3 A5 A7 (4 projects); quick E2E (4 projects, before the suites were trimmed) 346 passed / 3 skipped / 3 load flakes that pass alone; full E2E on 3 Chromium projects 214 passed / 4 skipped / 1 flake (fixed afterwards), 21 min 44 s; full E2E with Firefox (4 projects) 301 passed / 6 skipped / 1 timeout (fixed; passes alone), 32 min 25 s |
| Phase 1 slice 9 — settings scopes | 134/134 unit (4 new); settings reload test in 4 projects; frames, assets, organize and storage specs in Chromium and Firefox 176 passed / 4 skipped; full suite not re-run since v0.9.0 |
| Phase 2 (7 slices) — rotation (strokes, images, text), snapping, groups, hide and lock, object eraser, recovery | 140/140 unit (6 new); full suite on 4 projects 340 passed / 6 skipped / 2 failed (one test that measured the wrong thing; fixed and re-run alone 64/64), 34 min 50 s; snapping E2E in Chromium and Firefox with frames, text and editing 62 passed (2.3 min; the editing U1 test now turns snapping off); rotation E2E (strokes; image and text) in 4 projects; frames, text, editing, deep-zoom-rendering, tiles and density specs in Chromium and Firefox 96 passed (6.7 min); full suite not re-run since v0.9.0 |
| Phase 3 slices 1-6 — decoded-image budget, adaptive quality, cooperative index build, duplicate notice, import grid, reduced copies, decode queue, FPS counter | 147/147 unit; E2E for each; assets, editing, frames, deep-zoom-rendering, archive and organize in Chromium and Firefox 122 passed (8.9 min) |
| Selection fixes (owner feedback) — oriented boxes, rotate from a corner, select by touch, shortcuts after a slider | 147/147 unit; E2E for each; frames, editing and text in Chromium and Firefox 90 passed (3.5 min) |

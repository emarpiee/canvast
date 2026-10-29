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
| NF | Nested frames redesign ([ADR 0014](adr/0014-nested-frames.md), [reference](reference/nested-frames.md)): constant per-frame cost at any depth | **done** (v0.9.0) |
| 1i | Settings scopes ([ADR 0017](adr/0017-settings-scopes.md)): device scope built (pen and select options persist), workspace and board scopes declared | **done** (see below) |
| 2 | Rendering and interaction productionization: selection and transforms including **item rotation**, **snapping and guides**, layers and groups, object eraser, per-canvas cameras | **done** (ADRs 0018 to 0023; full suite in [testing/full-run-phase-2.md](testing/full-run-phase-2.md)) |
| 3 | Performance infrastructure: LOD, caches and budgets, resource lifecycle, adaptive quality, worker scheduling, stress fixtures | **done** (v0.12.0): decoded-image budget ([ADR 0027](adr/0027-decoded-image-budget.md)), adaptive quality ([ADR 0028](adr/0028-device-tiers-and-adaptive-quality.md)), cooperative index build ([ADR 0029](adr/0029-cooperative-index-build.md)), batch-import grid ([ADR 0030](adr/0030-import-grid-and-reduced-copies.md)), FPS counter with diagnostics; full suite 380 passed ([record](testing/full-run-phase-3.md)), tier benchmark ([record](testing/phase-3-bench.md)) |
| 1+ | Persisted WebP thumbnails, slide view and recognisable broken assets, video/GIF/audio, Markdown notes (mentions, backlinks), adjustments, Settings, groups, smart folders and batch asset edits, collaboration | planned |
| 7 | Professional UX: Settings view with tabs, scopes and reset ([ADR 0048](adr/0048-settings-view.md)), rebindable shortcuts and the shortcut list ([ADR 0049](adr/0049-shortcuts.md)), accessibility audit and appearance options ([ADR 0050](adr/0050-accessibility-and-appearance.md)), selection action bar ([ADR 0051](adr/0051-selection-action-bar.md)) | **done (v0.16.0)**: full suite 428 passed, 6 skipped, 0 failed ([record](testing/full-run-phase-7.md)) |
| 5v | Vector objects ([ADR 0099](adr/0099-vector-paths.md)): shapes, Bézier paths, node editing, fills and outlines with transparency | **first slice done (v0.17.0)**: unit and E2E (Chromium, Firefox) green; exact edges at any depth, gradients (ADR 0100) and Boolean groups (ADR 0101, 0103: non-destructive) and text to path (ADR 0102) done; vector UX first pass and stroke position (ADR 0104) done; UX audit items 1-9 done; shapes stay editable (sides, points, ratio, corner radius, ADR 0105); next: SVG import and export, then dashes, node snapping, per-corner radii |
| 5t | Text tool revamp ([ADR 0125](adr/0125-mentions-removed-item-names.md), [0126](adr/0126-text-look.md), [0127](adr/0127-imported-fonts.md)): mentions removed, names above items, text look in the options bar, text styles, fonts from the library | **done (v0.18.0)**: unit and E2E in Chromium (Firefox for the text spec); see [testing/text-0.18.md](testing/text-0.18.md); the rest of the text list (gradient, ranges, set height, fonts) is in 5u |
| 5u | The backlog run ([ADR 0130](adr/0130-text-ranges-and-looks.md) to [0142](adr/0142-arrow-heads-miter-svg-use.md)): text ranges, font engine, note tool, picture adjustments, media crop and speed, metadata, backups, import, settings, context menu, vector extras, scenario tests, contrast audit | **done (v0.18.1)**: unit and E2E in Chromium and Firefox for each slice; the full suite is recorded in [testing/full-run-0.18.1.md](testing/full-run-0.18.1.md); report below |
| VII | **Vectors II, masks and vector networks** ([ADR 0143](adr/0143-outline-stroke-smoothing-angular.md) to [0146](adr/0146-vector-networks.md)): outline stroke, tapered lines, corner smoothing, angular gradient, Edit nodes on several paths with a lasso, Divide and the Shape builder, clipping masks, masks by opacity or brightness, brush masks, vector networks | **done (v0.19.0)**: unit and E2E; full suite recorded in [testing/full-run-0.19.0.md](testing/full-run-0.19.0.md) |
| 8 | Scale and compatibility: large projects, search at scale, the qualification matrix, an update-safe origin for a replaced HTML file, a low-memory tier, startup benchmarks | **done** (v0.21; [testing/phase-8.md](testing/phase-8.md)). 60 and 120 FPS on reference devices other than the owner's machine stay unmeasured |
| 9 | Standalone release: reproducible build, offline completeness, clean-machine test, portability ([testing/phase-9.md](testing/phase-9.md)), README and licences, the release artifact | **done**: every release carries the single file ([ADR 0175](adr/0175-releases.md)); PDF page rendering and other 3D formats are not planned |
| 5s | Sheets ([ADR 0108](adr/0108-sheets.md)): container with clipping, Sheet tool, put on a sheet, Layers rows and clip toggle | **first slice done (v0.17.0)**: E2E in both browsers; real units, constraints, auto layout next |
| 5v+ | SVG in and out, dashes, node snapping, dragging a number's name, only a picked shape moves ([ADR 0107](adr/0107-svg-dashes-node-snapping-scrub.md)) | **done (v0.17.0)**: unit and E2E; two-browser sweep of the affected specs (see the commit); full suite not run |
| PV | Painting view ([ADR 0164](adr/0164-brush-engine-webassembly.md) to [0169](adr/0169-brush-presets.md)) | **removed (v0.37.0, [ADR 0170](adr/0170-painting-view-removed.md))**: built to P4 slice 1 (v0.36.0), then discontinued by the owner |
| 5 | Creative editing, including **arrange selected items in a grid (A–Z, Z–A, by date, size, type), align and distribute** | **done** ([ADR 0036](adr/0036-arrange-align-distribute.md)) |
| WF | Workspace folder and the desktop app ([ADR 0177](adr/0177-workspace-folder-desktop-app.md)): Electron shell, the workspace as a folder of files, encrypted hidden items, outside changes; Linux packages (AppImage with updates, `.deb`, `.rpm`, `.tar.gz`, x86_64 and aarch64) | **done** (v0.49.0; packages v0.50.33 to 0.50.35) |

## v0.50.44: the library index in parts (2026-10-29)

**Implemented:** the desktop app's library index in `.canvast/library/` (an index and sixteen parts by hash; only changed parts are written and read), `library.json` kept as a marked copy for older versions up to 10,000 items, changes by an older version taken, workspaces of earlier versions read and converted ([ADR 0179](adr/0179-library-in-parts.md)). The online copy: `.github/workflows/pages.yml` puts each release's checked `canvast.html` on GitHub Pages.
**Tested:** the whole desktop spec (13 passed), unit suite; the built file served over HTTP loads in Chromium and Firefox with no other request and no error.
**Known failures:** none.
**Unverified:** a library over 10,000 items on disk (not measured after this change); an older app version and this one on the same workspace through a real sync tool (simulated in the test by writing `library.json` by hand); the Pages workflow until its first run.
**Committed:** on `main`, not pushed.
**Next bounded task:** coverage-based test selection; for very large libraries, an in-memory list of changed items so a save does not read the whole catalog.

## v0.50.40 to v0.50.43: undo re-selects, font cards, search keywords, saved searches, delete at once (2026-10-29)

**Implemented:** undoing a delete brings the items back selected (every kind); a font's card on the canvas shows "Aa" in the font; library and canvas search keywords (`kind:`, `is:`, `uses>`, `date:`, `on:`, `folder:`, `note:`, `field:`, `duration>`; `group:`, `in:`, `fill:`, `stroke:`); saved searches in both search boxes ([ADR 0178](adr/0178-saved-searches.md)); *Delete library files at once* (desktop); CI reports failed tests as annotations.
**Tested:** unit suite (all passed); the specs each change reaches, in Chromium and Firefox (desktop spec for the desktop setting), from snapshots.
**Known failures:** none new. A `library · chromium` job failed once on GitHub (a96696d) and passed on the re-run; its log could not be read here.
**Unverified:** the saved-search chips and the save button on a narrow screen; `duration>` on a large library (lengths are read from each media file once).
**Committed:** on `main`, not pushed.
**Next bounded task:** the library index in parts (v0.50.44).

## v0.50.34 to v0.50.39: packages and tests on GitHub, the viewer's player, a tidier repository (2026-10-29)

**Implemented:** release packages built on GitHub (x86_64 and aarch64) and the end-to-end suite on GitHub by group and project; the viewer's player floats over the picture and fades (Hide the player setting); its hide/show-controls button beside the details button; Show in file manager (desktop); the version in the window and tab titles; stale workflows, plans, spike code and notes removed.
**Tested:** the specs each change reaches, in Chromium and Firefox (desktop spec for the desktop changes), from snapshots; the whole suite on GitHub.
**Known failures:** two library tests and one reveal test have failed once each on GitHub and passed on the next run (on the backlog).
**Unverified:** Gear Lever's own update button.
**Committed:** on `main`.
**Next bounded task:** owner review.

## v0.50.33: Linux packages, a new README, GPL v3 (2026-10-29)

**Implemented:** `package-desktop.mjs` makes the AppImage, `.deb`, `.rpm` and `.tar.gz` for the machine's architecture, starts the AppImage and the unpacked tarball, and lists the `.deb` and `.rpm` for the app and its menu entry; `release.mjs` uploads them all with their SHA-256; `.github/workflows/release-arm64.yml` builds and adds the aarch64 ones on an ARM runner; `scripts/hidden-items.mjs` (decrypt and encrypt); the README reorganized; the licence is the GPL v3 or later.
**Tested:** the hidden-items tool against a workspace the app encrypted (desktop spec: decrypt, wrong password, encrypt then listed and read by the app); the release notes unit test.
**Known failures:** none.
**Unverified:** the packages until rpmbuild is installed here; the aarch64 workflow until the repository is public (ARM runners); an AppImage update through zsync until the releases can be reached without signing in.
**Committed:** on `main`.
**Next bounded task:** package and release 0.50.33; make the repository public.

## v0.50.32: AppImage updates (2026-10-29)

**Implemented:** `package-desktop.mjs` writes the update information (`gh-releases-zsync|<owner>|<repo>|latest|canvast-*-x86_64.AppImage.zsync`) into the runtime's `.upd_info` section, reads it back, and makes the `.zsync` with zsyncmake; `release.mjs` uploads and checks it.
**Tested:** packaged and started; the update information read back with readelf; an update from the 0.50.31 AppImage with zsync against the published release.
**Known failures:** none.
**Unverified:** Gear Lever's own update button.
**Committed:** on `main`.
**Next bounded task:** owner review.

## v0.50.31: font samples, no second password after an import (2026-10-29)

**Implemented:** `src/ui/font-specimen.ts` (one sample for the details and the viewer: the font loaded once per file under its own family, the last six kept); the inspector's preview and the viewer show it for a font file; the start right after an import (desktop) skips the lock screen once (`stayUnlockedOnReload` / `takeStayUnlocked`, session storage of that window).
**Tested:** the font spec in `text.spec` (Chromium) and the backup import spec in `desktop.spec` (with a workspace password set before the import), from a snapshot.
**Known failures:** none.
**Unverified:** Firefox.
**Committed:** on `main`.
**Next bounded task:** owner review.

## v0.50.30: the logo as chosen (2026-10-29)

**Implemented:** the owner's chosen drawing (the filled Tunnel concept, 24-unit grid) scaled exactly to the 64 grid in `scripts/brand/pages.mjs` (frame 34.67 r9.53, window 19.93 r5.89 set low and right, dot 6.93 r1.91 in the window's middle), `src/ui/brand.ts` and the favicon; no small master, no line version; pages, board recursion (off-centre dot), kit, cover and social preview made again.
**Tested:** the rendered tile matches the owner's SVG pixel for pixel (ImageMagick compare, 0 differing pixels at 256 px); the About and workspace-password specs in `settings.spec` (Chromium, from a snapshot).
**Known failures:** none.
**Unverified:** Firefox; the desktop AppImage was not packaged again.
**Committed:** on `main`, not pushed.
**Next bounded task:** owner review; push and release when they say so.

## v0.50.29: the logo, filled (2026-10-29)

**Implemented:** the mark is a solid canvas (32 units, radius 8) with the dot at its centre (8 units, radius 2) on the 64 grid, in `scripts/brand/pages.mjs`, `src/ui/brand.ts` (one colour, dot cut out) and `src/index.html`; no small master, no line version; the board's construction draws the canvas and the dot with the Shape tool; misuse examples redone; the kit, cover and social preview made again.
**Tested:** the About and workspace-password specs in `settings.spec` (Chromium, from a snapshot). The board was built in the app and its pages and the icons at 16 to 512 px checked by eye.
**Known failures:** none.
**Unverified:** Firefox; the desktop AppImage was not packaged again.
**Committed:** on `main`, not pushed.
**Next bounded task:** owner review; push and release when they say so.

## v0.50.28: a new logo (2026-10-29)

**Implemented:** the Tunnel mark (frame 40, window 20, dot 10 on the 64 grid; radii 12, 6, 3) in `scripts/brand/pages.mjs` and `src/ui/brand.ts`, the 16 px master in `src/index.html`, a line version in the logo files; guideline pages redrawn (ideas, construction built with *Subtract*, misuse, cards as the app's panels); the README cover redrawn as a default-theme canvas (`cover.mjs`, with a 2:1 height for the social preview); the kit in `docs/brand/` made again.
**Tested:** the About and workspace-password specs in `settings.spec` (Chromium, from a snapshot): 2 passed. The board was built in the app and its pages checked by eye.
**Known failures:** none.
**Unverified:** Firefox; the desktop AppImage's icon (made from `icons.mjs` when packaged) was not packaged again.
**Committed:** on `main`, not pushed.
**Next bounded task:** owner review of the logo and cover.

## v0.50.27: a faster big library (2026-10-29)

**Implemented:** `storedStub` (folder-file records without `blob`), `AssetCatalog.healStubs` (once, at start); `LibraryMirror.writeJson` reuses the write's read; `seen()` fingerprints in the mirror state; the library search filters `sortedAll()` (sorted once per listing and sort) and caches each item's lower-case name and tags.
**Tested:** see the commit. Benchmark (desktop, fake items, files absent): 20k: open 3.0 s, list 0.9 s, save after one rename 2.1 s, search 0.7 s; 100k (before the search change): open 8.0 s, list 4.5 s, save 9.8 s, `library.json` 29 MB, heap 342 MB.
**Known failures:** none.
**Unverified:** 500k. A change still reads and rewrites the whole library: incremental writes and a split `library.json` are the next step.
**Committed:** on `main`, not pushed.
**Next bounded task:** incremental library writes (only changed items), split `library.json`.

## v0.50.26: a file put in .hidden/ asks for the password (2026-10-29)

**Implemented:** `FolderHandlers.hiddenNeedsKey` → `askHiddenPassword` (LibraryMirror.askKey, WorkspaceMirror.askHiddenKey); main's folder import logs a file it could not take.
**Tested:** hidden-items desktop test: dropped while locked → the password prompt names it → given → sealed; locked-picture test.
**Known failures:** none.
**Unverified:** the app's window is not brought to the front when it asks (the person may be in the file manager).
**Committed:** on `main`, not pushed.
**Next bounded task:** search keywords (owner to choose).

## v0.50.25: told each time a file is put in .hidden/ (2026-10-29)

**Implemented:** `scanHidden(tellAgain)`, set when the watcher reports a readable file in `.hidden/`.
**Tested:** the hidden-items desktop test drops a file while locked (the notice), then opens the items (sealed).
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** search keywords (owner to choose).

## v0.50.24: one search panel (2026-10-29)

**Implemented:** `ui/search-parts.ts` (`searchWaysHtml`, `searchHelpLineHtml`, `searchKeysHtml`) used by the canvas search and the library search; Esc leaves the library search box.
**Tested:** library search test checks the shared parts and Esc (chromium, firefox); search tests chromium 6/6.
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** new search keywords (owner to choose).

## v0.50.23: back to top (2026-10-29)

**Implemented:** `assets-to-top` in the status bar's controls (`arrowUpToLine`, registry row), shown when `scrollTop >= clientHeight`.
**Tested:** the big-library test uses it after End (first card in view, button gone); icon audit; chromium and firefox 4/4.
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** "Aa" on a font's card on the canvas.

## v0.50.22: resizable list columns, a remembered thumbnail size (2026-10-29)

**Implemented:** `.col-resize` in each list header (pointer drag, double-click resets), `ui.colW` (into `--cols`), `ui.thumb`; `COL_W_MAX`.
**Tested:** the list-columns test resizes a column (not a sort), sets the thumbnail size, reloads, both kept (chromium, firefox 2/2).
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** "Aa" on a font's card on the canvas.

## v0.50.21: fonts show their letters (2026-10-29)

**Implemented:** `isFontFile`, `hasThumb` (file-kind.ts); `makeFontThumb` (FontFace, "Aa" in light letters, PNG); library cards and filmstrip show it (`.is-font-thumb`, `--font-thumb-filter` per theme, no chequered ground).
**Tested:** the font import test checks the library card's "Aa" thumbnail loads; card tests; chromium and firefox 4/4.
**Known failures:** none.
**Unverified:** a font card placed on a canvas still shows the file card (the canvas draws cards itself): next step.
**Committed:** on `main`, not pushed.
**Next bounded task:** "Aa" on a font's card on the canvas.

## v0.50.20: a folder for each kind of file (2026-10-29)

**Implemented:** `kindFolder` by extension first (`KIND_EXTS`), then by type; `KIND_FOLDERS` holds the twelve kinds (owner chose the full set).
**Tested:** unit test of the kind folders (8/8 in the file).
**Known failures:** none.
**Unverified:** moving an existing workspace's files into the new kind folders (done by the next library write, as any move).
**Committed:** on `main`, not pushed.
**Next bounded task:** font preview (Aa) in the library and on the canvas.

## v0.50.19: the player no longer covers the video (2026-10-29)

**Implemented:** `--viewer-media-h` (the player's height, observed); with the player shown, `--viewer-bottom` makes room for it and `.viewer-hide` sits above it.
**Tested:** the GIF viewer test checks the picture ends above the player and the hide button is above it; viewer and media tests chromium and firefox 34/34.
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** folders by file kind (proposal), font preview.

## v0.50.18: the library keeps its filters (2026-10-29)

**Implemented:** `ui.filters` (usage, sort, reversed, scope) saved by `keepFilters` on each render; `NO_FILTERS`; reset button (`funnelX`, registry row added); `.assets-btn[hidden]`.
**Tested:** new organize test (kept over a reload, reset), icon audit, chromium and firefox 4/4.
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** media player bar over the video in the viewer.

## v0.50.17: files put back show at once (2026-10-29)

**Implemented:** an outside change under `library/` (or a readable file in `.hidden/`) rescans and then always lists the library again. Audit: the folder is followed by events only (no polling); followed live: library files, `library.json`, `hidden.json`, `workspace.json`, canvas files, `.hidden/`.
**Tested:** the outside-changes desktop test now puts a deleted file back while the app runs (present again); follow test passes.
**Known failures:** none.
**Unverified:** a deleted item whose picture the canvas's undo can still bring back keeps its file until restart (by design: undo needs it).
**Committed:** on `main`, not pushed.
**Next bounded task:** library filters remembered + reset button.

## v0.50.16: a moved workspace keeps its password (2026-10-29)

**Implemented:** `WorkspaceMirror.adoptLocks` (folder passwords into the app's storage before the lock check, never removing one); `LibraryMirror.scanHidden` (readable files in `.hidden/` imported in place as hidden items, then sealed; a copy of a known item erased; a notice while locked); `frame.place` default off; Enter opens the selected item in the viewer.
**Tested:** new desktop test (password set, folder moved and renamed, reopened on the same device: lock screen; fails without the fix), hidden-items test extended (a dropped readable file sealed), viewer and extract tests in chromium and firefox; desktop spec 13/13 (before the .hidden change), hidden tests after.
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** realtime updates of the workspace folder (deleted extracted frame, restored file).

## v0.50.15: put the library's sections in your order (2026-10-28)

**Implemented:** `ui.sections` (saved with the library layout), `SIDE_SECTIONS`; section heads draggable (`application/x-canvast-section`), `.drop-zone` on the other sections, Alt+Up/Down on a section's name; `renderSide` puts the sections in that order.
**Tested:** organize sidebar test: Alt+Up, a drag, and the order over a reload (chromium, firefox).
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** owner's feedback; push and release when asked.

## v0.50.14: one look for lists of boards and drop places (2026-10-28)

**Implemented:** the Place on… menu renders the navigator's `.nav-board` markup, its menu rules scoped to `.place-menu` too; `.drop-zone` / `.is-drop-target` for the strip and every sidebar row `takesDrop` accepts.
**Tested:** Place on…, switcher and drag tests (the drag test checks the sidebar targets are marked), chromium and firefox 6/6.
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** owner's feedback; push and release when asked.

## v0.50.13: the filmstrip finds the open item (2026-10-28)

**Implemented:** `centreFilm` sizes the strip (`windowFilm`) before it scrolls.
**Tested:** the big-library test opens the last item in the viewer and checks its film item is in view (chromium, firefox 4/4 with the viewer test).
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** owner's feedback; push and release when asked.

## v0.50.12: many boards, thumbnails ready (2026-10-28)

**Implemented:** `ui/board-filter.ts` (search + folding, `FOLD_FROM` 4) used by the navigator menu and the Place on… menu; `fillThumbs` in the library (`CatalogStore.thumbHashes`, background `thumbFor` jobs), `THUMB_MAKERS` 6.
**Tested:** new storage test (6 boards: folded, search, unfold), Place on… and big-library tests, chromium and firefox 8/8.
**Known failures:** none.
**Unverified:** background thumbnails on the owner's 2,466 files (time to finish, memory).
**Committed:** on `main`, not pushed.
**Next bounded task:** owner's feedback; push and release when asked.

## v0.50.11: narrow panels never cut (2026-10-28)

**Implemented:** `:is(.assets-side, .asset-inspector)` overflow-x hidden, every descendant `min-width: 0; max-width: 100%`, button labels ellipsis.
**Tested:** the panel-width test now also checks both panels at their narrowest have no sideways overflow (chromium, firefox 2/2).
**Known failures:** none.
**Committed:** on `main`, not pushed.
**Next bounded task:** Place on… menu for many boards.

## v0.50.10: drag from the library to place (2026-10-28)

**Implemented:** a drag image of up to `DRAG_STACK` (5) thumbnails and a count (`.drag-stack`); `.assets-place-zone` at the top while dragging (drop: `askPlaceTags` then `session.placeAssets`, the library stays open); the edge handle takes no space back in the viewer.
**Tested:** organize spec's drag test extended (dropped on the strip: placed, the library still open), chromium and firefox 2/2.
**Known failures:** none.
**Unverified:** how the stack looks while dragging (a drag image is not in screenshots).
**Committed:** on `main`, not pushed.
**Next bounded task:** owner's feedback.

## v0.50.9: smooth panel edges, one scrollbar style (2026-10-28)

**Implemented:** `.is-resizing-side/-insp` (panel at `--drag-w` over a slot of `--slot-w`, grid `will-change: transform; contain: strict`); grip in a single gap; `:where(*) { scrollbar-width: thin }`. Profile (600 items, Chromium): frame p90 50 ms → 33 ms while dragging.
**Tested:** see the commit.
**Known failures:** none.
**Unverified:** the drag in the owner's 2,466-item library.
**Committed:** on `main`, not pushed.
**Next bounded task:** the owner's start-up timings with 0.50.8+.

## v0.50.8: the library lists at once (2026-10-28)

**Implemented:** `externalFolder.hasMany` (sizes from `Dir.sizes`, the bridge's `canvast:sizes` with `lstat`, one call) replaces a read of every file in `AssetCatalog.list`; the library's view controls inside its status bar.
**Tested:** see the commit. Owner's console before: library listed 11.5 s after the rest of the start.
**Known failures:** none.
**Unverified:** the owner's start after the fix.
**Committed:** on `main`, not pushed.
**Next bounded task:** the owner's start-up timings with 0.50.8.

## v0.50.7: a start screen, one word for each thing, smoother library (2026-10-28)

**Implemented:** user-visible strings and the README say selected / select / the selection, file / files, info bar (owner's choice; Sheet stays; code names unchanged). A start screen (`openStartScreen`, `ui/busy-screen.ts`) until the session has started, its steps from `startStep` (`app/startup-log.ts`), also logged with times. Panel edges: no layout while dragging. Library cards kept 3 screens beyond the view, known thumbnails decoded before paint. Open in default app (`OriginalStore.fileOf`, bridge `openFile`). The library status bar is `.hud-bottom`.
**Tested:** wording specs in chromium (bookmarks, archive, files, pictures, assets, library-folder, pattern: 120 then the 4 fixed), panel/big-library/file tests, desktop spec 12/12.
**Known failures:** none.
**Unverified:** strings built from pieces that the pass could not see (a word split across template parts).
**Committed:** on `main`, not pushed.
**Next bounded task:** the start-up time of a 2,500-item workspace.

## v0.50.6: smooth panel resizing in the library (2026-10-28)

**Implemented:** a dragged panel edge (`.col-grip`, `assets-view.ts`) sets the width once a frame and lays the cards out at most every `RESIZE_LAYOUT_MS` (120 ms), then once on release; the grid's ResizeObserver waits while an edge is dragged.
**Tested:** the panel-width and big-library assets tests in chromium and firefox (4/4).
**Known failures:** none.
**Unverified:** how smooth it feels in the owner's 2,465-item library.
**Committed:** on `main`, not pushed.
**Next bounded task:** common terms (selected, files, info bar) across the app.

## v0.50.5: an import writes its files straight into the workspace folder (2026-10-28)

**Implemented:** `OriginalWriter` (archive.ts): `stageOriginals` hands each batch's originals that are not hidden to it and stores only their file (`ext: 1`); the desktop build sets `IdbBackups.writeOriginals` to `LibraryMirror.writeOriginals` (written by kind and name without a flush each, checked by hash, one `syncFiles` per batch; the next library write moves each to its library folder).
**Tested:** desktop spec (see the commit).
**Known failures:** none.
**Unverified:** an import that fails after its files are written leaves them in `library/`, where the folder's look-through imports them as new items; the owner's 2,510-file backup end to end.
**Committed:** on `main`, not pushed.
**Next bounded task:** the owner's import, then the start-up time of a 2,500-item workspace.

## v0.50.4: the lock screen answers at once, one window per workspace (2026-10-28)

**Implemented:** the lock screen checks against the lock read before it opened (`checkLock`), with a *Checking…* state; the close handler returns at once until the session has started; `holdWorkspace` in `desktop/main.ts` (a pid file per workspace in the app's data folder; a running canvast holding it is waited for 20 s, then asked about).
**Tested:** desktop spec and the workspace password test (see the commit).
**Known failures:** none.
**Unverified:** the second start while the first is closing (native dialog, no E2E); why the owner's workspace takes about 15 s to open (2,510 items) and longer right after an import.
**Committed:** on `main`, not pushed.
**Next bounded task:** time the start-up of a 2,500-item workspace and remove what blocks it.

## v0.50.3: import and export questions you can read at a glance (2026-10-28)

**Implemented:** `DialogSummary` (facts, a titled list, warnings) for `confirmDialog` and `chooseDialog` (`ui/confirm.ts`); the import dialog (`ui/archive-ui.ts`) and the passwords and privacy question (`ui/hidden-access.ts`) use it.
**Tested:** archive and library-folder specs in chromium and firefox (26 tests, wording assertions updated); unit 587/587 earlier this session.
**Known failures:** none.
**Unverified:** the owner's lock screen not opening after importing their backup on 0.50.2 (not reproduced with 2,500 pictures, hidden items and both passwords); waiting for their console output.
**Committed:** on `main`, not pushed.
**Next bounded task:** the lock screen after the owner's import.

## v0.50.2: faster import into a workspace folder (2026-10-28)

**Implemented:** an import's files are written without a flush each (`write(path, bytes, { durable: false })`), then `canvast:syncFiles` (`sync -f` on Linux, else a flush per file) once per 100, and only then the app's copies let go, in one transaction (`writeNew`, `keepWritten` in `library-mirror.ts`).
**Tested:** desktop spec 12/12. Spinning disk: 1,168 imported files written in 10.4 s (about 112 a second).
**Known failures:** none.
**Unverified:** a side-by-side run of the old and new build on one backup (stopped for time); the owner's 2,510-file backup.
**Committed:** on `main`, not pushed.
**Next bounded task:** the owner's blank window after a big import.

## v0.50.1: a new folder is a new workspace, the folder watched per folder, a calmer library wait (2026-10-28)

**Implemented:** in the desktop app, each workspace folder has its own id (`.canvast/folder.json`); the storage partition is per path and id (`partitionOf` in `desktop/main.ts`, recorded in the app's `partitions.json`), so a new folder where a deleted one was never opens the deleted one's cache, which is cleared; folders from before keep theirs. On Linux the folder is watched per folder (`watchTree`) instead of Node's recursive watch, which watched every file and read a folder again synchronously on each change. Loading thumbnails share one soft wave (fixed to the window, `--thumb-glint`). Settings > Storage's workspace card: the path as a Folder line, one short line, Switch workspace as the other buttons, where deleted files go as a standard settings row.
**Tested:** desktop spec 12/12 (the same-path case added); library-folder, storage Settings and the virtual-library assets spec in chromium and firefox 16/16; unit 587/587.
**Known failures:** none.
**Unverified:** a folder opened by this build after an older build had cached a deleted workspace at the same path (logic only). The blank window for about 2 minutes after importing a backup of 2,510 files: not reproduced with 1,500 generated pictures; the watcher cost fixed here grows with the folder but did not reach minutes.
**Committed:** on `main`, not pushed.
**Next bounded task:** reproduce the blank window after a big import (the owner's backup has hidden items and both passwords).

## v0.50.0: hidden items always a padlock, an eye on passwords, fields in any order (2026-10-28)

**Implemented:** every password field (prompt and lock screen) has an eye button that shows and hides what was typed (`secretFieldHtml`, `wireSecretFields` in `ui/confirm.ts`). A hidden library item's pictures are a padlock on every canvas, in both builds and whatever the password state (`AssetLibrary.setHidden`, `CatalogStore.hiddenHashes`, synced in `main.ts` on library changes but not on canvas commits); hidden media do not play. Note fields move by a grip (drag, or Up and Down on it), the order stored. Fixed: after a restart, Similar images read a locked hidden item's thumbnail and the library kept the failure, so its card and details stayed blank until a reload; hidden items are no longer read for looks, failed thumbnails are tried again on the next library read, and the library is read again when the hidden items open or lock.
**Tested:** unit 587/587; every group in `chromium` and most in `chromium-cpu`/`chromium-dpr2` (746 tests, 0 failed; the run was stopped there as too long for the change); desktop, organize and settings in `desktop` and `firefox` 40/40 (snapshot 6d2eeb5f). New desktop test for the thumbnail fix fails on the old code. `chromium-dpr2` and `firefox` not run for the drawing, rendering and pictures groups (code they test changed only by a lookup in `AssetLibrary.get`).
**Known failures:** none.
**Also in v0.50.0 (after the first commit):** the details say where an item is used once and fold long lists; one Delete button; long sidebar lists fold; a library status bar (the canvas's readout and controls reused); a shimmering place for thumbnails still loading; in the desktop app, a busy screen while an import's files are written (then the app reloads), a guard on closing mid-write, the folder writes about 1.7 times faster on a spinning disk (6 at a time, relaxed record commits, a file already in place taken by its content), and Switch workspace (recent, open, new, a gone one off the list; File menu; a start dialog when the last folder is gone). Measured on a spinning disk, 300 pictures of about 215 KiB: import with folder writing 47.9 s before, 32.1 s after (folder writing about 38 s to 22 s).
**Unverified:** the eye button and the grip on a touch screen; the start dialog when the last workspace folder is gone, and the close guard while files are written (native dialogs, no E2E); the AppImage build of these changes.
**Committed:** on `main`, not pushed.
**Next bounded task:** choose specs by what they run (per-spec coverage of the source), so a small change in a shared file does not run every group.

## v0.49.0: the desktop app, merged into main (2026-10-28)

**Implemented:** ADR 0177 steps 1 to 6 (see the step sections below), plus, before the release: the boards and canvases moved into `.canvast/boards/` (owner: canvas files are not edited by hand; a workspace with them at the top is moved in when opened); the app may reload itself in Electron (Delete all data hung); in the desktop app Settings describes the workspace folder (Storage, Privacy, About, Develop), *Start from scratch* is *Rebuild from the folder* (clears only this device's working copy, keeps the settings, writes pending edits first), and the browser-format library index is no longer written; a package that fails its start check is deleted; stopped test runs no longer keep their snapshots. Testing moved to **groups** (`test:affected`, `test:group`, `check:groups`; docs/testing/README.md).
**Tested:** the groups the branch needs, on the release source (snapshot 79c9d19b): desktop, storage, interface, library 263 passed, 10 skipped (12.7 min); smoke 10 passed, 2 skipped (49 s). Earlier on the branch (snapshot 266c5b7b): storage, library, desktop, pictures, interface, smoke 430 passed, 1 failed under load from a parallel packaging run, which passed alone (efbeca81). Not run: navigation, drawing, rendering and packages (code they test did not change), and the full stress lengths (no zoom, coordinate or rendering change). Unit 587/587.
**Known failures:** none known.
**Unverified:** the system trash choice; the save dialog of an export in the desktop app (the test gives the download a path); the desktop app outside Linux.
**Committed:** fast-forwarded into `main`; released as v0.49.0 with the AppImage.
**Next bounded task:** ask the owner: spike code removal, outside edits of library files (wait for a file that is still being written; an edited file: take it, keep the old one in `.trash/`), the follow-up for `test:affected` (judge shared files by what changed in them).

## Workspace folder, step 5: deleting and changes from outside the app (branch `workspace-folder`, 2026-10-28)

**Implemented:** [ADR 0177](adr/0177-workspace-folder-desktop-app.md) "Deleting" and "Changes from outside the app". 5a: Settings > Storage (the workspace folder card) chooses where a deleted file goes: `.trash/` (the default), the system trash (`shell.trashItem`), or for good. It applies to originals erased by garbage collection and to deleted canvases and boards. 5b: `LibraryMirror.scan` looks through `library/`. A file whose content (SHA-256, hashed in the main process) is an item whose file is gone is relinked: the item takes the library folder of its folder and, when renamed, the new name. Any other new file is imported where it lies (`importFileDetailed(..., at)`), into the library folder of its folder (made when there is none). Partial and temporary files are left alone, and a deleted file shows as missing. The scan waits for start-up to finish. 5c: the main process watches the folder (`fs.watch`, recursive, one message a second after the last change). Library paths re-run the scan (skipping the app's own recent writes), `library.json` or `hidden.json` from a sync re-read the index, and canvas files and `workspace.json` run `WorkspaceMirror.recheck`. That takes another device's tree, follows canvas files and board folders renamed or moved by hand (`followMoved`), and reconciles each canvas as at start-up. The session reloads the open canvas, keeping its camera. Before writing a canvas file, the mirror now checks its header: a file another device changed meanwhile is never overwritten, but compared (a conflict copy).
**Tested:** `desktop.spec.ts` 9/9 and 18/18 repeated twice (snapshot 853f411e). New tests: files changed in a file manager between runs (rename into a new folder, a new file, a partial download, a deleted file), and following the folder while running (a canvas file renamed by hand, a file dropped into `library/`, two devices open at once: one's edits loaded again on the other, both sides' edits giving a conflict copy). The boards/canvases test now waits for the stored object before closing: "verified" could be the status from before the import, which failed it twice under load. Bugs found by these tests and fixed: the start-up scan ran before `library.json` was read (a new device imported known files again and made duplicate folders); filtering the app's own recent writes by path also hid another device's write to the same canvas file; and the mirror wrote a canvas file over another device's newer version, losing its edit. Unit 583/583; in Chromium and Firefox: storage and archive 38/38, assets, library-folder and storage 71 (Chromium) and 10 passed, 8 skipped (Firefox).
**Known failures:** none known.
**Unverified:** the quick and full suites; the system trash choice (not run in tests, to keep the real trash clean); `fs.watch` on Windows and macOS; a `.cvst` dropped in from elsewhere (an id the workspace does not have) is left alone; very large libraries (each outside change in `library/` lists the whole folder).
**Committed:** on branch `workspace-folder` (see the commits).
**Next bounded task:** step 6: the AppImage in the release pipeline, README and Limitations for the desktop app, ADR 0177 accepted; then the merge into `main` with a version bump.

## Workspace folder, step 4: encrypted hidden items (branch `workspace-folder`, 2026-10-28)

**Implemented:** [ADR 0177](adr/0177-workspace-folder-desktop-app.md) "Hidden items: the design", with the owner's answers G (a password before the first hide), H (a padlock while locked) and I (no readable picture anywhere). 4a: `hidden-vault.ts`: a random AES-GCM data key, wrapped (AES-KW) by the Hidden password stretched with PBKDF2-SHA-256 (600,000 iterations); sealed files are an IV plus ciphertext; a new password re-wraps the same key; bridge `erase`. 4b: `Storage.hidden` (`hidden-store.ts`, `.canvast/hidden.json`): the right Hidden password opens the key (`session.checkPassword`), a new one re-wraps it, removing it is refused while items are hidden, and a password set before the key makes the key on first use; hiding in the desktop build asks for a password first or for the password when locked. 4c: `LibraryMirror` seals a hidden item into `.hidden/<random>.bin`, reads it back and opens it to prove it, erases the readable file and drops its thumbnail; showing opens it back into its place; sealed items are only in the sealed index, which another device reads when the password is given there; hiding while locked waits for the key; reads open sealed files in memory; thumbnails of hidden items are not stored. 4d: a hidden picture on a canvas shows a padlock while locked; *Lock hidden items* forgets the key and drops decoded hidden pictures.
**Tested:** `desktop.spec.ts` 7/7 (snapshot d859c0a3). The hidden-items test checks that no file in the folder holds the name or the picture, the second device, wrong and changed passwords, removal refused, showing back, hiding while locked, and lock and unlock from the command palette. It fails when locking keeps the decoded picture (tried). An earlier run caught two bugs: a shown item took the `.bin` extension, and hiding while locked dropped the item from `library.json` before it was sealed. Unit 583/583 (`hidden-vault.test.ts`: wrong password, tampering, re-wrap). In Chromium and Firefox: organize, library-folder, storage and archive 78 passed, 8 skipped (b833e6e0). In Chromium: assets and pictures 86/86 (d859c0a3).
**Known failures:** none known.
**Unverified:** the quick and full suites; the "set a password first" dialog was not driven by a test (the tests set the password through the session, as Settings does); a texture fill that uses a hidden picture while locked; deleting a hidden item while locked leaves it in the sealed index until the next write with the key.
**Committed:** on branch `workspace-folder` (see the commits).
**Next bounded task:** step 5: delete options (`.trash/`, system trash, permanently) and changes from outside the app (watching, relinking by hash).

## Workspace folder, step 3: the workspace format (branch `workspace-folder`, 2026-10-28)

**Implemented:** the on-disk format of [ADR 0177](adr/0177-workspace-folder-desktop-app.md) (approved A–F). IndexedDB stays the only place the app's logic works on (journal and cache); the desktop build's storage wraps it so the folder follows each change about 2 s later and when the window closes. 3a: one canvas JSON codec for backups and `.cvst` files (`archive.ts` `canvasJson`/`readCanvasData`, `canvas-file.ts`). 3b: `WorkspaceMirror` writes boards as folders, canvases as `<board>/<canvas>.cvst`, `.canvast/workspace.json` and `.canvast/devices/<id>.json`; renames move, deletes go to `.trash/`. 3c: at start-up the folder wins (a new device opens the whole workspace; a canvas another device changed is read in; both changed: a conflict copy). 3d: `LibraryMirror` (`library-mirror.ts`): each original under `library/<library folder path>/` or `library/<kind>/`, named after its library name; filing or renaming moves the file, a file whose place still fits stays, a move waits for a name another move still holds (so undo puts swapped files back exactly), a move cut short is finished at start-up (journal), library folders are made on disk even when empty and emptied ones are removed; `.canvast/library.json` (one item per line); at start-up each item another device changed is taken unless this device changed it too. A new original being imported and a move never take the same free name (claims in `external-folder.ts`). Bridge: `makeFolder`, `removeEmptyFolder`. 3e: a backup imported in the desktop app is written into the folder: its originals, which an import stores in IndexedDB, are written out as files (read back and compared with the hash) and kept only as files.
**Tested:** `desktop.spec.ts` 6/6 (snapshot c08579eb): library folders (filing, renaming onto a freed name, undo of both, folder rename, `library.json`, a new device gets names, folders and files) and backup import into a new workspace folder (board folder, `.cvst`, `library/<folder>/` file with the same bytes, present after a restart). The undo test failed before the waiting rule for moves (the swapped file got `-2`). Unit 579/579 (placement and `library.json` items); browser library-folder, storage and archive specs in Chromium and Firefox 46 passed, 8 skipped (c08579eb).
**Known failures:** none known.
**Unverified:** the quick and full suites; two devices editing the same library item's tags at once (this device's version wins, the other's is not merged); hidden items are still plain files under `library/` (step 4); a file renamed or moved outside the app is not found again by its hash yet (step 5).
**Committed:** on branch `workspace-folder` (see the commits).
**Next bounded task:** step 4, encrypted hidden items in `.hidden/`.

## Workspace folder, step 2: the desktop shell (branch `workspace-folder`, 2026-10-28)

**Implemented:** an Electron shell ([ADR 0177](adr/0177-workspace-folder-desktop-app.md)): `desktop/main.ts` serves only the built `canvast.html` from `app://canvast/` in a sandboxed, context-isolated window (no Node, no navigation, no new windows, no network), one storage partition per workspace folder, folder from `--workspace=`, the last one opened or a dialog; File > Open workspace folder…. `desktop/preload.ts` gives the page `window.canvastDesktop`: the workspace, and file calls confined to the folder (safe relative paths, no link out), atomic writes (temp, flush, rename), removal into `.trash/`. New library originals are readable files `library/<kind>/<safe name>.<ext>` (`workspace-names.ts`, a `FolderNaming` rule on the library-folder code; the browser keeps hash names). Boards, canvases and library entries are still in the workspace's own IndexedDB (step 3). `npm run desktop`; Electron 44.7.1 (pinned devDependency). Snapshots now build the desktop shell too, and the source hash covers `desktop/`.
**Tested:** `desktop.spec.ts` in the new `desktop` project, 2/2 (snapshot 47b31fa1): sandbox (no require/process, five escapes refused including a symlink out, fetch blocked, only app:/data:/blob: requests) and library files (same bytes once, `-2` on a clash, both read back after a restart). Breaking the link check on purpose fails the first test. Unit 573/573 (external-folder test extended with the naming rule); browser storage, archive, library-folder 27/27 and import tests in Chromium and Firefox 12/12 (f428853b).
**Known failures:** none known.
**Unverified:** the quick and full suites; the desktop shell on Windows and macOS; files of a library folder are not yet moved when an item is filed in a library folder or renamed (step 3).
**Committed:** on branch `workspace-folder` (see the commits).
**Next bounded task:** step 3, the workspace format: boards as folders, `.cvst` canvases, `.canvast/index.json`, safe-write saving, and the move from browser storage.

## Workspace folder, step 1: the storage boundary (branch `workspace-folder`, 2026-10-28)

**Implemented:** the app reaches storage only through `src/storage/store.ts` ([ADR 0177](adr/0177-workspace-folder-desktop-app.md), proposed): `WorkspaceStore` (implemented by `WorkspaceRepo`, which also took the v1 start-up and the tag queries from `Session`), `BackupStore` (`IdbBackups`), `CatalogStore` (`AssetCatalog`), `OriginalStore` (`IdbOriginals`, which took `AssetLibrary`'s reads and writes of originals with the library folder and storage-full handling), `LibraryFolderStore` (browser only) and `Storage.resetAll`. `main.ts` opens it with `openBrowserStorage()` and never holds the database. `npm run check:storage` (in `npm test`, `test:full` and CI) fails on IndexedDB use outside the listed implementation files. No change in behaviour.
**Tested:** per sub-slice on fresh snapshots: storage, archive, library-folder in Chromium 27/27 and tags/core storage in Chromium and Firefox 16/16 (1a, 072bbbeb); assets, library-folder, organize in Chromium 77/77 and Firefox import tests 6/6 (1b, b3a88330); storage and library-folder in Chromium and Firefox 28 passed, 8 skipped (Chromium-only folder tests), archive and asset import/GC 16/16 (1c, f71a3bf6); unit 572/572; the guard fails on a planted violation.
**Known failures:** none known.
**Unverified:** the quick and full suites.
**Committed:** on branch `workspace-folder` (see the commits); no version bump until the branch is merged into `main`.
**Next bounded task:** step 2, the desktop shell (Electron, preload file API, `app://`, workspace picker) with a `FolderStore` for library files.

## Old painting data removed (v0.48.2, 2026-10-28)

**Implemented:** IndexedDB schema 12 deletes the stores `paintings`, `paintLayers` and `paintTiles` left by the removed Painting view (`storage/idb.ts`; [ADR 0170](adr/0170-painting-view-removed.md) amended). The archive import still recognises paintings in old backups and leaves them out with a note.
**Tested:** the v1 migration test in `storage.spec.ts` now also seeds a leftover `paintTiles` store and checks the upgrade removes it: Chromium and Firefox, 2 passed (snapshot 669bfb55). Unit 572/572, typecheck, check:names, check:offline.
**Known failures:** none known.
**Unverified:** the quick and full suites.
**Committed:** this slice (see the commit).
**Next bounded task:** the workspace folder and desktop app proposal (ADR 0177, on branch `workspace-folder`), waiting for the owner's decision; chaining (ADR 0033) is still open.

## Zooming out is never cut off (v0.48.1, 2026-10-28)

**Implemented:** a zoom-out preview whose scaled tile set does not reach every edge draws the objects outside it directly, clipped to that border (`DrawBorder` in `TileCache.preview`, given by `main.ts`); cover checks use the whole tile range a set was built for (`Generation.range`); the idle prebuild makes the level one out first and queries each set once ([ADR 0012](adr/0012-zoom-preview.md) and [0033](adr/0033-idle-prebuild-of-adjacent-zoom-tiles.md) amendments).
**Tested:** reproduced with the showcase (Powers of two, zoom in near Earth, rest about 0.3 s, zoom out): the scaled set covered about 70% of the view. The extended `tiles.spec.ts` preview test fails without the border drawing (30% of the border unlike the exact picture) and passes with it; `tiles.spec.ts` in all four projects on a fresh snapshot of the final source, 40 passed (1.1 min). Both prebuilt sets ready 584/541/658/563/552 ms → 421/410/435/415/444 ms after a zoom step (showcase, headless Chromium).
**Known failures:** none known.
**Unverified:** the quick and full suites; the cost of the border frames on a GPU (headless Chromium on the CPU: about 45-50 ms instead of 22-28 ms for a preview frame).
**Committed:** this slice (see the commit).
**Next bounded task:** chaining (ADR 0033, not done): build the next level while a long zoom gesture continues, so a zoom of several levels has no exact-frame pause (80-120 ms each in the showcase) at each level.

## Notes and fields on library items (v0.48.0, 2026-10-28)

**Implemented:** catalog entries carry an optional plain-text `note` and ordered user-named `fields` (`{ key, value }`), set through `MetaChange` (replacing the stored ones, normalized and bounded in `AssetCatalog`), part of the library undo snapshot; the details panel of one item shows them under Tags and Folder (stored on change; the values being stored are shown until the listing has them, so a redraw never writes old ones back); the library search (All) matches them; archives and the library index carry them, and an import keeps an existing note and adds missing fields.
**Tested:** unit 572 passed (the old-entry defaults test now expects an empty note and fields); extended two `organize.spec.ts` tests (edit, search, remove, reload; archive round trip and double import), in Chromium and Firefox, twice each on a fresh snapshot, 8 passed (1.2 min); before the fix of a redraw race the edit test failed once in Chromium (a field save wrote the old note back). `archive.spec.ts`, the archive and library-undo tests of `organize.spec.ts` in Chromium, 11 passed; the icon audit in both browsers passed.
**Known failures:** none known.
**Unverified:** the quick and full suites; touch screens; several picked items (the note and fields are shown for one item only).
**Committed:** this slice (see the commit).
**Next bounded task:** ask the owner whether a value that is a web address should be a link that opens in a new tab.

## Import a backup of any size (v0.47.2, 2026-10-28)

**Implemented:** an import keeps no bytes in its plan (each original is hashed and let go; the plan holds a slice of the file), writes the originals the store lacks a batch at a time (128 MiB, listed under `meta.importStaged` in the same transaction), then everything else in one transaction that clears the list; `sweepImportStaging` erases listed originals without a library entry when an import fails, before each import and at start (before the catalog is reconciled) ([ADR 0176](adr/0176-batched-import.md)). Export and the `.canvast` format are unchanged: one file.
**Tested:** unit 572 passed; `archive.spec.ts` in Chromium and Firefox, 16 passed and 2 failed (the extended test: the start-up sweep ran after reconcile, which had given the leftovers library entries); after the fix the extended test passed in both browsers on a fresh snapshot (2 passed, 18 s). It imports with one original per batch, stops after the files (nothing left), stops as if the tab closed (the files listed, erased on reload) and imports in full.
**Known failures:** none known.
**Unverified:** memory and time with a real backup of several gigabytes; the rest of `archive.spec.ts` on the final source (it passed on the source before the start-up order change, which touches only start-up); the quick and full suites.
**Committed:** this slice (see the commit).
**Next bounded task:** measure the peak memory of importing a multi-gigabyte synthetic backup in Chromium and Firefox.

## A fast library with thousands of items (v0.47.1, 2026-10-27)

**Implemented:** the library grid and the viewer's filmstrip keep only the items near the view in the page; the card places are worked out in code (`src/ui/library-layout.ts`: justified rows, squares on a phone, list rows) and the cards are positioned in a grid as tall as all of them; keyboard moves, reveal and the scroll anchor use that layout. Thumbnails missing from storage are made three at a time (the screen first, none for a card gone from the page) and at most 3,000 loaded addresses are kept. The filter and sort run once per change (one collator, text keys made once), the sidebar counts once per listing, entries are looked up by hash; search redraws after a 250 ms pause; picture looks are read only while Similar or a look filter is in use. An organization change (`Session.organize`, library undo) reads only the catalog again (`AssetCatalog.relist`), and library-folder files are checked fifty at a time.
**Tested:** unit 572 (2 new, library layout); E2E assets, library-folder, files, organize, a11y, archive, settings and vectors in Chromium and Firefox (372 passed, 2 failed: an organize test that counted every card in the page, changed to the library count); then organize, assets (one new test: 3,000 items) and a11y in both browsers on a fresh snapshot, 146 passed (6.9 min). A local measurement with 20,000 seeded items (Chromium, headless): opening 11.1 s → 1.0 s, wheel scrolling about 2 → 60 frames a second at the top, half way and at the end, typing six letters 15.9 s of stalls → none, Ctrl+A 19.4 s → under 0.1 s.
**Known failures:** none known.
**Unverified:** the quick and full suites; a real library of many thousands of different originals (the measurement used one shared thumbnail and no originals); touch scrolling on a phone.
**Committed:** this slice (see the commit).
**Next bounded task:** a jump of several screens at once (dragging the scroll bar) still makes about 60 picture addresses per frame (about 55 ms); reusing addresses or decoding off the main thread would smooth it.

## The logo, and OKLCH in the colour picker (v0.47.0, 2026-10-27)

**Implemented:** the logo and its guidelines (`scripts/brand/`; favicon in full colour, the one-colour mark in the app, a designed lock screen, prompt fields like Settings); the colour picker's OKLCH model replacing OKHCL, its `theme` option, and a dark `color-scheme`; README cover and screenshots made again, with new pictures for the Pattern panel, the colour picker and text.
**Tested:** the colour picker's own unit and E2E specs were run in the slices that made it; no suite was run for this release as a whole.
**Known failures:** none known.
**Unverified:** the full suite on this version; the lock screen on a touch screen.
**Committed:** the slice commits and the release commit (see the log).
**Next bounded task:** the Styles and Adjust pictures in the README; whether drawing a sheet should take the rest of a group when only one member lies inside it.

## Hidden library items and passwords (v0.46.0, 2026-10-27)

**Implemented:** Rename in the canvas context menu; a `hidden` flag on library items with a Hidden list opened by a word typed in the library search; a password gate for the Hidden items and one for the whole workspace (a lock screen before the workspace is read), both salted PBKDF2 hashes kept in the browser's catalog (no encryption); export questions for hidden items and for passwords and privacy settings; the library index leaves hidden items out.
**Tested:** `organize.spec.ts` (hiding, the word, the password, the export questions, keep-open), `settings.spec.ts` (the lock screen), `archive.spec.ts` (a workspace password in a backup, left out and included, and an import that sets it where there is none), `assets.spec.ts` (the metadata fold): organize, archive, settings and assets specs in Chromium, 91 passed; the new and changed tests in Firefox, 4 passed. The quick and full suites were not run.
**Known failures:** none. The Details fold of the library panel read its open state from a `toggle` event that a quick pick of another item could outrun (a failure that predates this slice); it is now read when the panel is drawn.
**Unverified:** the lock screen on a touch screen; the `chromium-cpu` and `chromium-dpr2` projects (these specs are logic specs and run in `chromium`).
**Committed:** this slice (see the commit).
**Next bounded task:** file encryption for the hidden items (the password would derive the key), and a remember-for-this-tab option for the workspace password.

## Objects fills live; Vary each copy (v0.40.1, v0.41.0, 2026-10-25)

**Implemented:** objects fills follow a source during a gesture (texture host draws with the preview; filled shapes' tiles refreshed through `fillUsersOf`). `vary` on a texture ([ADR 0173](adr/0173-vary-texture-copies.md)): per-cell hashed copies (`copyAt`, `varyPeriod`), a cached repeated block, or the copies in view one by one when shown large; SVG writes the block; the texture editor has a Vary section (field and choice tables), New seed, and Randomize rolls Vary.
**Tested:** unit 560 (4 new for copyAt); E2E pictures.spec 31/31 (live test, snapshot cd2232ac) and the new Vary test with the live and nested-fill tests (snapshot b5dcbdf6); pictures, vectors, colour-picker 120/120 (Chromium, snapshot b5dcbdf6); the Vary and live tests in Firefox 2/2.
**Known failures:** none known.
**Unverified:** which drawing path the zoomed-in check used (block or one by one) is not asserted; the deep-zoom colour inside a varied copy.
**Committed:** `fix(texture): objects fills follow their sources live (v0.40.1)`, `feat(texture): vary each copy of a repeated fill (v0.41.0)`, local, not pushed.
**Next bounded task:** the owner's next pick.

## Gaps with small openings; W A S D by name and in view (v0.40.0, 2026-10-25)

**Implemented:** Fill gaps closes openings up to `shape.gapClosePx` (default 4 px) with bridges united as one region ([ADR 0172](adr/0172-fill-gaps.md)); boolean loops at a point where outlines touch go on along the piece turning furthest right, so corner-touching shapes close in a hole. W A S D: `nav.mode` adds `layer-view`, `az`, `az-view` (names as the Layers list shows them, passed in from main); *Nearest in view* falls back to the nearest same-size item ahead beyond reach.
**Tested:** unit 556 (new: corner-touching gap, bridged slits); E2E (Chromium): vectors, frames, pictures 172/172 after the boolean change (snapshot 980d3532); W A S D 5/5 in Chromium and Firefox (one new A to Z test, the off-screen test extended), Fill gaps (with a 2 px slit) and Divide, settings (snapshot 8b382ba0).
**Known failures:** none known.
**Unverified:** curved shapes in E2E for gaps; the quick and full suites.
**Committed:** `feat: gaps with small openings; W A S D by name and in view (v0.40.0)`, local, not pushed.
**Next bounded task:** the owner's next pick.

## Fill the gaps between shapes (v0.39.0, 2026-10-25)

**Implemented:** gaps as holes of the picked shapes' union (`doc/gaps.ts`, [ADR 0172](adr/0172-fill-gaps.md)), islands left out (even-odd); *Fill gaps* (all, one undo step) and *Fill a gap…* (click mode with dashed outlines and a hover preview, Enter/Esc/Done) in the Path tools menu and the command palette; fills placed under the back shape with the Shape tool's fill.
**Tested:** unit 554/554 (3 new for gaps); E2E (Chromium, snapshot 747ae2fc): the new Fill gaps test and the Divide test, icon-audit and a11y 6/6.
**Known failures:** none known.
**Unverified:** Firefox for the new test; gaps among curved shapes in E2E (unit only for straight ones); the quick and full suites.
**Committed:** `feat(shapes): fill the gaps between shapes (v0.39.0)`, local, not pushed.
**Next bounded task:** close small openings (a gap open by a few px).

## Snapping to the shapes, shapes without an outline (v0.38.0, 2026-10-25)

**Implemented:** snapping to the shapes themselves for move, node drag, resize and turn, one rule in `shapeSnap` with the searches in `interaction/snap-points.ts` ([ADR 0171](adr/0171-snap-to-shapes.md)): a corner exactly onto a corner or the middle of a side (always wins in reach), a corner onto any side, a straight side flush along a nearly parallel one; ring and side guides. New shapes start with no outline (lines and open paths still get the ink); the outline is no longer remembered between sessions; every outline width readout shows 0 / None when there is none (the bar's slider: far left is no outline). Fixed: an open path with a fill and no outline was invisible. Also in v0.37.1 to v0.37.3: big library imports without lag or flicker, the library index written in slices (no long tasks), Make vector copy in place.
**Tested:** unit 548 + 3 new snap tests; E2E (Chromium) the 14 shape-related specs 276 passed and 2 failed, both fixed and re-run green (snapshot 7ac84d4d); the new snapping test (frames.spec, home and 10^12 levels down) in Chromium and Firefox. 16 tests that relied on a default outline now set one with the harness's `outlineShapes`.
**Known failures:** none known.
**Unverified:** the resize and turn snaps have no E2E test of their own (they share `shapeSnap` with the tested move); the quick and full suites have not run.
**Committed:** `feat(snap): snap to the shapes themselves; shapes start without an outline (v0.38.0)`, local, not pushed.
**Next bounded task:** E2E for resize and turn snapping; the owner's next pick.

## Painting view removed (v0.37.0, 2026-10-25)

**Implemented:** the Paint view, `src/paint/`, its UI, the brush engine (`engine/`, its build step, notice and CSP allowance), the `paint.*` settings and the canvas code that only hosted it (switchable targets, tool host hooks, `paint`/`both` key scopes, `data-only`, helpers split out to share with it) removed ([ADR 0170](adr/0170-painting-view-removed.md)). The Eyedropper tool of the rail removed too (the colour picker's own pick stays). Kept: wheel scrolling of bars, a sheet's ratio from a px size. The IndexedDB stores of paintings stay (schema 11), unread; archives stay format 6, without paintings or presets; an older backup's paintings and presets are skipped with a note.
**Tested:** typecheck; unit 548/548; check:tokens, check:names, check:offline. E2E (snapshot 701a56da): archive, colour-picker, dock, settings, vectors, a11y 116/116 in Chromium; the bar wheel test in Chromium and Firefox. New: the bar wheel test (dock.spec) moved off the removed painting.spec; the hostile-archive test extended with an older backup carrying paintings.
**Known failures:** none known.
**Unverified:** the quick and full suites have not run on this version.
**Committed:** `feat!: remove the Painting view (v0.37.0)`, local, not pushed.
**Next bounded task:** the owner's next pick from the backlog.

## Painting view, P4 slice 1: Smudge, Clone stamp, OpenRaster (v0.36.0, 2026-10-22)

**Implemented:** engine glue dab strokes (`stroke_smudge`, `stroke_clone`: one `DabRun` with a smudge (the engine's `Smudge`) or a clone effect (premultiplied mix from the layer before the stroke at an offset); each push runs the new recorded dabs on a working copy and `mix_back`s the changed area onto the layer; `stroke_live` sends the layer's own changed tiles). Protocol `begin` carries a `StrokeKind` (sym, smudge, clone); the session's live stroke has a `cut` mask so compose shows those tiles in place of the layer's. Tools `smudge` (R) and `clone` (S, Alt-click source, Aligned, a source cross) in the Brush flyout. `paint/ora.ts`: `writeOra` (stack.xml, a page-sized PNG per layer as it looks, merged image, thumbnail; mimetype first, stored) and `readOra` / `importOra` (its own ZIP reader for stored and deflated entries; layers placed at their x, y; opacity, visibility, blend); the list's Import and the painting menu's Export as OpenRaster.
**Tested:** new Smudge, Clone stamp and OpenRaster tests (a deflated `.ora` made in the test); painting + settings 65 passed, 1 skipped (Chromium + Firefox).
**Next bounded task:** blur, sharpen, dodge, burn, sponge (their effects are in the engine's app crate, not the paint crate: port the small ones into the glue), then the mixer brush, background and magic eraser, history brush, wrap-around, saved selections.

## P2 loose ends (v0.35.1, 2026-10-22)

**Implemented:** the Brushes panel's preset menu on a right-click in both views (`presetMenu`); the backup test now carries a painted layer mask. Still open: backups carry every preset's tips (the built-in ones too); undoing a delete brings a shape back unpicked (a question for the owner).
**Tested:** painting + archive 51 passed, 1 skipped (Chromium + Firefox).
**Next bounded task:** the full suite, once for P2 and P3.

## Painting view, P3 done: reference pictures, crop (v0.35.0, 2026-10-22)

**Implemented:** `ui/paint-references.ts` (library pictures over the stage, drag to move, corner to size, ⋯ opacity / remove; setting `paint.refs` per painting, checked); the painting's menu *Add a reference picture…* (the library chooser, shared with texture fills through `main.ts` `libraryPictures`); the Selection menu's *Crop to the selection* (`resizePage` takes an offset as well as an anchor).
**Tested:** new reference test; the pages test extended (crop); painting 35 passed, 1 skipped (Chromium + Firefox); unit 565/565.
**P3 is complete** (selections, fill, gradient, canvas and image size, free transform, brush from a selection, symmetry, `.pat`, reference pictures, crop). Left before the phase-end full suite: P2 loose ends (a mask archive test; backups carry every preset tip).
**Next bounded task:** P2 loose ends, then `npm run test:full` (about 8 h) once for P2 and P3.

## Painting view, P3 slice 5: `.pat` patterns (v0.34.4, 2026-10-22)

**Implemented:** engine glue `pat_read` (the engine's PSD `.pat` reader; grey by luminance, transparent as white, 8 or 16 bits, at most 2048 px a side; each pattern a preset whose brush has it as `texture.pattern`, put out as `abr_read` does); protocol `presets.pat`; the Brushes panel's Import accepts `.pat`. Kept, archived and collected as presets already are; Choose a pattern lists them.
**Tested:** new `painting.spec.ts` test with a `.pat` generated in code (`makePat`), Chromium + Firefox.
**Next bounded task:** reference images, crop.

## Painting view, P3 slice 4: symmetry (v0.34.3, 2026-10-22)

**Implemented:** engine glue (`engine/src/lib.rs`): `stroke_symmetry(mode, cx, cy, rotation)` gives the stroke a renderer per mirror; points are reflected into them (`PresetSymmetry::reflected_passes`); `stroke_live` takes the most coverage of the passes; `stroke_end` puts them on with `composite_union_many` (one opacity ceiling). Protocol `begin.sym`, `BrushEngine.begin(…, sym)`, `StrokeStart.sym`. Setting `paint.symmetry` (off, vertical, horizontal, dual, diagonal) about the page's middle, the Symmetry choice in the painting tools' options, the axes drawn over the page.
**Tested:** new `painting.spec.ts` symmetry test; painting 31 passed, 1 skipped (Chromium + Firefox); unit 565/565.
**Unverified:** the axis at another point or angle (the engine takes them; the UI keeps the middle, 0°).
**Next bounded task:** `.pat` patterns, reference images, crop.

## Painting view, P3 slice 3: brush from a selection (v0.34.2, 2026-10-22)

**Implemented:** the Selection menu's *New brush from the selection*: the picked layer's pixels in the selection's box, darkness × alpha × selection as u16 samples (at most 1000 px), named by their SHA-256, a 32 px preview (base64 little-endian u16) in the brush's `tip.stored`; `BrushPanels.addPreset` stores it in Saved with its bitmap and hands it to the engine; the Brush gets the preset. `selection.ts` `boxOf`.
**Tested:** new `painting.spec.ts` test (the tip paints its shape), Chromium + Firefox.
**Next bounded task:** symmetry, `.pat` patterns, reference images, crop.

## Painting view, P3 slice 2: free transform (v0.34.1, 2026-10-22)

**Implemented:** `paint/warp.ts` (affine draw for a parallelogram, homography + triangle mesh for a perspective); the session's `float` (`startFloat` lifts the layer's or mask's pixels, or the selection's box, `moveFloat`, `applyFloat` one step and the selection warped with it, `cancelFloat`); compose draws `rest` + the warp for the layer or its mask. Paint view: the Select tool on pixels (`transformOn`), `hitBox` / `dragBox` (move by whole px, corner and side scale with Shift, turn with 15° steps, Ctrl corner free), handles on the cursor canvas, Enter / Escape, Apply / Cancel in the options, applied on a tool or layer change.
**Tested:** unit `warp.test.ts`; new `painting.spec.ts` transform test; painting 27 passed, 1 skipped (Chromium + Firefox); unit 565/565.
**Known failures:** none. **Unverified:** a real pen; transforming a huge page (the lift scans the page once).
**Next bounded task:** brush tip from a selection, symmetry, `.pat` patterns, reference images, crop.

## Painting view, P3 slice 1: selections, fill, gradient, canvas and image size (v0.34.0, 2026-10-22)

**Implemented:** `paint/selection.ts` (masks: shape, combine by mode, feather, grow/shrink, invert, edge, magic wand); the session's `selection` (clips live tiles and finished strokes, premultiplied mix), `editPixels` (ink cut by the selection, onto the layer or its mask, one step, no engine) and `resizePage` (canvas size with an anchor, image size resampled; vectors moved or scaled); `settled()` waits for pixel edits and tile redraws. Tools `marquee`, `marqueeEllipse`, `lassoPoly`, `wand`, `fill`, `gradient` (and `lasso` on pixels), rail flyouts from one `FAMILIES` table in `ui/toolbar.ts`; option sets `SELECT_OPTIONS`, `FILL_OPTIONS`, `GRADIENT_OPTIONS`. Mirror view lost its M key (M = marquee).
**Tested:** new selection and fill/gradient tests, the pages test extended (image size, middle anchor); `painting.spec.ts` 25 passed, 1 skipped (Chromium + Firefox); dock, a11y, icon-audit, settings 24/24 Chromium; unit 563/563.
**Full suite (P2 phase end):** started 09:08, stopped at 188/1304 after 75 min with no failures: at that pace it takes about 8 h, which would block every other test run. It runs once at the end of P3 instead, for P2 and P3 together.
**Known failures:** none.
**Unverified:** a real pen; the outline at a far zoom out.
**Committed:** see git log (feat(paint): ... (v0.34.0)).
**Next bounded task:** P3: free and perspective transform of pixels, then brush tip from a selection, symmetry, `.pat` patterns, reference images.

## Painting view, P2c: rotate and mirror the view (v0.33.2, 2026-10-22)

**Implemented:** owner's choice (2026-10-22): turn the stage, not the camera. `.paint-turn` box inside `.paint-stage`, turned by CSS and sized to cover the stage; `view()` is that size computed from the stage (synchronously: the box's own layout lags a frame, which broke Fit on open); `toLocal` / `clientOf` undo and apply the turn and mirror; `ToolHooks.toLocal` gives the canvas's tools the same mapping; the debug hook's `screenOf` goes through `clientOf`. Keys 4 / 6 (15°), M, 5; the HUD's angle button opens the View rotation menu (keepOpen). Fit fits the turned page's box.
**Tested:** new `painting.spec.ts` test (both turn directions, mirror on a turn, the brush and the screen pixel via a screenshot, wheel zoom about the pointer, Fit corners, Shape and Select on a vector layer, Reset from the menu), Chromium + Firefox; two mutations of the inverse mapping (no mirror, wrong sign) both fail it. Regression run: see the commit.
**Known failures:** none.
**Unverified:** touch long-press list placement while turned (listed in Limitations); a real pen.
**Committed:** see git log (feat(paint): ... (v0.33.2)).
**Next bounded task:** raster layer masks (done in the same commit, below).

**Layer masks (same commit):** `LayerBase.mask { tiles, off? }` (alpha = hidden; validated; `hashesOf` for GC, history roots, archives); the session's `maskSurfaces`, `maskEdit` / `editsMask()`, mask strokes loaded and committed as the mask's tiles (engine version key `id#mask`); `compose.ts` `maskInto` takes the mask and the live mask stroke out of the look (an adjustment with a mask goes over, not in place); Rasterize bakes an applied mask and drops it. UI: the row's mask picture (pressed = paint the mask), the ⋯ menu's Add / Turn off-on / Delete. Paint view: on a mask the ink is black and the stroke erases for light paint or the Eraser. Tested: new `painting.spec.ts` mask test; see the commit for the run.

## Painting view, P2c tools: the Eyedropper (v0.33.1, 2026-10-22)

**Implemented:** the Eyedropper (tool `eyedropper`, `I`, both views; `src/interaction/eyedropper.ts` `sampleAt`, the alpha-weighted mean of a square): `attachTools` takes the press and asks the host's `sample` hook (the Paint view: `composePage` of the square in page px, or the picked layer's surface) or reads the screen (the canvas). Options on the editor (`sampleSize`, `sampleLayer`), carried when the bars switch views, kept in settings `eyedropper.size` / `eyedropper.layer`. Alt-click in the Paint view uses the same hook.
**Tested:** `painting.spec.ts` (new Eyedropper test, Chromium + Firefox), `icon-audit`, `dock`, `settings`, `a11y` 33/33 Chromium (one locator made exact: "Pen" vs "Pencil").
**Known failures:** none.
**Unverified:** a real pen; sampling on a high-DPI screen on the canvas (device px).
**Committed:** see git log (feat(paint): ... (v0.33.1)).
**Next bounded task:** view rotate and mirror (+ reset), then raster layer masks.

## Painting view, P2c tools: the Pencil (v0.33.0, 2026-10-22)

**Implemented:** the Pencil (tool `pencil`, `Shift+B` mapped to the internal key Y, the Brush flyout on the rail, paint-only): the engine's `aliased` tip, its own values (size 1 at first, no hardness or spacing), Auto erase (the start pixel of the active layer is the paint colour: the stroke erases). Layer picks re-sync the vector host.
**Tested:** `painting.spec.ts`, `icon-audit.spec.ts`, `dock.spec.ts` 29 passed, 1 skipped, Chromium + Firefox; unit 563/563.
**Known failures:** none.
**Unverified:** a real pen on the Pencil.
**Committed:** see git log (feat(paint): ... (v0.33.0)).
**Next bounded task:** Eyedropper (one tool for both views), then view rotate and mirror, raster layer masks.

## Painting view, brush settings complete (v0.32.1, 2026-10-22)

**Implemented:** Brush settings edit the brush's blend `mode` (a menu: a choice row with more than six options is a select), section pins (`locks`, `pickedBrush` = the engine's `picked_over`: smoothing, protected texture, pinned sections), a response curve per controlled dynamic (`ui/curve-editor.ts`, the adjustments' Curves control moved out of `colour-popover.ts` and shared), Choose a tip / Choose a pattern (round or procedural, or any bitmap the presets name, `presetBitmaps`); one icon (`pin`).

**Tested:** unit 563/563 (`pickedBrush`, lock paths against the engine's default brush); E2E `painting.spec.ts` "brush presets" extended (mode, pin kept over a pick, a curve point, tip and pattern chosen) in Chromium and Firefox; `pictures.spec.ts` curve tests, `pattern`, `icon-audit` in Chromium.

**Known failures:** none known.

**Unverified:** curves with a real pen.

**Committed:** see git log (feat(paint): ... (v0.32.1)).

**Next bounded task:** P2c tools (Pencil, Eyedropper in both views, view rotate and mirror, raster layer masks).

**Large `.abr` (2026-10-22):** `painting.spec.ts` "a large .abr" (generated ABR v2, 128 px sampled tips, Chromium only; limits `abrImportPerBrushMs` 50, `brushGridMs` 1000, set before the first run): quick 200 brushes 3.3 MB 7.8 ms/brush, grid 289 ms; full 400 brushes 6.6 MB 6.6 ms/brush, grid 353 ms.

**v0.32.2:** brush presets in workspace archives (format 6; `brushesOf`/`readBrushes`/`importBrushes` in `paint/archive-part.ts`, tips checked by inflate + SHA-256); the canvas crumb stays in the Paint view (only the board menu is canvas-only). Tested: `archive.spec.ts` + `painting.spec.ts` 13/13 Chromium, the archive paintings test in Firefox.

## Painting view, brush presets (v0.32.0, 2026-10-22)

**Implemented:** ADR 0169: engine calls `presets_builtin`, `abr_read` (the engine's `.abr` mapping compiled in), `abr_write` (v2: tip and spacing), `tip_put` and stored tiles filled when a stroke begins, `brush_default`; worker messages `tips`, `presets`, `abr-write`, `default`; `paint/brushes.ts` (presets, `cleanBrushes`, bitmaps by SHA-256, `brushOf` over the tool's brush, `BRUSH_SECTIONS`, paths); `PaintStore` `brushes`/`saveBrushes`/`tip`, GC keeps the presets' and tools' bitmaps; `ui/brush-panels.ts` (Brushes and Brush settings panels in the dock's left stack); `ui/setting-rows.ts` shared with the Pattern panel; tool state `paint.tools[t]` = values + brush + preset; two icons.

**Tested:** unit `painting.test.ts` (cleaning, keys, picking, paths, every `BRUSH_SECTIONS` path checked against the engine's default brush); E2E `painting.spec.ts` "brush presets" (built-ins, a sampled tip paints, Brush settings, Save, .json and .abr out and back in, reload); `painting`, `pattern` (the shared setting rows), `icon-audit` and `scrub-audit` specs 34/34 in Chromium and Firefox (snapshot 172479cc); unit 563/563.

**Known failures:** none known.

**Unverified:** pen tilt and rotation controls with a real pen; touch layout of the two panels.

**Committed:** see git log (feat(paint): ... (v0.32.0)).

**Next bounded task:** rest of P2 (P2c): Pencil and Eyedropper as tools of the one rail (the Eyedropper shared with the canvas), view rotate and mirror, raster layer masks.

## Painting view, one chrome for both views (v0.31.0, 2026-10-22)

**Implemented:** ADR 0168: `app/target.ts` (`Switch`: stand-ins for the document, editor, view, index and text editor of the canvas or the picked vector layer); main.ts gives the stand-ins to the rail, Properties bar, dock, Actions bar, view controls and hint line, and switches them in `setView`; `RAIL_TOOLS` with `only` (Brush paint-only; Sheet, Note canvas-only); `Tool` gains `brush`; keymap scopes `both` and `paint` with `inView`, `toolForKey(key, view)`; the Paint view lost its own bar, rail, options bar and colour button (Brush options in a Properties-bar slot, painting pill in the nav, floating Layers and pages); attachTools `keysActive`; scene-view caches keyed by `real(doc)`.

**Tested:** unit (keymap per view, tool keys per view, `Switch`); E2E `painting.spec.ts` 8/8 Chromium and Firefox; canvas regression specs: see the commit.

**Known failures:** none known.

**Unverified:** touch and the phone layout of the bars in the Paint view; the canvas's Adjust, Tags, Styles and Pattern panels are hidden there (not mounted on the vector layer); keyboard rebinding of the Brush by hand.

**Committed:** see git log (feat(paint): ... (v0.31.0)).

**Next bounded task:** rest of P2: brush presets as workspace data, the Brushes panel with `.abr` and JSON import and export, the Brush Settings sections from the engine's schema.

## Painting view, vector layers (v0.30.0, 2026-10-22)

**Implemented:** ADR 0167: `paint/vector-host.ts` hosts the canvas's `DocumentStore`, `ViewState`, `EditorState`, `attachTools` and text editor on the picked vector layer; edits are painting history steps; `attachTools` hooks `scope`, `history`, `active`; tools Select, Edit nodes, Pen, Shape (+ Path), Lasso, Text from the canvas; copy, cut, paste; shared `ui/reveal-list.ts` and cursor rules; `paint/vector-tools.ts` and `paint/handles.ts` removed.

**Tested:** E2E `painting.spec.ts` "vector layers" (two shapes in one layer, Select moves one, Delete, undo, Pen into the same layer, Rasterize), Chromium and Firefox; Text tool and gizmo checked by screenshots. Quick suite: see the commit.

**Known failures:** none known.

**Unverified:** touch gestures and the long-press list on a real touch screen in the Paint view; copy and paste between the canvas and the Paint view by hand; the Lasso and Edit nodes in the Paint view beyond the screenshots.

**Committed:** see git log (feat(paint): ... (v0.30.0)).

**Next bounded task:** rest of P2: brush presets as workspace data, the Brushes panel with `.abr` and JSON import and export, the Brush Settings sections from the engine's schema.

## Painting view, P2 first part (v0.29.0, 2026-10-22)

**Implemented:** ADR 0166: layer kinds `object` (shapes, texts, pictures, patterns, pasted canvas objects, drawn by the canvas's renderer at page px = world units at zoom 0), `fill` and `adjust`, `RENDER` registry in `compose.ts`, Move / Shape / Text / Edit nodes tools (`paint/vector-tools.ts`, `paint/handles.ts`), Rasterize, paste from the canvas, picture import, assets of paint layers kept by the library GC, `doc/node-edit.ts` shared with the canvas's Edit nodes tool.

**Tested:** unit `painting-objects.test.ts`; E2E: see the commit.

**Known failures:** none known.

**Unverified:** the vector tools, the new layer kinds and paste by hand in a browser (only through tests); adjustment layers on large pages (speed).

**Committed:** see git log (feat(paint): ... (v0.29.0)).

**Next bounded task:** rest of P2: brush presets as workspace data, the Brushes panel with `.abr` and JSON import and export, the Brush Settings sections from the engine's schema.

## Painting view, P1 (v0.28.0, 2026-10-21)

**Implemented:** the Paint view (ADR 0165): paintings per workspace, pages in px with DPI and background, raster layers stored as 256 px tiles (SHA-256 of the pixels, deflated), one edit path (record replacements) for every change with undo and redo, the brush engine in a worker with a live stroke of 64 px coverage tiles (engine patch 0001), clip to the layer below, alpha lock, blend and opacity, Brush and Eraser with a schema of options, Hand, zoom and fit, pages strip, PNG export, place on the canvas, archive format 5 with paintings, storage schema 11, CSP `'wasm-unsafe-eval'`.

**Tested:** unit `painting.test.ts` (7); E2E `painting.spec.ts` (3) and the paintings round trip in `archive.spec.ts`, Chromium and Firefox. Quick suite: see the commit.

**Known failures:** none known.

**Unverified:** a real pen tablet (pressure, tilt), headed browsers on real GPUs, touch (two-finger pan and pinch are written but not tested), large pages near 8192 px.

**Committed:** see git log (feat(paint): ... (v0.28.0)).

**Next bounded task:** P2: brush presets as workspace data, the Brushes panel with `.abr` and JSON import and export, the Brush Settings sections from the engine's schema.

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

**Test suites (2026-10-14):** the suites were made cheaper (logic specs in `chromium` only, smaller loops, one full-only 2,000-notch run). Full suite with all four projects: 32 min 25 s, unit 130/130, E2E 301 passed, 6 skipped, 1 timeout (the Firefox curvy-stroke test needs more than 180 s in full mode; fixed, passes alone in 5.2 min); details in [testing/full-run-4-projects.md](testing/full-run-4-projects.md). Earlier run on the 3 Chromium projects: [testing/full-run-3-chromium.md](testing/full-run-3-chromium.md). An Electron AppImage was tried and shelved the same day ([ADR 0026](adr/0026-electron-appimage-tried-and-shelved.md)).

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

**Per-canvas cameras and recovery (slice 7):** per-canvas cameras already existed (Phase 1a; test re-run); new: `contextlost` and `contextrestored` handlers (drop the tile cache, redraw) so a browser reset of the drawing surface loses nothing. [ADR 0023](adr/0023-per-canvas-cameras-and-backend-recovery.md). Tested: E2E `frames.spec.ts` "backend recovery" (events fired by hand; same ink, same camera, editing works; 4 projects).

**Layers panel (owner request):** `ui/layers-panel.ts`: floating, hideable (device setting `ui.layersOpen`, default hidden), tree of objects and groups front to back with eye, lock, select and drag to reorder. [ADR 0024](adr/0024-layers-panel.md). Tested: unit (`placeAbove`, `layerTree`); E2E `frames.spec.ts` "layers panel".

**Bookmarks (owner request):** `storage/bookmarks.ts`, `app/bookmarks.ts`, `ui/bookmarks-panel.ts`; per-canvas named saved views in frame form (exact at any depth), thumbnail, storage schema 5, kept by frame clean-up, carried in archives. [ADR 0025](adr/0025-view-bookmarks.md). Tested: E2E `frames.spec.ts` "bookmarks" (save, go exactly at 10^12 levels, rename, delete, clean-up and reload) and the archive round-trip test now carries a bookmark 1,600 levels in. Not built: camera flight, shortcut, view history.

**Phase 2 is built and the full suite has run** (34 min 50 s; 340 passed, 6 skipped, 2 failed on one test that measured the wrong thing and was fixed; see [testing/full-run-phase-2.md](testing/full-run-phase-2.md)); limits to remember: no snapping while resizing, text erased by its box, selection outline of a turned object is its bounding box.

**Phase 3 is built and the full suite has run** (36 min 36 s; 380 passed, 6 skipped, 0 failed, [testing/full-run-phase-3.md](testing/full-run-phase-3.md)). Known gaps: one 70 ms frame when a zoom in a dense scene crosses the ADR 0012 preview bound (fix planned: build the adjacent zoom level's tiles in idle time), no document-memory budget (1M objects is about 1.1 GB), Assets view with 300 HD images was slow (fixed in Phase 4: 1,000 cards open in under 250 ms).

**Phase 4, slice 1 done:** idle-time prebuild of the adjacent zoom levels' tiles ([ADR 0033](adr/0033-idle-prebuild-of-adjacent-zoom-tiles.md)); the dense-zoom hitch at the first crossing is gone, later crossings in one gesture still rebuild (not chained).

**Phase 4, slices 2 and 3 done:** persisted WebP thumbnails (made at import), the slide view, and thumbnails shown also for assets whose original is lost ([ADR 0034](adr/0034-persisted-thumbnails.md)); tested in `assets.spec.ts`.

**Phase 4, slice 4 done:** smart folders ([ADR 0035](adr/0035-smart-folders.md)); tested in `organize.spec.ts`.

**Phase 4 is built and the full suite has run** (36 min 24 s; 380 passed, 6 skipped, 0 failed, [testing/full-run-phase-4.md](testing/full-run-phase-4.md)). Deferred: thumbnails and smart folders in `.canvast` archives, regenerating a bad stored thumbnail, chaining the zoom prebuild (later crossings in one gesture still rebuild).

**Phase 5, slice 1 done:** arrange in a grid, align and distribute ([ADR 0036](adr/0036-arrange-align-distribute.md)); tested in `arrange.test.ts` and `frames.spec.ts`.

**Phase 5, slice 2 done:** four pens ([ADR 0037](adr/0037-pens.md)); tested in `pens.test.ts` and `frames.spec.ts`.

**Phase 5, slice 3 done:** copy, cut, paste and duplicate ([ADR 0038](adr/0038-copy-paste-duplicate.md)); tested in `clipboard.test.ts` and `frames.spec.ts`.

**Phase 5, slice 4 done:** opacity slider in the Layers panel ([ADR 0024](adr/0024-layers-panel.md)); tested in `frames.spec.ts` "layers panel" (chromium, firefox).

**Phase 5, slice 5 done:** mentions in text, same canvas ([ADR 0039](adr/0039-mentions.md)); tested in `text.test.ts` (syntax, fuzz with mentions) and `text.spec.ts` (chromium, firefox).

**Phase 5, slice 6 done:** backlinks, board-wide picker, missing-target state, storage v7 ([ADR 0040](adr/0040-backlinks.md)); tested in `text.spec.ts` "backlinks" (chromium, firefox) and storage, archive and assets specs (chromium, unchanged results).

**Phase 5 complete (v0.14.0):** full suite recorded in [full-run-phase-5.md](testing/full-run-phase-5.md). Relink of missing mentions, blend modes and layer renaming were built in Phase 6 (ADR 0047); undo/redo stays in-session by design.

**Phase 6, slice 1 done:** videos as image instances with a paused position and an on-canvas player ([ADR 0041](adr/0041-video-players.md)); tested in `media.test.ts` and `assets.spec.ts` "a video is placed" (chromium, firefox; one unexplained failure in the first of about 19 runs, not reproduced).

**Phase 6, slice 2 done:** audio instances (waveform picture, same player); tested in `assets.spec.ts` "audio is placed" (chromium, firefox).

**Phase 6, slice 3 done:** animated GIFs with a frame-index decoder ([ADR 0042](adr/0042-gif-frames.md)); tested in `gif.test.ts` (4) and `assets.spec.ts` "animated GIF" (chromium, firefox).

**Phase 6, slice 4 done:** Extract Frame and the step settings in the player ([ADR 0043](adr/0043-extract-frame-and-media-settings.md)); tested in `assets.spec.ts` (chromium, firefox: 24 pass).

**Phase 6, slice 5 done (media pictures, [ADR 0046](adr/0046-video-pictures-and-paused-frame.md)):** a paused video reopens on the frame it was paused on (Firefox desktop, fixed and confirmed by the owner); pictures of a video are taken by drawing the element, `createImageBitmap`, `VideoFrame`, then an MP4 frame decoded with WebCodecs (`mp4-frames.ts`); a flat picture is never stored. Tested in `assets.spec.ts` (chromium, firefox: video, flat-picture import, undecodable card); the WebCodecs path was checked by hand in Firefox 152 with H.264 files (B-frames, rotation), not in the suite (Playwright browsers cannot decode MP4).

**Phase 6, slice 6:** the mention picker and mention labels name an image by its file name (found by typing it), not "Image W×H"; tested in `text.spec.ts` "backlinks" (chromium, firefox).

**Phase 6, slice 7 (gaps closed, [ADR 0047](adr/0047-blend-modes-layer-names-relink.md)):** blend modes, layer and group names, relink of missing mentions, audio playing out of view. Tested: `frames.spec.ts` "layers panel" (blend changes pixels, undo, rename object and group, reload), `text.spec.ts` "backlinks" (relink and undo), `assets.spec.ts` "audio that is playing carries on" (chromium, firefox). Not built: see the ADR.

**Known failures (Phase 6):** none open from the full run. The Firefox "zooming deep into a curvy stroke" hole check (about 1 run in 3 to 4, exactly 140 holes) was found and fixed after v0.15.0: a zoom preview took over a prebuilt tile set one level deeper than the camera, scaled it down, and left a strip of bare background at the view edge (plus hairline seams between scaled tiles). Fixed in `render/tile-cache.ts` (`covers`, whole-pixel preview tiles); 4 of 4 pass under the load that failed 3 of 4 before. Firefox on Android with H.265 phone videos: the canvas shows the card with the reason, Extract Frame gives nothing, playing from the player works. Not reproducible without the device. Accepted for now. One unexplained failure of the "a video is placed" firefox test in about 6 runs after the pause change (passed 3 of 3 on rerun, not reproduced). The Firefox paused-frame mismatch on desktop is fixed.

**Phase 7, slice 1 (Settings view, [ADR 0048](adr/0048-settings-view.md)):** third top-level view with six tabs, rows from the declared settings with scope and reset, settings-to-editor sync, theme (system, light, dark). Tested: unit `settings-view.test.ts` (2); E2E `settings.spec.ts` (chromium, firefox: tabs, shortcuts off, a row reaches the pen, reset, theme and background pixel, reload, Storage tab); archive, assets, organize, frames and text specs in chromium. Found and fixed on the way: the Layers rename could start from a press on another canvas. Not built: see the ADR. **Next bounded task:** a shortcut list and rebinding, or an accessibility pass.

**Phase 7, slice 2 (shortcuts, [ADR 0049](adr/0049-shortcuts.md)):** rebindable tool keys, the shortcut list, `?`. Tested: unit `settings-view.test.ts` (3); E2E `settings.spec.ts` "shortcuts" (chromium, firefox); frames, text and editing specs in chromium (51). **Next bounded task:** accessibility pass, appearance options (text size, reduced motion, high contrast), then contextual tools.

**Phase 7, slice 3 (accessibility and appearance, [ADR 0050](adr/0050-accessibility-and-appearance.md)):** audit test of accessible names, landmarks and focus; header first in tab order; toolbar starts after the view tabs; interface size, contrast and motion settings. Tested: E2E `a11y.spec.ts` (2) and `settings.spec.ts` "appearance" in chromium and firefox; frames, text, editing, assets, organize, archive, storage, density, tiles and zoom-controls specs in chromium (100). **Next bounded task:** contextual tools (a selection action bar), then the Phase 7 full suite.

**v0.17.0 (ADRs 0057 to 0063), not yet in a full run:** one folder per asset, tag rename and delete, whole-workspace menu and plain ZIP export (0057); stepping with Ctrl+Arrow, Alt focus and fit (0058, 0063); Layers sort and guides, Place on another or a new canvas, workspace menu cards, tag chips (0059); canvas search (0060); phone and medium-screen layouts, resizable details sheet (0061); in-canvas tags, database version 8 (0062); Side-handle resize, Alt-drag copy, reset buttons (0063). Tests: see [testing/ui-polish-0.17.md](testing/ui-polish-0.17.md). Known limits: strokes and text cannot be stretched; in-canvas tags cannot yet be renamed or deleted across canvases; no non-destructive editing (crop, adjustments; the plan-gaps list (removed 2026-10-29)).

**UI polish in v0.17.0, second round (ADRs 0088 to 0097):** *Implemented:* the library sidebar and Settings share the details panel's framed cards and the shared button and field look (0088, 0092); files with no preview are a fixed grey tile instead of a stored thumbnail, so renaming remakes nothing (0089); the information readout is one full-width strip at the very bottom, most important first (0090); the list has one column per property (Type and Size apart; Width, Height, Canvases) and every header sorts (0091); animation tokens (`--dur-*`, `--ease-*`) with Settings > Performance > Animation (System, Full, Subtle, None) and Animation speed (0093); Settings tabs in groups and a search across all settings (0094); the library and details panels resize by their edges, the library bar keeps every control on a narrow window, and the board pill shows the canvas name (0095); View in the library fills the search with the names (0077); the selection bar finds a place clear of a player's bar, and layer tokens keep the floating edge components above everything on the canvas (0096). *Tested:* the affected specs in Chromium (assets, files, organize, settings, a11y, and the readout and Zen tests in frames), 202 unit; new tests for settings search, panel resizing, header sorting and the selection bar beside a player. *Known failures:* none. *Unverified:* Firefox and the dpr2 project for these changes; the full suite (not run since v0.16.0); phone-width layouts of the new Settings and sidebar. *Committed:* yes. *Next bounded task:* the next gap in the plan-gaps list (removed 2026-10-29) (crop first), running only the affected specs per slice; the Firefox pass of the specs above rides along; the full suite runs once, last, after all the work (owner, 2026-10-17).

**UI follow-ups after v0.16.0 (owner feedback, ADRs 0053 to 0056):** canvas pattern button, workspace menu with More actions, library list layout and reversible sorts, drag-import fix. notices stack with progress and errors, one spec for the floating elements, the four-view information readout, compact density, and the Assets view redesign (gallery, viewer, multi-select, slideshow). Tested: unit 177; chromium and firefox: assets, organize, archive, a11y and settings specs (72); the full suite has not been re-run since v0.16.0. ADR 0057 (one folder per asset, tag rename and delete, whole-workspace menu, plain ZIP export): chromium organize, assets, archive, storage, a11y, settings, density specs and unit tests pass; firefox organize and archive pass; plan gaps in the plan-gaps list (removed 2026-10-29). Earlier batch (click selects, double-click opens, keyboard moves, list columns, viewer zoom, immersive viewer, stuck shortcut capture fixed): chromium 97 (settings, assets, organize, a11y, archive, storage, text, density, frames) and firefox assets 25 passed.

**Visual system (ADR 0052, after v0.16.0):** oklch colours with hue and colourfulness dials, theme-aware default ink, tool rail, dock, one options bar. Tested: E2E `settings.spec.ts` "theme colour" (contrast of the accent at five hues stays at least 4.5:1 and the surface keeps its brightness; chromium, firefox), updated frames/assets specs; chromium 101 passed across frames, text, editing, assets, organize, archive, density, tiles, settings, a11y, zoom-controls; firefox 74 passed; unit 176. The full suite was not re-run.

**Phase 7 is complete (v0.16.0), full suite 428 passed, 0 failed.** Slice 5: a Collaboration tab in Settings (states that it is off), arrow keys stay on the view tabs, view-switch test (`settings.spec.ts`). Not built: see ADRs 0048 to 0051.

**Phase 7, slice 4 (contextual tools, [ADR 0051](adr/0051-selection-action-bar.md)):** the selection action bar. Tested: E2E `editing.spec.ts` "selection action bar" (chromium, firefox); frames and editing specs in chromium and firefox (92); text, assets, organize, archive, density, tiles, settings and a11y specs in chromium. **Next bounded task:** a Phase 7 pass against its exit gate (view switching, settings, theme, accessibility tests), then the Phase 7 full suite and v0.16.0.

**Phase 6 is complete (v0.15.0):** full suite in [full-run-phase-6.md](testing/full-run-phase-6.md): 411 passed, 6 skipped, 1 failed (the intermittent Firefox hole check above). **Next bounded task:** Phase 7; ask before pushing (Phases 5 and 6 are local).

## Phase 1, slice 9 — settings scopes

**Implemented:** `src/settings/settings.ts` ([ADR 0017](adr/0017-settings-scopes.md)): every setting declared once with a scope, a validated default and an effect; device scope stored in `localStorage` (pen colour and size, stabilizer on and strength, pen size follows zoom, ignore the filling object, lasso filter, last view); damaged stored values fall back to the default; the old stand-alone last-view key is adopted once. Workspace and board scopes are declared; their storage (schema 5, archive 3) comes with the first setting that needs it.

**Tested:** unit `settings.test.ts` (4: defaults, rejection, reset, damaged values, legacy key, no storage; 134/134 in all); E2E `frames.spec.ts` "pen and select options come back after a reload" (4 projects); `frames`, `assets`, `organize` and `storage` specs in Chromium and Firefox: 176 passed, 4 skipped (10.5 min).

**Known failures:** none.

**Unverified:** the full suite after this slice (last full run: v0.9.0, `testing/full-run-4-projects.md`); workspace and board storage (not built).

**Committed:** v0.10.0 on `main`.

**Next bounded task:** Phase 2 (layers and groups, object eraser, per-canvas cameras).

## v0.27.0 — Adjustments on shapes, shadows, pattern styles (2026-10-21)

- **Implemented:** `adjust` moved to every object (`ObjectBase`); `render/adjust-shape.ts` draws a shape, stroke or text on a scratch layer (cut to the canvas, made smaller when the blur is wide or the layer big), through the SVG filter of `adjust-filter.ts` on the graphics card (`ctx.filter`; the pixel path of `adjustInto` where there is none), then the inner shadow (erode, offset, blur, kept inside) and the drop shadow (dilate for the spread, offset, blur) behind; pictures get only their shadows here. Blur and shadows are shares of the object's size, capped at `REF_MAX` (2^14 px) so they stay bounded at depth; geometry clips leave room for the layer (`withClipExtra`); a coarse object seen from inside takes the colour adjustments on its colour (`adjustHex`). A view with a blurred or shadowed object is drawn directly (like blend modes). Export of a selection grows by `reachFraction`; SVG export writes `<filter>` primitives plus `data-canvast-adjust`, read back by the importer. Scrub: Shift snaps to `niceStep` (shared `scrub.ts`); the picker's names point at their number fields. Group Reset buttons in the Adjust panel. Pattern generators: `LOOSE` setting in nine generators, a note when the seed changes nothing, Scales capped at 12 across. `pattern` style kind (`PATTERN_KIND`), Save as a style in the Pattern panel, card with a picture, apply (one or several picked), update from the panel. Zoom-out preview swaps in a prebuilt tile set when the scaled one leaves a border (`tile-cache.ts`).
- **Tested:** chromium runs of pictures, styles, tiles, vectors, text, release, pattern, dock and colour-picker specs (last full group 149 passed); the shape tests, the scrub test and the pattern specs also in Firefox. New: shape adjustments (blur past the edge, undo, reload, SVG round trip), shadows (drop, spread, inner, SVG), deep zoom and export room, scrub with Shift (adjust and picker), group Reset, picture shadow, seeds in every generator, pattern styles (save, apply, update, several shapes).
- **Known failures:** none in the last runs. "Saved to the library" in `pattern.spec` failed twice in long parallel runs (a race on the library entry being written); its checks now wait for the folder and tags, 44 specs passed after.
- **Unverified:** the zoom lag fix and the seams fix by eye on the owner's machine; the full suite (not run); shadows on a playing video (not drawn while it plays); SVG filters in Firefox beyond the tests.
- **Committed:** v0.27.0 on `main`, local, not pushed.
- **Next bounded task:** run the full suite (all four projects) and record it; a spread control check by eye; the toolbar's own scrub (Radius, Sides, Points, Ratio) still has its own code and no Shift snap.

## v0.26.4 — A zoom in is just a zoom in (2026-10-21)

- **Implemented:** `flightPlan` judges the trip in the deeper end's frame (`approxIn`, offsets kept short): within one view it is a pure zoom about the fixed point (fraction `(2^(zD-z)-1)/(2^(zD-zS)-1)` from the deeper end, as exact digits; the camera is built with `normalize` so any depth costs the same); farther apart it is the van Wijk path as before (exact, up to 20,000 levels); the view width (px) now enters the widths.
- **Tested:** the far-trip test (three cases: zoom only, van Wijk, dive), real Chromium on `showcase.canvast` bookmarks 8 to 13, 1 to 6, 18 to 19 and back (monotone zoom read-outs, one million levels included); frame times in the test log.

## v0.26.3 — One continuous flight between views (2026-10-21)

- **Implemented:** `flightPlan` in `view-state.ts`: the target is expressed exactly in the current frame (`expressExactIn`, up to 20,000 levels apart), zoom widths are clamped to [2^-2, 2^40] of the distance, and the camera follows the van Wijk path (zoom out, cross at constant speed, zoom in); the part of the way still to go is computed from the target end so its digits are kept. The old dive stays as the fallback beyond 20,000 levels.
- **Tested:** the far-trip test in `bookmarks.spec` (100 levels: no frame jumps by more than 25 levels, never past the start; 100,000: the dive with its dip). Real Chromium run with screenshots: a smooth zoom out to a speck and in. Frame times in `docs/testing/camera-travel-0.26.md`.

## v0.26.2 — Why a trip cut (2026-10-21)

- **Implemented:** `nav.baseSeconds`, `nav.respectMotion`, `ViewState.cutReason/onCut` (a once-only message). Checked in a real (non-debug) Chromium with reduced motion emulated: cuts and says so; with the setting off it glides.
- **Tested:** `bookmarks.spec`, `settings.spec` (see the test log).

## v0.26.1 — Fade at the switch, tour speed (2026-10-21)

- **Implemented:** `ViewState.fade` (canvas opacity dip around the dive's switch), settings `nav.fade`, `tour.speed`. ADR 0163 updated.
- **Tested:** the dive test in `bookmarks.spec` checks the dip and that opacity comes back.

## v0.26.0 — Camera travel and bookmark keys (2026-10-21)

- **Implemented:** `ViewState.flyTo` dives (24 levels out, then in) for other frames or trips over 8 levels of zoom-out, with `travel`, `distanceAware`, `maxGlideMs`, `ease`; settings `nav.travel/speed/maxSeconds/ease`, `tour.pause`; bookmark `move`, `step`, `goTo`; keys `bookmark.prev/next/1-9`; drag reorder; bookmark of the picked things; debug hook `setSetting`. ADR 0163.
- **Tested:** three new tests in `bookmarks.spec` (see `docs/testing/camera-travel-0.26.md`).
- **Unverified:** a dive on a canvas with thousands of objects (25 strokes: steady 60 fps in Chromium, a few dropped frames in Firefox), touch reorder (drag uses HTML drag-and-drop; Move up/down is the touch route).

## v0.25.11 — Colour names, palettes copy too (2026-10-21)

- **Implemented:** `parseCssColour` takes colour names; palette cards and chips copy by right click or long press.
- **Tested:** `vectors.spec` CSS paste test (Chromium), `styles.spec` (Chromium, Firefox).

## v0.25.10 — Copy: pictures alone, edited stills, GIF frames (2026-10-21)

- **Implemented:** `renderedStill` for a picture's edited copy, picture-only clipboard when the text would be a placeholder, no SVG text for texture fills or over 1 MB, own-picture flag instead of byte size.
- **Tested:** `pictures.spec` (picture, GIF, picture-filled shape; Chromium), copy/paste specs in Chromium and Firefox.
- **Unverified:** a video's current frame (the same path as a GIF, not run with a video); Firefox writing the picture.

## v0.25.9 — Ctrl+C reaches other apps (2026-10-21)

- **Implemented:** copy writes SVG text (shapes) and a PNG (`copyPicture` in main.ts); the paste handler checks its own objects first; `copiedText`, `plain` argument of `copySelection`.
- **Tested:** `vectors.spec` clipboard test (Chromium); the copy/paste specs of vectors, frames, text and pictures pass in Chromium and Firefox.
- **Unverified:** Firefox writing the picture (the API needs a user gesture there; the text always stays); audio, video and other files cannot go on the clipboard.

## v0.25.8 — Picker: copy swatches, # in the hex field (2026-10-21)

- **Implemented:** `colour-picker/press.ts` (long press, copy), hex field copy/paste, `onCopy`; saved-gradient chips and Styles cards copy by long press.
- **Tested:** `colour-picker.spec` new test and `styles.spec` (Chromium, Firefox; made-up clipboard data steps Chromium only).
- **Fixed on the way:** a long press left its click-swallowing flag set, so the next click was lost.

## v0.25.7 — Styles: right-click copy and paste (2026-10-21)

- **Implemented:** `css-paint.ts` (`parseCssPaint`, `cssOfPaint`), Styles right-click copy, paste over the panel saves a style; angular summary fixed.
- **Tested:** `styles.spec` (all 5, Chromium and Firefox; the paste step Chromium only), `vectors.spec` CSS paste test.
- **Next bounded task:** elliptical radial gradients, then diamond.

## v0.25.6 — Paste a colour, copy a gradient as CSS (2026-10-21)

- **Implemented:** `parseCssColour` / `parseCssPaint` (css-paint.ts), `pasteCssPaint`; `cssColour` reads colours the canvas returns as text (oklch, lab) from a pixel; Styles: gradient **Copy as CSS**.
- **Tested:** `vectors.spec` CSS paste test (Chromium); `styles.spec` gradient test (Chromium, Firefox).
- **Committed:** yes.

## v0.25.5 — Paste a CSS gradient onto a fill (2026-10-21)

- **Implemented:** `app/css-paint.ts` reads CSS gradient text; `pasteCssGradient` (actions.ts) puts it on the picked fills; the stop parsing is shared with the conic import (`cssStops`).
- **Tested:** `vectors.spec` "CSS gradient text pasted ..." (Chromium only: Firefox ignores made-up paste text); the other-tool import test still passes.
- **Known failures / Unverified:** the box is taken as a square; elliptical radial sizes and `px` positions are not read.
- **Next bounded task:** elliptical radial gradients, then a diamond gradient.

## v0.25.4 — A pen stroke picked alone can be recoloured (2026-10-21)

- **Implemented:** one picked pen stroke shows its colour as a chip in the Properties bar (`ui/toolbar.ts`).
- **Tested:** `vectors.spec` "a pen stroke picked alone is recoloured from its colour chip" (Chromium, Firefox).
- **Committed:** yes. **Next bounded task:** CSS gradient text pasted onto a fill.

## v0.25.3 — WYSIWYG: no theme mapping (2026-10-21)

- **Implemented:** `render/ink.ts` is now `setCanvasInk` + `newInk` (the default ink chosen when an object is made) and an identity `swatchBackground`; `paintColor` and `exportColor` are gone (drawing and the SVG/PDF writers use stored colours); `newInk` is applied in the shape, line, path and pen tools, the text editor and the tool chips; `recolourOldInk` (command in the palette); SVG outline `align` (clip path or mask) and the SVG box from `paintBounds` (outside outlines, miter tips); `buildTarget` pads by `inkStyle`.
- **Tested:** `svg.test.ts` (newInk, files hold stored colours, aligned outlines), `vectors.spec` "WYSIWYG colours" (dark and light canvas, canvas pixel, SVG, the old-ink command and its undo; Chromium, Firefox); the full quick suite on this source is in `docs/testing/pattern-0.25.md`.
- **Gradients from other tools:** `svg-import.ts` applies a gradient's own transform scale to a radial radius and reads a CSS `conic-gradient` box (`parseConic`) in a clipped group as an angular gradient on the clip's shape; a diamond is read as a clipped group of linear-gradient rectangles. Test: `vectors.spec` "gradients written by another design tool are read" (Chromium; samples checked by hand: linear, radial, angular and diamond all import).
- **Gradient handles say whose they are:** `gradientSides` / `gradientHandleLabel` (path-edit.ts), the hint (tool-hint.ts) and the hover and drag labels (tools.ts); `editor.select` clears `gradientFocus`. Test: `vectors.spec` "fill and outline both gradients: the hint line and the handle names ...".
- **Angular gradients in SVG:** written as a PNG picture (up to 384 px a side) cut by a clip path (fill) or a mask of the stroked line (outline), `angularCount` + `angularWarning` (Export dialog with SVG chosen, Save to library as SVG, Copy as SVG); other design tools have no better answer (they write a radial gradient or an HTML box). The real gradient is written on the element (`data-canvast-fill` / `-stroke`) and `svg-import.ts` reads it back (a vector copy or a pasted SVG is editable again; before, such a file was "not an SVG drawing this app can read" because its shape had no visible paint). Test: `vectors.spec` "an angular gradient ... is written as a picture" (Chromium also pastes it back).
- **Unverified:** a PDF of a dark-canvas drawing in a viewer; an angular gradient on an outline that is also aligned inside or outside (a linear stand-in is written); an outside outline with a width profile or arrows; pasted SVG that holds `#1f2329` (kept as given).

## v0.25.2 — the default ink in SVG and PDF (2026-10-21)

- **Implemented:** `exportColor` (render/ink.ts: the default ink as "#rrggbb", read from `#hex` or `rgb()` as it is, else drawn on a one-pixel canvas) used by `exportSvg` and `pdfVectorOf` for solid fills and outlines.
- **Tested:** `svg.test.ts` (mapped on a dark canvas, other colours untouched, stored on a light one), `vectors.spec` "the default outline is written to an SVG as the canvas draws it" (Chromium, Firefox; the SVG was `#1f2329` on a dark canvas before the fix).
- **Unverified:** a PDF of a dark-canvas export opened in a viewer; the `oklch()` ink read in a browser that returns it unconverted other than Chromium.

## v0.25.1 — exports are cut to the sheet (2026-10-21)

- **Implemented:** `layoutPaths` (svg-export.ts) takes the sheets that cut each path (`ClipOf`, from `clipSheetsOf` in actions.ts): the box counts only what a sheet lets through, a path wholly outside is left out, and `exportSvg` writes one `<clipPath>` for each sheet and wraps what is on it; `pdfVectorOf` clips each shape's drawing with `W n`; `buildTarget` frames a picked selection by the part that shows.
- **Tested:** `pattern.spec` "a pattern that runs past its sheet exports as the sheet's frame" (picture ratio, SVG ratio and clip, PDF, sheet picked and pattern picked; failed before the fix), plus the export specs listed in `docs/testing/pattern-0.25.md`.
- **Unverified:** an object on a sheet inside a rotated sheet; a clipping mask sheet of a very curved shape in the PDF (the clip is the shape; checked by the file starting as a PDF, not rendered).

## v0.25.0 — Pattern generators (2026-10-21)

- **Implemented:** `src/gen/` (seeded RNG and value noise, geometry helpers, 39 generators declared as settings plus one pure function each, `generate`, `randomValues`, `cleanValues`), `app/pattern.ts` (target: picked sheet, picked closed shape cut by a mask copy, or a new sheet; a session replaces its own last undo step through `DocumentStore.lastTransaction`), `ui/pattern-panel.ts` (panel built from the generator's settings), dock button, palette command, `mountainSnow` icon.
- **Tested:** see the test log of this slice in `docs/testing/` (unit: `tests/unit/pattern.test.ts`; E2E: `tests/e2e/pattern.spec.ts`, Chromium and Firefox).
- **Unverified:** a pattern on a sheet or shape at deep zoom or in a non-world frame; a rotated target (refused with a message); a pattern whose group was nested in other groups or sheets at deep levels; touch.

- **Package:** `src/gen` is self-contained (`core.ts` holds the shared shapes; `check:patterns`), `scripts/build-patterns.mjs` builds `dist-patterns/` (script, module, declarations, demo), `src/gen/README.md` documents the API; not published (the owner will publish it with the colour picker).

**Next bounded task:** make a pattern again when its sheet is resized; presets (named settings per generator); a palette control that feeds every colour setting.

## v0.24.5 — a sheet drawn over objects takes them (2026-10-21)

- **Implemented:** `drawSheetOver` (actions.ts) and the Sheet tool's commit in `interaction/tools.ts` (objects wholly inside the new sheet's box, at its level, with their groups and contents, go on it; the sheet is placed behind them).
- **Tested:** new `sheets.spec` test (one inside, one crossing; parent, z order, pixels, one undo), all of `sheets.spec` in Chromium (18 passed), the new test in Firefox.
- **Unverified:** a sheet drawn over a mix of frames at deep zoom; a rotated or very large capture; touch.

## v0.24.4 — a group is one unit for Align and Arrange (2026-10-21)

- **Implemented:** `layoutUnits` splits a boolean group into its shapes only when its result is not picked (the shapes were picked as shapes).
- **Tested:** new `frames.spec` test (a group and a boolean group aligned and arranged with others keep their members' offsets; each picked alone moves nothing; the boolean case fails without the change); `vectors.spec` "align works on the shapes of a boolean group" now enters the group and picks the shapes (and checks the whole group is not split); the group, boolean and align tests of both specs in Chromium (24 passed) and the two in Firefox.
- **Unverified:** a boolean group nested in a group, and groups on sheets, were not exercised by the new test.

## v0.24.3 — gradient handles snap (2026-10-20)

- **Implemented:** `snapGradientPoint` in `interaction/tools.ts` (the Snap toggle, ADR 0019): the pointer's x and y snap to the box edges and middle of the shapes in view and to path nodes, within `SNAP_PX`, with the guide.
- **Tested:** new `vectors.spec` test (on: a handle dropped 4 px short of the shape's middle lands on it; off: it does not; fails without the change) and the gradient tests of the spec, Chromium and Firefox. The full quick suite has not been run since 0.22.0.
- **Unverified:** snapping the angular gradient's angle handle (it uses the same pointer snap, which changes the angle slightly rather than aligning a point); a rotated shape's gradient.

## v0.24.2 — Reveal: a picked thing can be moved by its outline (2026-10-20)

- **Implemented:** the press handler takes a picked thing within 8 px of its outline although a filled shape covers the spot (`click` keeps the top thing for a click that does not move).
- **Tested:** the reveal test in `frames.spec` now moves the picked shape by its top edge (and checks the big one stayed and a click picks the top one), Chromium and Firefox; `editing.spec` and `sheets.spec` in Chromium (39 passed). The full quick suite has not been run since 0.22.0.
- **Unverified:** dragging a picked thing by an outline that lies under a text or a picture; touch.

## v0.24.1 — Reveal: a click on an outline picks its own thing (2026-10-20)

- **Implemented:** `deepPick` takes the pointer and prefers the thing whose outline (`edgeDistancePx`, 8 px) it is on over a filled thing that covers the spot (ADR 0149 table updated).
- **Tested:** E2E `frames.spec` (new test: the outline of a small shape under a filled ellipse, inside both away from outlines, and the big one's own outline; fails without the change) and the other reveal tests, in Chromium and Firefox. The full quick suite has not been run since 0.22.0.
- **Unverified:** the 8 px reach on a touch screen (the touch list is the way there, ADR 0151) and with very thick outlines.

## v0.24.0 — progress notices, the library index by itself, Settings tidied (2026-10-20)

- **Implemented:** progress notices for every wait of the storage and import/export paths ([ADR 0161](adr/0161-progress-notices.md)); the library index written by itself (`storage/auto-index.ts`, a checkbox); Settings > Storage as one row per action; icons and indent for the Settings tabs; an icon for each setting's Reset.
- **Tested:** unit `progress.test.ts`, `auto-index.test.ts`; E2E `storage.spec` (progress notice outlasts a plain one), `library-folder.spec` (8, stable over 8 repeats; the flaky test was a wait that also matched "not saved yet"), `settings`, `a11y`, `archive` in Chromium and Firefox (settings, storage, archive, a11y). The full quick suite has not been run since 0.22.0.
- **Unverified:** progress on a very large export in a real browser (the stages are reported, the look at 300 MB is not checked); the automatic index write on the owner's real folder and synced drive; the hidden file name `.canvast-index` on a real folder.
- **Next bounded task:** the full suite.

## v0.22.0 to v0.23.0 — library folder polish, library index, start from scratch (2026-10-20)

- **Implemented:** SVG types restored for folder files (0.22.1), one Storage page in Settings (0.22.2), `<hash>.<ext>` names with a card button for older files (0.22.3), the library index (save and open, manual) and Start from scratch (0.23.0); [ADR 0159](adr/0159-library-folder.md).
- **Tested:** unit `external-folder.test.ts`; E2E `library-folder.spec` (Chromium, 7: import, reload, backup, file gone, moves, GC, bare names, the library index, reset keeps the folder's files, choosing a folder with a library offers to open it) and `storage.spec` (Chromium and Firefox: save indicator page, Start from scratch in Chromium run); archive, settings, release, organize and frames archive specs after the Storage page change. The full quick suite has not been run since 0.22.0.
- **Unverified:** the real folder picker and permission prompt on the owner's machines (the owner uses it; the tests use a stand-in directory); opening a library index on a second real device; two devices writing the library index at once; Start from scratch with other tabs open (the other tab is told to close; the wait message is not tested).
- **Next bounded task:** the full suite; opening a library index on a second real device.

## v0.21.1 and v0.22.0 — storage limits made visible; the library folder (2026-10-20)

- **Implemented:** 0.21.1: a full browser store refuses an import in plain words, `storage.persist()` asked once, a notice at 80% of the quota (`storage/quota.ts`). 0.22.0: the library folder ([ADR 0159](adr/0159-library-folder.md)), Chromium only: originals as files named by their SHA-256, stubs in the browser, moves both ways, Reconnect, backups and GC aware of it; schema 10 (an index).
- **Tested:** unit `quota.test.ts`, `external-folder.test.ts`; E2E `storage.spec` (full store, Chromium and Firefox) and `library-folder.spec` (Chromium: import, reload, backup, file gone, re-import, moves, GC); quick suite (`npm test`, 51 min, 2026-10-20): unit 527 passed; E2E 1141 passed, 19 skipped, 4 failed (below).
- **Known failures:** four CSS assertions in the viewer and library cards, all failing on the source without these changes too (re-run on it): `assets.spec` "small screens: the details panel is resizable..." (Chromium and Firefox), `assets.spec` "gallery viewer: the view tabs, the workspace menu and the Settings button are hidden..." (Firefox), `files.spec` "an SVG keeps its real preview..." (Firefox). Not caused by storage; to triage.
- **Unverified:** the real folder picker and the permission prompt (the native dialogs cannot be driven; a stand-in directory with the same interface is used, so a real Chromium session by the owner is the check); a folder on a slow or network drive; thousands of files in one folder (list checks each file's size).
- **Next bounded task:** the owner tries a real folder; then the full suite when Phase 8 closes.

## v0.21.0 — settings, panels, linked styles, Phase 8 groundwork (2026-10-19)

- **Implemented:** the items of the changelog entry 0.21.0; [ADR 0156](adr/0156-panel-shape.md) (one shape for every panel) and [ADR 0157](adr/0157-linked-styles.md) (objects follow the saved colour, gradient or adjustment they got).
- **Tested:** quick suite on the affected specs in Chromium and Firefox (530 passed, 2 failed, 6 skipped; both failures fixed after it); unit 512 passed.
- **Known failures:** none. The two failures of the run were both fixed: a pixel read right after an undo now waits for the frame, and the Firefox video-adjustments test (failing 3 runs in 12) was a real race: a number typed into the Adjust panel in the same frame as the render of a commit before it was lost when the panel was built again. The first change of a burst now previews at once (15 of 15 pass).
- **Unverified:** the full suite on this source; the Phase 8 benches (written, not run).
- **Next bounded task:** run the two benches and the qualification matrix and record them in `docs/testing/phase-8.md`; ADR 0155 and `docs/reference/storage-origin.md`.

## v0.20.0 — texture fills (2026-10-19)

- **Implemented:** [ADR 0154](adr/0154-texture-fills.md): `TexturePaint` (a picture or objects as a fill), one drawing path through `canvasPaint`, the Image and Objects (called Pattern until v0.25.0) modes of the paint chooser, library references, tile-cache invalidation for objects fills.
- **Tested:** unit (layout, validation, storage, average colour, SVG and PDF fallbacks), E2E in `pictures.spec.ts` (picture fill: pick, Fill, Tile, space, undo, reload, file; objects: pick, grid, brick rows, source change, deep zoom in and out).
- **Known failures:** the Firefox text-editor failures of v0.19.1.
- **Unverified:** Firefox for the texture tests (see the commit); a very large picture as a tile; objects fills across paste between canvases.
- **Next bounded task:** the "Not done" list of ADR 0154 (outline and text textures, adjustments on an image fill, handles on the canvas).

## v0.19.2 — picture, reveal and export gaps (2026-10-19)

- **Implemented:** [ADR 0153](adr/0153-picture-and-reveal-gaps-vector-pdf.md): gradient outline, radius dots and rounded picking for pictures; reveal of locked, hidden and mask parts, on Edit nodes and Lasso, spoken through the hint line; vector PDF; WebP resolution.
- **Tested:** unit tests (vector PDF operators, WebP EXIF), E2E in pictures, frames (reveal), vectors (mask reveal) and sheets (PDF and WebP of a shape); the vector PDF was also rendered by a PDF viewer and looked right. Wide run: see the commit.
- **Known failures:** the 14 Firefox text-editor tests of v0.19.1.
- **Unverified:** the vector PDF in other viewers; a hidden-object count above 400 (only the first are revealed); phone width.
- **Next bounded task:** the Firefox text-editor focus failure; a marquee that reveals what it would take.

## v0.19.1 — grouped menus, touch gestures, test snapshots (2026-10-19)

- **Implemented:** ADR 0151 and 0152 (grouped Actions-bar menus, kind chips, long-press list, two/three-finger undo/redo, held-finger Shift/Alt, live rotate/ratio labels), `test:snap` and `test:status`.
- **Tested:** unit 495/495, `check:tokens`, `check:names`; E2E (chromium + firefox; vectors, frames, sheets, text, styles, settings, assets) 396 passed, 14 failed, 6 skipped in 22.0 min. Touch is tested with emulated touch only; the owner confirmed on a phone that the earlier touch bugs are fixed.
- **Known failures:** 14 Firefox tests (13 in `text.spec.ts`, `styles.spec.ts:146`): the text editor is not focused after a click in Firefox; they fail on `a0e5227` too.
- **Unverified:** full suite for v0.19.1; phone-width look at the bars and Export.
- **Next bounded task:** the Firefox text-editor focus failure.

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

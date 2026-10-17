# Gaps against the engineering plan (checked 2026-10-17, v0.17.0, `main`)

Owner decisions of 2026-10-17: **masks, ratings and saved searches are out of scope**; they are listed as Decided against, not as gaps.

Checked item by item against the plan: sections 4 to 9, the detailed specifications of section 14 that name features (14.8 to 14.17, 14.21, 14.31 to 14.42, 14.46, 14.51 to 14.54) and the roadmap of section 16. The plan is outside the repository (the vault note `zettel/endless_canvas-complete_engineering_plan-expanded-claude.md`). "Gap" means the plan asks for it and the app does not do it. This file replaces the check of 2026-10-16.

How each row was decided: **Done** = found in the source and covered by a test or a record in `docs/testing`. **Partial** = some of it exists. **Gap** = not found in `src/`. **Decided** = left out on purpose (an ADR or the owner). **Unverified** = not confirmed from the code in this check; look before relying on it. Nothing here was measured on a device; performance rows rest on the records in `docs/testing`.

## Summary

Counted from the rows below (a row is one item of the plan, so counts compare areas, not effort).

| Area | Done | Partial | Gap | Decided | Unverified | Not started |
| --- | --- | --- | --- | --- | --- | --- |
| §4 Content types | 8 | 4 | 8 | 1 | 1 | 0 |
| §5 Non-destructive editing | 0 | 1 | 4 | 1 | 0 | 0 |
| §6 Assets and search | 6 | 2 | 2 | 4 | 0 | 0 |
| §7 Storage and portability | 5 | 1 | 4 | 1 | 0 | 0 |
| §8 Performance | 3 | 1 | 1 | 2 | 1 | 0 |
| §9 UI, Settings and accessibility | 8 | 4 | 3 | 0 | 2 | 0 |
| §14 Hierarchy, selection, clipboard and tests | 7 | 3 | 3 | 1 | 2 | 0 |
| §14.41 and roadmap | 0 | 1 | 1 | 0 | 0 | 2 |
| **Rows counted** | **37** | **17** | **26** | **10** | **6** | **2** |

## §4 Content types

| Plan item | State | Note |
| --- | --- | --- |
| Raster import, place, resize, rotate, flip, group, hide, lock | Done | Images, GIF, WebP, JPEG, PNG; item rotation about a pivot (ADR 0018). |
| Raster crop | **Gap** | No crop on any item. |
| Raster masks | Decided against | Left out (owner, 2026-10-17). |
| Raster adjustments | **Gap** | See §5. |
| Resolution-aware display, thumbnails, large images | Done | Tile cache, reduced copies, stored WebP thumbnails (ADR 0009, 0030, 0034). |
| Image pyramids / mipmaps, tiled decode, colour profiles, EXIF orientation | Partial | Reduced copies and tiles exist; no mipmap pyramid; EXIF and colour profiles are not read (the browser decides). |
| SVG import | Done (ADR 0107) | Pasted SVG text, or Make vector copy of an SVG picture, becomes editable paths (gradients, dashes, transforms; not text, masks, clips, patterns, `<use>`). A dropped SVG file is still a picture. |
| SVG export | Done (ADR 0107) | Save as SVG from the selection bar; an outline inside or outside the edge is written centred. |
| Vector shapes, custom paths, Bézier points and handles, fills, strokes, node editing | Done (ADR 0099) | Shape, Path and Edit nodes tools; fill and outline with transparency; join, cap and fill rule are stored (the tools set round or miter). Edges are exact at any depth (fill and thin outline; wide outlines of straight shapes); only a curved shape's outline wider than 2^14 px at the view is a dimmed approximation. |
| Gradients on paths (ADR 0100) | Done | Linear and radial, on fills and outlines, with a gradient editor in the colour package and handles on the canvas. |
| Boolean operations (ADR 0101, 0103) | Done | Union, intersect, subtract, exclude on the selection bar as non-destructive boolean groups (members stay editable, result derived, flatten and release); curves stay curves. |
| Stroke position (inside, centre, outside), outline corners and ends | Done | ADR 0104; Outline options on the options bar. |
| Corner radius (every shape with corners, curves included, per corner, boolean groups), sides, points and ratio editable after drawing | Done | ADR 0105; per-corner radii on a boolean group's result are not. |
| Dashes | Done (ADR 0107) | Solid, Dashed, Dotted; custom lengths and offset are not offered. |
| Clipping | **Gap** | Next slice of the vector plan (ADR 0099). |
| Freehand: four pens (fine, pencil, ink, marker), pressure, variable width, stabilizer | Done | ADR 0037. Distinct stroke dynamics; marker doubles as the highlighter. |
| Tilt | Done (ADR 0113) | Ink nib angle and pencil breadth follow the lean; mouse and touch unchanged. |
| Object eraser (swept, one undoable step, never deletes the original) | Done | ADR 0022. Whole-group option. |
| Stroke / path eraser (distinct from the object eraser) | Done for strokes (ADR 0111) | Scissors mode on the eraser; vector paths are not trimmed. |
| Rich text: WYSIWYG with a Markdown source, mentions, backlinks, Copy Markdown | Done | ADR 0013, 0039, 0040. |
| Text: font selection, line height, letter spacing, text boxes with several fonts | Partial | Line height and letter spacing done (ADR 0113). Font choice needs a decision: each font is bundled outlines (size of the single file). |
| Text: bidirectional text, IME, text-to-path export | Unverified | Not tested in this check. |
| Video: on-canvas player, repeat, seek step (3 s), Extract Frame, paused frame persisted, decoder budget, unsupported codecs | Done | ADR 0041 to 0046. |
| Video: crop, adjustments, playback speed | **Gap** | No crop or adjustments. Speed control not found. |
| Animated GIF: real frame parser, 1-frame step, Extract Frame | Done | ADR 0042. |
| Audio: player, waveform, volume, repeat, 1 s step | Done | |
| Audio: trimming or range selection | Done (ADR 0112) | Start here, End here, Whole file; video has it too. |
| Content-type adapter architecture, future types (PDF, 3D) | Partial | Any file is kept and shown as a card with its kind (ADR 0078); nothing renders a PDF page or a 3D model. |

## §5 Non-destructive editing

| Plan item | State | Note |
| --- | --- | --- |
| Per-object opacity and blend modes | Partial | The only part that exists (ADR 0047). |
| Crop | **Gap** | |
| Mask | Decided against | Left out (owner, 2026-10-17). |
| Exposure, contrast, highlights, shadows, temperature, tint, saturation, vibrance, RGB, curves, levels, blur, sharpen, grain | **Gap** | No adjustment stack, no filters. |
| Editable, reorderable stacks; Copy and Paste Adjustments across image, video and GIF | **Gap** | |
| Copy Rendered Media (adjustments baked in) | **Gap** | Depends on the above. |

## §6 Assets and search

| Plan item | State | Note |
| --- | --- | --- |
| Full Assets view beside Canvas view, one shared catalog | Done | ADR 0054, 0087 to 0095. |
| Import once, instances reference it; dedup by hash; missing detection and recovery | Done | ADR 0007, 0034. |
| Tags (several per asset, Obsidian rules, nested), favourites, nested folders (one folder per asset) | Done | ADR 0011, 0057, 0084. |
| Sorting, file-type filters, usage filter, Boolean search, suggestions | Done | ADR 0069, 0071, 0082, 0083, 0091. |
| Bulk tagging, folders, favourites, rename; direct placement; usage to instance navigation | Done | ADR 0058, 0077, 0085. |
| Metadata inspector | Partial | Name, size, pixels, type, usage, tags, folder; no EXIF, codec or colour data. |
| Search at large scale | Partial | A linear filter over the in-memory list; to be measured in Phase 8. |
| Independent collections | Decided against | One folder per asset plus tags (ADR 0057). |
| Dynamic smart folders | Decided against | Built (ADR 0035), then replaced by file types (ADR 0082). The plan still lists them. |
| Saved searches | Decided against | Left out (owner, 2026-10-17); recent searches that found something exist (ADR 0071). |
| Ratings | Decided against | Left out (owner, 2026-10-17); favourite only. |
| Filters by colour, dimensions, orientation, aspect ratio | **Gap** | Width, Height and Pixels are columns that sort; there is no filter. |
| Duplicate review, perceptual similarity | **Gap** | Exact duplicates merge on import; nothing shows them. |
| Search covering objects, boards and named locations | Done | Canvas search `/ # @` (ADR 0060). |

## §7 Storage and portability

| Plan item | State | Note |
| --- | --- | --- |
| IndexedDB, per-object revision-checked commits read back to verify, crash recovery | Done | ADR 0006. |
| Schema versioning, v0.0.x migration, multi-tab writer lease | Done | ADR 0006 to 0008. |
| Save states shown (unsaved to verified), storage panel, quota, persistence | Done | Storage panel and the readout. |
| `.canvast` archives: four export scopes, manifest, hashes, verified before a single-transaction import; plain ZIP by kind or folder | Done | ADR 0008, 0057. |
| Notes as real `.md` entries; thumbnails in archives | Done | |
| OPFS, SQLite WASM | Decided | IndexedDB only (ADR 0006). |
| ZIP64, archives above 4 GiB or 65,535 entries | **Gap** | The format refuses them. |
| Streaming export and import without the whole archive in memory | **Gap** | Built and verified from Blobs. |
| Hundreds of gigabytes, chunked or desktop-assisted fallback | **Gap** | Not offered. |
| Incremental backup chain; last verified backup shown | Partial | The status is shown; there is no incremental backup. |
| Update-safe origin for a replaced HTML file | **Gap** | Phase 8. The Storage tab explains it; there is no upgrade test. |

## §8 Performance

| Plan item | State | Note |
| --- | --- | --- |
| Spatial index at any depth, culling, LOD, density preview, tile cache, zoom preview | Done | ADR 0004, 0005, 0009, 0010, 0012, 0014. |
| 10K / 100K / 1M object benchmarks | Done | `docs/testing/phase-0c.md`, `phase-3-bench.md`. |
| Decoded-image budget, adaptive quality, cooperative index build, device tiers | Done | ADR 0027 to 0029. |
| Web workers | Decided against | Cooperative scheduling on the main thread instead (ADR 0029). |
| GPU or WebGL backend | Decided against | CPU-first Canvas 2D (ADR 0002). |
| 60 FPS on a reference device, 120 FPS | Unverified | Measured on the author's machine only; no hardware tiers. |
| Cold and warm startup benchmarks | **Gap** | Not recorded. |
| Software-render and low-memory test tier | Partial | A `chromium-cpu` test project exists; no low-memory tier. |

## §9 UI, Settings and accessibility

| Plan item | State | Note |
| --- | --- | --- |
| Two views with a switcher, workspace to boards to canvases, board pill and menu | Done | ADR 0048, 0079. |
| Tabbed Settings with scopes, defaults, validation, reset, search, groups | Done | ADR 0017, 0048, 0094. |
| Media and Playback defaults (3 s, 1 s, 1 frame) | Done | ADR 0043. |
| Canvas and Input (pens, eraser, snapping, navigation) and Keyboard Shortcuts with conflicts, remapping | Done | ADR 0049, 0058. |
| Appearance (theme, hue, density, contrast, text size, motion, animation) and accessibility options | Done | ADR 0050, 0052, 0093. Accessibility has no tab of its own; the plan allows merging where justified. |
| Lucide icons, bundled, labelled | Done | `src/ui/icons.ts`, `docs/reference/icons.md`. |
| Layers panel, bookmarks, tags panel, canvas search, selection action bar, contextual toolbars | Done | ADR 0024, 0025, 0051, 0060, 0076. |
| Phone and medium layouts, touch | Done | ADR 0061, 0097. |
| Storage and Backups tab | Partial | Usage, quota and persistence are shown; backup, export and import live in the workspace menu, not here. |
| Performance tab | Partial | Adaptive quality, Animation and speed; no backend choice, quality tier or cache limits. |
| About and Diagnostics tab | Partial | The Develop tab shows the version (fixed in this check; it was blank), developer tools; no error log, capability results, licences list or diagnostic export. |
| Privacy tab, Collaboration tab | Partial | Explanations only. Nothing to set while there is no network and no collaboration. |
| Command palette; Settings reachable from it | **Gap** | |
| Minimap or overview, tours or presentation paths, camera transitions | **Gap** | Slideshow exists for library assets only. |
| Navigation history (previous view) | **Gap** | Bookmarks and search-and-reveal exist; no back and forward of camera positions. |
| Context menus, drag between panels, detachable surfaces | Unverified | Not confirmed in this check. |
| Contrast validated against actual ratios | Unverified | ADR 0050 audited by hand; no automated contrast test found. |

## §14 Hierarchy, selection, clipboard and tests

| Plan item | State | Note |
| --- | --- | --- |
| Authoritative document, transactions, in-session undo, never persisted | Done | ADR 0003. |
| Groups, layers, hide, lock, reorder, stacking; Arrange in grid, align, distribute; import grid | Done | ADR 0020, 0021, 0030, 0036. |
| Snapping and guides, rotation, side-handle resize, Alt-drag copy | Done | ADR 0018, 0019, 0063. |
| Strokes drawn over media stay independent; lasso filters; select media from Layers; picking by alpha | Done | `editing.spec.ts`, U1, U2, U4, U5, U7, U8 recorded in `phase-0b.md`. |
| Attach to object and Detach (explicit, undoable) | Done (ADR 0109) | Link and unlink buttons on the options bar of Select. |
| Master and instance (symbols) | Decided | Not in the initial release; the plan asks for a decision. |
| Create, rename, delete canvases and boards | Done | |
| Duplicate, move and reorder canvases and boards | Done (ADR 0110) | In the More menu of the navigator. |
| Copy Object, duplicate, paste; Copy Markdown | Done | ADR 0038. |
| Copy Original Asset, Copy Rendered Media, Copy Adjustments | **Gap** | |
| System-clipboard image paste, directory import, remote URL import (optional) | Unverified | Drop and file import work; paste from the system clipboard and folders were not confirmed. |
| Single file, `file://`, no network (checked by tests), reproducible build | Partial | The build prints a hash and the offline check passes; a clean-machine test is Phase 9. |
| U1, U2, U4, U5, U7, U8 | Done | `editing.spec.ts`. |
| U3, U6, U9, U10 | Unverified | Named in `phase-0b.md` and ADR 0003; this check did not confirm a test for each. |
| U11 (CPU-only), U12 (crop or adjustment under an overlay) | Partial | U11 runs in the `chromium-cpu` project; U12 cannot exist until there is crop or an adjustment. |
| Scenarios I (dual views) and J (hierarchy) | Partial | Views switch with state kept; the 1,000-switch leak test and the duplicate, move and reorder steps are not there. |

## §14.41 and roadmap

| Item | State | Note |
| --- | --- | --- |
| Local and online collaboration, roles, E2EE | **Gap (optional)** | Phase 10; Settings says it is off. |
| Phase 8 Scale and compatibility | Not started | Large projects, qualification matrix, file-origin upgrade. |
| Phase 9 Standalone release | Not started | A single file, README and `THIRD_PARTY_NOTICES.md` exist; no clean-machine test and no reproducible-build check. |
| Phase 5 Creative editing | Partial | Pens, eraser, Markdown notes, arrange done; images and vectors editing and adjustments are not. |

## What to look at first

| Order | Gap | Why |
| --- | --- | --- |
| 1 | Non-destructive editing: crop, then the adjustment stack and Copy and Paste Adjustments (masks are dropped) | The largest plan item with nothing built; it blocks U12, Copy Rendered Media and video and GIF adjustments. |
| 2 | Vector objects: shapes, paths and node editing are done (ADR 0099); left: SVG import as vectors and export | Large; the plan sets a professional vector editor bar. |
| 3 | Attach and Detach, duplicate, move and reorder canvases and boards | Small, and the plan names each in a test scenario. |
| 4 | Stroke eraser, audio range, text fonts, tilt | Each small to medium. |
| 5 | Size and orientation filters, colour filter (the colour picker, ADR 0098, now exists to choose the colour), duplicate review | Library depth (ratings and saved searches are dropped). |
| 6 | ZIP64, streaming export, incremental backup | Needed before very large libraries. |
| 7 | Phase 8 and 9 checks, a Firefox pass and the full suite | Not run since v0.16.0 (the full suite) and not yet for the latest UI work (Firefox). |

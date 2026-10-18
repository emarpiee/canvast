# Gaps against the engineering plan (checked 2026-10-17, updated 2026-10-18, v0.19.0, `main`)

Owner decisions of 2026-10-17: **ratings and saved searches are out of scope**; they are listed as Decided against, not as gaps. (Masks were left out then and added on 2026-10-18, ADR 0144.)

Checked item by item against the plan: sections 4 to 9, the detailed specifications of section 14 that name features (14.8 to 14.17, 14.21, 14.31 to 14.42, 14.46, 14.51 to 14.54) and the roadmap of section 16. The plan is outside the repository (the vault note `zettel/endless_canvas-complete_engineering_plan-expanded-claude.md`). "Gap" means the plan asks for it and the app does not do it. This file replaces the check of 2026-10-16.

How each row was decided: **Done** = found in the source and covered by a test or a record in `docs/testing`. **Partial** = some of it exists. **Gap** = not found in `src/`. **Decided** = left out on purpose (an ADR or the owner). **Unverified** = not confirmed from the code in this check; look before relying on it. Nothing here was measured on a device; performance rows rest on the records in `docs/testing`.

## Summary

Counted from the rows below (a row is one item of the plan, so counts compare areas, not effort).

| Area | Done | Partial | Gap | Decided | Unverified | Not started |
| --- | --- | --- | --- | --- | --- | --- |
| §4 Content types | 32 | 1 | 0 | 0 | 0 | 0 |
| §5 Non-destructive editing | 6 | 0 | 0 | 0 | 0 | 0 |
| §6 Assets and search | 9 | 1 | 0 | 4 | 0 | 0 |
| §7 Storage and portability | 7 | 1 | 2 | 1 | 0 | 0 |
| §8 Performance | 3 | 1 | 1 | 2 | 1 | 0 |
| §9 UI, Settings and accessibility | 15 | 2 | 0 | 0 | 0 | 0 |
| §14 Hierarchy, selection, clipboard and tests | 11 | 4 | 0 | 1 | 0 | 0 |
| §14.41 and roadmap | 0 | 1 | 1 | 0 | 0 | 2 |
| **Rows counted** | **83** | **11** | **4** | **8** | **1** | **2** |

## §4 Content types

| Plan item | State | Note |
| --- | --- | --- |
| Raster import, place, resize, rotate, flip, group, hide, lock | Done | Images, GIF, WebP, JPEG, PNG; item rotation about a pivot (ADR 0018). |
| Raster crop | Done (ADR 0118, 0137) | Stills, video and GIF. |
| Raster masks | Done (ADR 0144) | A mask by opacity or brightness (any object, a picture too), and a brush mask painted with the Pen (vector strokes, so sharp at any zoom). |
| Raster adjustments | Done (ADR 0118) | See §5. |
| Resolution-aware display, thumbnails, large images | Done | Tile cache, reduced copies, stored WebP thumbnails (ADR 0009, 0030, 0034). |
| Image pyramids / mipmaps, tiled decode, colour profiles, EXIF orientation | Done (ADR 0138) | Reduced copies and tiles stand in for a stored pyramid (decided: no per-level storage); EXIF and colour profiles are read and shown, and the orientation is applied. |
| SVG import | Done (ADR 0107) | Pasted SVG text, or Make vector copy of an SVG picture, becomes editable paths (gradients, dashes, transforms, `<use>` and symbols; not text, masks, clips, patterns). A dropped SVG file is still a picture. |
| SVG export | Done (ADR 0107) | Save as SVG from the selection bar; an outline inside or outside the edge is written centred. |
| Vector shapes, custom paths, Bézier points and handles, fills, strokes, node editing | Done (ADR 0099) | Shape, Path and Edit nodes tools; fill and outline with transparency; join, cap and fill rule are stored (the tools set round or miter). Edges are exact at any depth (fill and thin outline; wide outlines of straight shapes); only a curved shape's outline wider than 2^14 px at the view is a dimmed approximation. |
| Gradients on paths (ADR 0100) | Done | Linear and radial, on fills and outlines, with a gradient editor in the colour package and handles on the canvas. |
| Boolean operations (ADR 0101, 0103) | Done | Union, intersect, subtract, exclude on the selection bar as non-destructive boolean groups (members stay editable, result derived, flatten and release); curves stay curves. |
| Stroke position (inside, centre, outside), outline corners and ends | Done | ADR 0104; Outline options on the options bar. |
| Corner radius (every shape with corners, curves included, per corner, boolean groups), sides, points and ratio editable after drawing | Done | ADR 0105; per-corner radii on a boolean group's result are not. |
| Dashes, arrow heads, sharp-corner limit | Done (ADR 0107, 0139, 0142) | Solid, dashed, dotted, and a custom length, gap and start; an arrow head (solid, open, dot) at each end of an open line; the angle below which a sharp corner is cut. |
| Clipping | Done (ADR 0108, 0144) | A sheet clips to its rectangle; a clipping mask is a sheet of any shape. |
| Simplify a path, pen stroke to path | Done (ADR 0139) | Curve fitting; one undo step each. |
| Variable-width paths, corner smoothing, angular gradient, outline stroke, shape builder, lasso of nodes and editing nodes of several paths | Done (ADR 0143, 0145) | Variable width is a Taper made as a shape; the Shape builder takes up to six shapes. |
| Vector networks | Done (ADR 0146) | Edges meet at vertices, regions are filled; edges that cross are not split, one fill for the whole network. |
| Freehand: four pens (fine, pencil, ink, marker), pressure, variable width, stabilizer | Done | ADR 0037. Distinct stroke dynamics; marker doubles as the highlighter. |
| Tilt | Done (ADR 0113) | Ink nib angle and pencil breadth follow the lean; mouse and touch unchanged. |
| Object eraser (swept, one undoable step, never deletes the original) | Done | ADR 0022. Whole-group option. |
| Stroke / path eraser (distinct from the object eraser) | Done for strokes (ADR 0111) | Scissors mode on the eraser; vector paths are not trimmed. |
| Rich text: WYSIWYG with a Markdown source, mentions, backlinks, Copy Markdown | Done | ADR 0013, 0039, 0040. |
| Text: font selection, line height, letter spacing, text boxes with several fonts | Done (ADR 0113, 0127, 0132, 0139) | Fonts from the library (TrueType, OpenType with CFF, WOFF, WOFF2, variable fonts), real bold and italic files, kerning, OpenType features and axes, several fonts in one text. No font is bundled beyond the one for the interface (the owner chooses if one should be). |
| Text: underline, strikethrough, colour and size of a range, links, nested lists, gradient, outline, case, line limit, set height, text on a path | Done (ADR 0130, 0131) | Markdown with `<u>`, `~~`, `<span style>`. |
| Note tool (a text on a card) | Done (ADR 0140) | Key M. |
| Text: bidirectional text, IME, text-to-path export | Done (ADR 0102, 0132) | UAX 9 order and Arabic joining; an input method tested in Chromium (a synthetic composition; Firefox has none to drive). |
| Video: on-canvas player, repeat, seek step (3 s), Extract Frame, paused frame persisted, decoder budget, unsupported codecs | Done | ADR 0041 to 0046. |
| Video: crop, adjustments, playback speed | Done (ADR 0118, 0137) | |
| Animated GIF: real frame parser, 1-frame step, Extract Frame | Done | ADR 0042. |
| Audio: player, waveform, volume, repeat, 1 s step | Done | |
| Audio: trimming or range selection | Done (ADR 0112) | Start here, End here, Whole file; video has it too. |
| Content-type adapter architecture, future types (PDF, 3D) | Partial (ADR 0078, 0139) | Any file is kept and shown as a card with its kind; STL and OBJ cards show the model, a PDF card its page count. No PDF page is rendered and no other 3D format is read. |

## §5 Non-destructive editing

| Plan item | State | Note |
| --- | --- | --- |
| Per-object opacity and blend modes | Done (ADR 0047) | |
| Crop | Done for stills (ADR 0118) | |
| Mask | Done (ADR 0144) | |
| Exposure, contrast, highlights, shadows, temperature, tint, saturation, vibrance, RGB, curves, levels, blur, sharpen, grain | Done (ADR 0118, 0136) | |
| Editable, reorderable stacks; Copy and Paste Adjustments across image, video and GIF | Done (ADR 0118, 0136) | Layers of adjustments that can be added, reordered, hidden and removed. |
| Copy Rendered Media (adjustments baked in) | Done for stills (ADR 0118) | Copy as picture, and Make a new picture. |

## §6 Assets and search

| Plan item | State | Note |
| --- | --- | --- |
| Full Assets view beside Canvas view, one shared catalog | Done | ADR 0054, 0087 to 0095. |
| Import once, instances reference it; dedup by hash; missing detection and recovery | Done | ADR 0007, 0034. |
| Tags (several per asset, Obsidian rules, nested), favourites, nested folders (one folder per asset) | Done | ADR 0011, 0057, 0084. |
| Sorting, file-type filters, usage filter, Boolean search, suggestions | Done | ADR 0069, 0071, 0082, 0083, 0091. |
| Bulk tagging, folders, favourites, rename; direct placement; usage to instance navigation | Done | ADR 0058, 0077, 0085. |
| Metadata inspector | Done (ADR 0138) | Name, size, pixels, type, usage, tags, folder, and what the file says: EXIF, colour profile, PNG text, codec. |
| Search at large scale | Partial | A linear filter over the in-memory list; to be measured in Phase 8. |
| Independent collections | Decided against | One folder per asset plus tags (ADR 0057). |
| Dynamic smart folders | Decided against | Built (ADR 0035), then replaced by file types (ADR 0082). The plan still lists them. |
| Saved searches | Decided against | Left out (owner, 2026-10-17); recent searches that found something exist (ADR 0071). |
| Ratings | Decided against | Left out (owner, 2026-10-17); favourite only. |
| Filters by colour, dimensions, orientation, aspect ratio | Done (ADR 0114) | Filter words in the search; colour from the thumbnail. |
| Duplicate review, perceptual similarity | Done (ADR 0114) | The Similar images list; exact copies still merge on import. |
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
| ZIP64, archives above 4 GiB or 65,535 entries | Done (ADR 0115) | Written and read; the ceiling is the browser's Blob size. |
| Streaming export and import without the whole archive in memory | Partial (ADR 0115) | Built from Blob slices and verified by streaming; not measured at multi-GB sizes. |
| Hundreds of gigabytes, chunked or desktop-assisted fallback | **Gap** | Not offered. |
| Incremental backup chain; last verified backup shown | Done (ADR 0133) | A chain of files restores as one; the status is shown. |
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
| Storage and Backups tab | Done (ADR 0133) | Usage, quota, persistence, and backup, export and import. |
| Performance tab | Done (ADR 0135) | Adaptive quality, the quality held when it is off, memory for pictures, animation and speed. Canvas 2D is the only backend (ADR 0002). |
| About and Diagnostics tab | Done (ADR 0135) | Version, what the browser can do, the errors of the session, licences and a report to save. |
| Privacy tab, Collaboration tab | Partial | Explanations only. Nothing to set while there is no network and no collaboration. |
| Command palette; Settings reachable from it | Done (ADR 0117) | Ctrl+K. |
| Minimap or overview, tours or presentation paths, camera transitions | Partial (ADR 0116) | Tour of the bookmarks and gliding done; a minimap is decided against (no bounds, objects at every depth). |
| Navigation history (previous view) | Done (ADR 0116) | Alt+Shift+Left and Alt+Shift+Right. |
| Context menus, drag between panels, detachable surfaces | Done (ADR 0123, 0141) | A right click on the canvas; panels drag, stack, float and fold, by keyboard too. |
| Contrast validated against actual ratios | Done (ADR 0141) | `a11y.spec.ts` computes the ratio of every visible text in both themes and three views. |

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
| Copy Original Asset, Copy Rendered Media, Copy Adjustments | Partial (ADR 0118) | Rendered and adjustments done; the original is "Download the original". |
| System-clipboard image paste, directory import, remote URL import (optional) | Partial (ADR 0134) | A picture on the clipboard and a dropped or chosen folder are imported (the folder's files filed in library folders); a remote URL is not (no network by design). |
| Single file, `file://`, no network (checked by tests), reproducible build | Partial | The build prints a hash and the offline check passes; a clean-machine test is Phase 9. |
| U1, U2, U4, U5, U7, U8 | Done | `editing.spec.ts`. |
| U3, U6, U9, U10 | Done (ADR 0141) | `scenarios.spec.ts`. |
| U11 (CPU-only), U12 (crop or adjustment under an overlay) | Partial | U11 runs in the `chromium-cpu` project; U12 cannot exist until there is crop or an adjustment. |
| Scenarios I (dual views) and J (hierarchy) | Done (ADR 0110, 0141) | I: `scenarios.spec.ts` (1,000 switches, nodes, listeners and heap); J: `organize.spec.ts`. |

## §14.41 and roadmap

| Item | State | Note |
| --- | --- | --- |
| Local and online collaboration, roles, E2EE | **Gap (optional)** | Phase 10; Settings says it is off. |
| Phase 8 Scale and compatibility | Not started | Large projects, qualification matrix, file-origin upgrade. |
| Phase 9 Standalone release | Not started | A single file, README and `THIRD_PARTY_NOTICES.md` exist; no clean-machine test and no reproducible-build check. |
| Phase 5 Creative editing | Partial | Pens, eraser, text, notes, arrange, picture crop and adjustments, vectors done; the long tail of Vectors II (above) is not. |

## What to look at first

| Order | Gap | Why |
| --- | --- | --- |
| 1 | PDF page rendering and other 3D formats | A renderer to ship offline (its size in the single file is the cost) |
| 2 | Phase 8 (large projects, search at scale, qualification matrix, update-safe origin) and Phase 9 (clean-machine test, reproducible build) | Each is a phase of its own in `docs/status.md` |
| 3 | Hundreds of gigabytes; streaming archives measured at multi-GB sizes | Not offered; the browser's Blob size is the ceiling |
| 4 | 60 and 120 FPS on reference devices; cold and warm startup benchmarks; a low-memory tier | Need devices and a recorded method |
| 5 | Networks: split edges where they cross, a fill per region | Needs curve intersection on edges; ADR 0146 |
| 6 | A layer clipped to the layer below (a toggle on a Layers row); the clipping mask of ADR 0144 works the other way round (the top shape cuts what is below) | Asked for 2026-10-18; needs a marker on the layer and the clip following moves and reordering |

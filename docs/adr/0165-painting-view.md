# ADR 0165: the Painting view (P1)

- Status: accepted (v0.28.0, 2026-10-21)
- Related: ADR 0164 (the brush engine as WebAssembly), ADR 0007 (reference-checked GC), ADR 0008 (archives), ADR 0068 (menus), ADR 0156 (panels), ADR 0017 (settings)

## Owner's rulings

The Painting view is a **separate view**, like the Library, the Canvas and Settings, with its own rules: **no endless zoom**, and pages and layers are measured in **units (px by default), not ratios** as sheets and what is on them are on the canvas. A first attempt that put painting inside the canvas was thrown away for this reason. The brush engine is WebAssembly (ADR 0164); brush presets will be workspace data (P2); the engine's source is named only in `THIRD_PARTY_NOTICES.md` and the build step that fetches it.

## Decision

**Documents.** A painting is its own record (name, ordered pages), stored per workspace; a page is width and height in whole px (up to 8192), a DPI and a background (a colour or none). A layer is a record of its own (`paintLayers`, one per layer so a stroke writes one small record) with the fields every layer has (page, `z`, name, opacity, blend, hidden, locked, clip to the layer below) and its kind's own (`LAYER_KINDS`, typed over the kinds: P1 has `raster`, with `alphaLock` and a tile map). Clip to the layer below takes the nearest layer under it that is not clipped (several clipped layers share one base); a hidden base hides them.

**One edit path.** Every edit is a list of record replacements (`Op`: a layer or the painting as it was and as it is). `commit` applies it (the only place records change), draws again only the tiles whose hash changed, stores it (one transaction, read back) and puts it on the history; undo and redo apply the same list backwards or forwards. A new kind of edit is a list of ops and gets undo, storage and redraw with nothing more. The history is the painting's own; its tile hashes are roots of the tile GC.

**Tiles.** 256 px (the engine's), named by the SHA-256 of their straight RGBA pixels and stored once, deflated with `CompressionStream` (exact: a PNG through a canvas premultiplies and shifts soft edges). Undo never copies pixels. `PaintStore.collect` erases a tile when no stored layer and none of the open painting's roots names it (after a painting is closed or deleted).

**Strokes.** The engine runs in a worker (ADR 0164) that holds only the layer being painted (loaded from the tile map, with a cache of pixels by hash so undo and layer switches do not decode again; `adopt` tells it a stroke's result is the layer's new version). While painting, the worker sends the stroke's coverage 64 px at a time (an engine patch, `engine/patches/0001`, reads a coverage tile in one pass: 1.1 ms a frame for a 500 px brush instead of 16 ms) and the view draws the layer with it (normally, `source-atop` with alpha lock, `destination-out` erasing). When the stroke ends, the engine composites once and the worker returns the changed tiles, hashed and deflated; the layer takes them in one step. A new stroke waits for the previous one to end.

**Display.** Each layer of the shown page is one page-sized canvas (seamless at any zoom; tiles are the unit of storage and of the engine, not of display). `composePage` draws the background and the layers with opacity, blend and clipping, the same function for the view (at the camera, a checkerboard under a transparent page, square pixels from 200 %) and for an export (1:1). The camera is plain numbers: zoom from a sixteenth of the fitted page to 64×, the page kept partly in view.

**Tools.** `TOOLS` (Brush, Eraser, Hand): each declares its options as a schema that builds the options bar, checks the stored values (`paint.tools`, device scope) and becomes the engine's brush (`brushOf`). Keys are the Paint view's own (`B`, `E`, `H`, `[` `]`, `Ctrl+0`, `Ctrl+1`, `+` `−`, `Space`), active only while it is shown (`shortcutsActive(e, "paint")`).

**To the canvas.** A page leaves as a PNG (Export) or as a library picture placed on the canvas (Place on the canvas): from then on an ordinary picture; the canvas never holds painting records.

**Archives** (version 5): a workspace archive carries `paintings.json` and each tile once under `paint-tiles/<hash>`; import checks every tile (inflates to a tile, hashes to its name), leaves out a painting with a damaged part and says so, and writes paintings with new ids in the import's single transaction.

## Open decisions taken (the plan's recommendations)

- Paintings belong to the workspace (listed in the Paint view), not to a board.
- A page placed on the canvas is a copy, not a live link.
- Units: px, in, cm and mm, stored as px.
- 8-bit RGBA layers.

## Not done (next phases)

Brush presets and the Brushes panel with `.abr` and JSON brush files (workspace data), the full Brush Settings sections, eyedropper tool, Pencil, rotate and mirror of the view, layer groups and masks, adjustment and fill layers, shape, text and picture layers, selections, fill and gradient, transform, the wet and retouch tools, OpenRaster, rebinding the Paint view's keys in Settings, a read-only tab following another tab's painting live, incremental backups that leave out unchanged paintings, the three-surface cache while painting (not built: a page draws every visible layer each frame; not measured with many layers), WebGL2.

## Tests

Unit: `tests/unit/painting.test.ts` (records, clip base, names and units, history inverse and roots, tool schema and brush, camera, tile codec). E2E (`LOGIC_ONLY`: Chromium and Firefox): `tests/e2e/painting.spec.ts` (stroke on the layer and the screen, undo and redo, reload; clip, hidden base, alpha lock, Eraser with and without alpha lock; mm at 300 DPI, new page, PNG export size, place on the canvas) and the archive round trip in `tests/e2e/archive.spec.ts`.

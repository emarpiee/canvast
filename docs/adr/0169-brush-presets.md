# ADR 0169: brush presets, brush files and Brush settings

- Status: accepted (v0.32.0, 2026-10-22)
- Related: ADR 0164 (the brush engine as WebAssembly), ADR 0165 (the Painting view), ADR 0168 (one chrome), ADR 0120 (styles), ADR 0123 (the panel dock), ADR 0162 (the Pattern panel's settings schema)

## Context

The Brush and Eraser had seven options (size, hardness, opacity, flow, spacing, pressure on size or opacity) although the engine models a whole professional brush: sampled tips, shape dynamics, scattering, texture, dual brush, colour dynamics, transfer, pose, noise, wet edges, build-up and smoothing, and it reads and writes `.abr` brush files. The plan asked for brush presets as workspace data, a Brushes panel with `.abr` and JSON import and export, and the Brush Settings sections built from the engine's schema.

## Decision

**A preset is the engine's own brush.** `paint/brushes.ts`: `{ id, name, group, folder, brush, captures }`, where `brush` is the engine's `BrushSettings` JSON as it is (unknown or missing fields are the engine's defaults; the engine checks the brush when a stroke begins). `captures` says whether picking it brings its size and its tool settings (opacity, flow, pressure switches), as the engine's presets do. `cleanBrushes` checks what is read back; a brush is at most 64 KiB of JSON.

**Bitmaps are kept outside the presets.** Every bitmap of a brush (a sampled tip, the dual brush's tip, a texture's pattern) is an engine *stored tile*: its key, its size and a preview at most 32 px a side. The key is the SHA-256 of its u16 samples, and the samples are stored once, deflated, in `paintTiles` beside the painted tiles. The list stays small however big the tips are. The engine (`engine/src/lib.rs`) takes bitmaps the page gives it (`tip_put`) and fills a brush's stored tiles from them when a stroke begins; a missing bitmap paints with its preview. The page sends each bitmap to the worker once, before the first stroke that needs it.

**Storage.** The list is one record of the `meta` store (`"brushes"`), for the whole library like the saved styles; a change writes the list and the bitmaps new to it in one transaction and reads the list back. A tab without the writer lease cannot change it. The tile GC (`PaintStore.collect`) keeps every bitmap a stored preset or a tool's brush names. The first time the list is read and has never been stored, it is the engine's built-in set (36 presets in four groups).

**Engine calls.** The worker answers `presets` (an `.abr` file's, mapped by the engine's own mapping, with what could not be kept as warnings; or the built-in ones), `abr-write` and `default` (the engine's default brush). Bitmaps taken out of presets are named `#n` by the engine and hashed in the worker; the page puts the hashes in their place (`withKeys`).

**Files.** Import takes `.abr` files (v1, v2, v6 and their folders; the presets go in a group named after the file) and canvast brush files (`.json`: `{ format: "canvast-brushes", version: 1, presets, tips }`, the bitmaps deflated in base64; a bitmap whose hash does not match its name is refused, with the presets that need it). Export writes either: a canvast file keeps everything; an `.abr` (version 2) keeps the tip and spacing, the part every painting program reads.

**The tool's brush.** A painting tool's state (setting `paint.tools`) is its options bar's values, its brush, and the preset it came from. The engine's brush for a stroke is the tool's brush, with the bar's values (size, hardness, spacing, opacity, flow, pressure) and the colour over it (`brushOf`). Picking a preset sets the tool's brush and the bar's values it captured.

**Brush settings: one schema.** `BRUSH_SECTIONS` lists the sections and their settings as paths in the engine's brush (`shapeDynamics.size.jitter`), in the Pattern panel's setting kinds (range, toggle, choice; ADR 0162) with a scale for the panel's units. The same schema builds the panel, reads and writes the brush (`getPath`, `setPath`) and is checked against the engine's default brush by a unit test, so a misspelled path fails the build's tests. A setting that is one of the bar's values (Tip: size, hardness, spacing) is the bar's value. The rows are the Pattern panel's own, moved to `ui/setting-rows.ts` and shared. A row whose setting the brush does not have (the pattern style of a texture that is a picture) is hidden.

**Panels.** Brushes and Brush settings are panels of the dock (ADR 0123) on the left stack, shown only in the Paint view; buttons at the ends of the painting tools' Properties bar open them, the Brushes button naming the picked preset.

## Consequences

- A new section of the engine is one `BRUSH_SECTIONS` entry; a new file format is one branch of the import and one export.
- Brush presets are not in `.canvast` archives or backups yet (as the saved styles are not); they move between libraries as brush files.
- The engine's section locks, response curves, the brush's blend mode, the texture's pattern picture and the tip's own picture are not editable in the panel yet; they come with the preset.
- The WebAssembly grows by about 230 KiB (the `.abr` mapping).

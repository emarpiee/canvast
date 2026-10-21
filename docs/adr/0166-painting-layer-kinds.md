# ADR 0166: shape, text, picture, fill and adjustment layers in the Painting view (P2, first part)

- Status: accepted (v0.29.0, 2026-10-22)
- Related: ADR 0165 (the Painting view), ADR 0144 (masks), ADR 0136 (adjustments), ADR 0162 (pattern generators), ADR 0068 and 0151 (menus)

## Context

The plan for the Painting view puts shape, text and picture layers, fill layers and adjustment layers in P2, "the canvas's path geometry, text layout and picture drawing reused; the canvas's coordinates, frames and ratios not". Writing a second renderer for paints, gradients, textures, outlines, fonts and pictures would copy thousands of lines and drift from the canvas.

## Decision

**A page pixel is a world unit of the canvas at zoom 0.** Shapes, paths, texts and pictures on a page are ordinary canvas objects at the page's origin in the world frame of one fixed `FrameSpace` (no other frame is ever needed: the view does not zoom endlessly). They are stored as the canvas stores them (`SerializedObject`) and read back by the canvas's own reader, so a damaged object is caught the same way. They are drawn by the canvas's renderer (`drawObjects`) through a camera made from the view's placement (`paint/objects.ts`). No Dyadic or frame logic leaks into the rest of the Painting view: positions in its records and tools are page px.

**Layer kinds** (`LAYER_KINDS`, typed over the kinds, with label, icon, validator and a fresh record):

| Kind | Holds | Drawn by |
| --- | --- | --- |
| `raster` | tiles | its pixels (and the live stroke) |
| `object` | canvas objects; optionally `gen` (a pattern's generator, seed and values, so *New seed* makes it again) | the canvas renderer |
| `fill` | one `Paint` (colour, gradient, texture) over the page | the canvas renderer, as a page-sized rectangle |
| `adjust` | an `Adjust` stack | `adjustInto` on the page drawn so far |

`compose.ts` has a `RENDER` registry over the same kinds; clip, opacity and blend are handled once for every kind. An adjustment at full opacity and not clipped replaces what is below; otherwise its result goes over it like any layer. A picture that is not decoded yet makes `composePage` report *pending*, and the view draws again.

**Tools** join `TOOLS` with option kinds `choice` and `paint` (a paint stored as text, checked with `paintFromText`): Move (`V`), Shape (`U`: rectangle, ellipse, polygon, star, line), Text (`T`) and Edit nodes (`N`), all routed to `paint/vector-tools.ts` with handles from `paint/handles.ts`. Node editing shares `doc/node-edit.ts` (`bakedPath`, `rebuiltPath`) with the canvas's Edit nodes tool, which now calls it too.

**Rasterize** draws a layer's look at 1:1 (`paint/rasterize.ts`), cuts it into tiles and replaces the layer with a raster layer of the same id in one undo step. Brush and Eraser refuse a non-raster layer with a message pointing to Rasterize.

**Assets.** `assetsOf(layer)` lists the pictures, fonts and textures a layer uses; the library's GC (`asset-catalog.ts` collect) keeps them while any layer names them. A picture imported in the Paint view is a library asset, like one placed on the canvas.

**Paste.** Objects copied on the canvas come as one object layer, scaled to the size they were seen at and fitted to the page; a copied picture comes as a picture layer. Objects copied deep inside a zoom (not at depth 0) are refused with a message, since a page has no frames.

## Consequences

- Fills, outlines, gradients, textures, adjustments, fonts and pictures look exactly as on the canvas, and every later improvement to them reaches the Paint view with no change here.
- An adjustment layer is worked out on the CPU at the view's size on every draw; heavy pages with several of them draw more slowly (listed in Limitations). A cache of the page below is the fix if it matters.
- Still to come in P2: brush presets as workspace data, the Brushes panel with `.abr` and JSON, the Brush Settings sections, eyedropper, Pencil, view rotate and mirror, raster layer masks.

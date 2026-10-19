# ADR 0154 — Texture fills: a picture or a pattern as the fill of a shape

- Status: accepted (v0.20.0)

A shape can be filled with a picture of the library (**Image**) or with other objects of the canvas repeated over it (**Pattern**). Both are one kind of paint, `TexturePaint` (`doc/texture.ts`), so there is one set of controls, one drawing path and one place in the document. Modelled on the fills of a design tool (an image in four modes, a pattern made from any object with a tile type, scale, spacing and alignment), with more control where this app's exact numbers make it cheap: free rotation and an offset.

## The paint

`{ type: "texture", src, mode, scale, rotation, offset, tile, spacing, align, avg }`.

| Field | Meaning |
| --- | --- |
| `src` | `{ kind: "asset", hash }` (a picture of the library) or `{ kind: "objects", ids }` (objects of the canvas, drawn as one tile, with what is on them). |
| `mode` | `fill` covers the shape (the overflow is cut), `fit` shows all of the picture, `crop` is `fill` with the controls free, `tile` repeats it. A pattern is always `tile`. |
| `scale` | 1 is natural: a repeated tile's longer side is a quarter of the shape's box (`TILE_SHARE`); a placed picture covers or fits the box. |
| `rotation` | Degrees, about the middle of the box, on top of the shape's own turn (any angle). |
| `offset` | Shares of the box, so the texture moves with the shape. |
| `tile`, `spacing`, `align` | Repeated tiles: the grid (`rect`, brick rows `hex-h`, brick columns `hex-v`), the space between tiles in shares of the tile, and where a tile lies in its cell. |
| `avg` | The source's average colour, `#rrggbb`: what the texture is where it cannot be drawn (see below). |

Everything is measured in the shape's own box, like a gradient (ADR 0100), so the texture follows the shape when it is moved, stretched or turned, and a stored paint never holds a pixel or a world number. `layoutOf` (pure, unit-tested) turns a paint and a box into the tile's place; `nearOrigin` moves a repeated layout by whole cells to near the view so the numbers stay small at any depth.

## One drawing path

`canvasPaint` (`render/gradient.ts`) is the one place a paint becomes something to fill with. For a texture it returns a `CanvasPattern` made by `render/texture.ts` and placed by one matrix (view, then the box's frame, then the cell's own pixels), so fills, the tile cache, the density preview, Export and PNG/WebP/JPEG/PDF pages all show it without knowing about it.

- A picture on a plain grid is the picture itself (full quality). Spacing and brick grids make a small **cell canvas** (the tiles and their gaps, with the copies that cross the cell's edges), cached by source, size and grid (least recently used, 24).
- A pattern's tile is the objects drawn by Export's own drawing: `renderExport` was split into `paintExport` (one drawing, true while pictures are still decoding) and the loop that waits. A tile is at most 2048 px; deeper than that a vector tile softens (a known limit).
- `app/texture-host.ts` gives `render/texture.ts` its pictures (`AssetLibrary.get`) and tiles once, with `setTextureHost`. A texture whose picture is not decoded yet is drawn as its average colour and `takeTexturePending` tells `drawObjects`, so the tile cache does not keep it.
- Tiles smaller than 2 px, and a view deeper than doubles can tell, draw the average colour. A pattern inside a pattern is not drawn (a shape that is its own source cannot loop).
- A pattern depends on other objects, so `main.ts` keeps the shapes that use one and invalidates their tiles when a source changes.

## In the document

- A texture is valid on a **fill** only (`isPaint(v, true)`); outlines, text, region fills and masks refuse it. `isGradient` no longer means "any object" (a texture has no stops).
- A path whose fill is a picture is stored with `assetId` = its picture's hash (`serializeObject`, `assetOf`, `storedAssetOf`), the key the library's usage count, reference-checked deletion, archives and ZIP exports already use: the picture is kept while a shape is filled with it, and travels in `.canvast` archives.
- `solidOf(paint)` is one colour standing for any paint (a colour, a gradient's first stop, a texture's average): the swatches, the SVG export, the Layers list. The vector PDF gives a page with a texture to the picture path.

## What the person can do

Fill, on a picked shape: the paint chooser offers **Image** and **Pattern** after Angular. **Pick on the canvas** (a click on a picture, or on what to repeat: groups give all their members; Esc cancels; the chooser stays open) or, for an image, **Choose a file…** (taken into the library, filed under Fills). Then Mode, Scale %, Rotation °, Offset X/Y %, and for a repeat Grid, Align and Space across/down %. One undo step for each change.

## Not done

Textures on outlines and text; the image adjustments (exposure, contrast and the rest) on an image fill; handles on the canvas for the offset and the tile; a pattern that keeps its tile when its source is deleted (it falls back to its average colour); sources that are on another canvas (after a paste, the ids point at nothing there); a live pattern while its source is being dragged (it follows when the move ends); a vector tile sharper than 2048 px.

## Update (v0.21.0, 2026-10-19)

- An image fill is first chosen **from the library** (`ui/library-picker.ts`), then from the canvas, then from a file.
- Where the texture is too deep to be drawn as a pattern (the coarse view), the shape shows the colour of the texture at that point (`textureColourAt`, sampled from a small copy of the source), no longer the average of the whole.
- A shape keeps showing its last pattern while the next is being made (a picture decoded at a new size), so a fill does not blink to its average.

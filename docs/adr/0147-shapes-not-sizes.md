# ADR 0147 — Shapes, not sizes: sheets have a ratio, export chooses the size

- Status: accepted (v0.19.1)

A sheet, a picture or a vector has a **shape** (width ÷ height) and a position, never a size in px. The canvas is endless and exact, so a "size in px" only ever meant "px of the zoom you happened to be at": 0.0035 at depth, different at every zoom, and confusing (ADR 0121 and its screen-px stopgap are superseded). The size is chosen where a size means something: when the thing leaves the canvas.

## On the canvas

- **Sheet bar:** *Ratio* (a text field: `16:9`, `3/2`, `1.5`, `A4`, `A4 portrait`, `letter`, `square`; shown as short words: `3 : 2`, `1 : 1.414`), a *Shapes…* list (basic, screen, paper, social), *Turn* (portrait ⇄ landscape) and *Scale contents*. A new ratio keeps the **area** and the top-left corner, so the sheet does not jump; what is on it follows its pin (or scales, with Scale contents), as with a handle resize. The small outline beside the field is the shape itself. `src/app/export-size.ts` holds the pure parts (parse, show, presets, units, suggestions); `sheetRatio` / `setSheetRatio` in `actions.ts` the edit.
- **On sheet fields (X, Y, W, H)** are per cent of the sheet, measured in the sheet's own units so they are plain numbers at any depth. Dragging a name moves a tenth of a per cent per pixel.
- Nothing stored changes: geometry is exact as before; only what is shown and typed changed. Typed sizes (the Size fields, the unit and the size presets) are gone.

## Export…

The Actions bar (picture-up icon), the sheet bar and the command palette open one dialog (`ui/export-dialog.ts`) for what is picked: a **sheet** (its own box, with what is on it) or **the picked things** (their box, with half the widest outline added; only they are drawn, not what lies behind). The target is `exportTarget` (`actions.ts`); the picture is drawn by the canvas's own code on a canvas of the chosen size, the camera fitted so the box covers it (`export-render.ts`): sharp at any size and any depth, waiting for pictures that are still decoding.

- **Size from the shape.** Width and height are linked by the ratio: type one, the other follows. Units px, in, cm, mm at 72, 96, 150, 300 or 600 ppi; a physical size stays what it is when the resolution changes (5 in at 150 ppi is 750 px, at 300 ppi 1500 px). All units are shown at once under the fields.
- **Sizes the shape is made for** are offered first (A4/A3/A5/A6 at 300 ppi, Letter, 4×6 and 8×10 photos, Full HD, 4K, story, link preview, banner …; a single whole picture offers its own pixels as *Original*), then 640, 1080, 1920 and 3840 px wide and 4, 6, 8 and 12 in wide at 300 ppi, each with the height that keeps the ratio. The first exact one is the size it opens at.
- **File:** PNG, WebP (falls back to PNG), JPEG with quality; background transparent, white or black (JPEG has none); **SVG** when everything picked is vector, sized in the unit chosen (`width="5in"`). Name proposed as `name-WxH`.
- **Limits:** 16,384 px a side and 120 MP in all; the dialog says when a size is capped and warns past 40 MP.
- **Output:** Download, Copy (PNG), or Save to library (the *Exports* folder and tag `export` by default, `export.folder` and `export.tags` in Settings > Media and playback; a pattern made by the Pattern panel goes to `pattern.folder` / `pattern.tags` instead, *Patterns* and `pattern`, ADR 0162; with the notice's View button).
- The last unit, resolution, format, quality and background are remembered in the browser.
- A live preview shows the shape (on a chequer when transparent) with its measures along the top and left.

**Several sheets** picked together (and nothing but them and what is on them) are exported together, in reading order: the width chosen is the width of each, each with the height of its own shape; they leave as a ZIP of files, or as **one PDF with a page for each** at the physical size (pixels ÷ resolution × 72 points; a JPEG inside when there is a background, deflated RGB with an alpha plane when it is transparent). Copy works for one picture only.

**Resolution in the file:** a PNG gets a `pHYs` chunk and a JPEG a JFIF density, so an editor or a printer reads the intended size (a 5 in picture says 5 in); `app/export-files.ts` holds these and the PDF writer.

Not done: a vector PDF (its pages are pictures), per-sheet sizes in one go, and the resolution in a WebP.

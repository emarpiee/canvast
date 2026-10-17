# ADR 0122: Styles: gradients, colours, palettes, gradient maps and GIMP files

## Status
Accepted (v0.17.0). Extends ADR 0120.

## Decision
- **Kinds.** The Styles registry (`assets/styles.ts`) now has Adjustment, Gradient, Colour and Palette. A kind says how to check its data, say it in a line, and `look` (a bar of CSS background, or a row of colours) for its card. `StyleLibrary` gained `update` (a palette or colour edited in place) and `duplicate`.
- **One place.** All of it lives in the floating Styles panel (the Assets view has no Styles card). Cards: an adjustment says what it does, a gradient shows its bar, a colour its swatch, a palette its strip; a palette opens to show its colours (press one to use it) or to edit them: change a colour (the colour picker), name it, add, remove; sort by hue or lightness; add the selection's colours; copy as CSS variables; duplicate; rename; delete.
- **Making.** A gradient is saved from the fill or outline picker (**Save gradient**, with the saved ones as bars to pick). A palette is made empty, from the colours of the selection, from the main colours of the picked picture (median cut, `assets/extract-palette.ts`), or from a colour and a harmony (analogous, complementary, split, triad, tetrad; the picker package's `harmonies`).
- **Applying.** A colour, a gradient or a colour of a palette goes on the fill of the picked shapes; **Apply to the outline** is in the card's menu. When several shapes are picked the person is asked: fill, outline or both (the same kind of question as for SVG and media).
- **GIMP files.** Gradients are read and written as `.ggr` (`assets/ggr.ts`, format: developer.gimp.org/core/standards/ggr), palettes as `.gpl` (`assets/gpl.ts`); Krita and Inkscape read both. Import takes several files at once and says what it skipped; export of several is a ZIP of files. A gradient segment that is not a plain RGB blend (curved, sine, sphere, step, HSV hue) is turned into extra stops so it looks the same; more than 32 stops are sampled; foreground and background end types are read as the colour written beside them. Photoshop `.grd` is not read (the format is unpublished).
- **Gradient map.** `Adjust.map` (`{stops, amount}`): the brightness of each pixel is looked up in a 256-entry table of a saved gradient and mixed with the picture by the amount. For video and GIF the same is an SVG filter (luminance, a 33-value transfer table, an arithmetic mix). Transparency in the gradient is not used. A saved adjustment keeps its map.

## Not done
- Photoshop `.grd`; ASE and ACO palettes; applying a palette to a picture as a map; gradient geometry (angle) is the saved gradient's own when applied.

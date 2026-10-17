# ADR 0127 — Fonts from the library

- Status: accepted (v0.18.0)
- Related: ADR 0078 (any file is a card), ADR 0007 (assets and clean-up), ADR 0126 (text look), ADR 0013 (text objects)

## Decision

- **A text can be set in any TrueType font in the library.** The font file is an ordinary library asset (content hash, stored once, a card like any file). A text names it in `assetId`, the same field pictures use, on purpose: the library's usage count, the "in use" check, the clean-up of unused originals, archives and file exports already follow `assetId`, so a font a text uses is never erased, travels with the canvas in a `.canvast` archive, and the library shows where it is used (`assetOf` and `storedAssetOf` in `doc/model.ts` are the one place that says which objects use which asset). No `assetId` = the bundled font (Inter).
- **What can be read** (`text/font-file.ts`): a `.ttf` (or an `.otf` with TrueType outlines) as it is, a `.woff` unpacked with the browser's `DecompressionStream`. PostScript (CFF) outlines, WOFF2 and collections are refused when imported, with a sentence saying what to use; nothing is stored then. The reader is the one used for the bundled font, so layout is the browser-independent layout of ADR 0013 for every font, and outlines (Ctrl+E) and deep zoom work the same.
- **One registry** (`text/fonts.ts`): `fontFor(hash)`, `familyFor(hash)`, `faceReady(hash)`. Layout, drawing, outlines, the coarse sampler and the editor ask it by the text's hash. A font not loaded (yet, missing from the library, another device before its archive was imported) is the bundled one, so text always has letters. The browser gets the font as a `FontFace` made from the bytes (no fetch). If the browser refuses the file, a canvas draws the letters from the outlines we read instead of `fillText`.
- **Loading** (`app/font-loader.ts`): when a text that names a font enters the document (a load, an undo, a paste), the font is read once from the library. When it arrives, layouts are dropped, the index, tiles and lists read the texts again (`DocumentStore.refresh`, which stores nothing and is not an undo step), and the canvas is drawn again.
- **Choosing:** a Font menu in the options bar (Text tool, text being edited, picked texts): the bundled font, the fonts in the library, and "Add a font file…", which checks the file, adds it to the library and sets the text in it. The font is part of the text look and of saved text styles.
- **Bold and italic** stay what they are for the bundled font: a second strike shifted right, and a slant. They are made, not taken from a bold or italic file; import the bold file and choose it for a real bold.

## Not built

Font families (regular, bold and italic of one family chosen together), variable-font axes, OpenType features and ligatures (layout has no kerning), CFF outlines, WOFF2, a font preview in the menu, licence text from the font file.

A note on licences: a font in a `.canvast` archive is copied with the canvas. Some font licences do not allow that; the person who imports the font is the one who knows.

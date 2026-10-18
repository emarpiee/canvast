# ADR 0130 — Text: looks of a range, fill and outline, box height, paragraphs, case

- Status: accepted (v0.18.1, built in slices; each slice adds its section)
- Related: ADR 0013 (text), 0102 (text as outlines), 0113, 0126 (text look), 0127 (fonts)

## Slice A: underline, strikethrough, a colour and a size of a range

- **Model.** A span (text/markdown.ts) may carry `underline`, `strike`, `color` and `scale` (a share of the block's size, 0.1 to 10), absent when default. The stored form stays Markdown, written in the forms other readers know: `~~strike~~`, `<u>under</u>`, `<span style="color:#rrggbb;font-size:150%">…</span>`. They are read as states like `*` (so a `<span>` does not nest), whitespace takes the looks its neighbours share, and the canonical form is a fixed point (fuzzed in `tests/unit/text.test.ts`). A `<` of the words is still written `\<`.
- **Layout.** A glyph has `k` (its range's size), `color`, `under`, `strike`; `glyphScale(line, g)` is the size to draw it at (every drawer uses it: draw-text, coarse, outline). A line is as tall as its biggest range, a line of small words is small; all glyphs share the baseline. `Line.decos` are the runs under and through the glyphs (same kind, size and colour), computed at the final places (after justify and alignment).
- **Drawing.** One fill pass per colour (nearly always one). A decoration is a rectangle added to the glyph path (doubles, or exact lines at deep zoom), so it is filled with the letters and at any depth. As outlines, the rectangles are joined with the letters of their line by a union; the colour of a range is lost there (a path has one fill).
- **Editing.** The editor bar has Underline (Ctrl+U), Strikethrough (Ctrl+Shift+X), Colour of the selected words (the colour picker, with transparency) and Bigger / Smaller (each press is 25% up or 20% down, relative to what the words sit in, so presses add up). Size is done by putting each run of selected text in a `span` (not `execCommand("fontSize")`, which reuses an element it finds); colour by `foreColor`; underline and strike by the browser's own commands. On commit the DOM is read back: decoration from the element or the ones it sits in, colour from the computed colour, size as the computed font size over the block's.
- **Not in a range:** font and letter spacing stay a whole-text look.

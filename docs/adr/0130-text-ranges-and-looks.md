# ADR 0130 — Text: looks of a range, fill and outline, box height, paragraphs, case

- Status: accepted (v0.18.1, built in slices; each slice adds its section)
- Related: ADR 0013 (text), 0102 (text as outlines), 0113, 0126 (text look), 0127 (fonts)

## Slice A: underline, strikethrough, a colour and a size of a range

- **Model.** A span (text/markdown.ts) may carry `underline`, `strike`, `color` and `scale` (a share of the block's size, 0.1 to 10), absent when default. The stored form stays Markdown, written in the forms other readers know: `~~strike~~`, `<u>under</u>`, `<span style="color:#rrggbb;font-size:150%">…</span>`. They are read as states like `*` (so a `<span>` does not nest), whitespace takes the looks its neighbours share, and the canonical form is a fixed point (fuzzed in `tests/unit/text.test.ts`). A `<` of the words is still written `\<`.
- **Layout.** A glyph has `k` (its range's size), `color`, `under`, `strike`; `glyphScale(line, g)` is the size to draw it at (every drawer uses it: draw-text, coarse, outline). A line is as tall as its biggest range, a line of small words is small; all glyphs share the baseline. `Line.decos` are the runs under and through the glyphs (same kind, size and colour), computed at the final places (after justify and alignment).
- **Drawing.** One fill pass per colour (nearly always one). A decoration is a rectangle added to the glyph path (doubles, or exact lines at deep zoom), so it is filled with the letters and at any depth. As outlines, the rectangles are joined with the letters of their line by a union; the colour of a range is lost there (a path has one fill).
- **Editing.** The editor bar has Underline (Ctrl+U), Strikethrough (Ctrl+Shift+X), Colour of the selected words (the colour picker, with transparency) and Bigger / Smaller (each press is 25% up or 20% down, relative to what the words sit in, so presses add up). Size is done by putting each run of selected text in a `span` (not `execCommand("fontSize")`, which reuses an element it finds); colour by `foreColor`; underline and strike by the browser's own commands. On commit the DOM is read back: decoration from the element or the ones it sits in, colour from the computed colour, size as the computed font size over the block's.
- **Not in a range:** font and letter spacing stay a whole-text look.

## Slice B: a gradient fill and an outline

- **Model.** `gradient` (a linear or radial gradient of doc/paint.ts, placed on the layout box of the text, 0..1 across and down) replaces `color` as the fill; a range with a colour of its own keeps it. `outline: { c, w }` is a line round the letters, its width `w` in em (a share of the size, so it scales with the text). Both are optional, validated, serialized, kept by saved text styles (applying a style that has neither takes them away) and counted in the box (an outline widens the padding).
- **Drawing.** The gradient goes through `canvasPaint` like a path's, on a stand-in path made of the text's box (no turn: a turned text is drawn in a turned view). The outline is the glyph outlines and decorations stroked twice as wide as `w` and drawn first, so the letters cover its inner half and `w` is the visible width outside them; a letter the font lacks has none. At deep zoom the outline uses the same exact path as the fill.
- **Options bar.** The text colour button now offers Colour, Linear and Radial (no None); beside it an Outline button (None or Colour) and a width field in px at this zoom (0 removes it). `openPaintPopover` takes `modes` instead of `solidOnly`.
- **As outlines** (flatten to path): the gradient and the outline are not carried over (a path has them of its own to set).

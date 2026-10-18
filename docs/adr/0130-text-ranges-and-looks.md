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

## Slice C: set height, paragraphs, nested lists

- **A set height** (`h`, local units, scaled with the text) makes the box that tall whatever the words need; `valign` (top, middle, bottom) places the words in it, never above the top (words taller than the box start at the top and run past it). `layoutOf` shifts the lines and caches the shifted layout by its layout, so the hot path is a lookup. A text without `h` is as tall as its words, as before.
- **Paragraphs.** `paraGap` is the space between paragraphs in em (default 0.6), `indent` how far the first line of a plain paragraph starts in (not headings, not list items; wrapping and justify take it into account).
- **Nested lists.** A list item has a `level` (0 to 5), written as two spaces of indent per level (a tab counts as two). Numbers count on per level (`listNumbers`: going in starts at 1, going out goes on with that level's count, a bullet or paragraph ends it); bullets go round `•`, `–`; the indent grows by 1.5 em per level. In the editor Tab and Shift+Tab make the item a level deeper or shallower (the browser's own indent and outdent), and the DOM, a list in a list or a list beside an item as Chrome makes it, is read back into levels.
- **Options.** One popover on the Properties bar (Paragraph and box options): paragraph space, first line, case, most lines, height, where the words sit.

## Slice D: case, a line limit, links, colour styles on text

- **Case** (`caps`: upper, lower, title, small): applied to the letters when they are set, so the words stay as typed (and the editor shows them with CSS `text-transform` and `font-variant-caps`). `ß` becomes `SS` in capitals; small caps draw lower case letters as capitals at 0.8 of the size, which is the same per-glyph size a range has.
- **A line limit** (`maxLines`): the layout is cut at the limit and the last line ends in `…`, taken back until it fits the width. Nothing is lost: the words are all there when the limit is taken away.
- **Links.** `[words](address)` in Markdown; only `http`, `https` and `mailto` addresses (anything else stays words, as typed), written with `( ) space < > " \` percent-encoded so the Markdown stays whole. Linked words are underlined; the editor bar has Link of the selected words (a small dialog, an empty address takes it away; the editor stays open while it is up); Ctrl or Cmd and a click on linked words in the Select tool opens the address in a new tab (`noopener`).
- **Colour styles on text and pen strokes.** A saved colour or gradient applies to the fill of a text (a gradient on its letters) or its outline, and to a pen stroke (one colour: the start of a gradient). The colours of the selection bar and Recolour cover texts and strokes too.

# ADR 0126 — The look of a text: size, alignment, width mode, colour

- Status: accepted (v0.18.0)
- Related: ADR 0013 (text objects), ADR 0113 (line height and letter spacing), ADR 0102 (text to path), ADR 0125 (mentions removed)

## Decision

- **One place for how a text is set** (`src/text/text-style.ts`): `TextLook` (size in screen px at the zoom it is read or applied, line height, letter spacing, alignment, width mode, colour), `lookOf` (read it off a text), `withLook` (apply it: values kept in range, a default never stored, the width refitted), `fitWidth`, `toolLook`. The options bar, the Text tool, the editor, the actions and saved text styles all use it. Layout takes the object (`layoutOf` in `text/layout.ts`), not a list of its fields, so a new field is added in one place.
- **New fields** on a text, both optional and absent when they are the default: `align` (centre, right or justify; absent = left) and `autoWidth` (true: the width follows the words, no wrapping except at a new paragraph, and `w` is kept equal to the widest line, so bounds, picking and scaling need no special case; absent = a set width the words wrap at).
- **Click and drag:** a click with the Text tool makes an auto-width text; dragging a box on empty canvas makes a text of that width (a drag narrower than 24 px is a click). A text is never given a set height: its height is always its words'. A set height with vertical alignment is not built.
- **Alignment** is part of the layout (em positions of the glyphs), so drawing, hit-testing, outlines (Ctrl+E) and the editor agree. Justify spreads the spaces of every line but the last of a paragraph; it needs a set width.
- **Colour** of a text may carry transparency (`#rrggbbaa`) and is chosen in the same paint chooser as shapes, limited to a plain colour (`solidOnly`): no gradient yet.
- **Options bar:** Colour, Size, Line, Letters, four alignment buttons and Auto width / Fixed width, for the Text tool (what the next text is), for the text being edited, and for picked texts. The alignment and width buttons do not take the focus, so a text being edited stays open and takes the change.

- **Text styles** are a Styles kind (`TEXT_KIND`): size, line height, letter spacing, alignment and colour (`cleanLook`, `styleOf`); the width mode is the text's own and is not part of one. The Styles panel has a Text styles tab: "Save from the text" keeps the look of the picked text, pressing a card applies it to every picked text through `withLook`, so an auto-width text is refitted.

## Not built

Gradient text, a set height and vertical alignment, per-range size and colour, underline and strikethrough.

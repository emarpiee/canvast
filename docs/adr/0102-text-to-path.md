# ADR 0102: Text converts to a path

## Status
Accepted (v0.17.0).

## Decision
**Convert text to path** (selection bar button, or Ctrl+E) turns the selected text objects into filled compound paths of the letters' own outlines, in place and as one undo step. It is the same object: its id (so an `@` mention of it still finds it), layer name (a name it did not have becomes its words), group, tags, place in the stacking order, opacity and blend. The result is a normal path (fill is the text colour, no outline), so it can be edited with Edit nodes, given a gradient, combined, exported.

**It reproduces what is drawn** (`src/text/outline.ts`). Each glyph of the shared layout is placed exactly as `drawText` places it: its quadratic outlines scaled by the line's size, italic sheared by `SKEW` about the baseline, bold as the outline together with a copy shifted by `BOLD_SHIFT_EM`; here the two copies are joined into one outline by a union, so the result has no edges inside a letter. A quadratic is a cubic with its handles two thirds of the way to its control point, which is exact, so the outlines are the font's own at any zoom (a path draws and picks like any other, edges exact at any depth). The text's turn is baked into the points: its pivot was the middle of the text box, not of the letters, and a path turns about its own middle.

**What it cannot do.** A character the bundled font lacks is drawn by the system font and has no outline we have; it is left out and the number is said in a notice. Hyphenation, kerning and ligatures are what the layout has (none). Mentions inside the text and the Markdown source are gone: it is a drawing now (undo brings the text back).

## Tests
`tests/unit/text-outline.test.ts` (the real bundled font: a letter's bounds equal its glyph's metrics where the layout puts it; the stem of I is filled and the counter of O is a hole; cubics are exact quadratics; lines, spaces and headings; italic leans, bold is one outline; missing characters counted; a turned text keeps its place), `tests/e2e/text.spec.ts` (Ctrl+E and the bar's button: same object, same place and about the same ink as the text, one undo; Chromium and Firefox).

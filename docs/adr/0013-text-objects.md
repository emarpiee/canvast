# ADR 0013 — Text objects

- Status: accepted (Phase 1, slice 8)
- Date: 2026-10-13
- Plan: §14.11 (typography and rich text)

## Context

Text is the next content type. It must be edited WYSIWYG, stored as real
Markdown (not editor HTML), and stay correct at any magnification, like
strokes and image pixels: a letter placed 3,000 levels deep and magnified
thousands of levels further must keep exact edges and a solid fill.

Browsers draw text well at ordinary sizes but give no guarantees for
glyphs thousands or 2^1000 pixels tall, and a font drawn by the browser is
not something canvast can project exactly. Options considered:

| Option | Result |
| --- | --- |
| Browser text only, capped zoom | Rejected: canvast has no zoom caps |
| Own engine for everything (glyph outlines at every size) | Exact, but loses the browser's quality and speed at reading sizes |
| **Hybrid** (chosen) | The browser at reading sizes; the font's real outlines, projected exactly, above them |

## Decision

### One bundled font

- **Inter Regular** (`@expo-google-fonts/inter` 0.4.2, `Inter_400Regular.ttf`,
  unmodified, SIL OFL 1.1) is embedded in the single HTML file (+~456 KB
  base64; the build is ~649 KB). Its licence is embedded with the other
  third-party notices.
- `src/text/font.ts` reads it: metrics (`head`, `hhea`), the character map
  (formats 12 and 4), advances (`hmtx`) and TrueType outlines (`glyf`,
  including composite glyphs). Outline coordinates are integers, implied
  midpoints and 2.14 fixed-point scales, so every point is an exact dyadic.
- The browser gets the same bytes as a `FontFace` built from memory. That
  is not a fetch, so the Content-Security-Policy needs no font source.
- **Characters Inter lacks** (CJK, emoji, …) use the system `sans-serif`.
  Their advance comes from the browser's measurement, so only text using
  them may wrap differently between systems.

### Model

`TextObject { md, w, size, color }` plus the common fields. The anchor is
the top-left corner. `w` (wrap width) and `size` (1 em) are local units.

- **`md` is canonical Markdown** (`src/text/markdown.ts`): paragraphs,
  `#`/`##`/`###` headings, `-` and `1.` list items, `**bold**`, `*italic*`,
  backslash escapes. `serialize(parse(md))` is the canonical form; loading
  (including archive import) canonicalizes, so hand-written Markdown
  (`__b__`, `* item`, `####`) is accepted.
- Emphasis delimiters toggle styles, and the serializer emits one delimiter
  run per change. Whitespace takes the style shared by its neighbours, so a
  delimiter never touches a space (ordinary Markdown readers parse the
  output the same way). Runs of whitespace collapse to one space; empty
  blocks are dropped. At most 100,000 characters.
- **Height is derived, not stored:** the layout is computed (and cached)
  from `md` and `w / size`. Bounds are the layout box plus 0.25 em on every
  side (italic overhang, bold, descenders).
- Text scales **uniformly** (resize changes `size` and `w` together).
  Picking, box/lasso selection and the drag rule are those of images.

### Layout (`src/text/layout.ts`)

All in em, independent of the browser: greedy word wrap with the font's own
advances (kerning off, no ligatures or contextual forms); words longer than
a line are broken by character. Line height 1.3; headings 2×, 1.5×, 1.25×;
block gap 0.6 em, 0.2 em between items of one list; lists indented 1.5 em
with a `•` or `N.` marker. The same numbers drive the editor's CSS.

### Drawing (`src/render/draw-text.ts`)

Every mode draws each glyph at its layout position, so switching modes does
not move anything:

| Case | Drawing |
| --- | --- |
| Up to 2,000 px per em, opaque | The browser draws each glyph with the bundled font (`fillText` per glyph, so the browser cannot shape or kern differently from the layout) |
| Up to 2,000 px per em, translucent | Outlines added to one path, filled once (one paint per object: overlapping glyphs never blend twice) |
| Above 2,000 px per em, or when the projection needs exact arithmetic | **Exact outlines** (below), one fill |

- **Bold** is the union of the outline and a copy shifted by 1/32 em;
  **italic** is a shear of 13/64 (≈ 11.5°) about the baseline. Both are
  exact in binary and applied identically in every mode. The browser is
  never asked to synthesize them for the bundled font.
- **Exact outlines.** Each outline piece (line or quadratic, in exact local
  units) is split at its midpoint (exact) until it either lies within
  2^14 px of the viewport, where it is drawn as is, or has its control box
  entirely outside the viewport (plus a margin). A far piece covers no
  visible pixel and only contributes to the winding number. Its control
  polygon cannot contain the viewport centre, so it sweeps less than half a
  turn around it. Consecutive far pieces become an arc of their total swept
  angle on a circle of radius 2^17 px around the centre, joined radially.
  Moving a point radially away from a convex region keeps it outside, so no
  visible point's winding number changes, and the canvas only ever receives
  bounded coordinates. Lines and glyphs are culled by their exact boxes
  first.
- **Characters drawn by the system font** are rendered once at 128 px per em
  and, at deep zoom, drawn like an image (exact pixel edges): they pixelate
  but never disappear.
- The density preview counts about 0.3 em² of ink per character.

### Editing (`src/ui/text-editor.ts`)

A native `contenteditable` overlay, placed over the object with the same
font, size, wrap width, line height and block spacing, hides the object on
the canvas while open. Chosen over a custom editor: native caret, selection,
IME and accessibility.

- **Text tool** (`T`): click to start a new text (16 px at the current zoom)
  or edit the one under the pointer. **Select tool:** double-click a text.
  Editing a text far smaller or larger than readable zooms to it first.
- **Format bar:** Bold, Italic, H1, H2, H3, Body, bulleted and numbered
  lists, Copy Markdown, Done. `Ctrl/⌘+B` and `Ctrl/⌘+I` are handled by
  canvast (Firefox does not bind them in editable content); `Ctrl/⌘+U` is
  blocked (no Markdown form).
- **Paste** inserts plain text only.
- **Commit** on Esc, Done, `Ctrl/⌘+Enter` or clicking away: the DOM is read
  back into blocks (styles from the computed style of each text run), then
  serialized. One transaction: Add text, Edit text, or Delete text when
  emptied. A read-only tab cannot open the editor.
- **Copy Markdown:** in the format bar, and in the toolbar when text is
  selected (all selected texts, in paint order, separated by blank lines).
  Uses the Clipboard API with a `copy` fallback.

## Consequences

- No zoom limit for text; tested at 4,000 levels beyond the placement scale.
- The overlay is the browser's layout, the canvas is canvast's: they match
  for the bundled font (same advances, no kerning). Lines containing system
  font characters can sit a few px lower in the editor (the fallback font's
  line box).
- Not yet: mentions, backlinks, cross-canvas links (the notes slice); other
  fonts and weights, alignment, letter spacing, colour per span, links,
  code, tables; bidirectional text and complex shaping (Arabic, Indic),
  combining marks positioned by the font; caret and selection geometry on
  the canvas itself (editing happens at a readable zoom).

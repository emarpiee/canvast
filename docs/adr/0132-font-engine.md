# ADR 0132 — The font engine: formats, variable fonts, features, kerning, families, text both ways

- Status: accepted (v0.18.1)
- Related: ADR 0013 (text), 0127 (fonts from the library), 0130 (text looks), 0131 (text on a path)

## What a font file can be now

| Format | How |
| --- | --- |
| TrueType (`glyf`) | as before (`font.ts`) |
| OpenType with PostScript outlines (`CFF `, and `CFF2`) | `cff.ts`: the Type 2 charstrings (subroutines, hints, flex, CID-keyed fonts with their font dicts, CFF2 `blend`) become the same lines and quadratics the TrueType reader makes: a cubic is split until a quadratic is within a tenth of a font unit of it. |
| WOFF (zlib) | as before |
| WOFF2 | `woff2.ts`: the tables are one Brotli stream; `glyf`/`loca` (stored as separate streams with packed "triplet" coordinates) and `hmtx` (stored without left side bearings) are rebuilt into ordinary tables, so the result is a plain sfnt the reader and a `FontFace` both take. |
| Collections (`.ttc`) | refused with a sentence |

**Brotli** (`brotli.ts`, RFC 7932): the browser's `DecompressionStream("brotli")` is used when it has it (Firefox does; the Chromium of the tests does not), else the app's own decoder, written to the RFC and checked against Node's encoder at every quality, mode and window size, on text, binary and random data, and against WOFF2 files unpacked both ways (`tests/unit/brotli.test.ts`, `font-woff2.test.ts`). The format's fixed data (the 122,784 byte dictionary, the 121 word transforms, the context tables) are in `brotli-data.ts`, taken from a reference build and stored deflated (the bundle grew by about 87 KB).

## Variable fonts

`variations.ts`: `fvar` (axes with their names and ranges), `avar` (the mapping of each axis), `gvar` (glyph variations of TrueType outlines, with the interpolation of the points a tuple leaves alone, and the deltas of composite offsets), `HVAR` and the `ItemVariationStore` (advance widths, and the regions CFF2 `blend` weighs). A text keeps `axes` (tag → value in the axis's units); `fontFor(ref, axes)` is an instance of the font at those values, cached by position (a value at its default is the font itself). A position is normalised the way the specification says; every delta is weighted by the scalar of its region. Without HVAR the advance comes from the phantom points of `gvar`. Hinting is not used, so no rounding is done to the moved points.

## Kerning, features, bold and italic

- **Kerning** (`kerning`, off by default so older texts keep their layout): `GPOS` pair adjustment of the `kern` feature (formats 1 and 2, extension lookups unwrapped), or the old `kern` table. It moves the second letter of a pair by the amount in font units; spaces and the edges of a run of one font and look are not kerned.
- **Features** (`features`, a list of `GSUB` tags): single, multiple and alternate substitution, and ligatures, chosen by tag across every script and language of the font (`liga`, `smcp`, `c2sc`, `tnum`, `onum`, `frac`, `zero`, `case`, `ss01`… are offered when the font has them). A letter a feature changed is marked (`PlacedGlyph.sub`) and is drawn from its outline: the browser can only draw a letter from its character. The contextual lookups (`calt` chains) are not read.
- **Families.** A bold or italic word is set in the family's own bold or italic file when the library has one (`variantOf`: same family name, closest weight; the glyph names its file in `face`), else the plain face is thickened or slanted as before. The CSS side is the same: every file of a family is one `FontFace` family with its weight and style, so the editor shows the very face the layout sets. A text keeps the face it was given: set in a bold file, its words are bold already.
- **Options.** Properties bar, Font options: kerning, the features of the font as switches (named in words), and a slider and number for every axis, with the font's family and style on top.

## Text both ways

`bidi.ts`: UAX 9 without explicit embeddings and isolates: each character's class, the weak and neutral rules, the implicit levels, and the visual order of a line (rule L2); brackets in right to left runs turn round. Layout keeps the letters in the order they were typed (wrapping works on that order) and sets each line in the order it is read; a paragraph's direction is its first strong letter. **Arabic** letters take their initial, medial, final and isolated forms from the font's `GSUB` (each form's lookups are applied to that letter only), then `rlig` and `liga`. Limits: alignment "left" is literal (a right to left paragraph is flush left until set right); marks (vowel signs) are not positioned on their letters (no `GPOS` mark attachment); the glyphs of a font that lacks the script are the system font's, one at a time, which do not join.

## Input methods

While an input method composes (`isComposing`), its keys (a candidate chosen or cancelled with Escape or Enter) are the method's, not the editor's commands: the edit stays open. Driven in a test through the DevTools protocol (Chromium).

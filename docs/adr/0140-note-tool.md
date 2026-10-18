# ADR 0140 — The Note tool: a text on a card

- Status: accepted (v0.18.1)

A note is a text object with a **card** (`card: { fill, pad, radius }`, fill a colour, pad and radius in em of the text's size). There is no second object kind: a note is edited, styled, picked, grouped, saved and exported as the text it is, and a text can be given a card or lose it at any time.

- **Layout owns the space.** `layoutOf` wraps the words inside `w − 2·pad`, moves every line, glyph and decoration in by `pad`, and returns a box `2·pad` bigger (or the set height). Bounds, picking, the editor, outlines and the deep-zoom sampler (between the letters the view is the card's colour, away from its edges) follow without a case of their own.
- **Drawing.** The card is a rounded rectangle of the whole box drawn behind the words (`roundRect`), under the same opacity and turn as the text.
- **The tool** (key `M`, changeable in Settings > Shortcuts, command "Note") is the Text tool whose new texts have the default card (yellow, 0.6 em of space, 0.3 em of rounding) and dark ink; the Text tool makes none unless its look says so. Options: Paragraph and box options has the card colours (none, yellow, pink, green, blue, orange, white), the space and the rounding.
- **The editor** shows the card too: the same padding, colour and rounding on the editing box, so nothing jumps when it closes.
- **Not in a style.** A saved text style does not carry a card.
- **Mentions and backlinks** stay out: mentions were removed in ADR 0125, and a note has no links of its own beyond those of the text it holds.

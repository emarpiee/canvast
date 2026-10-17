# ADR 0039 — Mentions in text (`[[item:<id>|label]]`)

- Status: superseded by ADR 0125 (mentions removed)
- Related: ADR 0013 (text editing), engineering plan §14.38 (mentions and backlinks)

## Decision

- **Syntax:** `[[item:<id>|label]]`, the stable object id first, the label after (`\` and `]` escaped). Ordinary `[` in text is always escaped (`\[`), so the form never collides with text. A mention is a `Span` with `ref` (the id); `text` is the label.
- **Atomic:** a mention is one unit: never merged with neighbours, never bold or italic by itself, never trimmed apart from its label. It is drawn bold italic (no renderer change); the editor shows it underlined and not editable inside.
- **Picker:** typing `@` in the text editor opens a small searchable list of the objects on this canvas (front first, up to 8); Enter or a click inserts the mention, Esc closes only the picker.
- The id is stored, not the label, so a rename or a move keeps the link; the label is a snapshot.
- Found by the round-trip fuzz: a heading ending in ` #` lost the `#` on reading; the serializer now escapes a closing `#` run.

## Not built yet (next slices)

Backlinks index and panel, jumping to a mention's target (also on other canvases of the same board), the picker listing other canvases of the board, a visible broken state when the target is deleted or moved off the board, relink.

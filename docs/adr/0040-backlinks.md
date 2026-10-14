# ADR 0040 — Backlinks, mention targets and the mention picker across a board

- Status: accepted (Phase 5, slice 6)
- Related: ADR 0039 (mentions), ADR 0024 (Layers panel), ADR 0006 (storage), engineering plan §14.38

## Decision

- **Derived index:** a stored text carries `refs`, the ids it mentions, computed from its Markdown on save and never read back; IndexedDB version 7 adds a multi-entry index `refs` on it and an index `kind` on `data.kind`. Backlinks of an object are one index read, with no text loaded to find them; a text edited to drop a mention loses the entry because the record is replaced whole. Records saved before version 7 have no mentions, so nothing needs rebuilding.
- **Board scope:** results are filtered to the canvases of the open board; ids are random and global, so a same-named object elsewhere can never match.
- **Layers panel:** with one object selected, a "Mentioned in" list shows the texts that mention it (this canvas read from the open document, other canvases from the index) and, for a text, a "Mentions" list of its targets; clicking a row opens that canvas and selects and frames the object (`Session.reveal`). A target that is not on the board (deleted, or its canvas deleted) shows as "Missing item".
- **Picker across the board:** below the open canvas's objects, `@` also lists matching texts and images of the board's other canvases (at most 6, read with a cursor over the `kind` index, never all at once), with the canvas name. Strokes can be mentioned only on their own canvas.

## Not built

Relinking a missing mention, a count badge on the target, clicking a mention in the drawn text itself (the panel is the way to follow it), mentioning strokes of other canvases, moving objects between canvases (no such command exists yet).

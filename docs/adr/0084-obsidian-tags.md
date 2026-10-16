# ADR 0084: Tags follow Obsidian's rules

## Status
Accepted (v0.17.0). Applies to library tags (ADR 0011) and in-canvas tags (ADR 0062).

## Decision
- A tag holds letters (of any script), numbers, `_`, `-` and `/`; no spaces or other punctuation; it needs a character that is not a digit (`#1984` is not a tag, `#y1984` is). Upper and lower case are one tag; the first spelling is kept. A tag is at most 64 characters.
- **Formatting, never refusing** (`src/doc/tags.ts`, `formatTag`): a leading `#` goes, spaces become `-`, other characters go, `//` and edge slashes are tidied, an all-digit tag gets `tag-` in front. When what was typed changes, a notice says what it was saved as. The Tags panel states the rules.
- **Nested tags:** `project/design` is under `project`. A `#project` search (library and canvas), a sidebar tag click and a tag filter find the tag and everything nested under it; renaming `project` renames `project/design` with it (library tags and in-canvas tags, on every canvas). A part of a tag is not a match (`#proj` does not find `project`).
- **Old tags are formatted once** at start-up, before any canvas is read: library entries and the stored objects of every canvas (flags `tagFormat` and `objectTagFormat` in the `meta` store; touched canvases get a new revision). An object read with an old-form tag is formatted instead of being skipped as damaged.
- Screenshot and frame tags (names of the board, canvas, video, your own) go through the same formatting.

## Consequences
"Cool Board" becomes `Cool-Board`; two tags that format to the same word merge into one (first spelling kept).

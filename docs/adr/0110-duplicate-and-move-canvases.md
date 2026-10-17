# ADR 0110: Duplicate, move and reorder canvases and boards

## Status
Accepted (v0.17.0).

## Decision
The **More** menu of a canvas row and of a board row in the navigator has **Duplicate**, **Move up**, **Move down**, and for a canvas **Move to <board>** for every other board.

- **Duplicate canvas** copies the stored objects, frames (coordinate spaces), saved view and bookmarks in one IndexedDB transaction (`WorkspaceRepo.duplicateCanvas`), after the open canvas has been saved, and opens the copy ("<name> copy", right after the original). Every object gets a new id and every link follows (`doc/duplicate.ts`: the sheet it is on, what it is attached to, groups and their names, boolean groups and results, mentions in text; a mention of an item on another canvas keeps pointing there), so the copy never leads back to the original. Assets are shared (originals are stored once; the copy adds references).
- **Duplicate board** copies a board with a copy of each canvas, after it, and opens its first canvas.
- **Move** puts a canvas or a board at a place in its list; a canvas may move to another board (a board keeps at least one canvas; the open canvas stays open and its board is updated).

## Tests
`tests/unit/duplicate.test.ts` (new ids, every link), `tests/e2e/organize.spec.ts` (duplicate, move up, move to a board, duplicate and move a board), both browsers.

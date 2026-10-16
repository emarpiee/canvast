# ADR 0071: Canvas search keeps its state, checks several results and remembers searches

## Status
Accepted (v0.17.0)

## Context
The canvas search closed after one choice and forgot its text, so picking several items or going back to a search took retyping.

## Decision
- **Stays open.** Choosing a result (Enter or click) selects it and brings it into view; the search closes only on Escape or a press outside.
- **Keeps its state.** Reopening (Ctrl+F, the dock button or `/ # @`) keeps the last text and way, with the text selected so typing replaces it. It is cleared only by the person: the × in the box, or emptying the text.
- **Checkboxes.** Each item result has a checkbox, and a "Select all shown" row sits above the list. Checked results are the canvas selection (the boxes mirror it), so a box adds or takes off one item and nothing moves. Enter with several checked brings them all into view; Ctrl+Enter checks the highlighted row; Shift+Enter checks every result.
- **Recent searches** (`localStorage` `canvast.search.recent`, 12 at most, this device only): a search is remembered only when it found something and the person acted on it (went to a result or checked one), so the list is searches that work. They show as chips when the box is empty (one press searches again, × removes one, "Clear recent" removes all).
- A typed `/` or `@` first in the box still chooses the way; a typed `#` stays (ADR 0069).
- **The library search matches it** (the scope is the only difference): the same ⓘ help, a clear ×, the ways All, Name and Tag (a first `/` chooses Name, Backspace on an empty box goes back to All), Recent chips of searches that found something and were used (Enter, or a card chosen), and `#tag` is an exact tag in both. Its tabs and chips are in a card under the box, shown while the box has the focus. Smart folders save the way (`SmartFolder.way`, absent = All). The library needs no checkbox column in the search because its gallery already has selection boxes.
- A row's ⋯ menu inside a blurred panel (the workspace menu) is placed against the window: `placeMenu` measures where (0, 0) really is.

## Consequences
History is a per-device convenience (ADR 0068's rule for browser storage): if storage is blocked the list is simply empty.

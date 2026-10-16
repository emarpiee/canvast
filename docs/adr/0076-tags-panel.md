# ADR 0076: A dedicated Tags panel

## Status
Accepted (v0.17.0). Moves the tag controls of ADR 0062 and 0070 out of the Layers panel.

## Decision
- A floating **Tags panel** (dock button with the tag icon, beside Layers and Bookmarks; device setting `ui.tagsOpen`, so it is remembered). It stacks under the other panels like they stack (ADR 0066).
- **On the selection:** the tags the selected items carry as chips (× takes one off; a dashed chip is on only some of the selected items), a box to add tags (Enter; a comma separates several), and the other tags of the canvas as one-press `+ #tag` suggestions.
- **On this canvas:** every tag with its item count, a filter box when there are many. Pressing a tag selects its items (Shift or Ctrl adds them to the selection). Its ⋯ menu (the shared More menu, ADR 0068): Select these items, Rename on every canvas, Delete from every canvas (ADR 0070).
- The Layers panel no longer has a tags row: it is the list and the selection's blend, opacity, rename, hide and lock. "Tag the selection" in the selection bar opens the Tags panel on its box.
- Zen mode (ADR 0075) fades it like the other panels.

## Consequences
The Layers footer is shorter, so its list gets more room. A tag is found by its name in one place, and a tag's items can be selected without searching.

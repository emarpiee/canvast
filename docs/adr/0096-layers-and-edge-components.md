# ADR 0096: Layers: the floating components on the edges are above everything on the canvas

## Status
Accepted (v0.17.0)

## Decision
Four layer tokens in `:root` (`src/styles.css`): `--z-item` (the picture a player draws over the canvas), `--z-item-bar` (the player's bar and the selection bar), `--z-item-pop` (the arrange menu opened from the selection bar) and `--z-edge` (everything floating on the edges: the board and view tabs, the toolbars, the dock, the rail, the status bar, the view controls, the side panels). `--z-edge` is above all the others, so nothing on the canvas covers an edge component whether it is selected, being moved or just placed. A new floating element takes one of these tokens, not a number.
Found in use: a GIF with a player, at the bottom of the view, was drawn over the status bar and the view controls (its layer was above their layer), and the selection bar landed on the player's bar (which had moved above the picture because there was no room below it).
The selection bar now looks at where the player's bar really is and takes the first place that is inside the view and clear of it: below the selection, above it, below the player's bar, above the player's bar; it looks once more after the player's bar has placed itself.

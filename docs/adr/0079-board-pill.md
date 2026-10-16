# ADR 0079: The board pill is the first control and the Canvas view's tab

## Status
Accepted (v0.17.0)

## Decision
- The top bar starts with one pill, `∞ Board 1 › Canvas 1 ▾`, then the Assets and Settings tabs. The word "Canvas" is said once (in the canvas's name); there is no separate Canvas tab.
- The name is the Canvas view's tab (selected look when the canvas is open, `aria-current="page"`). From another view it goes to the canvas; on the canvas it opens the board and canvas menu. The chevron always opens the menu.
- Each name is cut with an ellipsis to its own room (board up to 11 em, canvas up to 16 em), so a long name never pushes the tabs beside it; the tooltip has the full names.

# ADR 0061: canvas layout on phones

Status: accepted (owner request, 2026-10-16)

At 640 px wide and below the floating bars no longer share one row: row 1 is the view tabs and the workspace menu (the menu takes the rest of the width and truncates), row 2 is the dock (undo, redo, search, layers, bookmarks, import) spread across the width, row 3 is the options of the tool at full width. The tool rail starts below the rows (never under them) and the Layers and Bookmarks panels sit to its right, below the rows (`--bar-bottom` is measured from the stacked bars). `frames.spec.ts` checks at 360 px that none of these overlap or leave the screen.

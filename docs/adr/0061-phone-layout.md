# ADR 0061: canvas layout on phones

Status: accepted (owner request, 2026-10-16)

At 640 px wide and below the floating bars no longer share one row: row 1 is the view tabs and the workspace menu (the menu takes the rest of the width and truncates), row 2 is the dock (undo, redo, search, layers, bookmarks, import) spread across the width, row 3 is the options of the tool at full width. The tool rail starts below the rows (never under them) and the Layers and Bookmarks panels sit to its right, below the rows (`--bar-bottom` is measured from the stacked bars). `frames.spec.ts` checks at 360 px that none of these overlap or leave the screen.

**Assets view (same width):** the gallery is a two-column grid of square cards (the justified rows make one wide picture a whole row on a phone); the details are a sheet fixed to the bottom edge (at most 58% of the height, opaque, the gallery gets room to scroll past it); with the viewer open the library bar steps aside, the details stay hidden and the viewer controls wrap in two rows. `assets.spec.ts` checks it at 360 px.

**Medium screens (641 to 1180 px, 2026-10-19):** no layout of their own any more. The tool options stay on the top row between the tabs and the dock like on a wide screen, and scroll sideways (fade and arrow at the end that has more) when they do not fit. This replaces the earlier second row, which left the top row half empty.

# ADR 0092: Settings use the app's own panels and controls

## Status
Accepted (v0.17.0)

## Decision
An audit of Settings against the library and the details panel found: buttons (Back to canvas, Reset) and fields (selects, text, number) with their own heights, radii and borders instead of the shared control height (`--ctl`), radius and border; tabs as bare rows unlike the sidebar's rows; a flat page with no frame while every other panel is a framed card; the Shortcuts list narrower than the other tabs (a 640px cap) with its columns not lined up with theirs, and its small-screen rule undone by a later one; help and scope text dimmed with opacity instead of the muted token.
Now: the tabs are a framed panel of rows like the library sidebar's; each group of related rows is its own framed card with a title (Shortcuts: one for each of Tools, Step to the next item, View, and each group of the fixed shortcuts); the buttons look like `.assets-btn` and the fields like the library bar's; every row of every tab, Shortcuts included, has the same columns (text, control, where it is kept, Reset); muted text uses `--hud-muted`; everything comes from the tokens.

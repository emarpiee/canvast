# ADR 0091: List columns are properties, and headers sort

## Status
Accepted (v0.17.0)

## Decision
The library list has one column for each property of an asset: Name, Pixels, Type, Size, Used, Tags, Added, Folder, Favourite, Width, Height and Canvases (the old combined "Type and size" is now Type and Size; a saved layout that showed it shows both). Any but Name can be hidden or moved (the List columns button, or drag a header). A click on a header sorts by that property; a second click reverses it; the header shows an arrow (up for A–Z or low to high, down for high to low or newest first) and `aria-sort`. The Sort choice and button beside the search follow the headers and stay the one source of the order, so grid and list sort the same way.

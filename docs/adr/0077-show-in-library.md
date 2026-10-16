# ADR 0077: Show the selection in the library

## Status
Accepted (v0.17.0)

## Decision
- The selection bar has **View in the library** (the `library` icon), shown when the selection holds at least one picture, video or audio item.
- It opens the Assets view and calls `AssetsView.reveal(hashes)`: the viewer closes, the search, usage filter and way (All) are reset, the scope goes to All assets, the originals of the selected items are picked (the last one is open in the details), and the first is scrolled to the middle. Items whose original is no longer in the library are counted in the status line.
- Strokes and text have no original and are ignored.

## Consequences
The reverse of Show on canvas (ADR 0058's neighbours in the details panel): from either side, one press goes to the other.

## Update (v0.17.0)
The button is named **View in the library**. It no longer shows the whole library with these picked: it puts the names of the selected originals in the search (by name, `"a.png" OR "b.png"`), so everything else is filtered out and these are listed, still picked. A selection of more than 20 different names is picked in the whole list instead, as before.

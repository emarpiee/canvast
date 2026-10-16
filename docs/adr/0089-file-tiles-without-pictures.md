# ADR 0089: Files with no preview have a tile, not a picture

## Status
Accepted (v0.17.0)

## Decision
A file the browser cannot show (a 3D model, a document, a picture, video or sound it cannot read) is drawn in the library as a fixed tile made of the page icon, the extension and one general message, the same for every kind ("No preview for this kind of file"). It is part of the page (grid, list, filmstrip, details, viewer), not a stored thumbnail, so no thumbnail is made, stored or dropped for it and renaming a file does nothing to it. The tile and the bitmaps drawn on the canvas for these files (`card.ts`) use neutral greys (`--file-*`), not the theme colour, so they never clash with it. Neither shows the name or the size (both are in the details); the canvas bitmap of a video this browser cannot decode keeps its own shape, codec and size, with the same general message.
Thumbnails already stored for undecodable videos keep their old look until the asset is imported again.

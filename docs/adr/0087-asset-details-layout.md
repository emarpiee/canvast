# ADR 0087: The asset details panel layout

## Status
Accepted (v0.17.0)

## Decision
Order: the name (up to two lines), the preview, favourite and Place on canvas, a summary (type chip, pixels, size, use), the tags (and the in-canvas tags with the canvas each is on), the folder, where it is used, the actions (Rename, Download, Open in a new tab when a tab can show it, Export as archive, Delete alone at the end), and the technical details last. Sections are quiet cards with one heading style, one gap (`--sp-5`), controls from the shared tokens; the folder list scrolls when long and the actions are full-width rows so their words are never cut.

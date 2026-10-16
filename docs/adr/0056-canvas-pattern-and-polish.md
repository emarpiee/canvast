# ADR 0056 — Canvas pattern, workspace menu, library list and sort, and the fixes behind them

- Status: accepted (owner feedback of 2026-10-16/17)

## Decision

- **Canvas pattern.** A second button beside "Information shown" cycles Grid (default), Dots, Multi-scale grid (what the app always had: nested powers of four with the origin axes) and None; also Settings > Appearance > Canvas pattern (`ui.pattern`). The regular grid keeps its squares between 32 and 64 px with the next finer and coarser spacing fading across each doubling, placed from the exact remainder of the camera centre like every other mark. Landmarks (the orientation squares) are drawn in every pattern; None also removes the origin axes.
- **Workspace menu.** Boards are sections, canvases rows ("empty" or "12 objects", a check on the open one); "+ New canvas" and "+ New board". Each board and canvas has a **More** button that opens its actions as labelled rows (Rename, Export to a file, Delete), beside the button so the rows below stay reachable.
- **Library list and sort.** A List layout (a row per asset: picture, name, pixels, type and size, usage, tags; the header over its columns) beside Thumbnails. Every sort has a reverse button, and the choice says which order it is: Newest or Oldest first, Name A–Z or Z–A, Largest or Smallest first, Most or Least used.
- **Density** is compact by default (Settings > Appearance > Density > Comfortable for the roomier grid); the slideshow's seconds per slide is a setting (Settings > Media and playback).
- **Arrange menu** rows are plain rows with an icon, left-aligned, instead of toolbar buttons whose fixed height made a long label overlap the next.
- **Player.** The scrubber takes the whole top row of a wide bar.
- **One click opens the viewer** in the library; picking several starts from a checkbox, Ctrl or Shift, and then a plain click picks too. Esc clears the selection wherever the keyboard is.

## Bugs fixed on the way (found by the owner)

- Dragging a picture out of the library and letting go in the window **imported its thumbnail as a new asset** (the browser hands the dragged image over as a file). Library pictures are no longer draggable and a drag that starts inside the page is never a file import.
- The checkbox of a picked card was hidden when the card had focus and the pointer was elsewhere, and one stayed on after a click; it now follows hover, picking and keyboard focus only, and always shows on devices that do not report a hover.
- Pressing Esc right after opening the viewer left the library and details showing the wrong asset.
- Selecting or opening a card redrew the whole library (a flicker); the cards are only drawn again when something about them changed.

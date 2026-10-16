# ADR 0063: Figma-style resize, Alt-drag copies, Alt cycles the view, fit buttons

Status: accepted (owner request, 2026-10-16)

- **Handles:** the four corners and (for an upright box wide or tall enough) the middle of each side. A corner or a side of an **upright picture** (or a selection of only such pictures) is free: it follows the pointer in its axes, so the shape can change; a side changes one axis. Strokes, text, turned items and turned boxes keep their proportions whatever is held (a stroke's width and a text's glyphs cannot be stretched; ADR 0018, `scaleAbout`). A side handle on those scales uniformly about the opposite side's middle.
- **Modifiers while dragging a handle:** Shift keeps the proportions; Alt resizes about the middle of the box; Ctrl (or Cmd) turns snapping off. They can change during the drag.
- **Snapping:** the dragged edge (corner: both) snaps within 6 px to the left, middle or right (top, middle, bottom) of other visible objects, with the same guide lines as moving. With Shift on a corner only the nearer line holds and the other axis follows from the proportions. Snapping follows the "Snap and guides" setting.
- **Alt+drag the selection** starts the drag with a copy (placed exactly on the original, `duplicateSelection(…, 0)`) and moves the copy; the original stays. Alt+click (no drag) still cycles through overlapping items; Alt tapped alone does not fire when a pointer was pressed while it was held.
- **Alt tapped alone:** brings the selection into view; tapped again while the view is where it was left, it fits everything visible at this zoom (items from 4 px up to 16 windows, the same rule as stepping), and a third tap goes back to the selection. With nothing selected it fits everything.
- **Fit buttons** beside zoom out and in (bottom right): *Fit the selection in view* (disabled with nothing selected) and *Fit everything in view*, for screens with no Alt key.
- **Not done:** free stretching of strokes and text; resize handles for turned boxes' sides.

# ADR 0123: The panel dock

## Status
Accepted (v0.17.0).

## Decision
Every panel that floats over the canvas lives in one dock (`src/ui/panel-dock.ts`). A panel is any element with a `<header>` for a title bar; `dock.add(el, { id, title, side })` is all a new panel needs, and the panel stays unaware of the dock (it shows and hides itself with `hidden` and may redraw its own header).

- **Stacks and a free layer.** A stack on each side of the view and a layer for floating panels. Press and drag a title bar to float a panel anywhere (it is kept inside the view); drop it within 96 px of a side edge to stack it there (the edge lights up while dragging). On a narrow screen both stacks are one.
- **Used order.** A stack lists its panels in the order they were last used, the last used on top. A panel that is shown again, or unfolded, becomes the last used. A floating panel is raised by pressing it.
- **Folding.** Pressing a title bar (without moving) folds the panel to its bar, or opens it again.
- **Width.** Dragged from the edge towards the canvas, between `MIN_WIDTH` 240 px and `MAX_WIDTH` 480 px. The height is the panel's own content; a stack that is too tall scrolls.
- **Remembered.** Side, position, width and folded state of each panel, and the order, are the device setting `ui.dock` (written a moment after a change).
- **Auto-minimize (Settings > Panels).** `panel.autoFold`: Off; Keep only the active panel open; or Keep the latest few open, with `panel.keep` from 1 up to the number of panels (`settings/panels.ts`). It is applied to each stack on its own whenever a panel is used (shown, unfolded, dropped on a side) and when the setting changes; floating panels are never folded, and folding or unfolding by hand stands until the next use.
- **Keyboard.** `dock.commands()` gives the same moves to the command palette: dock on the left or right, float, fold or unfold, and Reset the panel layout.
- **Panels.** Layers (right), Bookmarks, Styles and Tags (left), and the **Adjust panel** (right), which used to be a popover: it now stays open, follows the picked pictures, and its gradient-map editor floats beside it as the usual picker panel.

## Not a dock panel
The storage status popover (opened from the save indicator), the colour, paint, outline and shape popovers, the command palette and the search are transient: they close on a press elsewhere, so they stay popovers.

## Tests
`tests/e2e/dock.spec.ts`: sides and used order, folding, floating, docking at an edge, width limits, reload, and the Adjust panel following the selection.

# ADR 0051 — The selection action bar

- Status: accepted (Phase 7, slice 4: contextual tools)

## Decision

- A small bar (`ui/context-bar.ts`) appears next to the selection with the actions most often wanted next: Duplicate, Group (when two or more units are selected), Ungroup (when something selected is grouped), Bring to front, Send to back, Lock, Hide, Delete. They call the same functions as the toolbar buttons and the shortcuts, so each is one undo step as before. The toolbar is unchanged.
- **Placement:** centred below the selection box (the rotate handle is above it); above it when the screen edge leaves no room; always inside the view. It follows pan and zoom because it is repositioned after every drawn frame.
- **When it shows:** a selection exists, the tool is Select or Lasso, nothing is being moved, scaled or turned (the preview is none), no text is being edited, and the Canvas view is open. It is a labelled toolbar ("Selection actions"), reachable by Tab.
- **Pointer:** presses on the bar do not reach the canvas; the canvas hover state (resize cursor) now ends when the pointer leaves the canvas onto any overlay (it used to stay until the next move over the canvas).

## Not built

Actions specific to the kind of object (colour and width of strokes, text format, media controls stay in their own bars), a customisable action list, and the bar for the Pen and Text tools.

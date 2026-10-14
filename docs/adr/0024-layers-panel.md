# ADR 0024 — Floating Layers panel

- Status: accepted (Phase 2, owner request of 2026-10-14)
- Related: ADR 0020 (groups and stacking), ADR 0021 (hide and lock), engineering plan §14 (layers)

## Context

Groups, stacking order, hiding and locking existed only as commands on the current selection. Nothing showed what is on the canvas, which objects are hidden or locked, or let the user act on an object that cannot be picked. A design tool's layers list solves all of these.

## Decision

A floating panel, hidden by default and toggled by the Layers button (or its own close button); the state is the device setting `ui.layersOpen`.

- **Content:** every object front to back, groups as expandable rows holding their members (the tree comes from the `groups` paths, `layerTree`), a kind icon and colour swatch, a name (stroke, "Image WxH", the start of a text, "Group (n)"), an eye and a lock. Hidden and locked rows are dimmed, so hidden objects can be found and shown again one by one. At most 500 rows are drawn (the front of the stack) with a note; virtual scrolling comes with the performance phase.
- **Actions, all through the same commands as the canvas:** click selects (Shift or Ctrl adds; a group row selects its members; locked objects can be selected here though not on the canvas), the eye and the lock set the flag on the object or the whole group (`setFlagOn`, one undo step), dragging a row onto another puts it just in front of it (`placeAbove`: the new z values sit in the gap between that row and the next one in front, so no other object changes; if the gap is too small the stack is renumbered).
- **Not built:** renaming layers (objects have no names yet), multi-row drag, keyboard navigation of the tree.

## Consequences

- The "no list of hidden or locked objects" limit of ADR 0021 is gone.
- Names for objects and layers are the natural next step, with the bookmark and search features.

## Update (Phase 5): opacity

The panel footer has an Opacity slider (5–100 %) for the selection; the renderer already painted opacity once per object (ADR 0010), so only the control and `setOpacityOn` were new. One undo step per release. Still not built: blend modes, renaming, per-row opacity.

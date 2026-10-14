# ADR 0031 — Oriented selection boxes, rotating from a corner, and select-by-touch

- Status: accepted (owner feedback of 2026-10-14 after testing rotation on a grid of 300 images)
- Related: ADR 0018 (rotation), ADR 0020 (groups), ADR 0024 (Layers panel), engineering plan Phase 2 (selection and transforms)

## Context

Testing rotation on a large grid of images showed four problems:

1. A selection box and each item's outline were screen-aligned bounding boxes, so turned items were wrapped in boxes that did not follow them.
2. The rotate handle sits above the top edge of the box; for a selection bigger than the view it was off-screen or under the toolbar, so the selection could not be turned.
3. After using a slider (pen size and others) keyboard focus stayed on it, and Ctrl+Z, Delete and the tool keys were ignored until the canvas was clicked: undo and redo "did not work".
4. A marquee or lasso took only what it fully enclosed (a stroke: at least half its points), so partly covering an item did nothing.

## Decision

**Oriented outlines (`render/selection-frame.ts`).** Every selected object is outlined by the rectangle it actually occupies on screen, turned with it (a stroke by the bounding rectangle of its points in the direction of its own rotation). A selection of several is boxed by a rectangle that turns with them when they all share one rotation (which is what happens after turning a group together), and by the axis-aligned box otherwise. The Select option "Axis-aligned selection box" (device setting `select.alignBox`) always uses the axis-aligned box. Resize handles sit on the oriented corners; resizing in a turned box is uniform (as for any turned object), so nothing shears.

**Reachable rotation.** The handle is kept inside the view and below the toolbar. A press within 30 px outside any corner (and outside the box) turns the selection about the box centre, like a design tool; Shift snaps to 15 degree steps as before.

**Shortcuts and stuck gestures.** Sliders, checkboxes and radio buttons no longer block canvas shortcuts (only text entry does). A gesture whose pointer is gone (a lost release, `lostpointercapture`) ends as cancelled, and a press never starts while a stale gesture is held.

**Select by touch.** A box or lasso takes any stroke that has a point inside it or a segment crossing its edge, and any image or text (with the "all" filter for the lasso) whose rectangle overlaps it. One exception protects drawing over media: a shape that lies entirely inside an image or text does not take it (lasso the strokes on a picture; click the picture to take it).

## Not changed

Rotation is saved with each object and survives every operation I could test (move, resize, group, stacking, hide, undo and redo, reload); a report that it did not is not explained by the code, and the save indicator is the first thing to read (an unsaved or read-only tab does not store it).

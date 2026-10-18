# ADR 0148 — Rounded corners and a border on pictures

- Status: accepted (v0.19.1)

A picture stays its own kind of object (the Assets pipeline, crop, adjustments, video and audio cards all rely on that) and gains two properties of shapes:

- `radius`: the corner radius in the picture's own units, the same at all four corners, never more than half the shorter side. The picture is cut to the rounded rectangle of its **whole box** (not of what is visible of it), so a corner that is off screen is still where it is.
- `border`: `{ color, width }`, a line (#rrggbb or #rrggbbaa) centred on the edge, drawn after the picture and following the rounded corners. The first border is white and a fiftieth of the shorter side; a width of 0 takes it away.

In the Properties bar of a picked picture: *Radius* (drag its name to scrub it), the border colour swatch (the app's colour popover, with transparency) and *Border* width. One undo step per change; the numbers being dragged are shown without being stored. Scaling a picture scales both (as the square root of the stretch), and a unit change keeps them. Export draws them (it is the canvas's own drawing). Both are stored with the picture.

Not done: a different radius for each corner, a border inside or outside the edge, picking by the rounded outline (a click in a cut corner still picks the picture), the radius and border in the copy-as-picture command, and a shape other than a rounded rectangle for a picture (a clipping mask does that).

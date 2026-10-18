# ADR 0148 — Rounded corners and an outline on pictures

- Status: accepted (v0.19.1)

A picture stays its own kind of object (the Assets pipeline, crop, adjustments, video and audio cards all rely on that) and takes two things from shapes, **with the same fields and the same controls**:

- `radius`: the corner radius, one value or one for each corner (top left, top right, bottom right, bottom left), in the picture's own units, never more than half the shorter side. The picture is cut to the rounded rectangle of its **whole box** (not of what is visible of it). It is the shape's own *Radius* field in the Properties bar (px at this zoom; four numbers for four corners).
- an outline: `stroke` (a solid colour; a gradient gives its start), `width`, `join`, `cap`, `align` (inside, centre, outside), `dash`, `dashOffset`, `miterAngle`, with the meaning they have for a path, drawn round the rounded box. They are the shape's own **Outline** swatch and **Outline options** (width, position, corners, dashes, sharp-corner limit); a picture has no Fill swatch. A first outline is white and a fiftieth of the shorter side; a width of 0 takes it away (the width is kept).

The code paths are the shapes': `lined()` in `actions.ts` is "the picked paths and pictures", and the outline and corner functions (`selectedOutline`, `commitOutline`, the dash and miter numbers, `selectedCorners`, `commitCorners`, `commitPaint` for the outline colour) take both. One undo step per change; the numbers being dragged are shown without being stored. Scaling a picture scales both, a unit change keeps them, and Export draws them (it is the canvas's own drawing).

Not done (the rest is closed by [ADR 0153](0153-picture-and-reveal-gaps-vector-pdf.md)): the copy-as-picture command, and a shape other than a rounded rectangle for a picture (a clipping mask does that).

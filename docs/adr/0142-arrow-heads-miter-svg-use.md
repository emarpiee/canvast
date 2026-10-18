# ADR 0142 — Arrow heads, the sharp-corner limit, `<use>` in SVG

- Status: accepted (v0.18.1)

## Arrow heads

`arrowStart` and `arrowEnd` (each `triangle`, `open` or `dot`) are optional fields of a path, drawn at the first and last point of every **open** outline, turned along the line there, `ARROW_LEN` (4) widths long and as wide as long, in the outline's paint and width. The line runs under a filled head, so no cap shows past it. They are drawn from the flattened outline in screen space (so they follow a curve's tangent at any zoom) and are part of the path's bounds (`StrokeStyle.arrows` reserves `ARROW_LEN` widths round each end, so a head is never culled or clipped). In Outline options, Start and End rows appear for a picked open path; one undo step each. Export as SVG writes each head as a `polygon`, `polyline` or `circle` beside the path, turned along the line at the node. A closed shape has none. SVG import does not read `marker-start` and `marker-end`.

## Sharp-corner limit

`miterAngle` (1° to 90°; absent = the default of 29°, a miter limit of 4) is the angle below which a sharp corner is cut to a bevel instead of coming to a point: `miterLimitOf` turns it into the canvas's miter limit (`1 / sin(angle / 2)`). It is used by drawing (centred and inside or outside outlines), by the bounds and by SVG export (`stroke-miterlimit`). It is offered only while the corners are Sharp. The wide-outline fallback (exact polygons past 2^14 px) keeps the default limit.

## SVG `<use>` and symbols

SVG import follows `<use href="#id">` (and `xlink:href`): the referenced shape or group is drawn again at the use, moved by `x` and `y`, in the use's style; a `symbol` contributes its children. A use of itself or of what holds it is skipped, and uses nest at most 8 deep. **Copy the selection as SVG** puts the text of Save as SVG on the clipboard.

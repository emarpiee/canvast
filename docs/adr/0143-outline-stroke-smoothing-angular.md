# ADR 0143 — Outline stroke, tapered lines, corner smoothing, angular gradient

- Status: accepted (v0.19.0)

## Outline stroke and width profiles (`src/doc/stroker.ts`, `outline-stroke.ts`)

The stroke of a path becomes a shape of its own. A stroke is cut into the pieces it is made of, each a closed polygon turned the same way: a trapezoid for each straight piece of the flattened centre line, a wedge (miter, bevel) or a round fan at each corner for the join, a cap at each open end, and arrow heads. Filled with the **non-zero** rule the pieces are exactly the stroke, so nothing has to be united and no tolerance can fail: it is right for any path, join, cap, dash (a dash of no length is a dot), arrow head or width profile. The cost is overlapping pieces inside the result (it is a valid shape, not a minimal one; Simplify and the Boolean tools can tidy it).

- **Outline stroke** (Actions bar, palette): a path with no fill becomes the shape in place (the stroke's paint is its fill); one with a fill keeps it and gets the outline as a new shape above (`… outline`). A turned path is baked turned.
- **Width profiles** (Taper on the bar; taper, taper start, taper end and swell in the palette): the same, with the width a function of the length along each sub-path (`WIDTH_PROFILES`). The result is a shape: the centre line is not kept (Undo brings it back). Variable width is therefore an operation, not a live property.
- Not done: an outline *inside or outside* the edge is made centred; that needs the Boolean tools on shapes whose outlines graze.

## Corner smoothing

`smoothing` (0 to 1) on a rounded path starts each rounded corner farther from the corner (up to 1.6 times the radius) with longer handles (up to 1.45 times the circular ones, never past the corner), so the curve leaves the line without a visible start. Rounding is made again from the sharp base (`roundCorners(base, radius, smoothing)`), so Edit nodes, resize and stretch keep it. In the Properties bar (Smooth, a number or by dragging its name). A boolean group's result is not smoothed.

## Angular gradient

`{ type: "angular", cx, cy, angle, stops }`: colours go clockwise round a centre, the first stop at `angle` degrees from pointing right. Drawn with a canvas conic gradient when the centre is near the view and, far from it (or at any depth), as a linear gradient across the view along the tangent, so it stays exact when magnified. It turns with its path; its handles on the canvas are the centre and a dot on the first edge (drag to set the angle); the paint chooser has an Angular kind (the colour package's editor takes `type: "angular"` with an angle and a centre). SVG has no sweep: Export as SVG writes a linear gradient along the first edge. Text gradients offer Linear and Radial only.

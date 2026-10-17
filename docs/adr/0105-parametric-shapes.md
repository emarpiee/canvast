# ADR 0105: Shapes stay editable: sides, points, ratio and corner radius

## Status
Accepted (v0.17.0).

## Decision
A rectangle, polygon or star keeps the numbers it was made from, in `PathObject.params` (`ShapeParams`: `box`, and `sides`, `tips`, `inner`, `radius` as the kind takes them, lengths in the object's local units). The nodes are made again from them whenever one changes (`withShapeParams`, `src/doc/shape-params.ts`), in one undo step, so after drawing a polygon you can still change its sides, a star its points and ratio, and any of the three its **corner radius**.

**Geometry** (`src/doc/path.ts`). `fittedShape` generates the shape in a unit box and stretches it so that its *bounds* are `box` (a polygon or star used to be inscribed in its box's ellipse, so it did not fill it; now a drawn shape fills the box it was dragged, and changing the sides keeps the same box). `roundCorners` turns every corner node between two straight lines into two nodes joined by a circular arc (a cubic with the standard handle length); the radius is cut down so each corner uses at most half of each line, so a large radius gives a pill on a rectangle and neighbours never overlap. Nodes with handles, and the ends of open sub-paths, are left as they are. The stored `sub` is the rounded result, so everything that draws, picks, bounds or combines paths needs no change.

**When it applies.** Stretching scales `params` with the shape (`scaleParams`; the radius follows the mean of the two scales, at the two places that scale a path's coordinates). Moving a node, a handle or deleting a node by hand ends it: the object loses `params` and is an ordinary path, as the nodes are then the person's own. Shapes drawn before this keep working: their numbers are worked out from the nodes when those are still exactly the kind's own (`paramsOf`), and not otherwise.

**Controls.** With a shape picked on Select or Edit nodes, the options bar shows **Radius** (px at this zoom), and **Sides** for a polygon, **Points** and **Ratio** (percent) for a star, applied on Enter or blur. With several picked, each number goes to the shapes it concerns. The Shape tool's own Sides and Points still set the next shape.

## Not done
Per-corner radii, smoothing (a corner rounded with a curve other than a circle), an ellipse's arc and inner radius, and rounding corners of a path that was not made as a shape.

## Tests
`tests/unit/shape-params.test.ts` (a drawn shape fills its box; sides, points, ratio remake it in the same box; the radius rounds, keeps a rectangle's bounds, is cut down to a pill; open paths untouched; legacy shapes found out, hand-edited ones refused; stretching scales box and radius; saved and bad numbers refused), `tests/e2e/vectors.spec.ts` ("shapes stay editable": sides with undo and redo, radius, saved over a reload; a star's points and ratio; a rectangle's corner cut away; a node moved by hand ends it).

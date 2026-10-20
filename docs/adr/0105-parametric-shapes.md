# ADR 0105: Shapes stay editable: sides, points, ratio and corner radius

## Status
Accepted (v0.17.0).

## Decision
**Shape numbers.** A polygon or star keeps the numbers it was made from, in `PathObject.params` (`ShapeParams`: `box`, `sides`, `tips`, `inner`), and a rectangle its box. The nodes are made again from them when one changes (`withShapeParams`, `src/doc/shape-params.ts`): a polygon's **Sides**, a star's **Points** and **Ratio**, in one undo step. `fittedShape` stretches the generated shape so that its *bounds* are the box (polygons and stars used to sit inside their box's ellipse; a drawn shape now fills the box it was dragged). Moving a node by hand ends the numbers (`params` goes); shapes drawn before are recognised from their nodes when those are still exactly the kind's own (`paramsOf`).

**Corner radius is a property of the path, not of the shape kind** (reworked after review against a design tool whose radius works on every shape). It applies to any path that has a corner to round: a node where the path turns, **between lines or curves** (`src/doc/rounding.ts`: a corner is where the direction in and the direction out differ; a smooth node is not one; the ends of an open path are never rounded):

| What | Behaviour |
|---|---|
| Rectangle | One radius, or one per corner (four values in the same field: top left, top right, bottom right, bottom left). Cut to half the shorter side (a pill). |
| Polygon, star | Every corner, outer and inner. |
| Any path (Path tool, converted text, a flattened group) | Every sharp corner; on an open path the inner ones. |
| Ellipse, line | No field (no corner). |
| Boolean group | The group has its own radius, stored on its *result* and applied as the result is derived: the result is rounded, the shapes inside keep their own corners (and the result honours a shape's rounding). Flatten bakes it. |
| Picked together | The field shows the first ("Mixed" when the corners differ); a value goes to every picked path that has corners. |

**Each corner on its own, on every shape.** `radius` may be an array, one radius per node of the sharp outline (across its sub-paths, in order), so any path made of its own nodes (a polygon, a star, a rectangle, a path) can have a different radius at each corner; the field takes one value or one per corner. A boolean group's result has one radius only: its nodes change as its shapes move, so a radius per node would not stay with its corner. Adding or taking away a node (Edit nodes, or changing the sides) turns an array into the largest of its values.

**Storage.** `radius` (a number, or an array of one per node for a rectangle) with `sub` as the rounded geometry and `base` as the sharp geometry it was made from. Everything that draws, picks, bounds or combines uses `sub`, so none of it changed. **Edit nodes shows and edits `base`** (the sharp corners, turned like the drawing; `editSubs`), and the rounding is made again on commit, so rounding survives node editing. The result of a boolean group stores only the number (it is derived from its shapes, never edited).

**The box is the shape as drawn (changed 2026-10-20, owner).** The bounds of a path (selection frame and handles, spatial index, alignment, the pivot a turn is about) are those of its drawn outline (`sub`), rounded corners and ratio included, so the box fits the shape and leaves no empty space. Before, they were those of the sharp outline (`base`) so that rounding never looked like a resize; the owner found the empty space worse. The gradient and texture box (`geometryBounds`) is still the sharp one, so a fill does not move when the radius changes. A turned, asymmetric shape moves slightly when its radius changes, because its pivot (the middle of its box) does.

**Stretching** scales the radius with the shape (by the mean of the two scales), so a shape keeps its look when it is resized, and the rounding is made again from the stretched base (corners stay circular on a non-uniform stretch). A toggle beside the thickness lock, **Lock corner radius** (shown on Select when a picked shape has corners, remembered as `shape.lockRadius`), keeps the radius its size instead, so a bigger rectangle keeps its corner. It is separate from the thickness lock, which is only about line width. A change of local units (normalisation, the same size in the world) always scales it.

**Edges, not segments.** The stretch of path between two corners (or an end of an open path) is one *edge*, however many segments and smooth nodes it is made of, and a corner takes its arc from the edge: so the corners a Boolean operation leaves at the ends of a string of tiny segments (a rounded star cut by a rectangle) are rounded like any other, and none is left sharp.

**Rounding** (`roundCorners`): each edge is trimmed by the tangent length (cut to half of the segment, so neighbours never overlap), and the two ends are joined by a cubic that leaves along the segments' tangents with the handle length of a circular arc through them (exactly an arc between two lines). Where a segment cannot hold what both its ends ask, they share it in proportion to what each asked, so a sharp tip next to a blunt inner corner does not hold the whole shape to half a segment. A radius is not kept above the point where more would change nothing (`maxUniform`: a corner stops changing when the first of its two segments is full); a single corner's limit is what its neighbours leave (`maxFor`).

**One field, no new buttons.** *Radius* sits in the options bar of Select and Edit nodes, shown only when a picked path has corners; it takes one value or four. Sides, Points and Ratio appear only for a picked polygon or star. Nothing is added to the selection bar, the rail or the Shape tool; the dots appear only on the picked shape.

**Controls on the shape.** The *main dot* (large, filled, ringed) sets one radius for every corner: inside the first corner, along its bisector. *Double-click it, or hold it still for half a second,* and the corners open out: a small dot at the middle of each corner's arc sets that corner alone, and the main dot moves to the middle of the shape, where dragging it sideways sets them all again; a second double-click or hold closes them. A dot's drag is relative to where it was taken (it never jumps) and is measured from the *effective* radius (what the corner can use), so a radius pushed past its limit comes back at once. A boolean group shows the main dot too (on its sharp outline, kept as `base` under a radius).

**Setting numbers without typing.** Dragging the *name* of a number (Radius, Sides, Points, Ratio) changes it live, one undo step when released (`data-scrub`; a plain click still goes to the field). On the canvas a picked shape shows a **dot inside its first corner** (drag towards the middle for a bigger radius; delta-based, so it never jumps) and a star a handle on its **first inner corner** (drag along the spoke for the ratio). Both preview through a `replace` preview (the changed objects shown, stored once on release), the same path the scrub uses. The dots show on the Select tool for one picked shape; the hint line names them.

## Not done
Corners next to curved edges, smoothing other than circular arcs (continuous curvature), per-corner radii on a boolean group's result, an ellipse's arc and inner radius.

## Tests
`tests/unit/shape-params.test.ts` (a drawn shape fills its box; sides, points, ratio remake it in the same box; the radius rounds, keeps a rectangle's bounds, is cut down to a pill; open paths untouched; legacy shapes found out, hand-edited ones refused; stretching scales box and radius; saved and bad numbers refused), `tests/e2e/vectors.spec.ts` ("shapes stay editable": sides with undo and redo, radius, saved over a reload; a star's points and ratio; a rectangle's corner cut away; a node moved by hand ends it).

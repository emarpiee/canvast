# ADR 0105: Shapes stay editable: sides, points, ratio and corner radius

## Status
Accepted (v0.17.0).

## Decision
**Shape numbers.** A polygon or star keeps the numbers it was made from, in `PathObject.params` (`ShapeParams`: `box`, `sides`, `tips`, `inner`), and a rectangle its box. The nodes are made again from them when one changes (`withShapeParams`, `src/doc/shape-params.ts`): a polygon's **Sides**, a star's **Points** and **Ratio**, in one undo step. `fittedShape` stretches the generated shape so that its *bounds* are the box (polygons and stars used to sit inside their box's ellipse; a drawn shape now fills the box it was dragged). Moving a node by hand ends the numbers (`params` goes); shapes drawn before are recognised from their nodes when those are still exactly the kind's own (`paramsOf`).

**Corner radius is a property of the path, not of the shape kind** (reworked after review against a design tool whose radius works on every shape). It applies to any path that has a corner to round: a *sharp node between two straight lines* (a node with handles, or next to a curved edge, is left alone; the ends of an open path are never rounded):

| What | Behaviour |
|---|---|
| Rectangle | One radius, or four (top left, top right, bottom right, bottom left) typed in the same field. Cut to half the shorter side (a pill). |
| Polygon, star | Every corner, outer and inner. |
| Any path (Path tool, converted text, a flattened group) | Every sharp corner; on an open path the inner ones. |
| Ellipse, line | No field (no corner). |
| Boolean group | The group has its own radius, stored on its *result* and applied as the result is derived: the result is rounded, the shapes inside keep their own corners (and the result honours a shape's rounding). Flatten bakes it. |
| Picked together | The field shows the first; a value goes to every picked path that has corners. |

**Storage.** `radius` (a number, or an array of one per node for a rectangle) with `sub` as the rounded geometry and `base` as the sharp geometry it was made from. Everything that draws, picks, bounds or combines uses `sub`, so none of it changed. **Edit nodes shows and edits `base`** (the sharp corners, turned like the drawing; `editSubs`), and the rounding is made again on commit, so rounding survives node editing. The result of a boolean group stores only the number (it is derived from its shapes, never edited).

**Stretching** keeps the radius (a bigger rectangle keeps its corner, as the reference app does) and makes the rounding again from the stretched base; only a change of local units (normalisation, the same size in the world) scales it.

**Rounding** (`roundCorners`): a circular arc as a cubic of the standard handle length; the tangent length is cut so each corner uses at most half of each adjacent line.

**One field, no new buttons.** *Radius* sits in the options bar of Select and Edit nodes, shown only when a picked path has corners; it takes one value or four. Sides, Points and Ratio appear only for a picked polygon or star. Nothing is added to the selection bar, the rail or the Shape tool; the dots appear only on the picked shape.

**Setting numbers without typing.** Dragging the *name* of a number (Radius, Sides, Points, Ratio) changes it live, one undo step when released (`data-scrub`; a plain click still goes to the field). On the canvas a picked shape shows a **dot inside its first corner** (drag towards the middle for a bigger radius; delta-based, so it never jumps) and a star a handle on its **first inner corner** (drag along the spoke for the ratio). Both preview through a `replace` preview (the changed objects shown, stored once on release), the same path the scrub uses. The dots show on the Select tool for one picked shape; the hint line names them.

## Not done
Corners next to curved edges, smoothing other than circular arcs (continuous curvature), per-node radii on a general path (the model allows an array; only rectangles get the field), an ellipse's arc and inner radius.

## Tests
`tests/unit/shape-params.test.ts` (a drawn shape fills its box; sides, points, ratio remake it in the same box; the radius rounds, keeps a rectangle's bounds, is cut down to a pill; open paths untouched; legacy shapes found out, hand-edited ones refused; stretching scales box and radius; saved and bad numbers refused), `tests/e2e/vectors.spec.ts` ("shapes stay editable": sides with undo and redo, radius, saved over a reload; a star's points and ratio; a rectangle's corner cut away; a node moved by hand ends it).

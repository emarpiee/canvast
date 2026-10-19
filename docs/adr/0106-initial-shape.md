# ADR 0106: Initial shape: set, update, reset

## Status
Accepted (v0.17.0).

## Decision
A vector shape can keep a copy of its own shape, to come back to. The copy is stored **on the object** (`PathObject.initial`), so it is saved with the canvas like everything else, survives a closed browser or a crash, and travels with the object (undo, redo, reload, archives).

**What is saved:** everything that makes the shape and nothing about where it is or how it looks: the sub-paths, the sharp outline and radius under a rounded one, the parameters of a rectangle, polygon or star (box, sides, points, ratio), the turn, and the unit they are in. Not saved: position, paint, outline, opacity, layer, name, tags.

**Three actions**, in one grouped menu on the Actions bar (ADR 0151), before Bring to front (a map-pinned button, shown when a shape is picked; icons map-pin-plus, map-pin-check, map-pin-house); they used to be three loose buttons on the options bar:
- *Set initial shape*: saves the shape as it is now (for the picked shapes that have none).
- *Update initial shape*: replaces the saved one with the shape as it is now.
- *Reset to initial shape*: puts the shape back as saved, **about where its middle is now** (so a shape that was moved or resized comes back at its place, at its saved size, with its saved points, ratio and radius, turned as it was); paint and everything else stay. One undo step.

Each is one undo step and works on all the picked shapes (several at once). **A boolean group picked whole** is saved and brought back as a whole: each of its shapes (every level of nested groups) keeps its own saved shape plus where its middle was from the middle of the group (`initial.offset`), and each group's result keeps its operation and radius (`initial.op`, `initial.radius`; the result's outline is derived, so it is never what is saved). Reset puts every shape back as saved and where it was in the group (about the group's middle now, so a group that was moved stays moved), restores the operations and radii, and the result follows. Shapes added to the group since, or taken from it, are left as they are. With a single shape of the group picked, the shape's own initial shape is what is used.

**Units.** The saved shape is in its own unit (`initial.unit`). Wherever the object's unit is renamed by moving it to another frame (`inFrame`) or by pasting it at another depth (`instantiate`), the saved one's unit moves with it; renaming for size (normalisation) changes only the object's own unit and leaves the saved shape alone. Reset sets the object back to the saved unit and places it by its middle, exactly (dyadic).

## Not done
A thumbnail of the saved shape, saving several, and naming them.

## Paint (setting)
Setting `shape.initialPaint` (Settings, Drawing, Shapes; on by default). The buttons are named “initial state” makes Set and Update also save `initial.paint`: fill, outline, width, join, cap, dash, dash offset, miter angle, align, arrows, opacity, blend, even-odd and width profile. Smoothing is saved with the shape (always), like size, rotation, points, ratio and radius. Reset then puts that look back whole (an option the saved look did not have is cleared). Off, or a shape saved while it was off: paint stays as it is. A boolean group's result keeps no paint (its look is derived). Test: "initial shape with the setting on keeps the fill and outline".

## Tests
`tests/unit/shape-params.test.ts` (saved and read back, malformed refused, unit follows a frame change), `tests/e2e/vectors.spec.ts` ("initial shape": the menu's states, set, change ratio, points, radius, move and resize, reload, reset to size, points, ratio, no radius, middle kept, paint kept; undo; update then reset to the updated one; Chromium and Firefox).

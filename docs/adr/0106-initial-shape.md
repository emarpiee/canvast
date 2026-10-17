# ADR 0106: Initial shape: set, update, reset

## Status
Accepted (v0.17.0).

## Decision
A vector shape can keep a copy of its own shape, to come back to. The copy is stored **on the object** (`PathObject.initial`), so it is saved with the canvas like everything else, survives a closed browser or a crash, and travels with the object (undo, redo, reload, archives).

**What is saved:** everything that makes the shape and nothing about where it is or how it looks: the sub-paths, the sharp outline and radius under a rounded one, the parameters of a rectangle, polygon or star (box, sides, points, ratio), the turn, and the unit they are in. Not saved: position, paint, outline, opacity, layer, name, tags.

**Three actions**, in one menu on the options bar of Select and Edit nodes (a pin button, shown when a shape is picked, lit when an initial shape is saved):
- *Set initial shape*: saves the shape as it is now (for the picked shapes that have none).
- *Update initial shape*: replaces the saved one with the shape as it is now.
- *Reset to initial shape*: puts the shape back as saved, **about where its middle is now** (so a shape that was moved or resized comes back at its place, at its saved size, with its saved points, ratio and radius, turned as it was); paint and everything else stay. One undo step.

Each is one undo step and works on all the picked shapes (several at once). A boolean group's result has no shape of its own (it is derived), so it has none.

**Units.** The saved shape is in its own unit (`initial.unit`). Wherever the object's unit is renamed by moving it to another frame (`inFrame`) or by pasting it at another depth (`instantiate`), the saved one's unit moves with it; renaming for size (normalisation) changes only the object's own unit and leaves the saved shape alone. Reset sets the object back to the saved unit and places it by its middle, exactly (dyadic).

## Not done
A thumbnail of the saved shape, saving several, naming them, and saving paint with the shape.

## Tests
`tests/unit/shape-params.test.ts` (saved and read back, malformed refused, unit follows a frame change), `tests/e2e/vectors.spec.ts` ("initial shape": the menu's states, set, change ratio, points, radius, move and resize, reload, reset to size, points, ratio, no radius, middle kept, paint kept; undo; update then reset to the updated one; Chromium and Firefox).

# ADR 0018 — Item rotation

- Status: accepted (Phase 2, slice 2a; owner chose the stored-angle representation on 2026-10-14)
- Related: ADR 0001/0014 (exact anchors and frames), ADR 0003 (projection shared by drawing and picking), engineering plan §16 Phase 2

## Context

Phase 2 adds item rotation. An object's position is an exact dyadic anchor; its local geometry is ordinary doubles. Rotation by an arbitrary angle cannot be exact in dyadic numbers, and rotation must not become a second coordinate authority (plan §14.x: "Rotation, nested groups, and multiple canvases cannot introduce a second inconsistent coordinate authority").

## Decision

**A rotation is a stored angle on the object, not baked into its geometry.** `rot` is a whole number of 2^-32 turns (`core/angle.ts`); absent or 0 means not rotated.

- The geometry that is drawn, picked, indexed and summarised is a pure function of the stored data: `strokePoints(o)` rotates `points` by `rot` about the centre of the points' bounding box (the pivot) with a matrix made of `+` and `*` only. It is cached per object.
- **Exact round trips:** angles add and subtract as integers, so a rotation followed by its opposite gives back the identical object. Nothing is re-rounded.
- **Same in every browser:** the matrix does not use `Math.sin` or `Math.cos` (their last bit may differ between engines); quarter turns are exact.
- **One transform, no second authority:** every place that read `o.points` now reads `strokePoints(o)` (bounds, projection, exact stroke coverage, picking through the projected points, the coarse samplers at depth, the spatial index summary). The exact deep-zoom arithmetic needs no change: the rotated points are ordinary doubles, so they convert to exact dyadics as before.
- **Scaling** (uniform for strokes) keeps `rot`; it commutes with rotation about the centre.
- **Rotating several objects:** each turns about its own centre by the same angle and also moves around the common centre. That move is rounded once to a double (`rotateAbout`), like a scale. A single stroke turns about its own centre, so it does not move at all.
- **Gesture:** a handle above the selection box; drag to turn, Shift snaps to 15 degree steps (of the stroke's own angle for one stroke). One transaction on release, so one undo step.
- **Format:** `rot` is stored in the object record; archives are version 3 (older versions refuse them rather than silently drop the rotation). Opening a rotated drawing in an older build shows it unrotated, and saving there would lose the angle: no downgrade path.

## Not in this slice

- **Images and text.** The handle is offered only when every selected object is a stroke. Rotating a bitmap or glyph outlines exactly at any depth (rotated pixel rectangles, rotated glyph winding in the coarse samplers) is the next slice, using the same `rot` field and the same `strokePoints`-style single transform.
- **Snapping to other objects and guides** (Phase 2, next).

## Consequences

- A new kind or a new consumer of stroke geometry must call `strokePoints`, never read `points` directly.
- Group rotation (layers and groups, Phase 2) reuses `rotateAbout`.

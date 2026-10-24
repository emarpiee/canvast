# ADR 0171: snapping to the shapes themselves

- Status: accepted (v0.38.0, 2026-10-25)
- Extends: ADR 0019 (snapping a move to box lines)

## Context

Snapping (ADR 0019) lined up the boxes of things: three lines per axis (sides and middle). A shape whose corners and sides are not its box, such as a hexagon or a triangle, could not be put corner to corner or side to side.

## Decision

With the Snap toggle on, every gesture that places geometry also snaps to the shapes themselves, by one rule (`shapeSnap` in `interaction/tools.ts`, the searches in `interaction/snap-points.ts`):

- **Targets:** the nodes of the paths in view, the middle of each straight side, the corners of upright pictures, texts and players, and every side (a curve's as its drawn outline).
- **Moving parts:** the corners and straight sides of what the gesture moves, where the gesture would put them now.
- **Rule:** a corner within `SNAP_PX` of a corner always wins, since it fixes both axes. Otherwise a corner onto a side, or a straight side flush along a straight side within 3° of parallel and facing it, wins when it is nearer than the best box line. Otherwise the box lines apply as before.
- **Gestures:** move (corner on corner is exact: target corner minus source corner as dyadic numbers; onto a side it is as exact as the side's place on the screen), node drag, resize (the size follows from where a corner of the shape lands; a side handle takes only a corner already level on the other axis), and turn (a corner turns onto a target's direction, a side turns parallel to a nearby side). Shift's 15° steps on a turn take precedence.
- **Guides:** a box line is a dashed line as before, a corner a ring with a cross, a side a solid line along it.
- **Cost:** targets go into a grid of 32 px cells once per gesture (at most 20,000 corners and 20,000 sides), and each pointer move looks only at the cells around each moving corner.

## Consequences

Shapes fit together by their corners and sides at any depth. A flush side is moved along its normal only, with no turn, so sides that are not quite parallel touch at their middles. A side snap during a move is placed to the double precision of the screen, not exactly.

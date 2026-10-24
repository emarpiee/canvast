# ADR 0172: filling the gaps between shapes

- Status: accepted (v0.39.0, 2026-10-25)
- Related: ADR 0101 (boolean operations), ADR 0145 (Divide and the Shape builder)

## Context

Shapes laid side by side (hexagons, tiles) leave empty places between them. Filling one meant drawing a path along its edges by hand. The Shape builder works only on the regions shapes overlap in, not on the places they close in.

## Decision

A gap is a **hole of the union** of the picked closed shapes (`doc/gaps.ts`). The union (`booleanOp`) runs its loops with the shapes on the left, so a hole runs the other way round. The largest loop is an outer one and gives the turning. A single shape is united with itself, so the hole of a ring counts too. An outer loop lying directly inside a hole (a shape sitting in the gap) is an island: it goes into the gap's fill, which is even-odd, so the island stays empty.

- **Fill gaps** (Path tools menu, command palette): every gap, as shapes with the Shape tool's fill and no outline, placed just under the back shape (so the shapes round them stay on top), on the same sheet. One undo step; the fills are picked.
- **Fill a gap…**: the gaps show as dashed outlines, the one under the pointer filled as it would be; a click fills it (one undo step each); a click elsewhere does nothing; Enter, Esc or Done ends it, and it ends by itself when no gap is left. Done and Cancel on the Actions bar are the Shape builder's.
- Up to 200 shapes per search; outlines the union cannot tell apart give a message, as Divide does.

**Corners that touch** (v0.40.0): where outlines meet at a single point, the loops of a boolean result (`link` in boolean.ts) now go on along the piece turning furthest to the right, so they run round the outside of shapes that touch at a corner, and a place those shapes close in is a hole of its own. Before, the next piece at such a point was whichever was found first, which could share a gap's edges out among the shapes' loops. The filled result is the same either way.

**Closing small openings** (v0.40.0): `shape.gapClosePx` (default 4 px, 0 to 24, Settings > Drawing) is turned into the back shape's units at the zoom in use. From every corner of the union (nodes, and 8 points along each curve) to the nearest point of another loop, or of the same loop across a bend (the way round at least 3 times the way across), within that distance, a bridge is added as a quad 1% of its length wide. All bridges are one region united with the shapes in one operation. The places behind them are gaps, and their fills stop at the bridges.

## Consequences

A place open by more than the closing distance is no gap. The fill of a bridged place stops a hair (1% of the opening) short of the line across it.

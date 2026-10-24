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

## Consequences

Only closed places are found: a place open to the outside, even by a hair, is no gap. Closing small openings is the next step.

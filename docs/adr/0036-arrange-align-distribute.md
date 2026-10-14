# ADR 0036 — Arrange in a grid, align and distribute

- Status: accepted (Phase 5, slice 1; plan: `docs/plans/arrange-commands.md`)
- Related: ADR 0030 (the import grid shares `gridCells`), ADR 0020 (groups), ADR 0021 (locks)

## Decision

A button with a menu on the Select tool's toolbar (Arrange and align) offers, for the selection:

- **Arrange in a grid**, ordered by name (A to Z or Z to A), by date added (images by when they were added to the library; text and strokes after them, in stacking order), by size (largest first), by type (images, text, strokes), or in stacking order;
- **Align** left, centre, right, top, middle, bottom;
- **Distribute** horizontally or vertically (three or more).

A **unit** is a group at the level the user is working at, or one object; its box is the exact union of its members' world boxes (a turned object counts by the box it covers). Units are moved, never resized or turned: every member gets one exact `translate`, the whole command is one transaction (one undo step), and a unit already in place is not part of it. Locked objects are left out. The selection must lie in one frame (one space); otherwise a message says so.

The grid uses the batch-import layout (`gridCells`: cells as large as the largest unit, each unit centred in its cell, about as wide as tall, left to right then down) at the units' real size, centred on the centre of the selection. A name is a file name for an image (read from the library when sorting by name), the first words of a text, and empty for a stroke; empty names go last in both directions.

**Exactness at any scale.** Positions are decided in doubles relative to the largest unit (a power of two covering it), so units 2^-900 and 2^1000 apart neither overflow nor vanish; the offsets that result are exact dyadics added to the exact anchors. The only rounding is in the layout itself (and in the gap of Distribute, one division by the number of gaps).

## Tests

Unit (`arrange.test.ts`): alignment edges exact, grid shape and centre, distribute spacing, sort orders including unnamed strokes, and a scale-spread case. E2E (`frames.spec.ts`): the menu, the message for one item, align and grid each undone in one step, in both browsers.

## Not done

Arranging in a chosen number of columns, a gap setting, keeping the grid's top-left instead of its centre, and items in different frames.

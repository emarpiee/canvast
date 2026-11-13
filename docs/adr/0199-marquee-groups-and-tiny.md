# ADR 0199: What a marquee or a lasso takes: a group whole only when all of it is inside; nothing too small to see

- Status: **accepted** (2026-11-14)
- Related: ADR 0020 (groups), 0031 (a marquee takes what it touches), 0037 (pen marks), 0103 (boolean groups), 0162 (patterns)

## Context

In the *Powers of two* showcase, a marquee drawn round Earth seen as a dot selected about 837 objects and the window lagged (about a quarter of a second). Two rules added up. The marquee could take anything at least 1/8 px on screen (the drawing's own limit), so the island, the tree and the cells inside the dot, far too small to see, were taken. And every touched object brought its whole group, as a click does: Earth's orbit is in the Solar System group, so the Sun, the planets and orbits reaching far outside the window were taken too. With so many selected, the bars spent most of the time listing the selection again and again (a filter of all 7,000 objects for each question) and finding a text's scale by projecting every object in view.

## Decision

- **A group comes whole only when all of it is inside the marquee or lasso** (its shown members, measured on screen, also those too small to draw). Otherwise the touched objects come alone. The outermost such group from the level entered is taken. A click still takes whole groups.
- **A group that is one thing is never split**: a boolean group (its result is made from its shapes), a pen's mark (a pencil or ink line is a group of strokes: a group of strokes only), a pattern. A touched member brings it whole, as a single object.
- A sheet still brings what is on it.
- **Nothing smaller than 2 px on screen is taken** by a marquee or a lasso (`SHAPE_PICK_MIN_PX`).
- **Speed**: the list of the selected objects is kept until the document or the selection changes; a text's scale is found by projecting that text alone.

## Consequences

- In the showcase the same marquee takes about 100 objects (Earth's own group, wholly inside, and the bit of the Solar System it touches), and the time from release to the second frame fell from about 250 ms to about 140 ms (about 57 ms of which is two frames with nothing selected).
- A marquee over part of a group selects members without entering the group, as a Ctrl+click does.

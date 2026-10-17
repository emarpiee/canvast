# ADR 0111: Erase parts of strokes

## Status
Accepted (v0.17.0).

## Decision
The Object eraser has a second mode, **Erase parts of strokes** (scissors button on its options, remembered as `eraser.parts`). With it on, a swipe touches only freehand strokes (everything else is left alone) and cuts out of each what the brush swept over; what is left becomes new strokes (`doc/stroke-cut.ts`: the line is sampled at least every half brush radius so a long segment cannot jump the brush, points within the brush radius plus half the stroke's width of the swept path go, the runs between them stay). A turned stroke is cut by its drawn points and the pieces are upright. One undo step per swipe; the original objects are removed and the pieces added in one transaction. Off (the default): whole objects, as before (ADR 0022).

## Not done
Cutting parts out of vector paths (they have nodes and fills, not a line to trim), and pressure or tilt widths across the cut (a stroke's pieces keep its width).

## Tests
`tests/unit/stroke-cut.test.ts`; `tests/e2e/frames.spec.ts` (a swipe across a line leaves two pieces with a gap, undo restores it), both browsers.

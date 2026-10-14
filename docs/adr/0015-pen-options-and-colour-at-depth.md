# ADR 0015 — Pen options, and colour at depth for every kind of object

- Status: accepted (nested-frames branch; owner decisions of 2026-10-14)
- Related: ADR 0014 (nested frames), reference `docs/reference/nested-frames.md` §7.3, §8b, §8c

## Context

Pen behaviour at extreme zoom was never designed on the absolute system
(a stroke's width was fixed in canvas units and the pen size in screen px at
the zoom where it was drawn). Testing the frames build also showed that the
colour of an item vanished when the view was zoomed far inside it: only
strokes had a deep-zoom summary; images and text fell back to the exact
path, which stops working past 100,000 levels.

## Decisions

1. **Strokes always scale with the canvas.** A stroke has one width in
   canvas units, fixed when you press down. Nothing in storage, picking or
   rendering depends on the zoom.
2. **Thickness lock is a pen mode, not a stroke property.** Off: the pen has
   its size in screen px at the current zoom. On: the pen has the size it had
   when the lock was set, scaled by the zoom since, so a new stroke has the
   same width on the canvas as the earlier ones and matches the artwork at
   any depth (`interaction/pen-width.ts`; the size follows the zoom for
   ±1,000 levels, then holds). A first version that fixed a stroke's width on
   screen was removed: it contradicted this. On the Select tool the same
   lock keeps a stroke's line width when it is resized.
3. **Pen size:** three presets and a log-scale slider (0.5–128 px). A new
   size while locked becomes the new reference.
4. **Stabilizer:** a lazy rope of 0.6–60 screen px (`interaction/stabilizer.ts`),
   independent of how often the pointer reports and of the zoom.
5. **Pen size follows zoom (toggle):** while drawing, when the width the pen
   should have differs by a quarter level from the current piece's, the piece
   ends and the line continues as a new stroke from its last point; all
   pieces are committed in one transaction (one undo step). No change to the
   stroke format.
6. **Colour at depth is generic.** `render/coarse.ts` has one sampler per
   kind of object (`SAMPLERS`, typed over every kind: a new kind does not
   compile without one; `bboxSampler` is the one-line default). A sampler
   decides cover, miss or "an edge is near" from the rounded camera centre;
   for images the pixel boundaries are placed from exact term sums, so a
   camera on a pixel corner keeps its pixels at any depth.
7. **Select option:** ignore the object that fills the view when picking, so
   it cannot be selected or deleted by accident.

## Consequences

- An outline edge (stroke side, glyph outline) that stays within the view
  past 100,000 levels is not drawn: placing it exactly needs a number with a
  digit per level (reference §7.3). Straight, rational edges (image pixel
  boundaries) are exact at any depth.
- Pieces of a stroke drawn with "follows zoom" are separate objects.
- The lock, stabilizer and follow-zoom settings are not saved with the canvas.

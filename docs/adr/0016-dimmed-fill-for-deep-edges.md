# ADR 0016 — A dimmed approximate fill for an edge in view past 100,000 levels

- Status: accepted (nested-frames branch; owner decision of 2026-10-14)
- Related: ADR 0014 (nested frames), ADR 0015 (colour at depth), reference `docs/reference/nested-frames.md` §7.3

## Context

Zoomed far inside a coarse object (more than 4,096 levels below its frame) the
view is almost always entirely inside it or entirely outside it, and a
rounded camera centre is enough to say which (ADR 0014 §7.3). When an *edge*
of the object (a stroke's side, a glyph outline, an image border or pixel
boundary) is within the view, the rounded centre cannot place it, and the
exact path needs the exact centre, which has O(levels) bits. That is only
affordable up to `COARSE_EXACT_MAX` (100,000 levels; Firefox also caps a
BigInt near 2^20 bits). Past it the object was not drawn at all.

Drawing nothing is the worst answer: the colour you zoomed into vanishes
exactly where you are looking (the owner's rule in ADR 0015: the colour of an
item must never vanish). It also makes a frame at the edge look empty and
unrelated to its neighbours.

## Decision

When the classification says "an edge is near" and the exact camera is out of
range, draw a **dimmed approximate fill**: the object's colour over the whole
view at half strength (`DIM_ALPHA` in `render/draw-objects.ts`). For an image
it is the source pixel under the view centre.

Every kind supplies its own stand-in (`CoarseSampler.approx`; `bboxSampler`
gives new kinds a default), so no kind is special-cased in the renderer.

## Why this way

- **Honest.** An edge here is a fraction of a pixel wide or the view is
  deep inside the outline's neighbourhood; the true picture is a boundary
  between two flat colours we cannot place. Half strength says "something is
  here, approximately", and an exact fill would claim a precision we do not
  have.
- **Cheap and depth-independent.** No big numbers: it uses only the rounded
  centre, so the cost is the same at 10^5 and 10^12 levels.
- **Continuous.** Up to 100,000 levels the real edge is drawn; past it the
  colour is still there, only dimmed, instead of switching to empty.
- **Rejected:** guessing a side (a hard edge in the wrong place); drawing
  the full-strength colour (looks exact when it is not); clamping the exact
  path further out (Firefox BigInt limit, and the cost grows with depth).

## Consequences

- A covering approximation is selectable like any covering object
  (picking sees the view inside the object); the Select option "ignore the
  object that fills the view" skips it too.
- Test: `frames.spec.ts` "an edge in view past 100,000 levels is drawn as a
  dimmed approximate fill": the four corners are one dimmed colour at 2·10^5,
  10^6 and 10^12 levels; at 5·10^4 the real edge is still drawn.
- The same ADR covers the size slider on the Select tool (owner decision of
  the same day): with Select active, the slider also sets the thickness of
  the selected strokes on release, in one undo step (`setSelectedWidth` in
  `app/main.ts`); strokes whose scale is out of double range are skipped.

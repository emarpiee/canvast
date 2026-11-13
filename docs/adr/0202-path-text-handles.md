# ADR 0202: A text along a path follows its boolean group, and has handles of its own

- Status: **accepted** (2026-11-14)
- Related: ADR 0131 (text on a path), 0103 (boolean groups), 0105 (shape handles), 0193 (auto layout handles)

## Context

A text set along a shape kept following that shape's own outline after the shape was put into a boolean group, though the shape is then
hidden and the group's result is what is seen: the text had to be taken off and set again. Where along the path it starts and how far off it
sits could only be typed in Paragraph and box options.

## Decision

- **What is seen is followed**: a text tied to a shape (along it or inside it) takes its place from `shownShape`
  (`doc/text-in-shape.ts`): the shape's own outline, or, when the shape is in a boolean group, the outermost group's result. The text stays
  tied to its own shape, so letting the group go puts it back on the shape. A change that makes a result again (another member moved)
  brings the texts on its members with it, in the same transaction; the preview while dragging does the same.
- **Two handles** on the one selected text along a path, part of the shape handles (`shapeHandles`, `interaction/path-edit.ts`), so
  they are drawn, named on hover, pressed and dragged as a balloon's are (the same glyphs: a diamond slides along an outline, two triangles
  set a distance):
  - **along**, on the path where the text is held (its start, middle or end, as aligned): dragged, the held point goes to the nearest
    point of the path; *Start at* changes. A closed path goes round; on an open one the held point stays on the path, so *Start at* can be
    below 0 (from -100%).
  - **lift**, above the letters there: dragged the way the letters stand, *Off the path* changes (from 0).
- The geometry is `pathTextGrips`, `nearestAlong` and `startFor` in `text/glyph-space.ts`, the one map of glyphs on a curve.

## Consequences

- One undo step per drag, as the option fields. `pathTextDots()` in the debug hook gives the handles for tests.

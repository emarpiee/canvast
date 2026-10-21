# ADR 0107: SVG in and out, dashes, node snapping, dragging a number's name, move only what is picked

## Status
Accepted (v0.17.0).

## Decision
**SVG export** (`src/app/svg-export.ts`). The picked paths (a boolean group by its result) are put in the units of the first one exactly (the anchors differ by an exact amount, then one rounding), turned as drawn, and scaled to a 1000-unit box, so any depth of zoom comes out in readable numbers. Kept: fill and outline colour with transparency, linear and radial gradients (as `userSpaceOnUse` defs), width, corners, ends, dashes, fill rule, opacity, blend mode, names. Not kept: an outline's inside or outside position (written centred; SVG has no word for it). A **Save as SVG** button on the selection bar when paths are picked.

**SVG import** (`src/app/svg-import.ts`, `src/doc/svg-path.ts`). Paths (every command, arcs as quarter-turn cubics), rectangles with rounded corners, circles, ellipses, lines, polylines, polygons, nested groups, transforms (matrix, translate, scale, rotate, skew), paint (any CSS colour, `none`, `url(#gradient)` as a box-unit gradient), width, ends, corners, dashes (kept in widths of the outline), fill rule, opacity. The text is parsed as an image document and never inserted in the page. A `clip-path` on a group or a `<use>` becomes a clipping mask (ADR 0108, 0144): a sheet of the clip's shapes that holds what it cuts, one for each place a clip is used (the outermost clip only, shapes only; `clip-rule` is not read). `<use>` is read (ADR 0107 update, v0.21.0). Left out: text, images, filters, masks, patterns, markers. Entry points: pasting SVG text on the canvas, and **Make vector copy** on a picked SVG picture (the picture stays; the shapes land centred in the view, half the shorter side across, grouped when there are several, picked).

**Dashes.** `PathObject.dash?: [dash, gap]` in widths of the outline, so the pattern looks the same at any zoom and width; absent is solid. Outline options has a **Line** choice: Solid, Dashed (3, 2), Dotted (0, 2; drawn with round ends, which the choice sets). Remembered for the next shape (`shape.dash`). Drawn with `setLineDash`; the exact wide-outline path (above 2^14 px) draws solid. Custom numbers and an offset are not offered yet.

**Node snapping.** While a node (not a handle) is dragged in Edit nodes, with the Snap toggle on, its x and its y line up with the nearest node of the same shape or of another shape in view within `SNAP_PX`; guide lines show it (the object-snapping guides).

**Dragging a number's name** (`src/colour-picker/scrub.ts`, shared by the colour package and the app). Every `<label>` of one `<input type="number">`, wrapped or by `for`, can be dragged left or right to change the value live (`input` events), with one `change` on release; Shift snaps to round steps worked out from the range (100: steps of 5; no range: ten times faster); a click on the name focuses the field. Numbers that sit beside a slider keep the slider. The toolbar's own scrub (Radius, Sides, Points, Ratio of a picked shape) is kept: it previews shapes.

**Only what is picked moves.** A press-and-slide on a shape, path or stroke that is not picked draws the selection box, like a picture; pick it first (click), then drag. Before, paths and strokes moved on the first slide.

## Not done
Per-corner radius on a boolean group's result: its nodes change as its shapes move, so a number per node would point at other corners after an edit. Flatten the group to round its corners one by one. Copy as SVG to the clipboard, custom dashes, miter angle, arrow ends, `<use>` and clip paths on import.

## Tests
`tests/unit/svg.test.ts` (path data, arcs, export, dashes saved and refused), `tests/e2e/vectors.spec.ts` (only a picked shape moves, dashes from Outline options, node snapping, dragging the name of Sides and of Width, pasted SVG text), `tests/e2e/frames.spec.ts` (the snapping test picks the stroke first).

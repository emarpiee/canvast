# ADR 0104: Vector UX first pass and stroke position

## Status
Accepted (v0.17.0). The audit is `docs/reference/vector-ux-audit.md`.

## Decision
**Stroke position.** A path has an optional `align`: absent (centred on the edge), `"inside"` or `"outside"`. It applies only when the object has an outline and every sub-path is closed (`alignOf`); an open line is always centred. The whole width is on the chosen side of the edge, so a 20 px outline outside a rectangle reaches 20 px beyond it and none of it is over the fill.

**Drawing** (`drawAlignedOutline`): a centred line twice as wide is drawn on a scratch canvas, then cut with the shape itself (`destination-in` keeps the inside, `destination-out` the outside), then put on the canvas. This is exact for any fill rule (non-zero, even-odd, holes) and does not touch the shape's fill or what is under it. The scratch canvas is reused. An outline too wide for the canvas, drawn from exact polygons, stays centred (limit).

**Picking** (`hitsObject`): inside needs the pointer inside the shape and within the whole width of the edge, outside needs it outside and within the whole width; a filled shape is still picked by its fill. **Bounds** (`inkStyle`): outside reaches the whole width past the geometry (as a centred line of twice the width), inside reaches nothing; the turn pivot and gradient box still use the centred line, so toggling the position never moves a turned shape or its gradient.

**Controls.** *Outline options* (a button beside the Fill and Outline chips; for the picked shapes, or for the next one on Shape and Path): width, Position (Inside, Centre, Outside), Corners (Sharp, Round, Cut), Ends (Flat, Round, Square). Choices are stored as what differs from the default (`doc/stroke-look.ts`): round joins and caps and a centred position are the absence of the field. One undo step per change; a Shape or Path draft uses the same choices, and rectangles, polygons and stars keep sharp corners unless Round or Cut is chosen.

**Telling the person what to do.** A hint line under the tool options (`ui/tool-hint.ts`, pure and unit-testable): per tool, while drawing a path, with one shape picked, with a boolean group picked, inside one. Fill and Outline are named. Enter edits the nodes of a picked shape and finishes node editing (as Esc does). On Select the pen-size slider is hidden unless a stroke is picked, since it set a shape's width without saying so.

## Second pass
Corners, ends and position for the next shape are remembered (`shape.join`, `shape.cap`, `shape.align`). A **Flatten** button is on the selection bar for a boolean group. Shape and Path are one rail button, **Shape and path**; the Path tool is chosen beside the shape kinds and stays lit under the Shape button (U and B keep working).

## Width 0
Typing 0 in Outline options' width (or setting it on several shapes) is no outline: the stroke is switched off and the width is kept for when it is turned on; a width typed on a shape without an outline turns one on in the default colour. For the next shape the same applies to the Shape tool's defaults.

## Selection colours
With two or more shapes picked, the Fill and Outline chips (which spoke for the first shape only) give way to one chip per paint the shapes use (`selectionPaints`): a colour, or a gradient (equal gradients are one paint), in order of first use; an outline-only paint is drawn as a ring. A chip opens the same paint chooser, and a change is made everywhere the picked shapes use that paint, fills and outlines alike (`recolour`: shown while dragged through the `replace` preview, stored once as one undo step). A gradient keeps working per shape: each shape has its own box, so the same gradient lands on each shape's own geometry. Nothing is added to the bar for one shape.

## Tests
`tests/unit/stroke-look.test.ts` (choices stored as differences; only closed outlines can be inside or outside; the ink's reach per position; saved and refused when bad), `tests/e2e/vectors.spec.ts` ("outline options": width, outside, inside, centre drawn and picked, one undo each, corners, saved; "the line under the tool options": per tool, picked shape, boolean group, entered; Enter).

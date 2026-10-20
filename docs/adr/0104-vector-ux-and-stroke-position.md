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

## Where things are (second pass)
- **The hint moved off the options bar to plain floating text at the bottom of the canvas** (`ui/hint-line.ts`: on the row of the view controls, from the left edge to them, no background, click-through), so the room above the canvas is for the options. It says what the tool does and what to press next, and, while the pointer or the keyboard focus is on a button of a toolbar, what that button is. The options bar's groups are named (Colour, Size, Smooth, Keep size, Select), numbers share one value font token (`--font-value`), the pen's size presets and slider are one group, and the two locks sit together. **Settings > Appearance > Hints and tooltips**: All (the line and the browser's own tooltips), Line only (the browser's are set aside while the pointer is on a button), None.
- **Seldom-used options of Select left the bar** for one menu (`Selection tool options`: show all hidden, unlock all, axis-aligned selection box, ignore the object that fills the view); snapping and the locks stay.
- **The selection bar has dividers** between its groups (copy; group; tag, library, file; turn and proportions; vector actions; arrange and order; lock, hide, delete), shown only between two groups that both have a button, and delete goes red under the pointer.
- **Selection colours** show the six most used, then "+n" with a list of the rest; the pointer on a colour lights up the shapes that use it on the canvas.
- **Handles each look different**: the big filled ringed dot is the radius of every corner; a ring with a dot is one corner's own radius; a diamond is a star's ratio; a triangle (pointing round the middle) is how many corners, with a label beside whatever is being dragged ("Radius 12", "Ratio 40%", "Count 8"). Gradient handles stay plain circles.
- **Count handle** for polygons and stars (`cornerHandles().count`): on the second outer corner; dragged round the middle, the angle from the first corner is a turn divided by how many there are (live, one undo step).

- **A turned shape keeps its side handles.** Resizing is along the selection box's own axes (`scaleFactors`), and a turned path can be stretched along them (`stretchTurned`: its geometry is scaled in its own unturned coordinates and the anchor chosen to leave the fixed point where it is). Pictures, text and strokes still resize only proportionally when turned.
- **Stepping with W A S D** reaches an item that is in the window however small the selected one is: the size (6x) and gap (3 sizes) rules that keep the step among neighbours are relaxed to 60x and a window between two items that are both in view.

- **Menus and pickers keep off the selection** (`setMenuAvoid`, `placeMenu`, the selection bar's menu): where the usual place would cover the selected items, they go above or below the bar, or beside the selection, wherever they cover it least. The side handles of a turned box are drawn (they could be dragged before but were not shown).
- **Align and distribute inside groups.** A group, and a boolean group, picked as a whole is **one unit** for Align, Distribute and Arrange (its shapes keep their places among themselves; picked alone it has nothing to line up). The shapes of a boolean group line up with each other only when they are picked as shapes (in the Layers list, or with the group entered); a group's result is never moved by itself. (v0.24.4: before, a boolean group picked as a whole was split into its shapes, which the first version of this ADR chose.) **One shape inside a group aligns with the group** (the box of its shapes: the group being worked in, or the boolean group it is a shape of), as in any design tool, and the Arrange button is there for it. Items in different frames are put in one frame (exactly) for the layout and sent back to the frames that suit them, instead of refusing.
- **Shift while turning** snaps the whole turn to steps of 15 degrees from where the box is (a turned group used to snap only the change, so it could not get back to 0).

## Width 0
Typing 0 in Outline options' width (or setting it on several shapes) is no outline: the stroke is switched off and the width is kept for when it is turned on; a width typed on a shape without an outline turns one on in the default colour. For the next shape the same applies to the Shape tool's defaults.

## Selection colours
With two or more shapes picked, the Fill and Outline chips (which spoke for the first shape only) give way to one chip per paint the shapes use (`selectionPaints`): a colour, or a gradient (equal gradients are one paint), in order of first use; an outline-only paint is drawn as a ring. A chip opens the same paint chooser, and a change is made everywhere the picked shapes use that paint, fills and outlines alike (`recolour`: shown while dragged through the `replace` preview, stored once as one undo step). A gradient keeps working per shape: each shape has its own box, so the same gradient lands on each shape's own geometry. Nothing is added to the bar for one shape.

## Tests
`tests/unit/stroke-look.test.ts` (choices stored as differences; only closed outlines can be inside or outside; the ink's reach per position; saved and refused when bad), `tests/e2e/vectors.spec.ts` ("outline options": width, outside, inside, centre drawn and picked, one undo each, corners, saved; "the line under the tool options": per tool, picked shape, boolean group, entered; Enter).

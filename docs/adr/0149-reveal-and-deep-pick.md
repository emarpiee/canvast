# ADR 0149 — Reveal and deep pick

- Status: accepted (v0.19.1)

Things on the canvas can be invisible (a shape with no fill and no outline, a sheet with no background), behind others, or inside a group, a mask or a sheet, and a plain click picks the top painted thing, widened to its unit. **Reveal** shows what is there; **deep pick** picks exactly that.

## The module

`src/interaction/reveal.ts` (logic) and `src/render/reveal.ts` (drawing); the tools, the renderer and the Layers panel only use them.

- `revealHits(visible, x, y)`: everything whose **shape** is under the point, top first, found by `pickAllByShape` (`render/hit-test.ts`): a path counts by its inside or by its edge **whatever its paint**; pictures, text and pen strokes as before; hidden and locked things are left out (they cannot be picked).
- `deepPick(hits, picked, below)`: the thing a Ctrl+click picks: the top one, or with `below` the one under the first already picked (so repeated presses go down the stack and round).
- `createReveal(editor, allowed)`: the pointer and Ctrl state; sets `editor.revealAt` (only on Select, only with no gesture running). `revealRow(editor, ids)`: sets `editor.revealIds` for a Layers row.
- `drawReveal`, `drawRevealOutlines`, `traceOutline`: the outline of each thing's own shape (a path's edge, a pen line, a picture's or text's rectangle: never a bounding box), the top one strong, the others fainter and dashed, each over a pale halo so it shows over an outline of its own colour; the names of up to six, top first, beside the pointer.

## What the person can do

| Input | Result |
| --- | --- |
| Hold **Ctrl** and move over the canvas (Select) | The outline and names of everything under the pointer. |
| **Ctrl+click** | Picks exactly the thing there: the one whose **outline** the pointer is on (within 8 px; the nearest outline, the top one when two are as near), even under a filled shape that covers it; otherwise the top one (a sheet alone, without what is on it; deep inside a group or a mask). |
| **Drag from the outline of a picked thing** | Moves it, although a filled shape covers the spot (the press takes the picked thing within 8 px of its outline; a click that does not move picks the thing on top, as before). |
| **Ctrl+Shift+click** | Adds that thing to what is picked, or takes it away if it is picked. |
| **Ctrl+Alt+click** | Goes on to the thing below the one already picked. |
| Point at (or tab to) a **Layers row** | The outline of what the row stands for, on the canvas. |

Moving a sheet always carries what is on it, even when only the sheet is picked.

## Checked and not done

Covered: hidden and locked things stay out; the reveal is not in screenshots and exports; it does not run during a gesture or on other tools; Ctrl+click on a link in text still opens the link (that check comes first); Ctrl while dragging still means "no snapping".

Not done: a marquee does not reveal what it would take. The touch and pen reveal is the long-press list (ADR 0151); mask members, hidden and locked things, screen reader words and the Node and Lasso tools are in [ADR 0153](0153-picture-and-reveal-gaps-vector-pdf.md).

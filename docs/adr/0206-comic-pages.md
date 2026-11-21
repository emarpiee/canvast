# ADR 0206: Comic pages: a Panel tool that cuts panels, moves gutters and merges them

- Status: **accepted** (2026-11-21)
- Related: ADR 0108 (sheets), 0162 (pattern generators and guides), 0198 (tools that make things), 0205 (every action a command)

## Context

The *Comic Panels* guide draws panel lines on a sheet, but they are lines: nothing is held in a panel, and changing the layout means making
the guide again. The owner asked for a comic panel object, as interactive as the speech balloon, easy to slice the way Krita's comic panel
tools are: cut a panel with a line, keep the gutter, move a gutter, merge two panels. Panels must clip the art in them.

## Decision

- **Data**: a comic page is a sheet (`container.clip`) with `container.comic = { gutter }`, the gutter in thousandths of the page's shorter
  side (so it stays right when the page is resized or its units change). Its **panels** are the clipping sheets on it: one closed, convex
  outline each, a white fill and a border drawn *outside* their edge (`align: "outside"`), so the art a panel clips never covers its
  border. Nothing else marks a panel; it is a sheet on a page. Old versions see sheets on a sheet.
- **Geometry** is pure, in `doc/comic.ts`, in the page's units: a cut keeps each side of the line farther than half the gutter (a
  half-plane clip of a convex outline); a gutter is two facing edges of two panels, with every other edge on their lines that faces an edge
  of the other side (one panel above, two below: all three; the gutters of two rows on one line stay two); moving it moves those edges and their corners slide along the edges beside them, refused when an outline
  would fold or a panel grow thinner than a hundredth of the page; a merge is the convex hull of the two outlines; widening the gutters
  moves each edge that faces another by half the change.
- **The Panel tool** (`J`, beside the Speech balloon): a drag on empty canvas makes a page of the chosen size (*As drawn* or a page size,
  portrait or landscape: the same list as the guides, `gen/pages.ts`), laid out in panels inside its margin; a drag across a panel cuts it
  (Shift: straight or at 45°), the knife's line shown and the result shown live; a drag on a gutter moves it; a double-click on a gutter
  merges the two panels across it; a click picks a panel. What lay in a panel goes with the part that holds its middle.
- **Options** (the Properties bar's *Comic page* section, with the tool and whenever a page or its panels are selected): page size and way
  up, layout (one panel, or the guide's twelve), gutter, margin and border, in per cent of the page's shorter side. With a page selected
  they change it: its layout (the panels laid out again, what was in them kept in the one that holds it), its gutters, its borders, its
  shape (as the sheet's Ratio does).
- **Actions bar**: the Sheets menu adds *Cut across*, *Cut down* (through each selected panel's middle) and *Merge panels* (two or more).
- **Commands**: `comic.setOption`, `comic.cutAcross`, `comic.cutDown`, `comic.merge`; the tool's gestures are input on the canvas, as
  drawing a shape is.

## Consequences

- Panels are convex: a cut makes convex parts, and a merge takes the hull (an L-shaped panel is two panels).
- A gutter along several panels moves them all; a double-click on one merges only when it lies between exactly two.
- The *Comic Panels* guide stays, for lines over a picture; the page is for drawing and lettering in.

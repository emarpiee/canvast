# Shapes, sheets and masks

Three words for things that are built from the same stuff. This page says what each is, how they relate and when to use which. (The reasons are in ADR 0108, 0144 and 0147.)

## The relationship in one picture

```
shape            a vector path: a rectangle, ellipse, polygon, star, line or curve
 └─ sheet        a shape that HOLDS other things and cuts them at its edge
     └─ mask     a sheet of ANY shape, made from a shape and what it should cut
```

Underneath they are all the same object, a path. A sheet is a path with a `container` property; a clipping mask is a sheet with `container.mask`. That is why a sheet has a fill, an outline, a corner radius, opacity and blend like any shape, and why the bar shows **Sheet | Shape** chips when you pick one: the Sheet chip has what is only for sheets, the Shape chip the ordinary shape options of the same object.

("Frame" is something else: an internal coordinate space that keeps deep zoom exact, ADR 0014. There is no Frame tool.)

## Shape and path (`U`, and `B` for the path)

Draws vector shapes: rectangle, ellipse, polygon, star, line, and curved paths. A shape stands on its own: it has a fill and an outline, can be edited node by node, combined (union, subtract, divide …), turned into a network, masked, exported. It does not hold anything.

## Sheet (`C`)

A fixed area of the canvas, like a page or an artboard. One drag draws it. It is a rectangle.

| What it does | How |
| --- | --- |
| **Holds** things | Draw or move a thing onto it and it belongs to the sheet; it moves with the sheet and is listed under it in Layers. |
| **Cuts** things at its edge | On by default; the clip button in Layers shows what lies outside. |
| **Has a shape, not a size** | The Sheet bar shows a **Ratio** (`16:9`, `A4 portrait`, `1.5` …), a list of common shapes and **Turn** (portrait ⇄ landscape). A new ratio keeps the area and the top-left corner. |
| **Makes what is on it follow it** | Each thing on a sheet has a **Pin** (left/top by default: it stays put; right, both, centre, or scale). **Scale contents** (kept with the sheet) makes everything on it grow with it, whatever the pins say. |
| **Is measured in per cent** | X, Y, W and H of something on a sheet are per cent of the sheet, so they read the same at any zoom. |
| **Gets a size when it is exported** | **Export…** (Actions bar, Sheet bar, command palette) chooses px, inches, cm or mm at a resolution, from the shape (ADR 0147). |
| Fits and moves | **Fit to contents** shrinks it to what is on it; **Put on a sheet** (`Ctrl+Alt+G`) puts picked things on a new one and **Release** takes it away; the name above a sheet picks it with what is on it. |

Picking: a click on a thing on a sheet picks that thing alone; a click on the empty part of the sheet picks the sheet with everything on it.

## Mask

A **clipping mask** cuts things to the outline of a shape: pick the shape (the top one) and what it should cut, press **Clipping mask** (Actions bar or palette). The shape becomes a **sheet of its own shape**: no fill (its outline stays), named "Mask n", marked as a mask, with the other picked things on it. So a mask is a sheet whose edge is any shape, not only a rectangle. **Release the mask** takes it apart again.

A mask is **one unit**: a click on its output picks the whole mask (so dragging moves the output), the box and handles are the mask's own, and a **double click** goes in so what it cuts is picked one by one; Escape comes out.

Other masks work differently (they are not sheets): by opacity or by brightness (another object's opacity or brightness decides what shows, with Invert), and the brush mask (paint black to hide, white to show, as vector strokes).

## Which to use

| I want … | Use |
| --- | --- |
| to draw something | Shape and path |
| a page or a card that holds several things, with a shape such as 16:9 or A4, and to export it at a size | Sheet |
| a picture (or anything) cut to a blob, a star or a letter | Clipping mask |
| a soft fade or a texture to decide what shows | Mask by opacity or brightness |
| to hide parts of something by painting | Brush mask |

Steps: a sheet is one drag, and things dropped on it are cut at once. A clipping mask needs the shape, the thing to cut, both picked, and one command (the shape's own outline is what cuts, which is what a sheet cannot do).

# ADR 0144 — Masks

- Status: accepted (v0.19.0)

Three kinds, each following how the app already holds relations.

## Clipping mask

The top picked closed shape becomes a **sheet of its own shape** (ADR 0108): `container: { clip: true }`, no fill or outline, named "Mask n", with the other picked things on it (`parent`). Drawing and picking already cut by a sheet's projected outline, whatever its shape (curves, holes, turned), so a clipping mask needed only the command. Release the sheet to undo it.

## Mask by opacity or brightness

`mask: { by, mode: "alpha" | "luminance", invert? }` on an object names a group; the objects of that group marked `isMask` are the mask. The picked things are put in a group (named Masked) with the mask group (named Mask) inside it, so everything moves, stretches, turns, copies and deletes together; copies and canvas copies follow the mask to its new group, and a mask copied without what it cuts stops being one.

- **Drawing.** `src/render/mask.ts`: the object is drawn on a scratch layer, the mask on another; what the mask lets through is kept (`destination-in`; `destination-out` when inverted) and the result is put on the canvas as one picture. Brightness is the mask drawn on black and turned into opacity by an SVG filter (`feColorMatrix`, 0.2126 R + 0.7152 G + 0.0722 B), so soft edges stay soft. A blend mode on a masked object works inside its layer.
- **Hidden masks.** Mask objects are not in the spatial index: they are not drawn, picked, boxed or snapped on their own. A mask is shown, see-through, only while it is picked (Pick the mask, or its row in the Layers panel), so it can be moved to change what shows; it cuts as it is moved.
- Commands (Actions bar and palette): Clipping mask, Mask by opacity, Mask by brightness, Pick the mask, Invert the mask, Release the mask.

## Brush mask

Command "Brush mask: show everything, paint black to hide" (or the other way round) puts a white (or black) rectangle over the picked things as a mask by brightness, and the Pen then paints into the mask while it is open (`editor.maskEdit`): its strokes are `isMask`, in the mask group, black or white by the ink chosen (Actions bar: white/black/Done). Nothing is rasterised: the mask is vector strokes, so it stays sharp at any zoom.

Not done: picking respects the mask (an object is picked by its own shape), SVG export ignores masks, a text or picture used as a mask works (any object does) but the Pen is the only way to paint one.
